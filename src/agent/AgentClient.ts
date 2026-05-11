import type { HumanoidControl } from '../control/HumanoidControl';
import { executeTool, type ToolCall, type ToolResult } from './tools';
import type { CapturedFrame } from './WebcamCapture';

export interface AgentTurn {
  text: string;
  tools: Array<{ call: ToolCall; result: ToolResult }>;
}

export interface AgentClient {
  readonly label: string;
  respond(
    userText: string,
    control: HumanoidControl,
    image?: CapturedFrame | null,
  ): Promise<AgentTurn>;
}

export function runToolCalls(control: HumanoidControl, calls: ToolCall[]) {
  return calls.map(call => ({ call, result: executeTool(control, call) }));
}
