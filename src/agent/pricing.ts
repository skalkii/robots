import { PRICING } from '../config';
import type { UsageStats } from './AgentClient';

/**
 * Compute the USD cost of a single agent turn from its token usage. Returns
 * `null` for unknown models so the UI can hide the cost line gracefully
 * instead of showing $0.00.
 */
export function priceUsage(model: string, u: UsageStats): number | null {
  if (model.includes('haiku-4-5')) {
    const p = PRICING.haiku45;
    return (
      u.inputTokens * p.inputPerMTok +
      u.outputTokens * p.outputPerMTok +
      (u.cacheReadTokens ?? 0) * p.cacheReadPerMTok +
      (u.cacheCreationTokens ?? 0) * p.cacheCreatePerMTok
    ) / 1_000_000;
  }
  return null;
}

/** Friendly USD formatter that handles fractional cents without scientific
 *  notation. */
export function formatUsd(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
