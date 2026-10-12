import { describe, expect, it } from 'vitest';
import { calculateSafeDistance, getICNIRPLimit, isWithinNearField, GROUND_REFLECTION_FACTOR } from '../rfSafetyCalculations';

describe('ICNIRP 2020 reference levels', () => {
  it.each([
    [144, 'public', 2],
    [144, 'occupational', 10],
    [900, 'public', 4.5],
    [900, 'occupational', 22.5],
    [2000, 'public', 10],
    [2400, 'public', 10],
    [5800, 'occupational', 50],
  ] as const)('%d MHz %s → %d W/m²', (f, pop, expected) => {
    const res = getICNIRPLimit(f, pop);
    expect(res?.limit).toBeCloseTo(expected, 10);
    expect(res?.approximate).toBe(false);
  });

  it('marks HF (below 30 MHz) as approximate', () => {
    expect(getICNIRPLimit(14, 'public')).toEqual({ limit: 2, approximate: true });
  });

  it('returns null outside 100 kHz – 300 GHz instead of a made-up value', () => {
    expect(getICNIRPLimit(0.05, 'public')).toBeNull();
    expect(getICNIRPLimit(400_000, 'public')).toBeNull();
  });
});

describe('safe distance', () => {
  it('free space: R = sqrt(EIRP / 4πS)', () => {
    const r = calculateSafeDistance(100, 0, 2, { groundReflection: false });
    expect(r.safeDistanceMeters).toBeCloseTo(Math.sqrt(100 / (8 * Math.PI)), 10);
    expect(r.reflectionFactor).toBe(1);
  });

  it('applies the 2.56 ground-reflection factor by default (distance × 1.6)', () => {
    const free = calculateSafeDistance(50, 6, 2, { groundReflection: false }).safeDistanceMeters;
    const withGround = calculateSafeDistance(50, 6, 2);
    expect(withGround.reflectionFactor).toBe(GROUND_REFLECTION_FACTOR);
    expect(withGround.safeDistanceMeters / free).toBeCloseTo(1.6, 10);
  });

  it('flags results inside one wavelength', () => {
    expect(isWithinNearField(1, 144)).toBe(true); // λ ≈ 2.08 m
    expect(isWithinNearField(3, 144)).toBe(false);
  });
});
