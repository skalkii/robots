import type { HumanoidControl } from '../control/HumanoidControl';
import type { AgentClient, AgentTurn, StreamCallback, UsageStats } from './AgentClient';
import { runToolCalls } from './AgentClient';
import { TOOL_SCHEMAS, type ToolCall } from './tools';
import type { CapturedFrame } from './WebcamCapture';
import { AGENT, STORAGE_KEYS } from '../config';
import { priceUsage } from './pricing';

const SYSTEM_PROMPT =
  'You control a humanoid robot in a 3D physics simulation. ' +
  "Interpret the user's natural-language commands and call the matching tools to drive the robot. " +
  'The robot has two arms (each with a shoulder and an elbow) and a torso. ' +
  'It does NOT have a head joint — never claim to look at, turn its head, or make eye contact. ' +
  'When the user asks the robot to "stand", prefer pin_root=true for a reliably upright demo unless they explicitly want realistic physics. ' +
  'You may receive a webcam frame as part of a user turn; ground commands like "wave at me" against it. ' +
  'After tool calls, reply with one short sentence confirming what you did. ' +
  'If the user asks something the robot cannot do, say so plainly.';

export type TextBlock = { type: 'text'; text: string };
export type ImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string };
};
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ApiResponse {
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

export { SYSTEM_PROMPT };

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
    this.history = restoreHistory();
  }

  resetConversation() {
    this.history = [];
    try { localStorage.removeItem(STORAGE_KEYS.history); } catch { /* quota / private */ }
  }

  async respond(
    userText: string,
    control: HumanoidControl,
    image?: CapturedFrame | null,
    onStream?: StreamCallback,
  ): Promise<AgentTurn> {
    const userContent: ContentBlock[] = [];
    if (image) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
      });
    }
    userContent.push({ type: 'text', text: userText });

    const messages: ApiMessage[] = [...this.history, { role: 'user', content: userContent }];
    const executedTools: AgentTurn['tools'] = [];
    const totalUsage: UsageStats = { inputTokens: 0, outputTokens: 0 };
    let truncated = false;

    for (let i = 0; i < AGENT.maxToolRounds; i++) {
      const res = await this.streamWithRetry(messages, onStream);
      accumulateUsage(totalUsage, res.usage);
      messages.push({ role: 'assistant', content: res.content });

      if (res.stop_reason !== 'tool_use') {
        const text = extractText(res.content) || '(no text)';
        this.history = messages;
        persistHistory(this.history);
        totalUsage.costUsd = priceUsage(this.model, totalUsage) ?? undefined;
        return { text, tools: executedTools, usage: totalUsage };
      }

      const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      for (const tu of toolUses) onStream?.({ type: 'tool_start', name: tu.name });

      const calls: ToolCall[] = toolUses.map(t => ({ name: t.name, input: t.input }));
      const results = runToolCalls(control, calls);
      executedTools.push(...results);
      for (let k = 0; k < toolUses.length; k++) {
        onStream?.({
          type: 'tool_result',
          name: toolUses[k].name,
          ok: results[k].result.ok,
          message: results[k].result.message,
        });
      }

      const toolResults: ToolResultBlock[] = toolUses.map((tu, idx) => ({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: results[idx].result.message,
        is_error: !results[idx].result.ok,
      }));
      messages.push({ role: 'user', content: toolResults });

      if (i === AGENT.maxToolRounds - 1) truncated = true;
    }

    this.history = messages;
    persistHistory(this.history);
    totalUsage.costUsd = priceUsage(this.model, totalUsage) ?? undefined;
    return {
      text: `(stopped after ${AGENT.maxToolRounds} tool-use rounds)`,
      tools: executedTools,
      usage: totalUsage,
      truncated,
    };
  }

  private async streamWithRetry(
    messages: ApiMessage[],
    onStream?: StreamCallback,
  ): Promise<ApiResponse> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < AGENT.retry.maxAttempts; attempt++) {
      try {
        return await this.streamOnce(messages, onStream);
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

  /**
   * Single request/response cycle with SSE streaming. Yields incremental
   * text via `onStream` and reconstructs the full assistant content array
   * from the stream events so the caller can run the tool-use loop.
   */
  private async streamOnce(
    messages: ApiMessage[],
    onStream?: StreamCallback,
  ): Promise<ApiResponse> {
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
        stream: true,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: TOOL_SCHEMAS,
        messages,
      }),
    });
    if (!res.ok || !res.body) {
      const body = res.body ? await res.text().catch(() => '<unreadable>') : '<no body>';
      const err = new Error(`Anthropic API ${res.status}: ${body.slice(0, 400)}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    return parseSseStream(res.body, onStream);
  }
}

export function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

export function accumulateUsage(into: UsageStats, u: ApiResponse['usage']) {
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

/**
 * Anthropic's Messages-API streaming protocol uses Server-Sent Events.
 * Reconstruct the full assistant response from the event stream:
 *
 *   message_start            → ignored except for an initial `usage`
 *   content_block_start      → push a new content block (text or tool_use)
 *   content_block_delta      → append text deltas / accumulate tool input JSON
 *   content_block_stop       → finalize the block (parse JSON for tool_use)
 *   message_delta            → captures stop_reason + final output_tokens
 *   message_stop             → end of stream
 */
export async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  onStream?: StreamCallback,
): Promise<ApiResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');

  const content: ContentBlock[] = [];
  /** Per-content-block accumulator for tool_use partial JSON. */
  const partialJson: string[] = [];
  let stopReason: string = 'end_turn';
  const usage: NonNullable<ApiResponse['usage']> = {
    input_tokens: 0,
    output_tokens: 0,
  };

  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE events are separated by `\n\n`. Split, keep any trailing partial.
    const events = buf.split('\n\n');
    buf = events.pop() ?? '';
    for (const ev of events) processEvent(ev);
  }

  function processEvent(ev: string) {
    // Each event consists of `event:` and `data:` lines.
    let dataLine = '';
    for (const line of ev.split('\n')) {
      if (line.startsWith('data:')) dataLine = line.slice(5).trim();
    }
    if (!dataLine || dataLine === '[DONE]') return;
    let payload: unknown;
    try { payload = JSON.parse(dataLine); }
    catch { return; }
    if (typeof payload !== 'object' || payload === null) return;

    const p = payload as { type?: string; [k: string]: unknown };
    switch (p.type) {
      case 'message_start': {
        const m = p.message as { usage?: typeof usage } | undefined;
        if (m?.usage) Object.assign(usage, m.usage);
        return;
      }
      case 'content_block_start': {
        const idx = p.index as number;
        const block = p.content_block as ContentBlock;
        if (block.type === 'text') {
          content[idx] = { type: 'text', text: '' };
        } else if (block.type === 'tool_use') {
          content[idx] = { ...block, input: {} };
          partialJson[idx] = '';
        } else {
          content[idx] = block;
        }
        return;
      }
      case 'content_block_delta': {
        const idx = p.index as number;
        const delta = p.delta as { type: string; text?: string; partial_json?: string };
        const block = content[idx];
        if (delta.type === 'text_delta' && delta.text && block?.type === 'text') {
          block.text += delta.text;
          onStream?.({ type: 'text', text: delta.text });
        } else if (delta.type === 'input_json_delta' && delta.partial_json != null) {
          partialJson[idx] = (partialJson[idx] ?? '') + delta.partial_json;
        }
        return;
      }
      case 'content_block_stop': {
        const idx = p.index as number;
        const block = content[idx];
        if (block?.type === 'tool_use') {
          const json = partialJson[idx] || '{}';
          try { block.input = JSON.parse(json); }
          catch { block.input = {}; }
        }
        return;
      }
      case 'message_delta': {
        const d = p.delta as { stop_reason?: string };
        if (d?.stop_reason) stopReason = d.stop_reason;
        const u = p.usage as Partial<typeof usage> | undefined;
        if (u?.output_tokens != null) usage.output_tokens = u.output_tokens;
        if (u?.cache_read_input_tokens != null) usage.cache_read_input_tokens = u.cache_read_input_tokens;
        if (u?.cache_creation_input_tokens != null) usage.cache_creation_input_tokens = u.cache_creation_input_tokens;
        return;
      }
      // message_stop / ping / error fall through
    }
  }

  return { id: '', role: 'assistant', content, stop_reason: stopReason, usage };
}

/** Maximum number of API messages to persist. Older messages are dropped from
 *  the head so the storage payload stays small and the model still sees
 *  recent multi-turn context. */
const MAX_PERSISTED_MESSAGES = 40;

export function persistHistory(messages: ApiMessage[]) {
  try {
    const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES).map(stripImages);
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(trimmed));
  } catch { /* quota exceeded or private mode — silently skip */ }
}

export function restoreHistory(): ApiMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ApiMessage[] : [];
  } catch { return []; }
}

/** Replace image content blocks with a tiny text placeholder so a few
 *  conversation turns don't blow past the ~5 MB localStorage limit. The
 *  model still sees that an image was present, which is enough context to
 *  understand follow-ups. */
function stripImages(m: ApiMessage): ApiMessage {
  if (typeof m.content === 'string') return m;
  return {
    role: m.role,
    content: m.content.map(b =>
      b.type === 'image'
        ? { type: 'text', text: '[image attachment elided from persisted history]' } as TextBlock
        : b,
    ),
  };
}
