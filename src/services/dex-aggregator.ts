/**
 * DEX Aggregator - Routes to best price between Raydium and Meteora
 */

import { RaydiumRouter } from './raydium';
import { MeteoraRouter } from './meteora';
import { OrderRepository } from '../db/repository';
import { DEXQuote, DEXPlatform, RoutingDecision, TransactionResult } from '../types';

export class DEXAggregator {
  private raydium: RaydiumRouter;
  private meteora: MeteoraRouter;
  private orderRepo: OrderRepository;

  constructor(orderRepo: OrderRepository) {
    this.raydium = new RaydiumRouter();
    this.meteora = new MeteoraRouter();
    this.orderRepo = orderRepo;
  }

  /**
   * Get best quote by comparing both DEXes
   */
  async getBestQuote(
    orderId: string,
    inputToken: string,
    outputToken: string,
    inputAmount: string,
    slippageBps: number
  ): Promise<{ quote: DEXQuote; decision: RoutingDecision }> {
    console.log(`\n[DEX Aggregator] Finding best quote for order ${orderId}`);
    console.log(`Input: ${inputAmount} ${inputToken} -> ${outputToken}`);

    let raydiumQuote: DEXQuote | undefined;
    let meteoraQuote: DEXQuote | undefined;
    const errors: string[] = [];

    // Get quotes from both DEXes in parallel
    const [raydiumResult, meteoraResult] = await Promise.allSettled([
      this.raydium.getQuote(inputToken, outputToken, inputAmount, slippageBps),
      this.meteora.getQuote(inputToken, outputToken, inputAmount, slippageBps)
    ]);

    // Process Raydium result
    if (raydiumResult.status === 'fulfilled') {
      raydiumQuote = raydiumResult.value;
      console.log(`[Raydium] Output: ${raydiumQuote.outputAmount}, Fee: ${raydiumQuote.fee}, Impact: ${raydiumQuote.priceImpact}%`);
    } else {
      console.error(`[Raydium] Quote failed: ${raydiumResult.reason}`);
      errors.push(`Raydium: ${raydiumResult.reason}`);
    }

    // Process Meteora result
    if (meteoraResult.status === 'fulfilled') {
      meteoraQuote = meteoraResult.value;
      console.log(`[Meteora] Output: ${meteoraQuote.outputAmount}, Fee: ${meteoraQuote.fee}, Impact: ${meteoraQuote.priceImpact}%`);
    } else {
      console.error(`[Meteora] Quote failed: ${meteoraResult.reason}`);
      errors.push(`Meteora: ${meteoraResult.reason}`);
    }

    // If both failed, throw error
    if (!raydiumQuote && !meteoraQuote) {
      throw new Error(`All DEX quotes failed: ${errors.join('; ')}`);
    }

    // Select best quote
    const { bestQuote, selectedDex, reason } = this.selectBestQuote(
      raydiumQuote,
      meteoraQuote
    );

    // Create routing decision
    const decision: RoutingDecision = {
      orderId,
      raydiumQuote,
      meteoraQuote,
      selectedDex,
      reason,
      timestamp: new Date()
    };

    // Log decision to database
    await this.orderRepo.saveRoutingDecision(decision);

    console.log(`[DEX Aggregator] Selected: ${selectedDex}`);
    console.log(`[DEX Aggregator] Reason: ${reason}\n`);

    return { quote: bestQuote, decision };
  }

  /**
   * Execute swap on the selected DEX
   */
  async executeSwap(
    quote: DEXQuote,
    walletAddress: string
  ): Promise<TransactionResult> {
    console.log(`\n[DEX Aggregator] Executing swap on ${quote.dex}`);

    if (quote.dex === DEXPlatform.RAYDIUM) {
      return await this.raydium.executeSwap(quote, walletAddress);
    } else {
      return await this.meteora.executeSwap(quote, walletAddress);
    }
  }

  /**
   * Select best quote based on output amount and other factors
   */
  private selectBestQuote(
    raydiumQuote: DEXQuote | undefined,
    meteoraQuote: DEXQuote | undefined
  ): { bestQuote: DEXQuote; selectedDex: DEXPlatform; reason: string } {
    // If only one quote available, use it
    if (raydiumQuote && !meteoraQuote) {
      return {
        bestQuote: raydiumQuote,
        selectedDex: DEXPlatform.RAYDIUM,
        reason: 'Only Raydium quote available'
      };
    }

    if (meteoraQuote && !raydiumQuote) {
      return {
        bestQuote: meteoraQuote,
        selectedDex: DEXPlatform.METEORA,
        reason: 'Only Meteora quote available'
      };
    }

    // Both quotes available - compare
    if (raydiumQuote && meteoraQuote) {
      const raydiumOutput = BigInt(raydiumQuote.outputAmount);
      const meteoraOutput = BigInt(meteoraQuote.outputAmount);

      // Primary factor: output amount
      if (raydiumOutput > meteoraOutput) {
        const difference = raydiumOutput - meteoraOutput;
        const percentBetter = Number((difference * BigInt(10000)) / meteoraOutput) / 100;
        
        return {
          bestQuote: raydiumQuote,
          selectedDex: DEXPlatform.RAYDIUM,
          reason: `Raydium offers ${percentBetter.toFixed(2)}% better output (${raydiumQuote.outputAmount} vs ${meteoraQuote.outputAmount})`
        };
      } else if (meteoraOutput > raydiumOutput) {
        const difference = meteoraOutput - raydiumOutput;
        const percentBetter = Number((difference * BigInt(10000)) / raydiumOutput) / 100;
        
        return {
          bestQuote: meteoraQuote,
          selectedDex: DEXPlatform.METEORA,
          reason: `Meteora offers ${percentBetter.toFixed(2)}% better output (${meteoraQuote.outputAmount} vs ${raydiumQuote.outputAmount})`
        };
      } else {
        // If output is equal, compare price impact
        if (raydiumQuote.priceImpact < meteoraQuote.priceImpact) {
          return {
            bestQuote: raydiumQuote,
            selectedDex: DEXPlatform.RAYDIUM,
            reason: `Equal output, but Raydium has lower price impact (${raydiumQuote.priceImpact}% vs ${meteoraQuote.priceImpact}%)`
          };
        } else {
          return {
            bestQuote: meteoraQuote,
            selectedDex: DEXPlatform.METEORA,
            reason: `Equal output, but Meteora has lower price impact (${meteoraQuote.priceImpact}% vs ${raydiumQuote.priceImpact}%)`
          };
        }
      }
    }

    // Fallback (should never reach here)
    throw new Error('No valid quotes available');
  }
}
