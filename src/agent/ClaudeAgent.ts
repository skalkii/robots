import type { HumanoidControl } from '../control/HumanoidControl';
import type { AgentClient, AgentTurn, UsageStats } from './AgentClient';
import { runToolCalls } from './AgentClient';
import { TOOL_SCHEMAS, type ToolCall } from './tools';
import type { CapturedFrame } from './WebcamCapture';
import { AGENT } from '../config';

const SYSTEM_PROMPT =
  'You control a humanoid robot in a 3D physics simulation. ' +
  "Interpret the user's natural-language commands and call the matching tools to drive the robot. " +
  'The robot has two arms (each with a shoulder and an elbow) and a torso. ' +
  'It does NOT have a head joint — never claim to look at, turn its head, or make eye contact. ' +
  'When the user asks the robot to "stand", prefer pin_root=true for a reliably upright demo unless they explicitly want realistic physics. ' +
  'You may receive a webcam frame as part of a user turn; ground commands like "wave at me" against it. ' +
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
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

const RETRYABLE = new Set<number>(AGENT.retry.retryableStatus as readonly number[]);

export class ClaudeAgent implements AgentClient {
  readonly label = 'Claude Haiku 4.5';
  private apiKey: string;
  private model: string;
  /** Conversation history across turns. We keep it on the agent instance so
   *  multi-turn refinement ("now do the same on the left arm") works. The
   *  user/composer is responsible for calling `resetConversation()` when
   *  starting a new task. */
  private history: ApiMessage[] = [];

  constructor(apiKey: string, model: string = AGENT.defaultModel) {
    this.apiKey = apiKey;
    this.model = model;
  }

  resetConversation() { this.history = []; }

  async respond(
    userText: string,
    control: HumanoidControl,
    image?: CapturedFrame | null,
  ): Promise<AgentTurn> {
    const userContent: ContentBlock[] = [];
    if (image) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
      });
    }
    userContent.push({ type: 'text', text: userText });

    // Work on a transactional copy of history so a mid-loop failure doesn't
    // poison subsequent turns with a half-applied state.
    const messages: ApiMessage[] = [...this.history, { role: 'user', content: userContent }];
    const executedTools: AgentTurn['tools'] = [];
    const totalUsage: UsageStats = { inputTokens: 0, outputTokens: 0 };
    let truncated = false;

    for (let i = 0; i < AGENT.maxToolRounds; i++) {
      const res = await this.postWithRetry(messages);
      accumulateUsage(totalUsage, res.usage);
      messages.push({ role: 'assistant', content: res.content });

      if (res.stop_reason !== 'tool_use') {
        const text = extractText(res.content) || '(no text)';
        this.history = messages;
        return { text, tools: executedTools, usage: totalUsage };
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

      if (i === AGENT.maxToolRounds - 1) truncated = true;
    }

    // Cap hit: persist anyway so the next turn can see the partial state.
    this.history = messages;
    return {
      text: `(stopped after ${AGENT.maxToolRounds} tool-use rounds)`,
      tools: executedTools,
      usage: totalUsage,
      truncated,
    };
  }

  private async postWithRetry(messages: ApiMessage[]): Promise<ApiResponse> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < AGENT.retry.maxAttempts; attempt++) {
      try {
        return await this.post(messages);
      } catch (err) {
        const e = err as Error & { status?: number };
        const status = e.status;
        if (status === undefined || !RETRYABLE.has(status) || attempt === AGENT.retry.maxAttempts - 1) {
          throw e;
        }
        lastErr = e;
        const delay = AGENT.retry.baseDelayMs * 2 ** attempt * (0.5 + Math.random());
        await sleep(delay);
      }
    }
    throw lastErr ?? new Error('retry: exhausted without error');
  }

  private async post(messages: ApiMessage[]): Promise<ApiResponse> {
    const res = await fetch(AGENT.endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': AGENT.apiVersion,
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: AGENT.maxTokens,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: TOOL_SCHEMAS,
        messages,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      const err = new Error(`Anthropic API ${res.status}: ${body.slice(0, 400)}`) as Error & { status: number };
      err.status = res.status;
      throw err;
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

function accumulateUsage(into: UsageStats, u: ApiResponse['usage']) {
  if (!u) return;
  into.inputTokens += u.input_tokens ?? 0;
  into.outputTokens += u.output_tokens ?? 0;
  if (u.cache_read_input_tokens != null) {
    into.cacheReadTokens = (into.cacheReadTokens ?? 0) + u.cache_read_input_tokens;
  }
  if (u.cache_creation_input_tokens != null) {
    into.cacheCreationTokens = (into.cacheCreationTokens ?? 0) + u.cache_creation_input_tokens;
  }
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
