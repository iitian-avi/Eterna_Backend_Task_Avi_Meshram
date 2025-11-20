/**
 * Core type definitions for Solana DEX Trading Bot
 */

import { PublicKey } from '@solana/web3.js';

/**
 * Order Types
 */
export enum OrderType {
  MARKET = 'MARKET',   // Execute immediately at current best price
  LIMIT = 'LIMIT',     // Execute when target price is reached
  SNIPER = 'SNIPER'    // Execute on token launch/migration
}

/**
 * Order Status
 */
export enum OrderStatus {
  PENDING = 'pending',           // Order received and queued
  ROUTING = 'routing',           // Comparing DEX prices
  BUILDING = 'building',         // Creating transaction
  SUBMITTED = 'submitted',       // Transaction sent to network
  CONFIRMED = 'confirmed',       // Transaction successful
  FAILED = 'failed'              // If any step fails
}

/**
 * DEX Platforms
 */
export enum DEXPlatform {
  RAYDIUM = 'RAYDIUM',
  METEORA = 'METEORA'
}

/**
 * Order Side
 */
export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

/**
 * Order Interface
 */
export interface Order {
  id: string;
  userId: string;
  type: OrderType;
  side: OrderSide;
  inputToken: string;        // Token mint address
  outputToken: string;       // Token mint address
  inputAmount: string;       // Amount in smallest unit (lamports)
  outputAmount?: string;     // For LIMIT orders
  slippageBps: number;       // Slippage in basis points (e.g., 100 = 1%)
  status: OrderStatus;
  selectedDex?: DEXPlatform;
  executionPrice?: string;
  txSignature?: string;
  failureReason?: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * DEX Quote Interface
 */
export interface DEXQuote {
  dex: DEXPlatform;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  priceImpact: number;       // Price impact percentage
  minimumReceived: string;   // After slippage
  fee: string;               // DEX fee
  route: string[];           // Token route (for multi-hop swaps)
}

/**
 * Order Create Request
 */
export interface CreateOrderRequest {
  userId?: string;
  type: OrderType;
  side: OrderSide;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount?: string;     // Required for LIMIT orders
  slippageBps?: number;      // Default: 100 (1%)
}

/**
 * Order Create Response
 */
export interface CreateOrderResponse {
  orderId: string;
  status: OrderStatus;
  message: string;
  websocketUrl?: string;     // Optional WebSocket URL for connecting
}

/**
 * WebSocket Message Types
 */
export enum WSMessageType {
  ORDER_STATUS = 'ORDER_STATUS',
  ORDER_ROUTING = 'ORDER_ROUTING',
  ORDER_EXECUTION = 'ORDER_EXECUTION',
  ORDER_COMPLETE = 'ORDER_COMPLETE',
  ORDER_FAILED = 'ORDER_FAILED',
  ERROR = 'ERROR'
}

/**
 * WebSocket Message Interface
 */
export interface WSMessage {
  type: WSMessageType;
  orderId: string;
  timestamp: number;
  status?: OrderStatus;
  message?: string;
  data?: any;
  // Additional fields for specific message types
  selectedDex?: DEXPlatform;
  quote?: DEXQuote;
  txHash?: string;
  outputAmount?: string;
  executionPrice?: string;
  error?: string;
}

/**
 * Routing Decision Log
 */
export interface RoutingDecision {
  orderId: string;
  raydiumQuote?: DEXQuote;
  meteoraQuote?: DEXQuote;
  selectedDex: DEXPlatform;
  reason: string;
  timestamp: Date;
}

/**
 * Retry Configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
}

/**
 * Order Queue Job Data
 */
export interface OrderJobData {
  orderId: string;
  order: Order;
  retryCount: number;
}

/**
 * Transaction Result
 */
export interface TransactionResult {
  success: boolean;
  signature?: string;
  error?: string;
  inputAmount: string;
  outputAmount?: string;
  executionPrice?: string;
}
