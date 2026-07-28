// ─────────────────────────────────────────────────────────────────────────────
// Torus Gate native wire client (Task #49)
//
// The Gate speaks a JSON-free, framework-native line protocol: one field per
// line, `key<SP>value`. This module encodes requests, POSTs them as
// text/plain, and parses the line-wire response into a flat string map. No
// JSON on the happy path — only a defensive parse of the shared error body.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export type Wire = Record<string, string>;

function encode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k} ${String(v).replace(/\r?\n/g, ' ').trim()}`)
    .join('\n');
}

export function parseWire(text: string): Wire {
  const map: Wire = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.search(/\s/);
    if (idx === -1) {
      map[line.toLowerCase()] = '';
    } else {
      map[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
    }
  }
  return map;
}

export async function gatePost(
  path: string,
  fields: Record<string, string>,
): Promise<Wire> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: encode(fields),
  });
  const text = await res.text();
  if (!res.ok) {
    // Success is pure line-wire; the shared error path may still be JSON.
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.message || j.error || text;
    } catch {
      /* plain-text error, use as-is */
    }
    throw new Error(msg || `The gate refused (${res.status})`);
  }
  return parseWire(text);
}

/** Format three trits into the dotted cube the wire expects, e.g. `1.3.2`. */
export function cubeToWire(x: number, y: number, z: number): string {
  return `${x}.${y}.${z}`;
}
