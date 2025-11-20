/**
 * Database Schema and Migrations
 */

import { Pool } from 'pg';
import config from '../config';

// Support both individual config and DATABASE_URL
const poolConfig = process.env.DATABASE_URL 
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : config.postgres;

export const pool = new Pool(poolConfig);

/**
 * Initialize database schema
 */
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Create orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        side VARCHAR(10) NOT NULL,
        input_token VARCHAR(255) NOT NULL,
        output_token VARCHAR(255) NOT NULL,
        input_amount VARCHAR(255) NOT NULL,
        output_amount VARCHAR(255),
        slippage_bps INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL,
        selected_dex VARCHAR(50),
        execution_price VARCHAR(255),
        tx_signature VARCHAR(255),
        failure_reason TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    `);

    // Create routing_decisions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS routing_decisions (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL REFERENCES orders(id),
        raydium_quote JSONB,
        meteora_quote JSONB,
        selected_dex VARCHAR(50) NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_routing_order_id ON routing_decisions(order_id);
    `);

    // Create retry_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS retry_logs (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL REFERENCES orders(id),
        attempt_number INTEGER NOT NULL,
        error_message TEXT,
        retry_after_ms INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_retry_logs_order_id ON retry_logs(order_id);
    `);

    await client.query('COMMIT');
    console.log('✅ Database schema initialized successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Database initialization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
}
