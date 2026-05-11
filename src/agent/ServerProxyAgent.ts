import type { HumanoidControl } from '../control/HumanoidControl';
import type { AgentClient, AgentTurn, StreamCallback, UsageStats } from './AgentClient';
import { runToolCalls } from './AgentClient';
import { TOOL_SCHEMAS, type ToolCall } from './tools';
import type { CapturedFrame } from './WebcamCapture';
import { AGENT, STORAGE_KEYS } from '../config';
import { priceUsage } from './pricing';
import {
  parseSseStream,
  extractText,
  accumulateUsage,
  persistHistory,
  restoreHistory,
  SYSTEM_PROMPT,
  type ApiMessage,
  type ApiResponse,
  type ContentBlock,
  type ToolResultBlock,
  type ToolUseBlock,
} from './ClaudeAgent';

const RETRYABLE = new Set<number>(AGENT.retry.retryableStatus as readonly number[]);

/**
 * Same surface as `ClaudeAgent` but POSTs to a user-controlled proxy
 * endpoint instead of Anthropic directly. The proxy is expected to:
 *   1. Receive the same JSON payload we'd send to `/v1/messages`.
 *   2. Add the `x-api-key` / `anthropic-version` headers server-side
 *      so the API key never reaches the browser.
 *   3. Stream the SSE response back unchanged.
 *
 * See `server/agent-proxy.example.mjs` for a ~30-line Node reference.
 */
export class ServerProxyAgent implements AgentClient {
  readonly label: string;
  private endpoint: string;
  private model: string;
  private history: ApiMessage[] = [];

  constructor(endpoint: string, model: string = AGENT.defaultModel) {
    this.endpoint = endpoint;
    this.label = `Server proxy (${shortHost(endpoint)})`;
    this.model = model;
    this.history = restoreHistory();
  }

  resetConversation() {
    this.history = [];
    try { localStorage.removeItem(STORAGE_KEYS.history); } catch { /* noop */ }
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

  private async streamWithRetry(messages: ApiMessage[], onStream?: StreamCallback): Promise<ApiResponse> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < AGENT.retry.maxAttempts; attempt++) {
      try {
        return await this.streamOnce(messages, onStream);
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e.status === undefined || !RETRYABLE.has(e.status) || attempt === AGENT.retry.maxAttempts - 1) {
          throw e;
        }
        lastErr = e;
        const delay = AGENT.retry.baseDelayMs * 2 ** attempt * (0.5 + Math.random());
        await new Promise<void>(r => setTimeout(r, delay));
      }
    }
    throw lastErr ?? new Error('retry: exhausted without error');
  }

  private async streamOnce(messages: ApiMessage[], onStream?: StreamCallback): Promise<ApiResponse> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      const err = new Error(`Proxy ${res.status}: ${body.slice(0, 400)}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    return parseSseStream(res.body, onStream);
  }
}

function shortHost(url: string): string {
  try { return new URL(url, location.origin).host || 'self'; }
  catch { return url.slice(0, 40); }
}
