/**
 * Centralized configuration. Every magic number that controls runtime behavior
 * lives here so callers do not embed ad-hoc literals.
 *
 * Group constants by layer so dependencies are obvious at a glance.
 */

export const SIM = {
  /** Wall-clock dt the sim loop targets in seconds. RAF-independent. */
  fixedDt: 1 / 200,
  /** Hard cap on accumulated dt per RAF tick so a stalled tab can't trigger
   *  a spiral-of-death catch-up. */
  maxAccum: 0.25,
  /** Maximum sim sub-steps allowed inside one RAF tick. */
  maxStepsPerFrame: 8,
} as const;

export const CONTROL = {
  pd: {
    standKp: 14,
    standKd: 0.9,
    armKp: 8,
    armKd: 0.6,
    elbowKp: 6,
    elbowKd: 0.4,
  },
  walk: {
    defaultSpeedMps: 1.0,
    minDistanceM: 1e-3,
  },
  turn: {
    defaultRateDegPerSec: 90,
  },
} as const;

export const RENDER = {
  followLerp: 0.12,
  camera: { fov: 50, near: 0.05, far: 100, position: [3, 2.2, 3] as const, lookAt: [0, 1, 0] as const },
  fog: { color: 0x111418, near: 8, far: 25 },
} as const;

export const AGENT = {
  defaultModel: 'claude-haiku-4-5-20251001',
  endpoint: 'https://api.anthropic.com/v1/messages',
  apiVersion: '2023-06-01',
  maxTokens: 512,
  maxToolRounds: 6,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 600,
    retryableStatus: [408, 425, 429, 500, 502, 503, 504, 529] as const,
  },
} as const;

export const WEBCAM = {
  maxEdge: 768,
  jpegQuality: 0.75,
} as const;

export const STORAGE_KEYS = {
  provider: 'robots.agent.provider',
  apiKey: 'robots.agent.apiKey',
  /** Provider-specific conversation state (e.g. ClaudeAgent's `messages`). */
  history: 'robots.agent.history',
  /** UI-rendered transcript (`ChatTurn[]`). */
  transcript: 'robots.agent.transcript',
} as const;

/**
 * Anthropic Haiku 4.5 pricing as of 2026-05. Numbers are USD per million
 * tokens. Cache reads use the 90% discount tier; cache creation is a 25%
 * premium over base input.
 */
export const PRICING = {
  haiku45: {
    inputPerMTok: 0.80,
    outputPerMTok: 4.00,
    cacheReadPerMTok: 0.08,
    cacheCreatePerMTok: 1.00,
  },
} as const;
