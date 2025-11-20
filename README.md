# Solana DEX Trading Bot

High-performance trading bot for Solana DEX with Raydium and Meteora integration, WebSocket streaming, and concurrent order processing.

## 🎯 Core Features

### ✅ Order Types (All Implemented)
- **Market Order** - Immediate execution at current best price
- **Limit Order** - Execute when target price is reached  
- **Sniper Order** - Execute on token launch/migration

### ✅ DEX Router Implementation
- Query both **Raydium** and **Meteora** for quotes
- Route to **best price automatically**
- Handle wrapped SOL for native token swaps
- **Log routing decisions** for transparency

### ✅ HTTP → WebSocket Pattern
- Single endpoint handles both protocols
- Initial **POST returns orderId**
- Connection **upgrades to WebSocket** for status streaming
- Real-time order lifecycle updates

### ✅ Concurrent Processing
- Queue system managing up to **10 concurrent orders**
- Process **100 orders/minute**
- **Exponential back-off retry** (≤3 attempts)
- Emit "failed" status and **persist failure reason** for post-mortem

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Fastify HTTP Server                       │
│                     (WebSocket Support Built-in)                 │
└───────────────┬──────────────────────────────────┬───────────────┘
                │                                  │
                │ POST /api/orders                 │ WS /ws/orders/:id
                ▼                                  ▼
        ┌───────────────┐                 ┌────────────────┐
        │ Order Created │                 │  WebSocket     │
        │ Returns: ID   │                 │  Streaming     │
        └───────┬───────┘                 └────────────────┘
                │
                ▼
        ┌───────────────────────────────────────────┐
        │        BullMQ + Redis (Order Queue)       │
        │  • 10 concurrent workers                  │
        │  • 100 orders/min rate limit              │
        │  • Exponential backoff (3 attempts)       │
        └───────────────┬───────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────────────────┐
        │         Order Processor Worker            │
        │  1. PENDING → PROCESSING                  │
        │  2. PROCESSING → ROUTING                  │
        │  3. ROUTING → EXECUTING                   │
        │  4. EXECUTING → COMPLETED/FAILED          │
        └───────────────┬───────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────────────────┐
        │          DEX Aggregator                   │
        │  Compare Raydium vs Meteora               │
        │  Select best price automatically          │
        └───────┬─────────────────┬─────────────────┘
                │                 │
        ┌───────▼────────┐ ┌─────▼──────────┐
        │    Raydium     │ │    Meteora     │
        │    Router      │ │    Router      │
        └────────────────┘ └────────────────┘
                │                 │
                └────────┬────────┘
                         ▼
        ┌────────────────────────────────────────┐
        │         Solana Blockchain              │
        └────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────┐
        │  PostgreSQL (Order History)            │
        │  Redis Cache (Active Orders)           │
        └────────────────────────────────────────┘
```

## 📦 Technology Stack

- **Backend**: Node.js + TypeScript
- **Web Framework**: Fastify (WebSocket built-in)
- **Queue**: BullMQ + Redis
- **Database**: PostgreSQL + Redis
- **Blockchain**: Solana Web3.js
- **DEX**: Raydium SDK + Meteora SDK

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- Redis Server
- PostgreSQL
- Solana wallet (for production)

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### Start Services

```bash
# Start Redis (if not running)
redis-server

# Start PostgreSQL (if not running)
# On Linux/Mac: sudo service postgresql start
# On Windows: net start postgresql

# Build the project
npm run build

# Start the bot
npm start

# Or run in development mode with auto-reload
npm run dev
```

## 📖 API Documentation

### 1. Create Order

**Endpoint:** `POST /api/orders`

**Request Body:**
```json
{
  "type": "MARKET",           // MARKET, LIMIT, or SNIPER
  "side": "BUY",              // BUY or SELL
  "inputToken": "So11111111111111111111111111111111111111112",  // SOL
  "outputToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "inputAmount": "1000000000",  // 1 SOL (in lamports)
  "outputAmount": "150000000",  // For LIMIT orders (optional)
  "slippageBps": 100           // 1% slippage (optional, default: 100)
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "PENDING",
    "message": "Order created. Connect to WebSocket for status updates."
  }
}
```

### 2. WebSocket Connection

**Endpoint:** `GET /ws/orders/:orderId`

**Connection:**
```javascript
const ws = new WebSocket('ws://localhost:3000/ws/orders/550e8400-e29b-41d4-a716-446655440000');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Order update:', message);
};
```

**Message Types:**
```json
{
  "type": "ORDER_STATUS",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1234567890,
  "data": {
    "status": "PROCESSING",
    "order": { /* full order object */ }
  }
}
```

**Status Flow:**
1. `PENDING` - Order created and queued
2. `PROCESSING` - Worker picked up the order
3. `ROUTING` - Comparing DEX prices
4. `EXECUTING` - Executing on-chain transaction
5. `COMPLETED` - Successfully executed
6. `FAILED` - Failed after retries

### 3. Get Order Details

**Endpoint:** `GET /api/orders/:orderId`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "COMPLETED",
    "selectedDex": "METEORA",
    "executionPrice": "150.5",
    "txSignature": "5j7s...",
    // ... full order details
  }
}
```

## 🧪 Testing

### Using cURL

**Create Market Order:**
```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "type": "MARKET",
    "side": "BUY",
    "inputToken": "So11111111111111111111111111111111111111112",
    "outputToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "inputAmount": "1000000000",
    "slippageBps": 100
  }'
```

### Using WebSocket (JavaScript)

```javascript
const orderId = '550e8400-e29b-41d4-a716-446655440000';
const ws = new WebSocket(`ws://localhost:3000/ws/orders/${orderId}`);

ws.onopen = () => {
  console.log('Connected to order stream');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log(`[${message.type}] Status: ${message.data.status}`);
  
  if (message.type === 'ORDER_COMPLETE') {
    console.log('Order completed!', message.data);
    ws.close();
  }
  
  if (message.type === 'ORDER_FAILED') {
    console.error('Order failed:', message.data);
    ws.close();
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};
```

## ⚙️ Configuration

Edit `.env` file:

```env
# Server
PORT=3000
HOST=0.0.0.0

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=solana_dex_bot
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Queue & Concurrency
MAX_CONCURRENT_ORDERS=10
MAX_ORDERS_PER_MINUTE=100

# Retry
MAX_RETRY_ATTEMPTS=3
RETRY_BACKOFF_MS=1000
```

## 📊 Monitoring

### Queue Dashboard

View BullMQ dashboard:
```bash
npm install -g bull-board
bull-board --redis redis://localhost:6379
```

### Database Queries

**Check order status:**
```sql
SELECT id, status, selected_dex, execution_price, created_at 
FROM orders 
ORDER BY created_at DESC 
LIMIT 10;
```

**View routing decisions:**
```sql
SELECT order_id, selected_dex, reason, created_at 
FROM routing_decisions 
ORDER BY created_at DESC 
LIMIT 10;
```

**Analyze retry patterns:**
```sql
SELECT order_id, attempt_number, error_message 
FROM retry_logs 
WHERE order_id = 'your-order-id';
```

## 🔍 Routing Decision Logs

The bot logs all routing decisions with transparency:

```
[DEX Aggregator] Finding best quote for order abc-123
Input: 1000000000 SOL -> USDC

[Raydium] Output: 149500000, Fee: 300000, Impact: 0.5%
[Meteora] Output: 150200000, Fee: 200000, Impact: 0.3%

[DEX Aggregator] Selected: METEORA
[DEX Aggregator] Reason: Meteora offers 0.47% better output
```

## 📈 Performance Metrics

- **Throughput**: 100 orders/minute
- **Concurrency**: 10 simultaneous orders
- **Retry Logic**: Exponential backoff (1s, 2s, 4s)
- **Response Time**: <100ms for order creation
- **WebSocket Latency**: <50ms for status updates

## 🛡️ Error Handling

### Automatic Retries
- Network errors
- RPC throttling
- DEX liquidity issues
- Temporary failures

### Permanent Failures
- Invalid token addresses
- Insufficient balance
- Slippage exceeded
- Failed after 3 attempts

## 📝 License

MIT License

## 👤 Author

Avi - Built for Eterna Labs Interview

## 🙏 Acknowledgments

- Solana Foundation
- Raydium Protocol
- Meteora Protocol
- BullMQ Team

---

**⚠️ Disclaimer**: This is a demo project for interview purposes. Use at your own risk. Always test thoroughly before using with real funds.
