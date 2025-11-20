/**
 * Redis Cache Service for Active Orders
 */

import Redis from 'ioredis';
import config from '../config';
import { Order, OrderStatus } from '../types';

export class RedisCache {
  private redis: Redis;
  private readonly ORDER_PREFIX = 'order:';
  private readonly ORDER_TTL = 86400; // 24 hours

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    this.redis.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    this.redis.on('connect', () => {
      console.log('✅ Redis connected');
    });
  }

  /**
   * Set order in cache
   */
  async setOrder(order: Order): Promise<void> {
    const key = this.getOrderKey(order.id);
    await this.redis.setex(key, this.ORDER_TTL, JSON.stringify(order));
  }

  /**
   * Get order from cache
   */
  async getOrder(orderId: string): Promise<Order | null> {
    const key = this.getOrderKey(orderId);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * Update order status in cache
   */
  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    updates: Partial<Order> = {}
  ): Promise<void> {
    const order = await this.getOrder(orderId);

    if (!order) {
      return;
    }

    const updatedOrder: Order = {
      ...order,
      status,
      ...updates,
      updatedAt: new Date()
    };

    await this.setOrder(updatedOrder);
  }

  /**
   * Delete order from cache
   */
  async deleteOrder(orderId: string): Promise<void> {
    const key = this.getOrderKey(orderId);
    await this.redis.del(key);
  }

  /**
   * Get all active orders
   */
  async getActiveOrders(): Promise<Order[]> {
    const keys = await this.redis.keys(`${this.ORDER_PREFIX}*`);
    
    if (keys.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    
    const results = await pipeline.exec();
    
    if (!results) {
      return [];
    }

    const orders: Order[] = [];
    
    for (const [err, data] of results) {
      if (!err && data) {
        try {
          orders.push(JSON.parse(data as string));
        } catch (e) {
          console.error('Failed to parse order from cache:', e);
        }
      }
    }

    return orders;
  }

  /**
   * Increment rate limit counter
   */
  async incrementRateLimit(userId: string): Promise<number> {
    const key = `ratelimit:${userId}`;
    const count = await this.redis.incr(key);
    
    // Set expiry on first increment
    if (count === 1) {
      await this.redis.expire(key, 60); // 60 seconds window
    }

    return count;
  }

  /**
   * Check if user is rate limited
   */
  async isRateLimited(userId: string): Promise<boolean> {
    const count = await this.incrementRateLimit(userId);
    return count > config.rateLimit.maxRequests;
  }

  /**
   * Publish order update to WebSocket subscribers
   */
  async publishOrderUpdate(orderId: string, message: any): Promise<void> {
    const channel = `order:${orderId}`;
    await this.redis.publish(channel, JSON.stringify(message));
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }

  /**
   * Get Redis client for health checks
   */
  getClient(): Redis {
    return this.redis;
  }

  /**
   * Get order cache key
   */
  private getOrderKey(orderId: string): string {
    return `${this.ORDER_PREFIX}${orderId}`;
  }
}

// Singleton instance
export const redisCache = new RedisCache();
