// ─────────────────────────────────────────────────────────────────────────────
// Θ-LOCK — the Crystal side of the unified epoch.
//
// This is the exact mirror of `crates/yoda-api/src/theta.rs`. Both sides read
// the same clock, resolve it to the same angle on the ternary circle, and
// derive the same reading from the enrolled seed. Nothing secret is sent: the
// possession factor is computed here and only its six digits travel.
//
// Any change to the constants or the derivation below MUST be made in
// theta.rs in the same breath, or the two sides silently stop agreeing.
//
// Angular system — Salvi Framework, not decimal:
//   full circle 364° = 111111₃ · one ternary radian 13° = 111₃ · Z₂₈
// ─────────────────────────────────────────────────────────────────────────────

/** The unified epoch: the fixed instant every theta angle is measured from. */
export const UNIFIED_EPOCH_UNIX = 0;

/** Seconds the angle dwells at each station: 169 = 13². */
export const STATION_DWELL_SECS = 169;

/** A full circle: 364° = 111111₃. */
export const FULL_CIRCLE_DEG = 364;

/** One ternary radian: 13° = 111₃. */
export const RADIAN_DEG = 13;

/** Stations per revolution — the order of Z₂₈. */
export const CYCLIC_ORDER = FULL_CIRCLE_DEG / RADIAN_DEG;

/** One full revolution, in seconds: 28 × 169. */
export const REVOLUTION_SECS = CYCLIC_ORDER * STATION_DWELL_SECS;

const SEED_KEY = 'yoda_theta_seed';

export interface Theta {
  revolution: number;
  station: number;
  degrees: number;
  /** Exact — this is what the reading is keyed to, so it must not round. */
  absoluteStation: bigint;
  /** Seconds before the angle advances. */
  holdsFor: number;
}

/**
 * Euclidean division on bigint — negative instants must not produce negative
 * stations, and `/` on bigint truncates toward zero rather than flooring.
 */
function divEuclid(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b < 0n ? q - 1n : q;
}

function remEuclid(a: bigint, b: bigint): bigint {
  return ((a % b) + b) % b;
}

/**
 * Resolve a UTC Unix timestamp (seconds) to its theta angle.
 *
 * The arithmetic is bigint throughout so it matches Rust's i64 exactly at any
 * magnitude; only the small, bounded results are narrowed back to `number`.
 */
export function thetaAt(unixSeconds: number | bigint): Theta {
  const secs = BigInt(unixSeconds);
  const dwell = BigInt(STATION_DWELL_SECS);
  const order = BigInt(CYCLIC_ORDER);

  const elapsed = secs - BigInt(UNIFIED_EPOCH_UNIX);
  const absolute = divEuclid(elapsed, dwell);
  const revolution = divEuclid(absolute, order);
  const station = remEuclid(absolute, order);

  return {
    // Bounded by construction (0..27), so narrowing is exact.
    revolution: Number(revolution),
    station: Number(station),
    degrees: Number(station) * RADIAN_DEG,
    absoluteStation: absolute,
    holdsFor: STATION_DWELL_SECS - Number(remEuclid(elapsed, dwell)),
  };
}

/** The current theta angle, from this device's clock. */
export function thetaNow(): Theta {
  return thetaAt(Math.floor(Date.now() / 1000));
}

// ── The seed held by this Crystal ──

/**
 * The seed is what makes this device a possession factor. It is issued once at
 * enrollment and never leaves: only readings derived from it are sent.
 */
export function storeThetaSeed(seedHex: string, persist: boolean = true) {
  (persist ? localStorage : sessionStorage).setItem(SEED_KEY, seedHex);
}

export function getThetaSeed(): string | null {
  return localStorage.getItem(SEED_KEY) ?? sessionStorage.getItem(SEED_KEY);
}

export function clearThetaSeed() {
  localStorage.removeItem(SEED_KEY);
  sessionStorage.removeItem(SEED_KEY);
}

// ── Reading ──

/**
 * Derive the reading for a seed at an absolute station.
 *
 * `HMAC-SHA256(seed, station_be_bytes)` with RFC-4226 dynamic truncation to
 * six digits — byte-for-byte the construction in theta.rs. The seed is keyed
 * as its ASCII hex text, matching the server, which reads the column directly.
 */
export async function reading(
  seedHex: string,
  absoluteStation: bigint
): Promise<number> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(seedHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // The station as a big-endian i64, to match `i64::to_be_bytes`.
  const station = new DataView(new ArrayBuffer(8));
  station.setBigInt64(0, absoluteStation, false);

  const tag = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, station.buffer)
  );

  const offset = tag[tag.length - 1] & 0x0f;
  const truncated =
    ((tag[offset] & 0x7f) << 24) |
    (tag[offset + 1] << 16) |
    (tag[offset + 2] << 8) |
    tag[offset + 3];

  // `>>> 0` keeps the value unsigned — JS bitwise ops yield int32.
  return (truncated >>> 0) % 1_000_000;
}

/** The reading for right now, from the seed this Crystal holds. */
export async function currentReading(seedHex: string): Promise<number> {
  return reading(seedHex, thetaNow().absoluteStation);
}

/** Six-digit display form. */
export function formatReading(value: number): string {
  return String(value).padStart(6, '0');
}
