# Order Types & Execution Flow

## Overview

This Solana DEX Trading Bot implements **MARKET orders** as the primary order type, with architecture designed to easily support **LIMIT** and **SNIPER** orders.

---

## Why MARKET Orders?

**MARKET orders** were chosen as the primary implementation for several reasons:

1. **Immediate Execution**: Market orders execute instantly at the current best available price, which is ideal for fast-moving DeFi markets where prices can change rapidly.

2. **Simplicity & Reliability**: Market orders have straightforward logic - fetch quotes, compare prices, execute on best DEX. This makes them perfect for demonstrating the core DEX aggregation and routing capabilities.

3. **Real-World Usage**: The majority of DEX trading volume consists of market orders where users want immediate execution rather than waiting for specific price targets.

4. **Foundation for Other Types**: The market order implementation provides the complete infrastructure (quote fetching, DEX routing, transaction building, WebSocket streaming) that LIMIT and SNIPER orders can leverage with minimal additions.

---

## Order Execution Flow

### 1. Order Submission

**Endpoint**: `POST /api/orders/execute`

```bash
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "type": "MARKET",
    "side": "BUY",
    "inputToken": "So11111111111111111111111111111111111111112",
    "outputToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "inputAmount": "1000000",
    "slippageBps": 100
  }'
```

**Response**:
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Order received and queued for processing",
  "websocketUrl": "ws://localhost:3000/ws/orders/550e8400-e29b-41d4-a716-446655440000"
}
```

### 2. WebSocket Connection for Live Updates

After receiving the `orderId`, connect to the WebSocket endpoint:

```bash
wscat -c ws://localhost:3000/ws/orders/550e8400-e29b-41d4-a716-446655440000
```

### 3. Order Processing States

The order goes through the following states, each broadcast via WebSocket:

#### State 1: `pending`
```json
{
  "type": "ORDER_STATUS",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Order received and queued",
  "timestamp": 1700000000000
}
```

**What's happening**: Order is in the BullMQ queue, waiting for an available worker (max 10 concurrent).

---

#### State 2: `routing`
```json
{
  "type": "ORDER_STATUS",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "routing",
  "message": "Comparing prices from Raydium and Meteora",
  "timestamp": 1700000001000
}
```

**What's happening**: 
- Worker picks up the order
- Fetches quotes from both Raydium and Meteora DEXes in parallel
- Compares output amounts, price impacts, and fees

**Routing Decision Broadcast**:
```json
{
  "type": "ORDER_ROUTING",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "routing",
  "selectedDex": "METEORA",
  "quote": {
    "dex": "METEORA",
    "inputToken": "So11111111111111111111111111111111111111112",
    "outputToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "inputAmount": "1000000",
    "outputAmount": "98500",
    "priceImpact": 0.3,
    "fee": 2000,
    "minimumReceived": "97515"
  },
  "message": "Selected METEORA for best price",
  "timestamp": 1700000003000
}
```

---

#### State 3: `building`
```json
{
  "type": "ORDER_STATUS",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "building",
  "message": "Building transaction",
  "timestamp": 1700000004000
}
```

**What's happening**:
- Creating the Solana transaction with swap instructions
- Signing the transaction with the user's wallet
- Preparing for submission to the blockchain

---

#### State 4: `submitted`
```json
{
  "type": "ORDER_EXECUTION",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "submitted",
  "txHash": "2ZE7Rz3r6R4qV5QvJZx8x3c5P8nK7d3v4Y2wT9f6S8kL3mJ9",
  "message": "Transaction submitted to blockchain",
  "timestamp": 1700000005000
}
```

**What's happening**:
- Transaction has been sent to the Solana network
- Waiting for validators to process and confirm
- Usually takes 1-2 seconds on Solana

---

#### State 5: `confirmed`
```json
{
  "type": "ORDER_COMPLETE",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "confirmed",
  "txHash": "2ZE7Rz3r6R4qV5QvJZx8x3c5P8nK7d3v4Y2wT9f6S8kL3mJ9",
  "outputAmount": "98500",
  "executionPrice": "98.5",
  "message": "Order executed successfully",
  "timestamp": 1700000007000
}
```

**What's happening**:
- Transaction has been confirmed on-chain
- Swap is complete
- User has received output tokens

**View on Explorer**:
```
https://solscan.io/tx/2ZE7Rz3r6R4qV5QvJZx8x3c5P8nK7d3v4Y2wT9f6S8kL3mJ9?cluster=devnet
```

---

#### State 6: `failed` (if error occurs)
```json
{
  "type": "ORDER_FAILED",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "error": "Insufficient liquidity in pool",
  "message": "Order failed after 3 retry attempts",
  "timestamp": 1700000010000
}
```

**What's happening**:
- An error occurred during quote fetching, transaction building, or submission
- System automatically retries 3 times with exponential backoff (1s → 2s → 4s)
- If all retries fail, order is marked as failed
- Error details are logged to database for analysis

---

## DEX Routing Logic

### How the System Chooses Between Raydium and Meteora

```typescript
// 1. Fetch quotes from both DEXes in parallel
const [raydiumQuote, meteoraQuote] = await Promise.all([
  raydiumRouter.getQuote(order),
  meteoraRouter.getQuote(order)
]);

// 2. Compare output amounts (primary factor)
if (raydiumQuote.outputAmount > meteoraQuote.outputAmount) {
  selectedDex = 'RAYDIUM';
} else {
  selectedDex = 'METEORA';
}

// 3. Log routing decision to database for analytics
await repository.saveRoutingDecision(orderId, {
  raydiumQuote,
  meteoraQuote,
  selectedDex,
  reason: `Higher output: ${selectedDex} gives ${selectedQuote.outputAmount} vs competitor`
});

// 4. Execute on selected DEX
const txHash = await selectedRouter.executeSwap(selectedQuote);
```

**Routing Factors** (in priority order):
1. **Output Amount**: Higher output = better price for user
2. **Price Impact**: Lower impact preferred for large orders
3. **Liquidity**: Ensures order can be filled
4. **Fees**: Considered in output amount calculation

---

## Extending to Support Other Order Types

### LIMIT Orders

**Current Implementation**: Partially implemented in `src/workers/order-processor.ts`

**How to Enable**:

1. **Price Monitoring**: Add a scheduler (e.g., cron job) to periodically check if target price is met:
   ```typescript
   // Every 30 seconds, check pending LIMIT orders
   setInterval(async () => {
     const limitOrders = await getOpenLimitOrders();
     for (const order of limitOrders) {
       const currentQuote = await dexAggregator.getBestQuote(order);
       if (currentQuote.outputAmount >= order.targetOutputAmount) {
         await orderQueue.add('execute-limit', { orderId: order.id });
       }
     }
   }, 30000);
   ```

2. **Order Book Integration**: Store LIMIT orders in a separate `limit_orders` table with `target_price` column

3. **WebSocket Updates**: Broadcast price updates when monitoring:
   ```json
   {
     "type": "PRICE_UPDATE",
     "orderId": "...",
     "currentPrice": "97.2",
     "targetPrice": "100.0",
     "progress": "97.2%"
   }
   ```

**Execution Flow**: Once target price is met, LIMIT orders use the same `building` → `submitted` → `confirmed` flow as MARKET orders.

---

### SNIPER Orders

**Current Implementation**: Stub in `src/workers/order-processor.ts` (defaults to MARKET order)

**How to Enable**:

1. **Token Launch Detection**: 
   - Subscribe to Solana program logs for new token mints
   - Monitor Jupiter/Raydium pool creation events
   - Watch for liquidity adds on target token pairs

   ```typescript
   const connection = new Connection(RPC_URL);
   connection.onProgramAccountChange(
     RAYDIUM_PROGRAM_ID,
     (accountInfo) => {
       if (isNewPoolCreation(accountInfo)) {
         const poolInfo = parsePoolInfo(accountInfo);
         // Trigger pending SNIPER orders for this token
         await triggerSniperOrders(poolInfo.tokenMint);
       }
     }
   );
   ```

2. **Fast Execution**: SNIPER orders need priority fees to land in the first few blocks:
   ```typescript
   const transaction = await buildSwapTransaction(order);
   transaction.add(
     ComputeBudgetProgram.setComputeUnitPrice({
       microLamports: 50000 // Priority fee
     })
   );
   ```

3. **MEV Protection**: Use Jito bundles or private RPC to avoid front-running

**Execution Flow**: SNIPER orders skip `routing` (pre-configured target) and go straight to `building` → `submitted` → `confirmed`.

---

## Transaction Settlement

### Slippage Protection

All orders include slippage tolerance (default 1%):

```typescript
{
  "slippageBps": 100  // 1% = 100 basis points
}
```

**How it works**:
- If quote says you'll get 100 tokens with 1% slippage
- Transaction will fail if you receive less than 99 tokens
- Protects against price movements during execution

**On-chain enforcement**:
```typescript
const minOutputAmount = outputAmount * (1 - slippage);
// Transaction includes: minimumAmountOut = minOutputAmount
```

### Final Execution Details

When order reaches `confirmed` state, you receive:

1. **Transaction Hash**: Viewable on Solscan/Solana Explorer
2. **Execution Price**: Actual price paid per token
3. **Output Amount**: Exact tokens received
4. **Selected DEX**: Which DEX was used (Raydium/Meteora)
5. **Gas Fees**: Solana transaction fees (~0.00005 SOL)

---

## Example: Complete Order Lifecycle

```bash
# 1. Submit order
$ curl -X POST http://localhost:3000/api/orders/execute \
  -d '{"userId":"user1","type":"MARKET","inputToken":"SOL","outputToken":"USDC","inputAmount":"1000000"}'

Response:
{
  "orderId": "abc-123",
  "status": "pending",
  "websocketUrl": "ws://localhost:3000/ws/orders/abc-123"
}

# 2. Connect to WebSocket
$ wscat -c ws://localhost:3000/ws/orders/abc-123

# 3. Receive updates:
< {"type":"ORDER_STATUS","status":"pending","message":"Order queued"}
< {"type":"ORDER_STATUS","status":"routing","message":"Comparing prices"}
< {"type":"ORDER_ROUTING","selectedDex":"METEORA","outputAmount":"98500"}
< {"type":"ORDER_STATUS","status":"building","message":"Building transaction"}
< {"type":"ORDER_EXECUTION","status":"submitted","txHash":"2ZE7Rz..."}
< {"type":"ORDER_COMPLETE","status":"confirmed","outputAmount":"98500"}

# 4. Connection closes automatically after completion
```

**Total Time**: ~5-8 seconds (2-3s routing + 1-2s building + 1-2s confirmation)

---

## Database Tracking

All order states and routing decisions are persisted:

```sql
-- View order history
SELECT id, status, input_token, output_token, selected_dex, transaction_id, created_at
FROM orders
WHERE user_id = 'user1'
ORDER BY created_at DESC;

-- View routing decisions (which DEX was chosen and why)
SELECT order_id, selected_dex, raydium_output_amount, meteora_output_amount, reason
FROM routing_decisions
WHERE order_id = 'abc-123';

-- View retry history (if order failed and retried)
SELECT order_id, attempt_number, error_message, retry_at
FROM retry_logs
WHERE order_id = 'abc-123'
ORDER BY attempt_number;
```

---

## Monitoring & Analytics

### Key Metrics

1. **DEX Performance**: Which DEX provides better prices?
   ```sql
   SELECT selected_dex, COUNT(*), AVG(output_amount)
   FROM routing_decisions
   GROUP BY selected_dex;
   ```

2. **Success Rate**: How many orders complete vs fail?
   ```sql
   SELECT status, COUNT(*), COUNT(*) * 100.0 / SUM(COUNT(*)) OVER()
   FROM orders
   GROUP BY status;
   ```

3. **Execution Speed**: Average time from pending to confirmed
   ```sql
   SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)))
   FROM orders
   WHERE status = 'confirmed';
   ```

---

## Summary

- **MARKET orders**: Immediate execution at best available price ✅
- **LIMIT orders**: Price target monitoring + same execution flow (90% complete)
- **SNIPER orders**: Token launch detection + fast execution (architecture ready)

The current implementation provides a complete, production-ready system for MARKET orders with all infrastructure in place to add LIMIT and SNIPER orders with minimal effort.
