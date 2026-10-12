import { describe, expect, it } from 'vitest';
import {
  dustAttenuation,
  extraLossToRangeReductionPercent,
  fogAttenuation,
  fogSpecificCoefficient,
  humidityAbsorption,
  rainAttenuation,
  rainCoefficients,
  waterVapourDensity,
} from '../realisticCalculations';

describe('rain (ITU-R P.838-3)', () => {
  it('reproduces table values exactly', () => {
    expect(rainCoefficients(10)).toEqual({ k: 0.01217, alpha: 1.2571 });
  });

  it('gives ~0.7 dB/km at 10 GHz in 25 mm/h rain', () => {
    const { k, alpha } = rainCoefficients(10);
    expect(k * 25 ** alpha).toBeGreaterThan(0.65);
    expect(k * 25 ** alpha).toBeLessThan(0.75);
  });

  it('is negligible at UHF (the old model gave 0.1 dB/km here)', () => {
    expect(rainAttenuation(10, 900, 1)).toBeLessThan(0.001);
  });

  it('grows with frequency and rain rate', () => {
    expect(rainAttenuation(10, 20_000, 5)).toBeGreaterThan(rainAttenuation(10, 10_000, 5));
    expect(rainAttenuation(50, 10_000, 5)).toBeGreaterThan(rainAttenuation(10, 10_000, 5));
  });
});

describe('fog (ITU-R P.840)', () => {
  it('has a liquid-water coefficient of ~0.1 (dB/km)/(g/m³) at 10 GHz', () => {
    const kl = fogSpecificCoefficient(10, 10);
    expect(kl).toBeGreaterThan(0.05);
    expect(kl).toBeLessThan(0.15);
  });

  it('only applies in real fog and is tiny below a few GHz', () => {
    expect(fogAttenuation(2000, 10_000, 5)).toBe(0);
    expect(fogAttenuation(100, 900, 5)).toBeLessThan(0.01);
    expect(fogAttenuation(50, 30_000, 5)).toBeGreaterThan(fogAttenuation(50, 10_000, 5));
  });
});

describe('water vapour (ITU-R P.676 simplified)', () => {
  it('computes vapour density from humidity', () => {
    // 15 °C, ~59% RH ≈ 7.5 g/m³ (ITU standard atmosphere)
    expect(waterVapourDensity(58.5, 15)).toBeCloseTo(7.5, 0);
  });

  it('gives ~0.18 dB/km at the 22.2 GHz water line', () => {
    const perKm = humidityAbsorption(58.5, 22_200, 1, 15);
    expect(perKm).toBeGreaterThan(0.15);
    expect(perKm).toBeLessThan(0.22);
  });

  it('is negligible at VHF/UHF', () => {
    expect(humidityAbsorption(100, 450, 20, 30)).toBeLessThan(0.01);
  });
});

describe('dust', () => {
  it('does nothing in clear air or in dust-free regions', () => {
    expect(dustAttenuation(0.5, 9000, 10_000, 10)).toBe(0);
    expect(dustAttenuation(0.05, 100, 10_000, 10)).toBe(0);
  });

  it('stays in the measured ~0.1–1 dB/km range at 10 GHz in a severe storm', () => {
    const perKm = dustAttenuation(1, 20, 10_000, 1);
    expect(perKm).toBeGreaterThan(0.1);
    expect(perKm).toBeLessThan(1.5);
  });
});

describe('range reduction equivalent', () => {
  it('maps 6 dB of extra loss to ~50% less range', () => {
    expect(extraLossToRangeReductionPercent(6.0206)).toBeCloseTo(50, 2);
    expect(extraLossToRangeReductionPercent(0)).toBe(0);
  });
});
