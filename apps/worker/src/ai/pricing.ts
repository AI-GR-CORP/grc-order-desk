/**
 * USD per million tokens, for cost estimates in the dashboard. Check
 * https://platform.claude.com/docs/en/about-claude/pricing and update when prices change.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Haiku 5.5 bills prompts over 100K tokens at a higher rate. */
  longInput?: number;
  longOutput?: number;
}

const PRICES: Record<string, Price> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longInput: 0.5, longOutput: 2.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

export interface UsageInfo {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export function estimateCostUsd(u: UsageInfo, batch = false): number {
  const p = PRICES[u.model] ?? PRICES['claude-opus-5-5']!;
  const promptTokens = u.input_tokens + u.cache_read_tokens + u.cache_write_tokens;
  const long = promptTokens > 100_000 && p.longInput !== undefined;
  const inRate = long ? p.longInput! : p.input;
  const outRate = long ? p.longOutput! : p.output;
  const cost =
    (u.input_tokens * inRate +
      u.output_tokens * outRate +
      u.cache_read_tokens * p.cacheRead +
      u.cache_write_tokens * p.cacheWrite) /
    1_000_000;
  return batch ? cost / 2 : cost;
}
