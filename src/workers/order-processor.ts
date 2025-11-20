/**
 * Order Processing Worker with BullMQ
 * Handles concurrent order processing with exponential backoff retry
 */

import { Worker, Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import config from '../config';
import { OrderJobData, OrderStatus, OrderType, WSMessage, WSMessageType } from '../types';
import { OrderRepository } from '../db/repository';
import { redisCache } from '../db/redis';
import { DEXAggregator } from '../services/dex-aggregator';

// Redis connection for BullMQ (with error suppression)
const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
    // Stop retrying after 3 attempts to avoid log spam
    if (times > 3) {
      return null;
    }
    return Math.min(times * 50, 2000);
  },
  lazyConnect: true
});

// Suppress Redis connection error logs for worker
connection.on('error', () => {
  // Silently fail - Redis is optional
});

// Try to connect, but don't crash if Redis unavailable
connection.connect().catch(() => {
  console.warn('⚠️  Redis unavailable for queue - using fallback mode');
});

// Order queue
export const orderQueue = new Queue('orders', {
  connection,
  defaultJobOptions: {
    attempts: config.retry.maxAttempts,
    backoff: {
      type: 'exponential',
      delay: config.retry.backoffMs
    },
    removeOnComplete: config.queue.removeOnComplete,
    removeOnFail: config.queue.removeOnFail
  }
});

// Initialize repository and aggregator
const orderRepo = new OrderRepository();
const dexAggregator = new DEXAggregator(orderRepo);

/**
 * Order Processing Worker
 */
export const orderWorker = new Worker(
  'orders',
  async (job: Job<OrderJobData>) => {
    const { orderId, order } = job.data;
    
    console.log(`\n[Worker] Processing order ${orderId} (Attempt ${job.attemptsMade + 1}/${config.retry.maxAttempts})`);

    try {
      // Order is now being processed (status already set to PENDING when created)
      // Directly proceed to order-type-specific processing
      
      // Process based on order type
      switch (order.type) {
        case OrderType.MARKET:
          await processMarketOrder(orderId, order);
          break;
        
        case OrderType.LIMIT:
          await processLimitOrder(orderId, order);
          break;
        
        case OrderType.SNIPER:
          await processSniperOrder(orderId, order);
          break;
        
        default:
          throw new Error(`Unsupported order type: ${order.type}`);
      }

      console.log(`[Worker] Order ${orderId} completed successfully`);
      
      return { success: true, orderId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Worker] Order ${orderId} failed:`, errorMessage);

      // Log retry attempt
      await orderRepo.logRetry(
        orderId,
        job.attemptsMade + 1,
        errorMessage,
        calculateBackoffDelay(job.attemptsMade + 1)
      );

      // If this is the last attempt, mark as FAILED
      if (job.attemptsMade + 1 >= config.retry.maxAttempts) {
        await updateOrderStatus(orderId, OrderStatus.FAILED, {
          failureReason: `Failed after ${config.retry.maxAttempts} attempts: ${errorMessage}`
        });
        
        console.error(`[Worker] Order ${orderId} permanently failed after ${config.retry.maxAttempts} attempts`);
      }

      throw error; // Re-throw to trigger retry
    }
  },
  {
    connection,
    concurrency: config.queue.maxConcurrentOrders, // 10 concurrent orders
    limiter: {
      max: config.queue.maxOrdersPerMinute, // 100 orders per minute
      duration: 60000 // 1 minute
    }
  }
);

/**
 * Process MARKET order (immediate execution)
 */
async function processMarketOrder(orderId: string, order: OrderJobData['order']): Promise<void> {
  console.log(`[Worker] Processing MARKET order ${orderId}`);

  // Status: routing - Comparing DEX prices
  await updateOrderStatus(orderId, OrderStatus.ROUTING);
  await broadcastUpdate(orderId, {
    type: WSMessageType.ORDER_STATUS,
    orderId,
    status: OrderStatus.ROUTING,
    message: 'Comparing prices from Raydium and Meteora',
    timestamp: Date.now()
  });

  // Get best quote from DEX aggregator
  const { quote, decision } = await dexAggregator.getBestQuote(
    orderId,
    order.inputToken,
    order.outputToken,
    order.inputAmount,
    order.slippageBps
  );

  // Broadcast routing decision
  await broadcastUpdate(orderId, {
    type: WSMessageType.ORDER_ROUTING,
    orderId,
    status: OrderStatus.ROUTING,
    selectedDex: quote.dex,
    quote,
    message: `Selected ${quote.dex} for best price`,
    timestamp: Date.now()
  });

  // Status: building - Creating transaction
  await updateOrderStatus(orderId, OrderStatus.BUILDING, {
    selectedDex: quote.dex
  });
  await broadcastUpdate(orderId, {
    type: WSMessageType.ORDER_STATUS,
    orderId,
    status: OrderStatus.BUILDING,
    message: 'Building transaction',
    timestamp: Date.now()
  });

  // Execute swap and get transaction ID
  const result = await dexAggregator.executeSwap(quote, order.userId);

  if (!result.success) {
    throw new Error(result.error || 'Swap execution failed');
  }

  // Status: submitted - Transaction sent to network
  await updateOrderStatus(orderId, OrderStatus.SUBMITTED, {
    txSignature: result.signature,
    selectedDex: quote.dex
  });
  await broadcastUpdate(orderId, {
    type: WSMessageType.ORDER_EXECUTION,
    orderId,
    status: OrderStatus.SUBMITTED,
    txHash: result.signature,
    message: 'Transaction submitted to blockchain',
    timestamp: Date.now()
  });

  // Status: confirmed - Transaction successful
  await updateOrderStatus(orderId, OrderStatus.CONFIRMED, {
    txSignature: result.signature,
    executionPrice: result.executionPrice,
    outputAmount: result.outputAmount,
    selectedDex: quote.dex
  });
  await broadcastUpdate(orderId, {
    type: WSMessageType.ORDER_COMPLETE,
    orderId,
    status: OrderStatus.CONFIRMED,
    txHash: result.signature,
    outputAmount: result.outputAmount,
    executionPrice: result.executionPrice,
    message: 'Order executed successfully',
    timestamp: Date.now()
  });

  console.log(`[Worker] MARKET order ${orderId} confirmed with txHash: ${result.signature}`);
}

/**
 * Process LIMIT order (execute when price target is reached)
 */
async function processLimitOrder(orderId: string, order: OrderJobData['order']): Promise<void> {
  console.log(`[Worker] Processing LIMIT order (target: ${order.outputAmount})`);

  // Status: routing - Checking if target price is met
  await updateOrderStatus(orderId, OrderStatus.ROUTING);
  await broadcastUpdate(orderId, {
    type: WSMessageType.ORDER_STATUS,
    orderId,
    status: OrderStatus.ROUTING,
    message: 'Checking if limit price target is met',
    timestamp: Date.now()
  });

  // Get current best quote
  const { quote, decision } = await dexAggregator.getBestQuote(
    orderId,
    order.inputToken,
    order.outputToken,
    order.inputAmount,
    order.slippageBps
  );

  // Check if target price is met
  const currentOutput = BigInt(quote.outputAmount);
  const targetOutput = BigInt(order.outputAmount || '0');

  if (currentOutput < targetOutput) {
    throw new Error(
      `Target price not met. Current: ${currentOutput.toString()}, Target: ${targetOutput.toString()}`
    );
  }

  console.log(`[Worker] LIMIT order price target met. Executing...`);

  // Status: building - Creating transaction
  await updateOrderStatus(orderId, OrderStatus.BUILDING, {
    selectedDex: quote.dex
  });
  await broadcastUpdate(orderId, {
    type: WSMessageType.ORDER_STATUS,
    orderId,
    status: OrderStatus.BUILDING,
    message: 'Limit price met, building transaction',
    timestamp: Date.now()
  });

  // Execute swap
  const result = await dexAggregator.executeSwap(quote, order.userId);

  if (!result.success) {
    throw new Error(result.error || 'Swap execution failed');
  }

  // Status: submitted - Transaction sent
  await updateOrderStatus(orderId, OrderStatus.SUBMITTED, {
    txSignature: result.signature,
    selectedDex: quote.dex
  });
  await broadcastUpdate(orderId, {
    type: WSMessageType.ORDER_EXECUTION,
    orderId,
    status: OrderStatus.SUBMITTED,
    txHash: result.signature,
    message: 'Transaction submitted',
    timestamp: Date.now()
  });

  // Status: confirmed - Success
  await updateOrderStatus(orderId, OrderStatus.CONFIRMED, {
    txSignature: result.signature,
    executionPrice: result.executionPrice,
    outputAmount: result.outputAmount,
    selectedDex: quote.dex
  });
  await broadcastUpdate(orderId, {
    type: WSMessageType.ORDER_COMPLETE,
    orderId,
    status: OrderStatus.CONFIRMED,
    txHash: result.signature,
    outputAmount: result.outputAmount,
    executionPrice: result.executionPrice,
    message: 'Limit order executed successfully',
    timestamp: Date.now()
  });
}

/**
 * Process SNIPER order (execute on token launch/migration)
 */
async function processSniperOrder(orderId: string, order: OrderJobData['order']): Promise<void> {
  console.log(`[Worker] Processing SNIPER order`);

  // TODO: Implement token launch/migration detection
  // For now, treat as MARKET order
  
  await processMarketOrder(orderId, order);
}

/**
 * Update order status in both DB and cache
 */
async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  updates: Partial<OrderJobData['order']> = {}
): Promise<void> {
  // Update in database
  await orderRepo.updateOrderStatus(orderId, status, updates);
  
  // Update in cache
  await redisCache.updateOrderStatus(orderId, status, updates);
}

/**
 * Broadcast WebSocket update to all connected clients
 */
async function broadcastUpdate(orderId: string, message: WSMessage): Promise<void> {
  try {
    await redisCache.publishOrderUpdate(orderId, message);
  } catch (error) {
    console.error(`Failed to broadcast update for order ${orderId}:`, error);
  }
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attemptNumber: number): number {
  return config.retry.backoffMs * Math.pow(config.retry.backoffMultiplier, attemptNumber - 1);
}

// Worker event listeners
orderWorker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

orderWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

orderWorker.on('error', (err) => {
  console.error('Worker error:', err);
});

console.log('✅ Order worker initialized');
console.log(`   - Max concurrent orders: ${config.queue.maxConcurrentOrders}`);
console.log(`   - Max orders per minute: ${config.queue.maxOrdersPerMinute}`);
console.log(`   - Max retry attempts: ${config.retry.maxAttempts}`);
