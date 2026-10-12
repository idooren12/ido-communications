import { describe, expect, it } from 'vitest';
import { calculateFSPL, calculateMaxDistance, calculateReceivedPower, dbmToWatt, wattToDbm } from '../friisCalculations';

describe('Friis', () => {
  it('converts between watts and dBm', () => {
    expect(wattToDbm(1)).toBeCloseTo(30, 10);
    expect(wattToDbm(0.001)).toBeCloseTo(0, 10);
    expect(dbmToWatt(30)).toBeCloseTo(1, 10);
    expect(wattToDbm(0)).toBe(-Infinity);
  });

  it('computes free-space path loss (km, MHz)', () => {
    expect(calculateFSPL(1, 1000)).toBeCloseTo(92.44, 2);
    // Doubling distance adds ~6.02 dB.
    expect(calculateFSPL(2, 1000) - calculateFSPL(1, 1000)).toBeCloseTo(6.0206, 3);
  });

  it('max distance and received power are inverses of each other', () => {
    const { distanceKm } = calculateMaxDistance(5, 3, 3, 446, -110);
    const { receivedPowerDbm } = calculateReceivedPower(5, 3, 3, 446, distanceKm);
    expect(receivedPowerDbm).toBeCloseTo(-110, 6);
  });

  it('matches a hand-computed link budget', () => {
    // 1 W (30 dBm) + 0 + 0 - FSPL(10 km, 100 MHz = 92.44 dB) = -62.44 dBm
    expect(calculateReceivedPower(1, 0, 0, 100, 10).receivedPowerDbm).toBeCloseTo(-62.44, 2);
  });
});
