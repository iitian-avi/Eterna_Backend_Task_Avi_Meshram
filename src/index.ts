/**
 * Solana DEX Trading Bot - Main Entry Point
 */

import Fastify from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import config from './config';
import { initDatabase } from './db/schema';
import { registerRoutes } from './routes';
import { orderWorker } from './workers/order-processor';

const fastify = Fastify({
  logger: {
    level: config.logging.level,
    transport: config.logging.prettyPrint
      ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname'
          }
        }
      : undefined
  }
});

async function start() {
  try {
    console.log('\n🚀 Starting Solana DEX Trading Bot...\n');

    // Initialize database
    console.log('📊 Initializing database...');
    await initDatabase();

    // Register WebSocket plugin
    console.log('🔌 Registering WebSocket plugin...');
    await fastify.register(fastifyWebSocket);

    // Register routes
    console.log('🛣️  Registering routes...');
    await registerRoutes(fastify);

    // Start server
    await fastify.listen({
      port: config.server.port,
      host: config.server.host
    });

    const displayHost = config.server.host === '0.0.0.0' ? 'localhost' : config.server.host;
    
    console.log('\n✅ Server ready!');
    console.log(`   - HTTP Server: http://${displayHost}:${config.server.port}`);
    console.log(`   - WebSocket: ws://${displayHost}:${config.server.port}/ws/orders/:orderId`);
    console.log(`   - Listening on: ${config.server.host}:${config.server.port} (all interfaces)`);
    console.log(`   - Environment: ${config.server.env}`);
    console.log(`   - Solana RPC: ${config.solana.rpcUrl}`);
    console.log('\n📋 Available endpoints:');
    console.log('   POST   /api/orders/execute  - Create new order');
    console.log('   GET    /api/orders/:id      - Get order details');
    console.log('   GET    /ws/orders/:id       - WebSocket status stream');
    console.log('   GET    /health              - Health check');
    console.log('\n⚙️  Worker Configuration:');
    console.log(`   - Max concurrent: ${config.queue.maxConcurrentOrders} orders`);
    console.log(`   - Rate limit: ${config.queue.maxOrdersPerMinute} orders/min`);
    console.log(`   - Retry attempts: ${config.retry.maxAttempts}`);
    console.log(`   - Backoff: ${config.retry.backoffMs}ms (exponential)`);
    console.log('\n');
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\n\n⚠️  Received ${signal}, shutting down gracefully...`);

    try {
      // Close worker
      console.log('Closing order worker...');
      await orderWorker.close();

      // Close Fastify
      console.log('Closing HTTP server...');
      await fastify.close();

      console.log('✅ Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
start();
