import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n/config';
import { formatArea, formatDistance, haversineDistance, vincentyDistance } from '../los/geo';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('geo formatting', () => {
  it('formats distances with localized units', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(12_345)).toBe('12.35 km');
  });

  it('uses 1 dunam = 1,000 m² (was off by 10x)', () => {
    expect(formatArea(50_000)).toBe('50.0 dunam');
    expect(formatArea(2_500_000)).toBe('2.50 km²');
  });

  it('switches unit labels with the language', async () => {
    await i18n.changeLanguage('he');
    expect(formatArea(50_000)).toBe('50.0 דונם');
    await i18n.changeLanguage('en');
  });
});

describe('geodesy', () => {
  it('Tel Aviv – Jerusalem is ~54 km', () => {
    const d = haversineDistance(32.0853, 34.7818, 31.7683, 35.2137);
    expect(d / 1000).toBeGreaterThan(53);
    expect(d / 1000).toBeLessThan(55);
  });

  it('Vincenty agrees with haversine to within 0.5%', () => {
    const h = haversineDistance(29.5577, 34.9519, 33.2774, 35.5729);
    const v = vincentyDistance(29.5577, 34.9519, 33.2774, 35.5729)?.distance ?? NaN;
    expect(Math.abs(v - h) / v).toBeLessThan(0.005);
  });
});
