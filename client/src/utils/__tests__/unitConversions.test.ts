import { describe, expect, it } from 'vitest';
import { fromKm, fromMhz, fromWatts, toKm, toMhz, toWatts } from '../unitConversions';

describe('unit conversions round-trip', () => {
  it.each(['km', 'mi', 'm', 'ft', 'nmi'] as const)('distance %s', unit => {
    expect(fromKm(toKm(12.5, unit), unit)).toBeCloseTo(12.5, 10);
  });

  it.each(['W', 'mW', 'dBm', 'dBW'] as const)('power %s', unit => {
    expect(fromWatts(toWatts(7, unit), unit)).toBeCloseTo(7, 10);
  });

  it.each(['Hz', 'kHz', 'MHz', 'GHz'] as const)('frequency %s', unit => {
    expect(fromMhz(toMhz(3, unit), unit)).toBeCloseTo(3, 10);
  });

  it('uses exact reference values', () => {
    expect(toKm(1, 'nmi')).toBe(1.852);
    expect(toWatts(30, 'dBm')).toBeCloseTo(1, 12);
    expect(toWatts(0, 'dBW')).toBe(1);
  });
});
