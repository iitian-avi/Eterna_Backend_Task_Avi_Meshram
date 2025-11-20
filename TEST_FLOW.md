# Testing Order Flow & Status

## Prerequisites

Install wscat for WebSocket testing:
```bash
npm install -g wscat
```

---

## Method 1: Terminal Testing (Step by Step)

### Step 1: Start the Server

```bash
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start PostgreSQL (if not running)
# Windows: Check services or start manually
# Linux/Mac: sudo service postgresql start

# Terminal 3: Create database (first time only)
createdb solana_dex_bot

# Terminal 4: Start the application
cd C:\Users\Avi\Downloads\Eterna
npm run dev
```

Server should start on: `http://localhost:3000`

---

### Step 2: Submit an Order

Open a new terminal and run:

```bash
curl -X POST http://localhost:3000/api/orders/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"userId\":\"test_user_1\",\"type\":\"MARKET\",\"side\":\"BUY\",\"inputToken\":\"So11111111111111111111111111111111111111112\",\"outputToken\":\"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\",\"inputAmount\":\"1000000\",\"slippageBps\":100}"
```

**Expected Response:**
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Order received and queued for processing",
  "websocketUrl": "ws://localhost:3000/ws/orders/550e8400-e29b-41d4-a716-446655440000"
}
```

**Copy the `orderId` from the response!**

---

### Step 3: Connect to WebSocket to Watch Status Updates

```bash
# Replace {orderId} with the actual orderId from Step 2
wscat -c ws://localhost:3000/ws/orders/{orderId}
```

**Example:**
```bash
wscat -c ws://localhost:3000/ws/orders/550e8400-e29b-41d4-a716-446655440000
```

**You'll see real-time updates:**

```json
< {"type":"ORDER_STATUS","orderId":"550e...","status":"pending","message":"Order received and queued","timestamp":1700000000000}

< {"type":"ORDER_STATUS","orderId":"550e...","status":"routing","message":"Comparing prices from Raydium and Meteora","timestamp":1700000002000}

< {"type":"ORDER_ROUTING","orderId":"550e...","status":"routing","selectedDex":"METEORA","quote":{"dex":"METEORA","outputAmount":"98500","priceImpact":0.3},"message":"Selected METEORA for best price","timestamp":1700000005000}

< {"type":"ORDER_STATUS","orderId":"550e...","status":"building","message":"Building transaction","timestamp":1700000006000}

< {"type":"ORDER_EXECUTION","orderId":"550e...","status":"submitted","txHash":"meteora_1732123456_abc123xyz","message":"Transaction submitted to blockchain","timestamp":1700000007000}

< {"type":"ORDER_COMPLETE","orderId":"550e...","status":"confirmed","txHash":"meteora_1732123456_abc123xyz","outputAmount":"98500","executionPrice":"98.5","message":"Order executed successfully","timestamp":1700000010000}
```

**WebSocket will close automatically after order is confirmed/failed**

---

## Method 2: Check Status via HTTP GET

While the order is processing, you can query the status:

```bash
curl http://localhost:3000/api/orders/{orderId}
```

**Example:**
```bash
curl http://localhost:3000/api/orders/550e8400-e29b-41d4-a716-446655440000
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "test_user_1",
  "type": "MARKET",
  "status": "routing",
  "inputToken": "So11111111111111111111111111111111111111112",
  "outputToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "inputAmount": "1000000",
  "outputAmount": null,
  "selectedDex": null,
  "transactionId": null,
  "createdAt": "2025-11-20T10:30:00.000Z",
  "updatedAt": "2025-11-20T10:30:02.000Z"
}
```

---

## Method 3: Check Database Directly

### View All Orders

```bash
# Connect to PostgreSQL
psql -d solana_dex_bot

# Query orders
SELECT id, user_id, type, status, selected_dex, transaction_id, created_at 
FROM orders 
ORDER BY created_at DESC 
LIMIT 10;
```

**Example Output:**
```
id                                   | user_id      | type   | status    | selected_dex | transaction_id        | created_at
-------------------------------------|--------------|--------|-----------|--------------|-----------------------|---------------------------
550e8400-e29b-41d4-a716-446655440000 | test_user_1  | MARKET | confirmed | METEORA      | meteora_1732123_abc   | 2025-11-20 10:30:00
```

### View Routing Decisions

```bash
# See which DEX was chosen and why
SELECT 
  order_id, 
  selected_dex, 
  raydium_output_amount, 
  meteora_output_amount, 
  reason 
FROM routing_decisions 
WHERE order_id = '550e8400-e29b-41d4-a716-446655440000';
```

**Example Output:**
```
order_id                             | selected_dex | raydium_output_amount | meteora_output_amount | reason
-------------------------------------|--------------|----------------------|----------------------|---------------------------------------
550e8400-e29b-41d4-a716-446655440000 | METEORA      | 98200                | 98500                | Higher output: METEORA gives 98500...
```

### View Retry Logs (if order failed and retried)

```bash
SELECT order_id, attempt_number, error_message, retry_at 
FROM retry_logs 
WHERE order_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY attempt_number;
```

---

## Method 4: Using Browser/Postman

### Submit Order via Postman

1. **Open Postman**
2. **Create POST request** to: `http://localhost:3000/api/orders/execute`
3. **Set Headers**: `Content-Type: application/json`
4. **Set Body** (raw JSON):
   ```json
   {
     "userId": "test_user_1",
     "type": "MARKET",
     "side": "BUY",
     "inputToken": "So11111111111111111111111111111111111111112",
     "outputToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
     "inputAmount": "1000000",
     "slippageBps": 100
   }
   ```
5. **Click Send**
6. **Copy orderId from response**

### Connect WebSocket via Browser Console

Open browser console and run:

```javascript
const orderId = '550e8400-e29b-41d4-a716-446655440000'; // Replace with your orderId
const ws = new WebSocket(`ws://localhost:3000/ws/orders/${orderId}`);

ws.onopen = () => {
  console.log('✅ Connected to order status stream');
};

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log(`📊 Status: ${update.status}`);
  console.log(`📝 Message: ${update.message}`);
  console.log('📦 Full Update:', update);
  
  if (update.status === 'confirmed') {
    console.log(`✅ Transaction Hash: ${update.txHash}`);
    console.log(`💰 Output Amount: ${update.outputAmount}`);
  }
  
  if (update.status === 'failed') {
    console.error(`❌ Error: ${update.error}`);
  }
};

ws.onclose = () => {
  console.log('🔌 Connection closed');
};

ws.onerror = (error) => {
  console.error('❌ WebSocket error:', error);
};
```

---

## Method 5: Create a Simple HTML Test Page

Save this as `test-order-flow.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Solana DEX Order Flow Test</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
    .container { max-width: 800px; margin: 0 auto; }
    button { padding: 10px 20px; margin: 5px; cursor: pointer; font-size: 16px; }
    .log { background: #2d2d2d; padding: 15px; border-radius: 5px; margin: 10px 0; height: 400px; overflow-y: auto; }
    .status { padding: 5px 10px; border-radius: 3px; margin: 5px 0; }
    .pending { background: #4a4a00; }
    .routing { background: #004a4a; }
    .building { background: #00004a; }
    .submitted { background: #4a004a; }
    .confirmed { background: #004a00; }
    .failed { background: #4a0000; }
    input { padding: 8px; width: 300px; margin: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Solana DEX Order Flow Test</h1>
    
    <div>
      <h3>1. Submit Order</h3>
      <button onclick="submitOrder()">Submit MARKET Order</button>
      <div>
        <input id="inputAmount" type="text" value="1000000" placeholder="Input Amount">
        <input id="userId" type="text" value="test_user_1" placeholder="User ID">
      </div>
    </div>
    
    <div>
      <h3>2. Order Status</h3>
      <div id="orderId" style="margin: 10px 0;">Order ID: <span style="color: #569cd6;">None</span></div>
      <button onclick="connectWebSocket()" id="wsButton" disabled>Connect WebSocket</button>
      <button onclick="getOrderStatus()" id="httpButton" disabled>Check Status (HTTP)</button>
    </div>
    
    <div>
      <h3>3. Live Updates</h3>
      <div id="log" class="log"></div>
    </div>
  </div>

  <script>
    let currentOrderId = null;
    let ws = null;

    function log(message, className = '') {
      const logDiv = document.getElementById('log');
      const entry = document.createElement('div');
      entry.className = 'status ' + className;
      entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${message}`;
      logDiv.appendChild(entry);
      logDiv.scrollTop = logDiv.scrollHeight;
    }

    async function submitOrder() {
      const inputAmount = document.getElementById('inputAmount').value;
      const userId = document.getElementById('userId').value;

      log('📤 Submitting order...');

      try {
        const response = await fetch('http://localhost:3000/api/orders/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            type: 'MARKET',
            side: 'BUY',
            inputToken: 'So11111111111111111111111111111111111111112',
            outputToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            inputAmount,
            slippageBps: 100
          })
        });

        const data = await response.json();
        currentOrderId = data.orderId;
        
        document.getElementById('orderId').innerHTML = 
          `Order ID: <span style="color: #569cd6;">${currentOrderId}</span>`;
        document.getElementById('wsButton').disabled = false;
        document.getElementById('httpButton').disabled = false;

        log(`✅ Order created: ${currentOrderId}`, 'pending');
        log(`📊 Status: ${data.status}`, 'pending');
        
        // Auto-connect WebSocket
        setTimeout(() => connectWebSocket(), 500);
      } catch (error) {
        log(`❌ Error: ${error.message}`, 'failed');
      }
    }

    function connectWebSocket() {
      if (!currentOrderId) {
        log('❌ No order ID. Submit an order first.', 'failed');
        return;
      }

      if (ws) {
        log('⚠️ WebSocket already connected');
        return;
      }

      log('🔌 Connecting to WebSocket...');
      ws = new WebSocket(`ws://localhost:3000/ws/orders/${currentOrderId}`);

      ws.onopen = () => {
        log('✅ WebSocket connected', 'confirmed');
      };

      ws.onmessage = (event) => {
        const update = JSON.parse(event.data);
        
        let message = `📊 ${update.type}: ${update.status}`;
        if (update.message) message += ` - ${update.message}`;
        if (update.selectedDex) message += ` [DEX: ${update.selectedDex}]`;
        if (update.txHash) message += ` [TX: ${update.txHash.substring(0, 20)}...]`;
        if (update.outputAmount) message += ` [Output: ${update.outputAmount}]`;
        
        log(message, update.status);
      };

      ws.onclose = () => {
        log('🔌 WebSocket closed', 'pending');
        ws = null;
      };

      ws.onerror = (error) => {
        log(`❌ WebSocket error: ${error}`, 'failed');
      };
    }

    async function getOrderStatus() {
      if (!currentOrderId) {
        log('❌ No order ID. Submit an order first.', 'failed');
        return;
      }

      try {
        const response = await fetch(`http://localhost:3000/api/orders/${currentOrderId}`);
        const data = await response.json();
        
        log(`📊 HTTP Status Check: ${data.status}`, data.status);
        log(`📝 Selected DEX: ${data.selectedDex || 'Not yet selected'}`, data.status);
        if (data.transactionId) {
          log(`💳 Transaction ID: ${data.transactionId}`, data.status);
        }
      } catch (error) {
        log(`❌ Error: ${error.message}`, 'failed');
      }
    }
  </script>
</body>
</html>
```

**To use:**
1. Save the file above
2. Open it in your browser
3. Make sure server is running (`npm run dev`)
4. Click "Submit MARKET Order"
5. Watch real-time updates!

---

## Method 6: Check Server Logs

The server logs show detailed processing information:

```bash
# Watch server logs in real-time
npm run dev

# You'll see output like:
[Worker] Processing order 550e8400-e29b-41d4-a716-446655440000
[Worker] Processing MARKET order 550e8400-e29b-41d4-a716-446655440000
[Raydium] Getting quote for 1000000 SOL -> USDC
[Meteora] Getting quote for 1000000 SOL -> USDC
[DEX Aggregator] Selected METEORA (output: 98500 vs 98200)
[Worker] MARKET order 550e8400-e29b-41d4-a716-446655440000 confirmed with txHash: meteora_1732123_abc
```

---

## Quick Test Script

Create `test-order.sh` (Linux/Mac) or `test-order.bat` (Windows):

**Windows (test-order.bat):**
```batch
@echo off
echo Submitting order...
curl -X POST http://localhost:3000/api/orders/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"userId\":\"test_user\",\"type\":\"MARKET\",\"side\":\"BUY\",\"inputToken\":\"SOL\",\"outputToken\":\"USDC\",\"inputAmount\":\"1000000\"}" > response.json

echo.
echo Response:
type response.json

echo.
echo Extract orderId from response.json and run:
echo wscat -c ws://localhost:3000/ws/orders/{orderId}
```

**Linux/Mac (test-order.sh):**
```bash
#!/bin/bash
echo "Submitting order..."
response=$(curl -s -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{"userId":"test_user","type":"MARKET","side":"BUY","inputToken":"SOL","outputToken":"USDC","inputAmount":"1000000"}')

echo "Response: $response"
orderId=$(echo $response | jq -r '.orderId')
echo "Order ID: $orderId"
echo "Connecting to WebSocket..."
wscat -c "ws://localhost:3000/ws/orders/$orderId"
```

---

## Summary: Recommended Testing Flow

**Best practice for testing:**

1. **Start services**: Redis + PostgreSQL + Application
2. **Submit order**: Use cURL or Postman
3. **Watch live updates**: Use wscat or browser WebSocket
4. **Verify in database**: Check orders, routing_decisions, retry_logs tables
5. **Review logs**: Check server terminal for detailed processing info

**Expected Timeline:**
- 0s: Order submitted (status: `pending`)
- 1s: Worker picks up (status: `routing`)
- 3s: DEX quotes fetched (routing decision made)
- 4s: Transaction building (status: `building`)
- 5s: Transaction submitted (status: `submitted`, txHash available)
- 7s: Transaction confirmed (status: `confirmed`, output amount available)

---

**Need help?** Check logs, database, or WebSocket messages for troubleshooting!
