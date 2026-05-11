import type { HumanoidControl } from '../control/HumanoidControl';
import { executeTool, type ToolCall, type ToolResult } from './tools';
import type { CapturedFrame } from './WebcamCapture';

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Estimated USD cost for this turn (set by paid providers; mock leaves
   *  undefined). */
  costUsd?: number;
}

export interface AgentTurn {
  text: string;
  tools: Array<{ call: ToolCall; result: ToolResult }>;
  usage?: UsageStats;
  /** True when the tool-use loop ran out of rounds before the model returned
   *  end_turn. The chat surface should highlight this so the user knows the
   *  reply was cut short. */
  truncated?: boolean;
}

export type StreamCallback = (event:
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_result'; name: string; ok: boolean; message: string }
) => void;

export interface AgentClient {
  readonly label: string;
  respond(
    userText: string,
    control: HumanoidControl,
    image?: CapturedFrame | null,
    onStream?: StreamCallback,
  ): Promise<AgentTurn>;
  /** Drop any per-conversation state (history, etc.). Optional — pure
   *  agents may no-op. */
  resetConversation?(): void;
}

export function runToolCalls(control: HumanoidControl, calls: ToolCall[]) {
  return calls.map(call => ({ call, result: executeTool(control, call) }));
}
