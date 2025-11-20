/**
 * Redis Cache Service for Active Orders
 */

import Redis from 'ioredis';
import config from '../config';
import { Order, OrderStatus } from '../types';

export class RedisCache {
  private redis: Redis | null = null;
  private inMemoryCache: Map<string, string> = new Map();
  private readonly ORDER_PREFIX = 'order:';
  private readonly ORDER_TTL = 86400; // 24 hours

  constructor() {
    try {
      this.redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        retryStrategy: (times) => {
          if (times > 3) {
            console.warn('⚠️  Redis unavailable, using in-memory cache');
            return null; // Stop retrying
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        lazyConnect: true
      });

      this.redis.on('error', (err) => {
        console.warn('⚠️  Redis error, falling back to in-memory cache:', err.message);
        this.redis = null;
      });

      this.redis.on('connect', () => {
        console.log('✅ Redis connected');
      });

      // Try to connect, but don't fail if Redis is unavailable
      this.redis.connect().catch(() => {
        console.warn('⚠️  Redis connection failed, using in-memory cache');
        this.redis = null;
      });
    } catch (error) {
      console.warn('⚠️  Redis initialization failed, using in-memory cache');
      this.redis = null;
    }
  }

  /**
   * Set order in cache
   */
  async setOrder(order: Order): Promise<void> {
    const key = this.getOrderKey(order.id);
    
    if (this.redis) {
      try {
        await this.redis.setex(key, this.ORDER_TTL, JSON.stringify(order));
      } catch (error) {
        console.warn('Redis setOrder failed, using in-memory:', error);
        this.inMemoryCache.set(key, JSON.stringify(order));
      }
    } else {
      this.inMemoryCache.set(key, JSON.stringify(order));
    }
  }

  /**
   * Get order from cache
   */
  async getOrder(orderId: string): Promise<Order | null> {
    const key = this.getOrderKey(orderId);
    
    if (this.redis) {
      try {
        const data = await this.redis.get(key);
        if (!data) return null;
        return JSON.parse(data);
      } catch (error) {
        console.warn('Redis getOrder failed, using in-memory:', error);
      }
    }
    
    const data = this.inMemoryCache.get(key);
    if (!data) return null;
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
    
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (error) {
        console.warn('Redis deleteOrder failed');
      }
    }
    
    this.inMemoryCache.delete(key);
  }

  /**
   * Get all active orders
   */
  async getActiveOrders(): Promise<Order[]> {
    if (this.redis) {
      try {
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
      } catch (error) {
        console.warn('Redis getActiveOrders failed, using in-memory');
      }
    }
    
    // Fallback to in-memory
    const orders: Order[] = [];
    for (const [key, value] of this.inMemoryCache.entries()) {
      if (key.startsWith(this.ORDER_PREFIX)) {
        try {
          orders.push(JSON.parse(value));
        } catch (e) {
          console.error('Failed to parse order from memory:', e);
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
    
    if (this.redis) {
      try {
        const count = await this.redis.incr(key);
        
        // Set expiry on first increment
        if (count === 1) {
          await this.redis.expire(key, 60); // 60 seconds window
        }

        return count;
      } catch (error) {
        console.warn('Redis incrementRateLimit failed');
      }
    }
    
    // In-memory fallback (basic implementation)
    return 1; // Always allow in fallback mode
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
    if (this.redis) {
      try {
        const channel = `order:${orderId}`;
        await this.redis.publish(channel, JSON.stringify(message));
      } catch (error) {
        console.warn('Redis publish failed:', error);
      }
    }
    // Note: WebSocket broadcasting works without Redis pub/sub
    // Direct connections handle messaging
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch (error) {
        console.warn('Redis close failed:', error);
      }
    }
    this.inMemoryCache.clear();
  }

  /**
   * Get Redis client for health checks
   */
  getClient(): Redis | null {
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
