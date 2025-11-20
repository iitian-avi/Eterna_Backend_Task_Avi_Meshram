# Solana DEX Trading Bot - Implementation Guide

## Current Status: Mock Implementation (Option B)

The current implementation uses **mock/simulated responses** to demonstrate the architecture and flow. This allows you to:
- ✅ Test the complete order flow
- ✅ Verify WebSocket streaming
- ✅ Test concurrent processing and retry logic
- ✅ Validate the routing decisions between DEXes
- ✅ Focus on architecture without dealing with network issues

## Upgrading to Real Devnet Execution (Option A)

Follow these steps to integrate real Raydium and Meteora SDKs for devnet trading:

---

## 1. Install Real DEX SDKs

```bash
npm install @raydium-io/raydium-sdk-v2 @meteora-ag/dlmm @solana/spl-token
```

**Note**: The current `package.json` already includes these dependencies, but they may need version adjustments based on availability.

---

## 2. Set Up Devnet Wallet

### Create a Devnet Wallet

```bash
# Generate a new keypair
solana-keygen new --outfile ~/.config/solana/devnet-wallet.json

# Get your public key
solana-keygen pubkey ~/.config/solana/devnet-wallet.json
```

### Fund Your Wallet

Visit the Solana devnet faucet and request SOL:
- **Faucet**: https://faucet.solana.com
- Request 2-5 SOL for testing

### Update Environment Variables

```bash
# .env
WALLET_PRIVATE_KEY=your_base58_encoded_private_key_here
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_NETWORK=devnet
```

---

## 3. Update Raydium Integration

### File: `src/services/raydium.ts`

```typescript
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Raydium, TxVersion, parseTokenAccountResp } from '@raydium-io/raydium-sdk-v2';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { DEXQuote, Order } from '../types';
import config from '../config';
import logger from '../utils/logger';

export class RaydiumRouter {
  private connection: Connection;
  private raydium: Raydium | null = null;
  private owner: Keypair;

  constructor(ownerKeypair: Keypair) {
    this.connection = new Connection(config.solana.rpcUrl, 'confirmed');
    this.owner = ownerKeypair;
  }

  async initialize(): Promise<void> {
    if (this.raydium) return;

    // Initialize Raydium SDK
    this.raydium = await Raydium.load({
      owner: this.owner,
      connection: this.connection,
      cluster: 'devnet',
      disableFeatureCheck: true,
      disableLoadToken: false,
      blockhashCommitment: 'confirmed',
    });

    logger.info('Raydium SDK initialized');
  }

  async getQuote(order: Order): Promise<DEXQuote> {
    await this.initialize();
    if (!this.raydium) throw new Error('Raydium not initialized');

    try {
      const inputMint = new PublicKey(order.inputToken);
      const outputMint = new PublicKey(order.outputToken);

      // Fetch pool information
      const poolKeys = await this.raydium.liquidity.getPoolKeys({
        baseMint: inputMint,
        quoteMint: outputMint,
      });

      if (!poolKeys || poolKeys.length === 0) {
        throw new Error('No Raydium pool found for this pair');
      }

      // Get quote from the first available pool
      const pool = poolKeys[0];
      const { amountOut, minAmountOut, priceImpact, fee } = 
        await this.raydium.liquidity.computeAmountOut({
          poolInfo: pool,
          amountIn: order.inputAmount,
          slippage: order.slippage || 0.01,
        });

      logger.info({
        dex: 'raydium',
        orderId: order.id,
        inputAmount: order.inputAmount,
        outputAmount: amountOut.toFixed(6),
        priceImpact: priceImpact.toFixed(3) + '%'
      }, 'Raydium quote fetched');

      return {
        dex: 'raydium',
        inputToken: order.inputToken,
        outputToken: order.outputToken,
        inputAmount: order.inputAmount,
        outputAmount: amountOut.toFixed(6),
        priceImpact: priceImpact,
        fee: fee.toNumber(),
        route: [pool.id.toString()],
        estimatedGas: 0.00005,
        slippage: order.slippage || 0.01,
        minOutputAmount: minAmountOut.toFixed(6)
      };
    } catch (error) {
      logger.error({ error, orderId: order.id }, 'Raydium quote failed');
      throw error;
    }
  }

  async executeSwap(quote: DEXQuote, userKeypair: Keypair): Promise<string> {
    await this.initialize();
    if (!this.raydium) throw new Error('Raydium not initialized');

    try {
      const inputMint = new PublicKey(quote.inputToken);
      const outputMint = new PublicKey(quote.outputToken);

      // Build swap transaction
      const { transaction } = await this.raydium.liquidity.swap({
        poolKeys: quote.route[0], // Pool ID from route
        amountIn: quote.inputAmount,
        amountOut: quote.minOutputAmount,
        fixedSide: 'in',
        txVersion: TxVersion.V0,
      });

      // Sign and send transaction
      transaction.sign([userKeypair]);
      const txid = await this.connection.sendTransaction(transaction);
      
      // Wait for confirmation
      await this.connection.confirmTransaction(txid, 'confirmed');

      logger.info({
        dex: 'raydium',
        txId: txid,
        outputAmount: quote.outputAmount
      }, 'Raydium swap executed');

      return txid;
    } catch (error) {
      logger.error({ error, quote }, 'Raydium swap execution failed');
      throw error;
    }
  }
}
```

---

## 4. Update Meteora Integration

### File: `src/services/meteora.ts`

```typescript
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { DEXQuote, Order } from '../types';
import config from '../config';
import logger from '../utils/logger';

export class MeteoraRouter {
  private connection: Connection;
  private owner: Keypair;

  constructor(ownerKeypair: Keypair) {
    this.connection = new Connection(config.solana.rpcUrl, 'confirmed');
    this.owner = ownerKeypair;
  }

  async getQuote(order: Order): Promise<DEXQuote> {
    try {
      const inputMint = new PublicKey(order.inputToken);
      const outputMint = new PublicKey(order.outputToken);

      // Find Meteora DLMM pool
      const poolAddress = await this.findPool(inputMint, outputMint);
      
      if (!poolAddress) {
        throw new Error('No Meteora pool found for this pair');
      }

      // Load DLMM pool
      const dlmmPool = await DLMM.create(this.connection, poolAddress);

      // Get swap quote
      const swapQuote = await dlmmPool.swapQuote(
        order.inputAmount,
        true, // swapForY (true if swapping X to Y)
        new BN(order.slippage ? order.slippage * 10000 : 100), // slippage in BPS
        this.owner.publicKey
      );

      const outputAmount = swapQuote.outAmount;
      const priceImpact = swapQuote.priceImpact;
      const fee = swapQuote.fee;

      logger.info({
        dex: 'meteora',
        orderId: order.id,
        inputAmount: order.inputAmount,
        outputAmount: outputAmount.toString(),
        priceImpact: priceImpact.toFixed(3) + '%'
      }, 'Meteora quote fetched');

      return {
        dex: 'meteora',
        inputToken: order.inputToken,
        outputToken: order.outputToken,
        inputAmount: order.inputAmount,
        outputAmount: outputAmount.toString(),
        priceImpact: priceImpact,
        fee: fee.toNumber(),
        route: [poolAddress.toString()],
        estimatedGas: 0.00005,
        slippage: order.slippage || 0.01,
        minOutputAmount: swapQuote.minOutAmount.toString()
      };
    } catch (error) {
      logger.error({ error, orderId: order.id }, 'Meteora quote failed');
      throw error;
    }
  }

  async executeSwap(quote: DEXQuote, userKeypair: Keypair): Promise<string> {
    try {
      const poolAddress = new PublicKey(quote.route[0]);
      const dlmmPool = await DLMM.create(this.connection, poolAddress);

      // Build swap transaction
      const swapTx = await dlmmPool.swap({
        inAmount: new BN(quote.inputAmount),
        minOutAmount: new BN(quote.minOutputAmount),
        swapForY: true,
        user: userKeypair.publicKey,
      });

      // Sign and send
      swapTx.transaction.partialSign(userKeypair);
      const txid = await this.connection.sendRawTransaction(
        swapTx.transaction.serialize()
      );
      
      await this.connection.confirmTransaction(txid, 'confirmed');

      logger.info({
        dex: 'meteora',
        txId: txid,
        outputAmount: quote.outputAmount
      }, 'Meteora swap executed');

      return txid;
    } catch (error) {
      logger.error({ error, quote }, 'Meteora swap execution failed');
      throw error;
    }
  }

  private async findPool(
    tokenA: PublicKey,
    tokenB: PublicKey
  ): Promise<PublicKey | null> {
    // Query Meteora API for pool address
    // For devnet: Use Meteora's pool registry
    // This is a simplified version
    try {
      // TODO: Implement real pool discovery
      return null;
    } catch (error) {
      logger.error({ error }, 'Failed to find Meteora pool');
      return null;
    }
  }
}
```

---

## 5. Update Worker to Use Real Keypairs

### File: `src/workers/order-processor.ts`

Add wallet management:

```typescript
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import config from '../config';

// Load wallet from environment
const walletKeypair = Keypair.fromSecretKey(
  bs58.decode(process.env.WALLET_PRIVATE_KEY!)
);

// Pass keypair to routers
const raydiumRouter = new RaydiumRouter(walletKeypair);
const meteoraRouter = new MeteoraRouter(walletKeypair);
```

---

## 6. Testing on Devnet

### Step 1: Get Devnet Tokens

Use SPL token faucets to get test tokens:
- USDC-Dev: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- SOL: Request from https://faucet.solana.com

### Step 2: Test Quote Fetching

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user_1",
    "orderType": "MARKET",
    "inputToken": "So11111111111111111111111111111111111111112",
    "outputToken": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "inputAmount": "1000000",
    "slippage": 0.01
  }'
```

### Step 3: Monitor Transaction

```bash
# Watch transaction on Solscan
https://solscan.io/tx/{transaction_id}?cluster=devnet
```

---

## 7. Common Issues & Solutions

### Issue: Pool Not Found
**Solution**: Ensure the token pair has liquidity on devnet. Use well-known devnet token pairs.

### Issue: Insufficient SOL for Fees
**Solution**: Request more SOL from faucet. Each transaction costs ~0.00005 SOL.

### Issue: Slippage Exceeded
**Solution**: Increase slippage tolerance or reduce trade size.

### Issue: Transaction Timeout
**Solution**: Use `confirmed` commitment level and implement retry logic (already built-in).

---

## 8. Production Checklist

Before deploying to mainnet:

- [ ] Secure private key storage (use AWS KMS, HashiCorp Vault, etc.)
- [ ] Implement proper transaction monitoring
- [ ] Add balance checks before swaps
- [ ] Set up alerting for failed transactions
- [ ] Implement circuit breakers for DEX failures
- [ ] Add comprehensive logging and metrics
- [ ] Test with small amounts first
- [ ] Set up transaction fee optimization
- [ ] Implement emergency stop mechanism
- [ ] Add admin dashboard for monitoring

---

## 9. Resources

### Raydium
- SDK V2 Demo: https://github.com/raydium-io/raydium-sdk-V2-demo
- Documentation: https://docs.raydium.io/
- Devnet Pools: https://api.raydium.io/v2/main/pairs (check devnet flag)

### Meteora
- Documentation: https://docs.meteora.ag/
- DLMM SDK: https://github.com/MeteoraAg/dlmm-sdk
- Pool List: https://app.meteora.ag/pools (switch to devnet)

### Solana
- Web3.js Docs: https://solana-labs.github.io/solana-web3.js/
- SPL Token: https://spl.solana.com/token
- Devnet Faucet: https://faucet.solana.com
- Explorer: https://solscan.io/?cluster=devnet

---

## 10. Current Implementation Features

Even with mock data, the current implementation demonstrates:

✅ **Market/Limit/Sniper Order Types**: Fully implemented order type handling
✅ **Dual DEX Integration**: Raydium and Meteora router architecture
✅ **Best Price Routing**: Aggregator compares quotes and selects optimal DEX
✅ **HTTP → WebSocket Upgrade**: Real-time order status streaming
✅ **Concurrent Processing**: 10 parallel order workers with BullMQ
✅ **Rate Limiting**: 100 orders/minute throttling with Redis
✅ **Exponential Backoff Retry**: 3 attempts with 1s→2s→4s delays
✅ **Failure Persistence**: All retry attempts and routing decisions logged
✅ **Database Tracking**: PostgreSQL for order history and analytics
✅ **WebSocket Broadcasting**: Live updates for order lifecycle events

---

## Next Steps

1. **Test Current Implementation**: Run `npm run dev` and test with mock data
2. **Review Architecture**: Ensure the flow meets all requirements
3. **Add Real SDKs**: Follow steps above to integrate Raydium/Meteora
4. **Test on Devnet**: Start with small amounts and well-known pairs
5. **Monitor & Optimize**: Add metrics, logging, and performance tuning

---

**Need Help?** Check the README.md for API documentation and testing examples.
