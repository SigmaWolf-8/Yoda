import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { createFoldingLabBridge, FOLDING_MAX_BYTES } from '../folding-lab-bridge';

vi.mock('../../api/client', () => ({ default: { post: vi.fn() } }));

describe('bounded Folding Lab bridge', () => {
  const post = vi.mocked(apiClient.post);
  let frame: Window;
  let reply: ReturnType<typeof vi.fn>;
  let bridge: ReturnType<typeof createFoldingLabBridge>;
  function message(data: object, source = frame) {
    return bridge.receive({ source, data } as MessageEvent);
  }
  const input = (id = 'document-1') => ({ type: 'folding:extract', id, format: 'txt', bytes: new ArrayBuffer(4) });
  beforeEach(() => {
    vi.useFakeTimers();
    post.mockReset();
    reply = vi.fn();
    frame = { postMessage: reply } as unknown as Window;
    bridge = createFoldingLabBridge(frame);
  });
  afterEach(() => { bridge.dispose(); vi.useRealTimers(); });

  it('ignores other frames, malformed IDs, and unrecognized messages', async () => {
    await message(input(), {} as Window);
    await message(input('x'.repeat(101)));
    await message(input(''));
    await message({ ...input(), type: 'other' });
    expect(post).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('rejects unsupported formats, non-ArrayBuffer bodies and oversized documents', async () => {
    for (const invalid of [
      { format: 'exe' }, { bytes: new Uint8Array(4) }, { bytes: new ArrayBuffer(FOLDING_MAX_BYTES + 1) },
    ]) await message({ ...input(), ...invalid });
    expect(post).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(3);
  });

  it('sends the raw body with a fixed same-origin endpoint and returns limitations only to its frame', async () => {
    const request = input();
    post.mockResolvedValue({ data: { text: 'extracted', format: 'txt', limitations: ['Plain text only'] } });
    await message(request);
    expect(post).toHaveBeenCalledWith('/api/capomastro/folding/extract', request.bytes, expect.objectContaining({
      baseURL: window.location.origin, withCredentials: true, timeout: 25_000,
      headers: { 'Content-Type': 'application/octet-stream', 'X-Document-Format': 'txt' },
    }));
    expect(reply).toHaveBeenCalledWith({
      type: 'folding:extracted', id: request.id, text: 'extracted', limitations: ['Plain text only'],
    }, '*');
  });

  it('permits one request, validates cancel source/id, and suppresses canceled late responses', async () => {
    let resolve!: (value: unknown) => void;
    post.mockImplementation(() => new Promise(done => { resolve = done; }));
    const first = message(input());
    const signal = post.mock.calls[0][2]?.signal;
    await message(input('second'));
    expect(post).toHaveBeenCalledTimes(1);
    await message({ type: 'folding:cancel', id: 'different' });
    await message({ type: 'folding:cancel', id: 'document-1' }, {} as Window);
    expect(signal?.aborted).toBe(false);
    await message({ type: 'folding:cancel', id: 'document-1' });
    expect(signal?.aborted).toBe(true);
    resolve({ data: { text: 'late', format: 'txt', limitations: [] } });
    await first;
    expect(reply).toHaveBeenCalledTimes(1); // only second request's busy error
  });

  it('aborts at 25 seconds and never replies to an old document after reset or disposal', async () => {
    post.mockImplementation(() => new Promise(() => {}));
    void message(input());
    const signal = post.mock.calls[0][2]?.signal;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(signal?.aborted).toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('25 seconds') }), '*');
    void message(input('new'));
    const nextSignal = post.mock.calls[1][2]?.signal;
    bridge.reset();
    expect(nextSignal?.aborted).toBe(true);
    bridge.dispose();
    await message(input('unmounted'));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('reports backend and malformed response errors without document logging', async () => {
    post.mockRejectedValueOnce({ response: { data: { error: 'PDF has no extractable text' } } });
    await message(input());
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ error: 'PDF has no extractable text' }), '*');
    post.mockResolvedValueOnce({ data: { text: 7 } });
    await message(input());
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.stringContaining('invalid response') }), '*');
  });
});
