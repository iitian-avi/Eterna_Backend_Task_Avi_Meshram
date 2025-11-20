/**
 * API Routes with HTTP → WebSocket upgrade pattern
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';
import { orderQueue } from '../workers/order-processor';
import { OrderRepository } from '../db/repository';
import { redisCache } from '../db/redis';
import {
  CreateOrderRequest,
  CreateOrderResponse,
  Order,
  OrderStatus,
  OrderType,
  WSMessage,
  WSMessageType
} from '../types';

const orderRepo = new OrderRepository();

// Active WebSocket connections (orderId -> Set of connections)
const wsConnections = new Map<string, Set<any>>();

export async function registerRoutes(fastify: FastifyInstance) {
  /**
   * GET /health
   * Health check endpoint for monitoring and load balancers
   */
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check Redis connection
      const redisHealthy = await redisCache.getClient().ping() === 'PONG';
      
      // Check PostgreSQL connection
      const pgHealthy = await orderRepo.healthCheck();
      
      // Check queue status (simple check - queue object exists)
      const queueHealthy = orderQueue !== null && orderQueue !== undefined;

      const allHealthy = redisHealthy && pgHealthy && queueHealthy;

      return reply.code(allHealthy ? 200 : 503).send({
        status: allHealthy ? 'ok' : 'degraded',
        timestamp: Date.now(),
        services: {
          redis: redisHealthy ? 'connected' : 'disconnected',
          postgres: pgHealthy ? 'connected' : 'disconnected',
          queue: queueHealthy ? 'active' : 'inactive'
        }
      });
    } catch (error) {
      return reply.code(503).send({
        status: 'error',
        timestamp: Date.now(),
        error: 'Health check failed'
      });
    }
  });

  /**
   * POST /api/orders/execute
   * Create and execute a new order
   * Returns orderId and WebSocket URL for status streaming
   */
  fastify.post<{
    Body: CreateOrderRequest
  }>(
    '/api/orders/execute',
    async (request: FastifyRequest<{ Body: CreateOrderRequest }>, reply: FastifyReply) => {
      try {
        const {
          userId = 'default',
          type,
          side,
          inputToken,
          outputToken,
          inputAmount,
          outputAmount,
          slippageBps = 100 // Default 1%
        } = request.body;

        // Validation
        if (!type || !side || !inputToken || !outputToken || !inputAmount) {
          return reply.code(400).send({
            success: false,
            error: 'Missing required fields'
          });
        }

        // Validate order type
        if (!Object.values(OrderType).includes(type)) {
          return reply.code(400).send({
            success: false,
            error: `Invalid order type. Must be one of: ${Object.values(OrderType).join(', ')}`
          });
        }

        // LIMIT orders require outputAmount
        if (type === OrderType.LIMIT && !outputAmount) {
          return reply.code(400).send({
            success: false,
            error: 'LIMIT orders require outputAmount'
          });
        }

        // Rate limiting check
        const isRateLimited = await redisCache.isRateLimited(userId);
        if (isRateLimited) {
          return reply.code(429).send({
            success: false,
            error: 'Rate limit exceeded. Maximum 100 orders per minute.'
          });
        }

        // Create order
        const orderId = uuidv4();
        const now = new Date();

        const order: Order = {
          id: orderId,
          userId,
          type,
          side,
          inputToken,
          outputToken,
          inputAmount,
          outputAmount,
          slippageBps,
          status: OrderStatus.PENDING,
          retryCount: 0,
          createdAt: now,
          updatedAt: now
        };

        // Save to database and cache
        await orderRepo.createOrder(order);
        await redisCache.setOrder(order);

        // Add to queue
        await orderQueue.add('process-order', {
          orderId,
          order,
          retryCount: 0
        });

        console.log(`[API] Order ${orderId} created and queued`);

        // Generate WebSocket URL based on request
        const protocol = request.headers['x-forwarded-proto'] || (request.protocol || 'http');
        const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
        const host = request.headers['x-forwarded-host'] || request.headers.host || `${config.server.host}:${config.server.port}`;
        const websocketUrl = `${wsProtocol}://${host}/ws/orders/${orderId}`;

        // Return orderId immediately
        const response: CreateOrderResponse = {
          orderId,
          status: OrderStatus.PENDING,
          message: 'Order created. Connect to WebSocket for real-time updates.',
          websocketUrl
        };

        return reply.code(201).send({
          success: true,
          data: response
        });
      } catch (error) {
        console.error('[API] Order creation failed:', error);
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Internal server error'
        });
      }
    }
  );

  /**
   * GET /api/orders/:orderId
   * Get order details
   */
  fastify.get<{
    Params: { orderId: string }
  }>(
    '/api/orders/:orderId',
    async (request: FastifyRequest<{ Params: { orderId: string } }>, reply: FastifyReply) => {
      const { orderId } = request.params;

      try {
        // Try cache first
        let order = await redisCache.getOrder(orderId);

        // Fallback to database
        if (!order) {
          order = await orderRepo.getOrderById(orderId);
        }

        if (!order) {
          return reply.code(404).send({
            success: false,
            error: 'Order not found'
          });
        }

        return reply.send({
          success: true,
          data: order
        });
      } catch (error) {
        console.error('[API] Get order failed:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  );

  /**
   * WebSocket endpoint: /ws/orders/:orderId
   * Stream order status updates
   */
  fastify.get<{
    Params: { orderId: string }
  }>(
    '/ws/orders/:orderId',
    { websocket: true },
    async (connection, request: FastifyRequest<{ Params: { orderId: string } }>) => {
      const { orderId } = request.params;

      console.log(`[WebSocket] Client connected for order ${orderId}`);

      // Add connection to tracking
      if (!wsConnections.has(orderId)) {
        wsConnections.set(orderId, new Set());
      }
      wsConnections.get(orderId)!.add(connection);

      // Send initial order status
      try {
        const order = await redisCache.getOrder(orderId) || await orderRepo.getOrderById(orderId);
        
        if (order) {
          const message: WSMessage = {
            type: WSMessageType.ORDER_STATUS,
            orderId,
            timestamp: Date.now(),
            data: {
              status: order.status,
              order
            }
          };
          connection.socket.send(JSON.stringify(message));
        } else {
          const errorMessage: WSMessage = {
            type: WSMessageType.ERROR,
            orderId,
            timestamp: Date.now(),
            data: {
              error: 'Order not found'
            }
          };
          connection.socket.send(JSON.stringify(errorMessage));
          connection.socket.close();
          return;
        }
      } catch (error) {
        console.error('[WebSocket] Error sending initial status:', error);
      }

      // Handle client disconnect
      connection.socket.on('close', () => {
        console.log(`[WebSocket] Client disconnected from order ${orderId}`);
        const connections = wsConnections.get(orderId);
        if (connections) {
          connections.delete(connection);
          if (connections.size === 0) {
            wsConnections.delete(orderId);
          }
        }
      });

      // Handle client messages (optional - for cancellation, etc.)
      connection.socket.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());
          console.log(`[WebSocket] Received message for order ${orderId}:`, data);
          // Handle commands like 'cancel', etc.
        } catch (error) {
          console.error('[WebSocket] Invalid message:', error);
        }
      });
    }
  );

  /**
   * Health check
   */
  fastify.get('/health', async (request, reply) => {
    return {
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString()
      }
    };
  });
}

/**
 * Broadcast order update to all connected WebSocket clients
 * This should be called from the worker when order status changes
 */
export function broadcastOrderUpdate(orderId: string, message: WSMessage): void {
  const connections = wsConnections.get(orderId);
  
  if (!connections || connections.size === 0) {
    return;
  }

  const messageStr = JSON.stringify(message);
  
  connections.forEach((connection) => {
    try {
      connection.socket.send(messageStr);
    } catch (error) {
      console.error(`[WebSocket] Failed to send message to client:`, error);
    }
  });

  console.log(`[WebSocket] Broadcast to ${connections.size} client(s) for order ${orderId}`);
}
