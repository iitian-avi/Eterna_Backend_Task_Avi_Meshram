/**
 * Database Repository for Order Operations
 */

import { pool } from './schema';
import { Order, OrderStatus, RoutingDecision } from '../types';

export class OrderRepository {
  /**
   * Create a new order
   */
  async createOrder(order: Order): Promise<void> {
    const query = `
      INSERT INTO orders (
        id, user_id, type, side, input_token, output_token,
        input_amount, output_amount, slippage_bps, status, retry_count,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    const values = [
      order.id,
      order.userId,
      order.type,
      order.side,
      order.inputToken,
      order.outputToken,
      order.inputAmount,
      order.outputAmount || null,
      order.slippageBps,
      order.status,
      order.retryCount,
      order.createdAt,
      order.updatedAt
    ];

    await pool.query(query, values);
  }

  /**
   * Update order status
   */
  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    updates: Partial<Order> = {}
  ): Promise<void> {
    const fields: string[] = ['status = $1', 'updated_at = $2'];
    const values: any[] = [status, new Date()];
    let paramIndex = 3;

    if (updates.selectedDex) {
      fields.push(`selected_dex = $${paramIndex++}`);
      values.push(updates.selectedDex);
    }

    if (updates.executionPrice) {
      fields.push(`execution_price = $${paramIndex++}`);
      values.push(updates.executionPrice);
    }

    if (updates.txSignature) {
      fields.push(`tx_signature = $${paramIndex++}`);
      values.push(updates.txSignature);
    }

    if (updates.failureReason) {
      fields.push(`failure_reason = $${paramIndex++}`);
      values.push(updates.failureReason);
    }

    if (updates.retryCount !== undefined) {
      fields.push(`retry_count = $${paramIndex++}`);
      values.push(updates.retryCount);
    }

    if (status === OrderStatus.CONFIRMED || status === OrderStatus.FAILED) {
      fields.push(`completed_at = $${paramIndex++}`);
      values.push(new Date());
    }

    values.push(orderId);

    const query = `
      UPDATE orders
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
    `;

    await pool.query(query, values);
  }

  /**
   * Get order by ID
   */
  async getOrderById(orderId: string): Promise<Order | null> {
    const query = 'SELECT * FROM orders WHERE id = $1';
    const result = await pool.query(query, [orderId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToOrder(result.rows[0]);
  }

  /**
   * Get orders by user ID
   */
  async getOrdersByUserId(userId: string, limit = 50): Promise<Order[]> {
    const query = `
      SELECT * FROM orders
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [userId, limit]);

    return result.rows.map(row => this.mapRowToOrder(row));
  }

  /**
   * Save routing decision
   */
  async saveRoutingDecision(decision: RoutingDecision): Promise<void> {
    const query = `
      INSERT INTO routing_decisions (
        order_id, raydium_quote, meteora_quote, selected_dex, reason
      ) VALUES ($1, $2, $3, $4, $5)
    `;

    const values = [
      decision.orderId,
      decision.raydiumQuote ? JSON.stringify(decision.raydiumQuote) : null,
      decision.meteoraQuote ? JSON.stringify(decision.meteoraQuote) : null,
      decision.selectedDex,
      decision.reason
    ];

    await pool.query(query, values);
  }

  /**
   * Log retry attempt
   */
  async logRetry(
    orderId: string,
    attemptNumber: number,
    errorMessage: string,
    retryAfterMs: number
  ): Promise<void> {
    const query = `
      INSERT INTO retry_logs (order_id, attempt_number, error_message, retry_after_ms)
      VALUES ($1, $2, $3, $4)
    `;

    await pool.query(query, [orderId, attemptNumber, errorMessage, retryAfterMs]);
  }

  /**
   * Health check - verify database connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await pool.query('SELECT 1');
      return result.rows.length === 1;
    } catch (error) {
      console.error('PostgreSQL health check failed:', error);
      return false;
    }
  }

  /**
   * Map database row to Order object
   */
  private mapRowToOrder(row: any): Order {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      side: row.side,
      inputToken: row.input_token,
      outputToken: row.output_token,
      inputAmount: row.input_amount,
      outputAmount: row.output_amount,
      slippageBps: row.slippage_bps,
      status: row.status,
      selectedDex: row.selected_dex,
      executionPrice: row.execution_price,
      txSignature: row.tx_signature,
      failureReason: row.failure_reason,
      retryCount: row.retry_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at
    };
  }
}
