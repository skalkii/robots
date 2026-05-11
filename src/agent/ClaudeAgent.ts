import type { HumanoidControl } from '../control/HumanoidControl';
import type { AgentClient, AgentTurn } from './AgentClient';
import { runToolCalls } from './AgentClient';
import { TOOL_SCHEMAS, type ToolCall } from './tools';
import type { CapturedFrame } from './WebcamCapture';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT =
  'You control a humanoid robot in a 3D physics simulation. ' +
  "Interpret the user's natural-language commands and call the matching tools to drive the robot. " +
  'The robot has two arms (each with a shoulder and an elbow) and a torso. ' +
  'It does NOT have a head joint — never claim to look at, turn its head, or make eye contact. ' +
  'When the user asks the robot to "stand", prefer pin_root=true for a reliably upright demo unless they explicitly want realistic physics. ' +
  'After tool calls, reply with one short sentence confirming what you did. ' +
  'If the user asks something the robot cannot do, say so plainly.';

type TextBlock = { type: 'text'; text: string };
type ImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string };
};
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface ApiResponse {
  id: string;
  role: 'assistant';
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string;
}

export class ClaudeAgent implements AgentClient {
  readonly label = 'Claude Haiku 4.5';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async respond(
    userText: string,
    control: HumanoidControl,
    image?: CapturedFrame | null,
  ): Promise<AgentTurn> {
    // First user turn — attach the optional webcam frame so the model can
    // ground commands like "wave at me" or "raise the arm closest to me".
    const firstContent: ContentBlock[] = [];
    if (image) {
      firstContent.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
      });
    }
    firstContent.push({ type: 'text', text: userText });
    const messages: ApiMessage[] = [{ role: 'user', content: firstContent }];
    const executedTools: AgentTurn['tools'] = [];

    for (let i = 0; i < 6; i++) {
      const res = await this.post(messages);
      messages.push({ role: 'assistant', content: res.content });

      if (res.stop_reason !== 'tool_use') {
        const text = extractText(res.content) || '(no text)';
        return { text, tools: executedTools };
      }

      const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      const calls: ToolCall[] = toolUses.map(t => ({ name: t.name, input: t.input }));
      const results = runToolCalls(control, calls);
      executedTools.push(...results);

      const toolResults: ToolResultBlock[] = toolUses.map((tu, idx) => ({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: results[idx].result.message,
        is_error: !results[idx].result.ok,
      }));
      messages.push({ role: 'user', content: toolResults });
    }

    return {
      text: 'Stopped: too many tool-use rounds in a single turn.',
      tools: executedTools,
    };
  }

  private async post(messages: ApiMessage[]): Promise<ApiResponse> {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 512,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: TOOL_SCHEMAS,
        messages,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 400)}`);
    }
    return (await res.json()) as ApiResponse;
  }
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}
