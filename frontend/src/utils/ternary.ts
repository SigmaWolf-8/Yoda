/**
 * Format a raw 13-trit ternary address into dotted groups for readability.
 * '1111111111112' → '111.111.111.111.2'
 */
export function formatTernaryAddress(addr: string): string {
  if (!addr || addr === '—') return addr;
  const chunks: string[] = [];
  for (let i = 0; i < addr.length; i += 3) {
    chunks.push(addr.slice(i, i + 3));
  }
  return chunks.join('.');
}
