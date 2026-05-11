import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ServerProxyAgent } from './ServerProxyAgent';
import type { HumanoidControl } from '../control/HumanoidControl';

function emptySseStream(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(
        'event: content_block_start\n' +
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
        'event: content_block_delta\n' +
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n' +
        'event: content_block_stop\n' +
        'data: {"type":"content_block_stop","index":0}\n\n' +
        'event: message_delta\n' +
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n'
      ));
      controller.close();
    },
  });
}

function stubControl(): HumanoidControl {
  // Bare stub — the tests never trigger a tool dispatch, so the methods
  // don't need real bodies. Keep the type union narrow to match usage.
  return {} as unknown as HumanoidControl;
}

describe('ServerProxyAgent', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(emptySseStream(), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('labels itself with the host portion of the endpoint', () => {
    const agent = new ServerProxyAgent('https://example.com/api/agent');
    expect(agent.label).toContain('example.com');
  });

  it('posts to the configured endpoint without an x-api-key header', async () => {
    const agent = new ServerProxyAgent('/api/agent');
    await agent.respond('hi', stubControl());

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/agent');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['anthropic-version']).toBeUndefined();
    expect(headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
  });

  it('forwards the Anthropic-shaped payload (model, tools, stream, messages)', async () => {
    const agent = new ServerProxyAgent('/api/agent');
    await agent.respond('raise your right arm', stubControl());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toMatch(/claude/);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
    expect(body.messages[body.messages.length - 1].role).toBe('user');
  });

  it('resetConversation clears persisted history', () => {
    localStorage.setItem('robots.agent.history', JSON.stringify([{ role: 'user', content: 'hi' }]));
    const agent = new ServerProxyAgent('/api/agent');
    agent.resetConversation();
    expect(localStorage.getItem('robots.agent.history')).toBeNull();
  });

  it('extracts the final text from the streamed response', async () => {
    const agent = new ServerProxyAgent('/api/agent');
    const turn = await agent.respond('hi', stubControl());
    expect(turn.text).toBe('ok');
    expect(turn.usage?.outputTokens).toBe(1);
  });
});
