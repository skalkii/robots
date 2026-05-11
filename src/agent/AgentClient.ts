import type { HumanoidControl } from '../control/HumanoidControl';
import { executeTool, type ToolCall, type ToolResult } from './tools';
import type { CapturedFrame } from './WebcamCapture';

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
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

export interface AgentClient {
  readonly label: string;
  respond(
    userText: string,
    control: HumanoidControl,
    image?: CapturedFrame | null,
  ): Promise<AgentTurn>;
  /** Drop any per-conversation state (history, etc.). Optional — pure
   *  agents may no-op. */
  resetConversation?(): void;
}

export function runToolCalls(control: HumanoidControl, calls: ToolCall[]) {
  return calls.map(call => ({ call, result: executeTool(control, call) }));
}
