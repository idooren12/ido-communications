import { describe, it, expect } from 'vitest';
import { fromWgs84, toWgs84, guessProjectedCrs, crsFromEpsg, wgs84ToItm, itmToWgs84, type CrsCode } from '../core/projections';

// Reference values from PROJ 9 (pyproj Transformer.from_crs(4326, code, always_xy=True)).
const REF: Array<[CrsCode, number, number, number, number]> = [
  ['EPSG:2039', 31.77, 35.21, 219982.95, 630814.613],
  ['EPSG:2039', 29.55, 34.95, 194796.112, 384721.165],
  ['EPSG:2039', 33.28, 35.58, 254442.734, 798332.617],
  ['EPSG:2039', 32.08, 34.78, 179383.784, 665268.335],
  ['EPSG:2039', 30.6, 34.8, 180669.674, 501161.662],
  ['EPSG:28193', 31.77, 35.21, 169982.05, 1130812.642],
  ['EPSG:28193', 29.55, 34.95, 144794.802, 884718.305],
  ['EPSG:28193', 33.28, 35.58, 204442.483, 1298331.134],
  ['EPSG:28193', 32.08, 34.78, 129383.112, 1165266.636],
  ['EPSG:32636', 31.77, 35.21, 709289.018, 3517068.21],
  ['EPSG:32636', 29.55, 34.95, 688934.575, 3270509.425],
  ['EPSG:32636', 33.28, 35.58, 740281.254, 3685298.248],
];

describe('projections against PROJ', () => {
  it.each(REF)('%s forward (%f, %f)', (crs, lat, lon, x, y) => {
    const p = fromWgs84(crs, lat, lon);
    expect(Math.abs(p.x - x)).toBeLessThan(0.05);
    expect(Math.abs(p.y - y)).toBeLessThan(0.05);
  });

  it.each(REF)('%s inverse (%f, %f)', (crs, lat, lon, x, y) => {
    const g = toWgs84(crs, x, y);
    // 1e-6 degree ~ 0.1 m
    expect(Math.abs(g.lat - lat)).toBeLessThan(1e-6);
    expect(Math.abs(g.lon - lon)).toBeLessThan(1e-6);
  });

  it('keeps the legacy ITM API datum-correct', () => {
    const p = wgs84ToItm(31.77, 35.21);
    expect(p.east).toBeCloseTo(219982.95, 1);
    expect(p.north).toBeCloseTo(630814.613, 1);
    const g = itmToWgs84(p.east, p.north);
    expect(g.lat).toBeCloseTo(31.77, 7);
    expect(g.lon).toBeCloseTo(35.21, 7);
  });
});

describe('CRS guessing', () => {
  it('tells ITM, ICS and UTM apart, including the far south', () => {
    expect(guessProjectedCrs(190000, 380000, 200000, 390000)?.crs).toBe('EPSG:2039'); // Eilat, ITM
    expect(guessProjectedCrs(140000, 880000, 150000, 890000)?.crs).toBe('EPSG:28193'); // Eilat, ICS
    expect(guessProjectedCrs(165000, 125000, 175000, 135000)).toEqual({ crs: 'EPSG:28193', northOffset: 1_000_000 });
    expect(guessProjectedCrs(700000, 3510000, 710000, 3520000)?.crs).toBe('EPSG:32636');
    expect(guessProjectedCrs(5_000_000, 1, 5_000_100, 2)).toBeNull();
  });

  it('maps EPSG codes', () => {
    expect(crsFromEpsg(2039)).toBe('EPSG:2039');
    expect(crsFromEpsg(32637)).toBe('EPSG:32637');
    expect(crsFromEpsg(3857)).toBeNull();
  });
});
