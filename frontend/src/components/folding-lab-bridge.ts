import apiClient from '../api/client';

export const FOLDING_MAX_BYTES = 10 * 1024 * 1024;
export const FOLDING_FORMATS = ['txt', 'md', 'csv', 'json', 'html', 'pdf', 'docx'] as const;
type Extraction = { text: string; format: string; limitations: string[] };
type Pending = { id: string; controller: AbortController; timer: ReturnType<typeof setTimeout> };

/** The opaque-origin frame has no API authority. Only this bounded bridge does. */
export function createFoldingLabBridge(frame: Window) {
  let pending: Pending | null = null;
  let disposed = false;
  function reset() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.controller.abort();
    pending = null;
  }
  function reply(message: object) {
    // "*" is required for a sandbox's opaque origin; the Window is exact.
    if (!disposed) frame.postMessage({ type: 'folding:extracted', ...message }, '*');
  }
  async function receive(event: MessageEvent) {
    if (disposed || event.source !== frame) return;
    const message = event.data;
    if (!message || typeof message !== 'object' ||
        typeof message.id !== 'string' || !message.id.trim() || message.id.length > 100) return;
    const { id } = message;
    if (message.type === 'folding:cancel') {
      if (pending?.id === id) reset();
      return;
    }
    if (message.type !== 'folding:extract') return;
    if (!FOLDING_FORMATS.includes(message.format) ||
        !(message.bytes instanceof ArrayBuffer) || message.bytes.byteLength > FOLDING_MAX_BYTES) {
      reply({ id, error: 'Use a supported document format and an ArrayBuffer no larger than 10 MiB.' });
      return;
    }
    if (pending) {
      reply({ id, error: 'An extraction is already in progress. Clear it or wait before trying again.' });
      return;
    }
    const controller = new AbortController();
    const request: Pending = {
      id, controller,
      timer: setTimeout(() => {
        if (pending !== request) return;
        reset();
        reply({ id, error: 'Document extraction timed out after 25 seconds. Please retry.' });
      }, 25_000),
    };
    pending = request;
    try {
      const { data } = await apiClient.post<Extraction>('/api/capomastro/folding/extract', message.bytes, {
        baseURL: window.location.origin,
        withCredentials: true,
        signal: controller.signal,
        timeout: 25_000,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Document-Format': message.format },
      });
      if (disposed || pending !== request) return;
      if (!data || typeof data.text !== 'string' || typeof data.format !== 'string' ||
          !Array.isArray(data.limitations) || !data.limitations.every(item => typeof item === 'string')) {
        throw new Error('The extraction server returned an invalid response.');
      }
      reply({ id, text: data.text, limitations: data.limitations });
    } catch (error: unknown) {
      if (disposed || pending !== request) return;
      const responseError = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
      reply({ id, error: typeof responseError === 'string' ? responseError :
        error instanceof Error ? error.message : 'Document extraction failed. Please retry.' });
    } finally {
      if (pending === request) {
        clearTimeout(request.timer);
        pending = null;
      }
    }
  }
  return {
    receive,
    reset,
    dispose() { disposed = true; reset(); },
  };
}
