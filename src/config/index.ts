/**
 * Application Configuration
 */

import dotenv from 'dotenv';
import { PublicKey } from '@solana/web3.js';

dotenv.config();

export const config = {
  // Server
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },

  // Solana
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    wsUrl: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
    commitment: 'confirmed' as const
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: 0
  },

  // PostgreSQL
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'solana_dex_bot',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: 20, // connection pool size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  },

  // Queue
  queue: {
    maxConcurrentOrders: parseInt(process.env.MAX_CONCURRENT_ORDERS || '10', 10),
    maxOrdersPerMinute: parseInt(process.env.MAX_ORDERS_PER_MINUTE || '100', 10),
    jobTimeout: 60000, // 60 seconds
    removeOnComplete: 100, // keep last 100 completed jobs
    removeOnFail: 500 // keep last 500 failed jobs
  },

  // Retry
  retry: {
    maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10),
    backoffMs: parseInt(process.env.RETRY_BACKOFF_MS || '1000', 10),
    backoffMultiplier: 2 // exponential backoff
  },

  // DEX
  dex: {
    raydium: {
      programId: new PublicKey(
        process.env.RAYDIUM_PROGRAM_ID || '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
      )
    },
    meteora: {
      programId: new PublicKey(
        process.env.METEORA_PROGRAM_ID || 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB'
      )
    }
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    prettyPrint: process.env.NODE_ENV === 'development'
  },

  // Rate Limiting
  rateLimit: {
    windowMs: 60000, // 1 minute
    maxRequests: 100 // 100 requests per minute
  }
};

// Validation
if (!process.env.SOLANA_RPC_URL && config.server.env === 'production') {
  console.warn('Warning: Using default Solana RPC URL. Set SOLANA_RPC_URL for production.');
}

export default config;
