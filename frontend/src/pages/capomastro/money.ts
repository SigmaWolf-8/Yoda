/**
 * Exact-decimal presentation for Capomastro figures.
 *
 * Money and every derived quantity cross the wire as canonical decimal
 * *strings*, computed in exact base-10 decimal by the backend. They must never
 * be parsed into a JS `number` for display: a double cannot hold
 * `1600053031036.44653193` without altering it, and `Number(x).toFixed(2)` on a
 * trillion-dollar figure is a rounding error with a currency symbol in front
 * of it.
 *
 * Everything below is therefore string manipulation. Scaling moves the decimal
 * point within the digits; percentages shift it two places; nothing divides.
 * The single exception is {@link forGeometry}, which exists because chart
 * pixels are inherently floating point — its result is used for layout only
 * and is never shown to the reader as a value.
 */

/** A canonical decimal string, e.g. `"1250000000.05"`. Not a `number`. */
export type Dec = string;

/** Split a canonical decimal string into sign, integer digits and fraction. */
export function splitDec(value: Dec): { sign: string; int: string; frac: string } | null {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value.trim())) return null;
  const raw = value.trim();
  const sign = raw.startsWith('-') ? '-' : '';
  const [int, frac = ''] = (sign ? raw.slice(1) : raw).split('.');
  return { sign, int, frac };
}

export function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Exact rendering: every digit published, thousands-separated. Pure string
 * work — the value never becomes a `number`, so nothing is rounded.
 */
export function exact(value: Dec): string {
  const parts = splitDec(value);
  if (!parts) return '—';
  return `${parts.sign}${group(parts.int)}${parts.frac ? `.${parts.frac}` : ''}`;
}

/**
 * Exact rendering at a fixed scale of `dp` decimal places — truncated, never
 * rounded up, and zero-padded so figures line up in a column.
 */
export function exactTo(value: Dec, dp: number): string {
  const parts = splitDec(value);
  if (!parts) return '—';
  const frac = parts.frac.slice(0, dp).padEnd(dp, '0');
  return `${parts.sign}${group(parts.int)}${dp > 0 ? `.${frac}` : ''}`;
}

/**
 * Abbreviated headline ($2.153T). Scaling is done by moving the decimal point
 * within the string, so even the short form is derived from the exact digits
 * rather than from a divided float. It shows fewer digits — but the digits it
 * shows are the real ones.
 */
export function usd(value: Dec, digits = 2): string {
  const parts = splitDec(value);
  if (!parts) return '—';
  const { sign, int, frac } = parts;

  const units: Array<[number, string]> = [
    [12, 'T'],
    [9, 'B'],
    [6, 'M'],
  ];
  for (const [power, suffix] of units) {
    if (int.length > power) {
      const head = int.slice(0, int.length - power);
      const tail = (int.slice(int.length - power) + frac).slice(0, digits);
      return `$${sign}${group(head)}${tail ? `.${tail}` : ''}${suffix}`;
    }
  }
  return `$${sign}${group(int)}${frac ? `.${frac.slice(0, digits)}` : ''}`;
}

/** A decimal *fraction* rendered as a percentage, to `dp` places. */
export function percent(value: Dec, dp = 2): string {
  const parts = splitDec(value);
  if (!parts) return '—';
  // Shift the decimal point two places right, then trim — no multiplication.
  const shifted = parts.frac.padEnd(dp + 2, '0');
  const whole = `${parts.int}${shifted.slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  const rest = shifted.slice(2, 2 + dp);
  return `${parts.sign}${group(whole)}${dp > 0 ? `.${rest.padEnd(dp, '0')}` : ''}`;
}

/**
 * A figure that is *already* a percentage (e.g. a `3.65` rate), trimmed to
 * `dp` places without shifting the point.
 */
export function rate(value: Dec | null | undefined, dp = 3): string {
  if (value == null) return '—';
  return `${exactTo(value, dp)}%`;
}

/** Currency to the cent, always signed-safe and thousands-separated. */
export function money(value: Dec | null | undefined, dp = 2): string {
  if (value == null) return '—';
  const parts = splitDec(value);
  if (!parts) return '—';
  const frac = parts.frac.slice(0, dp).padEnd(dp, '0');
  return `${parts.sign}$${group(parts.int)}${dp > 0 ? `.${frac}` : ''}`;
}

/**
 * Charts need pixel geometry, and geometry is inherently floating point.
 * This is the ONLY place a published figure becomes a `number`, and its result
 * is never displayed as a value — labels are formatted from the exact string.
 */
export function forGeometry(value: Dec): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
