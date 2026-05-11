import { describe, expect, it } from 'vitest';
import { parseSseStream } from './ClaudeAgent';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i++]));
    },
  });
}

function event(type: string, data: object): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

describe('parseSseStream — text-only response', () => {
  it('reassembles deltas into a single text block', async () => {
    const stream = streamOf([
      event('message_start', { message: { usage: { input_tokens: 12, output_tokens: 0 } } }),
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: ', world' } }),
      event('content_block_stop', { index: 0 }),
      event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }),
      event('message_stop', {}),
    ]);

    const captured: string[] = [];
    const res = await parseSseStream(stream, ev => {
      if (ev.type === 'text') captured.push(ev.text);
    });

    expect(res.stop_reason).toBe('end_turn');
    expect(res.content).toHaveLength(1);
    expect(res.content[0]).toEqual({ type: 'text', text: 'Hello, world' });
    expect(captured).toEqual(['Hello', ', world']);
    expect(res.usage?.input_tokens).toBe(12);
    expect(res.usage?.output_tokens).toBe(7);
  });

  it('handles a single chunk that contains multiple events', async () => {
    const stream = streamOf([
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } }) +
      event('content_block_stop', { index: 0 }) +
      event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: {} }) +
      event('message_stop', {}),
    ]);
    const res = await parseSseStream(stream);
    expect(res.content[0]).toEqual({ type: 'text', text: 'ok' });
  });

  it('reassembles events split mid-line across chunks', async () => {
    const full = event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'split' } }) +
      event('content_block_stop', { index: 0 }) +
      event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: {} });
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += 13) chunks.push(full.slice(i, i + 13));
    const res = await parseSseStream(streamOf(chunks));
    expect(res.content[0]).toEqual({ type: 'text', text: 'split' });
    expect(res.stop_reason).toBe('end_turn');
  });
});

describe('parseSseStream — tool_use response', () => {
  it('accumulates input_json_delta fragments into parsed input', async () => {
    const stream = streamOf([
      event('content_block_start', {
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_abc', name: 'raise_arm', input: {} },
      }),
      event('content_block_delta', {
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"side":' },
      }),
      event('content_block_delta', {
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"right","angle_deg":90}' },
      }),
      event('content_block_stop', { index: 0 }),
      event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } }),
      event('message_stop', {}),
    ]);

    const res = await parseSseStream(stream);
    expect(res.stop_reason).toBe('tool_use');
    expect(res.content).toHaveLength(1);
    expect(res.content[0]).toMatchObject({
      type: 'tool_use',
      id: 'toolu_abc',
      name: 'raise_arm',
      input: { side: 'right', angle_deg: 90 },
    });
  });

  it('mixes a text block and a tool_use block in one response', async () => {
    const stream = streamOf([
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK ' } }),
      event('content_block_stop', { index: 0 }),
      event('content_block_start', {
        index: 1,
        content_block: { type: 'tool_use', id: 'tu_x', name: 'stand', input: {} },
      }),
      event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"pin_root":true}' } }),
      event('content_block_stop', { index: 1 }),
      event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: {} }),
      event('message_stop', {}),
    ]);
    const res = await parseSseStream(stream);
    expect(res.content[0]).toEqual({ type: 'text', text: 'OK ' });
    expect(res.content[1]).toMatchObject({ type: 'tool_use', input: { pin_root: true } });
  });

  it('falls back to {} input when tool_use json is malformed', async () => {
    const stream = streamOf([
      event('content_block_start', {
        index: 0,
        content_block: { type: 'tool_use', id: 'x', name: 'walk', input: {} },
      }),
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"direction":' } }),
      event('content_block_stop', { index: 0 }),
      event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: {} }),
    ]);
    const res = await parseSseStream(stream);
    expect(res.content[0]).toMatchObject({ type: 'tool_use', input: {} });
  });
});

describe('parseSseStream — robustness', () => {
  it('ignores keepalive ping events', async () => {
    const stream = streamOf([
      `event: ping\ndata: {"type":"ping"}\n\n`,
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'hi' } }),
      event('content_block_stop', { index: 0 }),
      event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: {} }),
    ]);
    const res = await parseSseStream(stream);
    expect(res.content[0]).toEqual({ type: 'text', text: 'hi' });
  });

  it('ignores malformed data lines', async () => {
    const stream = streamOf([
      `event: junk\ndata: not-json\n\n`,
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'still ok' } }),
      event('content_block_stop', { index: 0 }),
      event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: {} }),
    ]);
    const res = await parseSseStream(stream);
    expect(res.content[0]).toEqual({ type: 'text', text: 'still ok' });
  });
});
