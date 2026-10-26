/**
 * Parse a number typed in a form field. Unlike `parseFloat(v) || fallback`, a typed 0 stays 0;
 * only an empty or invalid field gets the fallback.
 */
export function numOr(value: string | number | null | undefined, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined || value.trim() === '') return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}
