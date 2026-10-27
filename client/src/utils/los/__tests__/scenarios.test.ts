/**
 * Broad scenario tests for the LOS model, the area pipeline and the DSM georeferencing.
 * Synthetic terrain is encoded into real tile structures, so the whole lookup path is exercised.
 * Reference values come from PROJ (pyproj) where noted.
 */
import { describe, it, expect } from 'vitest';
import {
  TILE_SIZE, TerrainSampler, packElevation, globalPixelToLngLat, tileKeysForBounds, tileKeysAlongPath,
  chooseAreaZoom, groundResolution, sampleDemLayer, demLayerPixel, MAX_DEM_ZOOM, type GeoBounds, type DemLayer,
} from '../core/terrain';
import {
  evaluateLOS, classify, uncertaintyBand, hasLineOfSight, STANDARD_K, OPTICAL_K, WORST_K,
  MARGINAL_CLEARANCE_M, ENDPOINT_CORRELATION_M, type LosStatus,
} from '../core/losCore';
import { geodesicDistance, greatCircleKnots, radiusOfCurvature, haversineMeters } from '../core/geodesy';
import { fromWgs84, toWgs84 } from '../core/projections';
import { calcPoints } from '../workers/areaLosWorker';
import { gridLayout, generatePointChunks, estimateTotalPoints, computeBounds, terrainBounds, computeZoom, type GridConfig } from '../gridGenerator';
import { rasterGeometry, legacyLayout } from '../losAreaRaster';
import { metersPerDegreeLat, metersPerDegreeLon } from '../geo';
import { numOr } from '../parse';
import { assessConfidence } from '../los';
import { detectCrs, makeLayer, parseASCIIText, wgs84BoundsOf } from '../customDSM';
import { workerCount } from '../MassiveCalculationEngine';

// ------------------------------------------------------------------ helpers

type Elev = (east: number, north: number) => number;

/** A local frame around (lat0, lon0): metres east/north <-> lat/lon (WGS84 metres per degree). */
function frame(lat0: number, lon0: number) {
  const mLat = metersPerDegreeLat(lat0), mLon = metersPerDegreeLon(lat0);
  return {
    at: (east: number, north = 0, height = 2) => ({ lat: lat0 + north / mLat, lon: lon0 + east / mLon, height }),
    local: (lon: number, lat: number) => ({ x: (lon - lon0) * mLon, y: (lat - lat0) * mLat }),
  };
}

/** Packed tiles for `keys`, each pixel centre holding elev(local x, y). Constant terrain shares one array. */
function tilesFor(keys: string[], z: number, f: ReturnType<typeof frame>, elev: Elev | number): Map<string, Uint16Array> {
  const tiles = new Map<string, Uint16Array>();
  const constant = typeof elev === 'number' ? new Uint16Array(TILE_SIZE * TILE_SIZE).fill(packElevation(elev)) : null;
  for (const key of keys) {
    if (constant) { tiles.set(key, constant); continue; }
    const [, tx, ty] = key.split('/').map(Number);
    const data = new Uint16Array(TILE_SIZE * TILE_SIZE);
    for (let py = 0; py < TILE_SIZE; py++) for (let px = 0; px < TILE_SIZE; px++) {
      const ll = globalPixelToLngLat(tx * TILE_SIZE + px + 0.5, ty * TILE_SIZE + py + 0.5, z);
      const q = f.local(ll.lng, ll.lat);
      data[py * TILE_SIZE + px] = packElevation((elev as Elev)(q.x, q.y));
    }
    tiles.set(key, data);
  }
  return tiles;
}

/** Sampler with tiles along the great circle a-b (what the line tool loads). */
function lineSampler(f: ReturnType<typeof frame>, a: { lat: number; lon: number }, b: { lat: number; lon: number }, elev: Elev | number, z = MAX_DEM_ZOOM, layers: DemLayer[] = []) {
  const d = geodesicDistance(a.lat, a.lon, b.lat, b.lon);
  const k = greatCircleKnots(a.lat, a.lon, b.lat, b.lon, Math.max(1, Math.ceil(d / 1000)));
  return new TerrainSampler(z, tilesFor(tileKeysAlongPath(k.lat, k.lon, z, 2), z, f, elev), layers);
}

function areaSampler(f: ReturnType<typeof frame>, bounds: GeoBounds, elev: Elev | number, z = MAX_DEM_ZOOM, layers: DemLayer[] = []) {
  return new TerrainSampler(z, tilesFor(tileKeysForBounds(bounds, z), z, f, elev), layers);
}

/** Expected minimum clearance over flat ground (same parabolic model, brute force). */
function flatMinClearance(h1: number, h2: number, D: number, Re: number): number {
  let min = Infinity;
  for (let i = 1; i < 2000; i++) {
    const d1 = (D * i) / 2000, d2 = D - d1;
    min = Math.min(min, h1 + (h2 - h1) * (d1 / D) - (d1 * d2) / (2 * Re));
  }
  return min;
}

const IL = frame(31.5, 35.0);

// ------------------------------------------------------------------ geometry and physics

describe('geodesy against PROJ', () => {
  // pyproj Geod(ellps="WGS84").inv
  const REF: Array<[number, number, number, number, number]> = [
    [31.77, 35.21, 31.78, 35.21, 1108.829],
    [31.0, 34.8, 31.45, 35.1, 57500.742],
    [29.55, 34.95, 33.28, 35.58, 417883.389],
    [32.08, 34.78, 32.08, 35.31, 50037.782],
    [31.5, 34.5, 31.5, 36.5, 190002.01],
    [60.0, 10.0, 60.5, 11.0, 78548.887],
  ];
  it.each(REF)('distance (%f,%f)-(%f,%f)', (a, b, c, d, ref) => {
    expect(Math.abs(geodesicDistance(a, b, c, d) - ref)).toBeLessThan(0.01);
    // The spherical formula the model used before is visibly off at these lengths.
    if (ref > 40000) expect(Math.abs(haversineMeters(a, b, c, d) - ref)).toBeGreaterThan(20);
  });

  it('great-circle knots stay on the great circle (no rhumb-line drift)', () => {
    const k = greatCircleKnots(29.55, 34.95, 33.28, 35.58, 400);
    // Every knot's distances to the ends add up to the whole (within 0.2 m on 418 km).
    const total = geodesicDistance(29.55, 34.95, 33.28, 35.58);
    for (let i = 1; i < 400; i += 37) {
      const s = geodesicDistance(29.55, 34.95, k.lat[i], k.lon[i]) + geodesicDistance(k.lat[i], k.lon[i], 33.28, 35.58);
      expect(s - total).toBeLessThan(0.5);
    }
  });

  it('radius of curvature lies between the meridian and prime-vertical radii', () => {
    const north = radiusOfCurvature(31.5, 0), east = radiusOfCurvature(31.5, 90), diag = radiusOfCurvature(31.5, 45);
    expect(north).toBeGreaterThan(6_340_000);
    expect(east).toBeGreaterThan(north);
    expect(diag).toBeGreaterThan(north);
    expect(diag).toBeLessThan(east);
  });
});

describe('flat terrain: the model reproduces the analytic ray clearance', () => {
  const cases: Array<[number, number, number, number | undefined]> = [
    // [h1, h2, distance m, frequency]
    [10, 2, 1000, undefined],
    [10, 2, 5000, undefined],
    [10, 2, 15000, undefined],
    [30, 10, 30000, 2400],
    [50, 50, 50000, 433],
    [100, 2, 60000, undefined],
    [0, 0, 2000, undefined],
  ];
  it.each(cases)('h1=%d h2=%d D=%d f=%s', (h1, h2, D, freq) => {
    const a = IL.at(0, 0, h1), b = IL.at(D * 0.6, D * 0.8, h2);
    const s = lineSampler(IL, a, b, 120);
    // collectProfile: no early exit, so minClearance is the true minimum even when blocked.
    const r = evaluateLOS(s, a, b, { frequencyMHz: freq, collectProfile: true });
    const k = freq ? STANDARD_K : OPTICAL_K;
    const Re = k * radiusOfCurvature((a.lat + b.lat) / 2, r.bearing);
    const expected = flatMinClearance(h1, h2, r.distance, Re);
    expect(Math.abs(r.minClearance! - expected)).toBeLessThan(0.3);
    expect(Math.abs(r.distance - D)).toBeLessThan(D * 0.002 + 1);
    expect(r.missingSamples).toBe(0);
  });

  it('horizon distance matches sqrt(2kRh1) + sqrt(2kRh2) for radio, light and worst-case k', () => {
    for (const [k, h1, h2] of [[STANDARD_K, 10, 2], [OPTICAL_K, 30, 10], [WORST_K, 50, 5]] as const) {
      const Re = k * 6_371_000;
      const dh = Math.sqrt(2 * Re * h1) + Math.sqrt(2 * Re * h2);
      const status = (D: number): LosStatus => {
        const a = IL.at(0, 0, h1), b = IL.at(D, 0, h2);
        return evaluateLOS(lineSampler(IL, a, b, 0), a, b, { refractionK: k }).status;
      };
      // Low masts graze the ground near the target for kilometres, so between ~0.6 and 1.1 of the
      // horizon the answer is "uncertain" by design; well inside it is clear.
      expect(status(dh * 0.4), `k=${k} well inside`).toBe('clear');
      expect(hasLineOfSight(status(dh * 0.75)) || status(dh * 0.75) === 'marginal', `k=${k} at 0.75`).toBe(true);
      expect(status(dh * 1.25), `k=${k} well beyond`).toBe('blocked');
      // Along a sweep the class never goes back from blocked to visible.
      let seenBlocked = false;
      for (let f = 0.5; f <= 1.5; f += 0.05) {
        const st = status(dh * f);
        if (st === 'blocked') seenBlocked = true;
        else expect(seenBlocked, `k=${k} at ${f.toFixed(2)} dh`).toBe(false);
      }
    }
  });

  it('worst-case k reports less clearance than standard k, by the curvature difference', () => {
    const a = IL.at(0, 0, 40), b = IL.at(40_000, 0, 40);
    const r = evaluateLOS(lineSampler(IL, a, b, 0), a, b, { frequencyMHz: 900, worstK: WORST_K });
    const R = radiusOfCurvature(31.5, r.bearing);
    const d = r.distance / 2;
    const diff = (d * d) / (2 * R) * (1 / WORST_K - 1 / STANDARD_K);
    expect(r.minClearanceWorstK!).toBeLessThan(r.minClearance!);
    expect(Math.abs(r.minClearance! - r.minClearanceWorstK! - diff)).toBeLessThan(0.5);
  });

  it('is symmetric: A->B and B->A give the same class and clearance', () => {
    const hills: Elev = (x, y) => 300 + 60 * Math.sin(x / 900) * Math.cos(y / 1300) + 0.01 * x;
    const B: GeoBounds = { west: 34.9, east: 35.1, south: 31.42, north: 31.58 };
    const s = areaSampler(IL, B, hills);
    for (let i = 0; i < 40; i++) {
      const a = IL.at(-8000 + 400 * i, -6000 + 150 * i, 2 + (i % 5) * 5);
      const b = IL.at(7000 - 300 * i, 5000 - 260 * i, 2 + (i % 3) * 10);
      const ab = evaluateLOS(s, a, b, { collectProfile: true });
      const ba = evaluateLOS(s, b, a, { collectProfile: true });
      expect(ab.status).toBe(ba.status);
      expect(Math.abs(ab.minClearance! - ba.minClearance!)).toBeLessThan(0.5);
    }
  });
});

describe('obstacles and the uncertainty band', () => {
  // 10 km path, 10 m and 2 m masts over 100 m ground: the ray is ~105.3 m at mid-path (k=1.15).
  const a = IL.at(0, 0, 10), b = IL.at(10_000, 0, 2);
  const rayMid = () => {
    const r = evaluateLOS(lineSampler(IL, a, b, 100), a, b, { collectProfile: true });
    return r.profile!.reduce((best, p) => (Math.abs(p.distance - 5000) < Math.abs(best.distance - 5000) ? p : best)).losHeight;
  };

  it('a wide ridge sweeps through blocked -> marginal -> clear at the band edges', () => {
    const top = rayMid();
    const at = (excess: number) => {
      const ridge: Elev = x => 100 + (top - 100 + excess) * Math.exp(-(((x - 5000) / 400) ** 2));
      return evaluateLOS(lineSampler(IL, a, b, ridge), a, b);
    };
    expect(at(10).status).toBe('blocked');
    expect(at(4).status).toBe('blocked');
    expect(at(2).status).toBe('marginal');
    expect(at(0).status).toBe('marginal');
    expect(at(-2).status).toBe('marginal');
    expect(at(-4).status).toBe('clear');
    expect(at(-10).status).toBe('clear');
  });

  it('a narrow ridge that really blocks is not reported as confidently clear', () => {
    // 30 m tall, 60 m wide ridge 2 km out (the review's E4b case: it truly blocks by ~12 m).
    const f = frame(31.5, 35.0);
    const p = f.at(0, 0, 10), q = f.at(4000, 0, 25);
    const ridge: Elev = x => 100 + 30 * Math.max(0, 1 - Math.abs(x - 2000) / 30);
    // Tiles hold area averages, like real resampled DEM tiles.
    const avgRidge: Elev = (x, y) => {
      const px = groundResolution(31.5, 12);
      let s = 0;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) s += ridge(x + ((i + 0.5) / 8 - 0.5) * px, y);
      return s / 64;
    };
    const r = evaluateLOS(lineSampler(f, p, q, avgRidge), p, q);
    expect(r.status).not.toBe('clear');
  });

  it('the band is zero at the endpoints, full at mid-path, and scales with short paths', () => {
    expect(uncertaintyBand(0, 5000)).toBe(0);
    expect(uncertaintyBand(2500, 2500)).toBe(MARGINAL_CLEARANCE_M);
    // Short path: the correlation length limits it (250 m from an end of a 1 km path: 3 * 0.25).
    expect(uncertaintyBand(ENDPOINT_CORRELATION_M / 4, 750)).toBeCloseTo(MARGINAL_CLEARANCE_M / 4, 6);
    // Long path: it grows linearly to mid-path (5 km from an end of a 50 km path: 3 * 0.2).
    expect(uncertaintyBand(5000, 45000)).toBeCloseTo(MARGINAL_CLEARANCE_M * 0.2, 6);
    expect(uncertaintyBand(100, 100)).toBeCloseTo(0.3, 6); // 200 m path: 3 * 100/1000
  });

  it('an obstacle inside the endpoint\'s own pixel is ignored, one 60 m away is not', () => {
    const p = IL.at(0, 0, 2), q = IL.at(500, 0, 2);
    const wallAt = (x0: number): Elev => x => (Math.abs(x - x0) < 20 ? 140 : 100);
    expect(evaluateLOS(lineSampler(IL, p, q, wallAt(5)), p, q).status).not.toBe('blocked');
    expect(evaluateLOS(lineSampler(IL, p, q, wallAt(80)), p, q).status).toBe('blocked');
  });

  it('classify and hasLineOfSight agree on every class', () => {
    expect(hasLineOfSight(classify(9, 3, null, false))).toBe(true);
    expect(hasLineOfSight(classify(9, 3, -1, true))).toBe(true);
    expect(hasLineOfSight(classify(2, -1, null, false))).toBe(false);
    expect(hasLineOfSight(classify(-1, -7, null, false))).toBe(false);
  });
});

describe('Fresnel zone', () => {
  it('the profile carries F1 = sqrt(lambda d1 d2 / D), and lower frequencies need more room', () => {
    const a = IL.at(0, 0, 12), b = IL.at(20_000, 0, 12);
    const s = lineSampler(IL, a, b, 100);
    const r433 = evaluateLOS(s, a, b, { frequencyMHz: 433, collectProfile: true });
    const r5800 = evaluateLOS(s, a, b, { frequencyMHz: 5800, collectProfile: true });
    const mid = r433.profile!.find(p => Math.abs(p.distance - r433.distance / 2) < 20)!;
    const lambda = 299792458 / 433e6;
    expect(mid.fresnelRadius!).toBeCloseTo(Math.sqrt(lambda * mid.distance * (r433.distance - mid.distance) / r433.distance), 3);
    expect(r433.status).toBe('fresnel');
    expect(r5800.minFresnelRatio!).toBeGreaterThan(r433.minFresnelRatio!);
    // 12 m masts over 20 km: ~4.3 m left at mid-path, 0.6 F1 at 5.8 GHz is ~8.6 m.
    expect(r5800.status).toBe('fresnel');
    const high = evaluateLOS(s, IL.at(0, 0, 40), IL.at(20_000, 0, 40), { frequencyMHz: 5800 });
    expect(high.status).toBe('clear');
  });

  it('coincident endpoints give finite numbers', () => {
    const p = IL.at(0, 0, 10);
    const r = evaluateLOS(lineSampler(IL, p, p, 100), p, { ...p, height: 2 }, { frequencyMHz: 2400, collectProfile: true });
    expect(r.distance).toBe(0);
    for (const s of r.profile!) expect(Number.isFinite(s.losHeight)).toBe(true);
    expect(r.profile!.every(s => s.fresnelRadius === undefined || Number.isFinite(s.fresnelRadius))).toBe(true);
  });
});

describe('data coverage and extremes', () => {
  it('a hole in the tiles: small -> still computed, large -> nodata', () => {
    // 70 km east-west: the path crosses ~9 tiles, so one missing tile is ~1/9 of the samples.
    const a = IL.at(0, 0, 400), b = IL.at(70_000, 0, 400);
    const full = lineSampler(IL, a, b, 100);
    const d = geodesicDistance(a.lat, a.lon, b.lat, b.lon);
    const k = greatCircleKnots(a.lat, a.lon, b.lat, b.lon, 70);
    const keys = tileKeysAlongPath(k.lat, k.lon, 12, 2);
    const drop = (n: number) => {
      const tiles = tilesFor(keys, 12, IL, 100);
      // remove n tiles from the middle of the corridor (not the endpoints' tiles)
      const mid = keys.filter(key => {
        const [, tx, ty] = key.split('/').map(Number);
        const c = globalPixelToLngLat((tx + 0.5) * 256, (ty + 0.5) * 256, 12);
        const e = IL.local(c.lng, c.lat).x;
        return e > d * 0.2 && e < d * 0.8;
      });
      mid.slice(0, n).forEach(key => tiles.delete(key));
      return evaluateLOS(new TerrainSampler(12, tiles), a, b);
    };
    expect(evaluateLOS(full, a, b).missingSamples).toBe(0);
    const small = drop(1);
    expect(small.status).not.toBe('nodata');
    expect(small.missingSamples).toBeGreaterThan(0);
    expect(drop(1000).status).toBe('nodata');
  });

  it('works below sea level (Dead Sea) and on high ground', () => {
    for (const ground of [-430, 0, 1200, 2800]) {
      const a = IL.at(0, 0, 10), b = IL.at(8000, 0, 2);
      const r = evaluateLOS(lineSampler(IL, a, b, ground), a, b);
      expect(r.startGround!).toBeCloseTo(ground, 0);
      expect(r.status).toBe('clear');
    }
  });

  it('a 300 km path stays bounded and sensible; a 60 km+ path is still sampled at zoom 12', () => {
    const a = IL.at(0, 0, 500), b = IL.at(0, 300_000, 500);
    const r = evaluateLOS(lineSampler(IL, a, b, 0), a, b);
    expect(r.status).toBe('blocked'); // horizon of two 500 m masts is ~185 km (k=1.15)
    const r60 = evaluateLOS(lineSampler(IL, IL.at(0, 0, 300), IL.at(70_000, 0, 300), 0), IL.at(0, 0, 300), IL.at(70_000, 0, 300), { collectProfile: true });
    expect(r60.pixelM).toBeLessThan(35);
    expect(r60.samples).toBeGreaterThan(4000);
  });

  it('works away from Israel (60N, Norway)', () => {
    const NO = frame(60.0, 10.0);
    const a = NO.at(0, 0, 10), b = NO.at(10_000, 5_000, 2);
    const r = evaluateLOS(lineSampler(NO, a, b, 50), a, b);
    expect(r.status).toBe('clear');
    expect(r.pixelM).toBeLessThan(20); // pixels shrink with cos(lat)
  });
});

// ------------------------------------------------------------------ area pipeline

describe('area worker equals the line tool', () => {
  it('for every grid point, optical and RF, with and without an uploaded DSM', () => {
    const B: GeoBounds = { west: 34.93, east: 35.07, south: 31.44, north: 31.56 };
    const hills: Elev = (x, y) => 300 + 40 * Math.sin(x / 700) * Math.cos(y / 500) + 0.02 * x;
    const tl = IL.at(-1500, 1500), br = IL.at(1500, -1500);
    const w = 150, h = 150, data = new Float32Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const x = -1500 + (c + 0.5) * 20, y = 1500 - (r + 0.5) * 20;
      data[r * w + c] = hills(x, y) + (Math.abs(x - 600) < 15 ? 25 : 0);
    }
    const layer: DemLayer = { bounds: { west: tl.lon, north: tl.lat, east: br.lon, south: br.lat }, width: w, height: h, data, noDataValue: -9999 };
    for (const layers of [[], [layer]]) {
      const s = areaSampler(IL, B, hills, 12, layers);
      const origin = IL.at(0, 0, 10);
      const points: Array<{ lat: number; lon: number }> = [];
      for (let e = -4000; e <= 4000; e += 400) for (let n = -4000; n <= 4000; n += 400) points.push(IL.at(e, n));
      for (const freqMHz of [undefined, 900, 5800]) {
        const area = calcPoints({ origin, points, targetHeight: 2, freqMHz }, s);
        area.forEach((cell, i) => {
          const line = evaluateLOS(s, origin, { ...points[i], height: 2 }, { frequencyMHz: freqMHz });
          expect(cell.status).toBe(line.status);
        });
      }
    }
  });
});

describe('grid and raster', () => {
  const sector = (maxDistance: number, resolution: number, extra: Partial<GridConfig> = {}): GridConfig => ({
    mode: 'sector', origin: { lat: 31.5, lon: 35.0, height: 10 }, targetHeight: 2,
    minDistance: 0, maxDistance, minAzimuth: 0, maxAzimuth: 360, resolution, ...extra,
  });

  const check = (cfg: GridConfig) => {
    const layout = gridLayout(cfg);
    const g = rasterGeometry(layout);
    const hits = new Uint32Array(g.W * g.H);
    let n = 0;
    for (const chunk of generatePointChunks(cfg, 50000)) for (const p of chunk) {
      n++;
      const iLon = Math.round((p.lon - layout.lonMin) / layout.lonStep);
      const iLat = Math.round((p.lat - layout.latMin) / layout.latStep);
      expect(Math.abs(p.lon - (layout.lonMin + iLon * layout.lonStep))).toBeLessThan(1e-9);
      const px = Math.floor((iLon * g.W) / layout.nLon), py = Math.floor(((layout.nLat - 1 - iLat) * g.H) / layout.nLat);
      hits[py * g.W + px]++;
    }
    return { layout, g, hits, n };
  };

  it.each([[1000, 10], [5000, 30], [20000, 30], [50000, 100]])('sector R=%d m res=%d m: one point per pixel, no gaps inside', (R, res) => {
    const cfg = sector(R, res);
    const { layout, g, hits, n } = check(cfg);
    expect(g.aggregated).toBe(false);
    let gaps = 0;
    for (let iLat = 0; iLat < layout.nLat; iLat++) for (let iLon = 0; iLon < layout.nLon; iLon++) {
      const lat = layout.latMin + iLat * layout.latStep, lon = layout.lonMin + iLon * layout.lonStep;
      const dist = haversineMeters(31.5, 35, lat, lon);
      const v = hits[(layout.nLat - 1 - iLat) * g.W + iLon];
      if (dist <= R - 1 && v !== 1) gaps++;
      if (dist > R + 1) expect(v).toBe(0);
    }
    expect(gaps).toBe(0);
    // Point count matches the estimate used for the warning dialog.
    expect(Math.abs(n - estimateTotalPoints(cfg)) / n).toBeLessThan(0.02);
    // Grid spacing really is `res` metres.
    expect(geodesicDistance(layout.latMin, 35, layout.latMin + layout.latStep, 35)).toBeCloseTo(res, 0);
    expect(geodesicDistance(31.5, layout.lonMin, 31.5, layout.lonMin + layout.lonStep)).toBeCloseTo(res, 0);
  }, 60_000);

  it('a sector across north (350..10 deg) and a minimum distance are honoured', () => {
    const cfg = sector(3000, 50, { minAzimuth: 350, maxAzimuth: 10, minDistance: 1000 });
    for (const chunk of generatePointChunks(cfg, 100000)) for (const p of chunk) {
      const d = haversineMeters(31.5, 35, p.lat, p.lon);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(3000);
      expect(Math.abs(p.lon - 35) * metersPerDegreeLon(31.5)).toBeLessThan(d * Math.sin((10.5 * Math.PI) / 180) + 1);
      expect(p.lat).toBeGreaterThan(31.5);
    }
  });

  it('polygon grids fall inside the polygon, and the terrain covers an observer outside it', () => {
    const poly = [IL.at(20000, 20000), IL.at(26000, 20000), IL.at(26000, 25000), IL.at(20000, 25000)];
    const cfg: GridConfig = { ...sector(0, 100), mode: 'polygon', polygonPoints: poly };
    let n = 0;
    for (const chunk of generatePointChunks(cfg, 100000)) n += chunk.length;
    expect(Math.abs(n - estimateTotalPoints(cfg)) / n).toBeLessThan(0.05);
    const tb = terrainBounds(cfg);
    expect(tb.south).toBeLessThanOrEqual(31.5);
    expect(tb.west).toBeLessThanOrEqual(35.0);
    expect(computeZoom(cfg)).toBe(12);
  });

  it('keeps zoom 12 for big areas as long as memory allows', () => {
    expect(computeZoom(sector(5000, 30))).toBe(12);
    expect(computeZoom(sector(70000, 100))).toBe(12);
    expect(computeZoom(sector(150000, 200))).toBeLessThan(12);
    expect(chooseAreaZoom({ west: 34, east: 36, south: 29.5, north: 33.3 })).toBeLessThan(12);
  });

  it('image rows are resampled to Mercator: each row shows the latitude drawn there', () => {
    const layout = gridLayout(sector(100_000, 200));
    const g = rasterGeometry(layout);
    const b = computeBounds(sector(100_000, 200));
    const yN = Math.log(Math.tan(Math.PI / 4 + (b.north * Math.PI) / 360));
    const yS = Math.log(Math.tan(Math.PI / 4 + (b.south * Math.PI) / 360));
    const rowLat = (r: number) => (2 * Math.atan(Math.exp(yN + ((r + 0.5) / g.H) * (yS - yN))) - Math.PI / 2) * 180 / Math.PI;
    const srcLat = (row: number) => b.north - ((row + 0.5) / g.H) * (b.north - b.south);
    let maxErrM = 0, maxNaiveM = 0;
    for (let r = 0; r < g.H; r++) {
      maxErrM = Math.max(maxErrM, Math.abs(rowLat(r) - srcLat(g.rowMap[r])) * metersPerDegreeLat(31.5));
      maxNaiveM = Math.max(maxNaiveM, Math.abs(rowLat(r) - srcLat(r)) * metersPerDegreeLat(31.5));
    }
    expect(maxErrM).toBeLessThanOrEqual(200 / 2 + 1); // within half a row
    expect(maxNaiveM).toBeGreaterThan(400);           // what it was without the resampling
  });

  it('downsampled pixels show the majority; ties are shown as uncertain', async () => {
    // Painting needs no canvas (it is created on the first flush).
    const { StreamingRasterCanvas } = await import('../losAreaRaster');
    const layout = { latMin: 31.5, lonMin: 35, latStep: 0.0001, lonStep: 0.0001, nLat: 4, nLon: 4 };
    const c = new StreamingRasterCanvas(layout, 2);
    const cell = (iLat: number, iLon: number, status: LosStatus) => ({ lat: 31.5 + iLat * 0.0001, lon: 35 + iLon * 0.0001, status, clear: hasLineOfSight(status), hasData: true });
    c.paintBatch([cell(0, 0, 'clear'), cell(0, 1, 'clear'), cell(1, 0, 'blocked')]);         // bottom-left: 2 vs 1
    c.paintBatch([cell(2, 2, 'clear'), cell(3, 3, 'blocked')]);                              // top-right: tie
    const st = c.getStateBuffer();
    expect(st[1 * 2 + 0]).toBe(5); // clear
    expect(st[0 * 2 + 1]).toBe(3); // marginal
    expect(c.getCellStats()).toMatchObject({ total: 5, clear: 3, blocked: 2 });
  });

  it('full resolution: every cell sets its own pixel, nothing else', async () => {
    const { StreamingRasterCanvas } = await import('../losAreaRaster');
    const cfg = sector(2000, 25);
    const layout = gridLayout(cfg);
    const c = new StreamingRasterCanvas(layout);
    let n = 0;
    for (const chunk of generatePointChunks(cfg, 10000)) {
      n += chunk.length;
      c.paintBatch(chunk.map((p, i) => ({ ...p, status: (i % 3 === 0 ? 'blocked' : 'clear') as LosStatus, clear: i % 3 !== 0, hasData: true })));
    }
    const px = c.getPixelStats();
    expect(px.clear + px.blocked).toBe(n);
    expect(px.empty).toBe(layout.nLat * layout.nLon - n);
  });

  it('legacy saved cells are re-gridded with the constants they were made with', () => {
    const cells = [] as Array<{ lat: number; lon: number; clear: boolean | null }>;
    const latStep = 100 / 111000, lonStep = 100 / (111000 * Math.cos((31.5 * Math.PI) / 180));
    for (let i = 0; i < 30; i++) for (let j = 0; j < 40; j++) cells.push({ lat: 31.4 + i * latStep, lon: 34.9 + j * lonStep, clear: true });
    const l = legacyLayout(cells, 100, 31.5)!;
    expect(l.nLat).toBe(30);
    expect(l.nLon).toBe(40);
  });

  it('worker count respects the memory budget', () => {
    expect(workerCount(10, 1e6, false)).toBe(1);
    expect(workerCount(1e7, 300e6, false)).toBe(1);
    expect(workerCount(1e7, 60e6, false)).toBeLessThanOrEqual(8);
    expect(workerCount(1e7, 1e6, true)).toBeLessThanOrEqual(4);
  });
});

// ------------------------------------------------------------------ DSM georeferencing

describe('uploaded DSM georeferencing', () => {
  it('the projected-raster control grid matches the exact projection to < 0.02 px', () => {
    // 50 x 40 km ITM raster at 10 m: pixel positions through the control grid vs the exact inverse.
    const edges = { west: 180000, south: 600000, east: 230000, north: 640000 };
    const layer: DemLayer = { bounds: wgs84BoundsOf('EPSG:2039', edges), width: 5000, height: 4000, data: new Float32Array(1), noDataValue: -9999, crs: 'EPSG:2039', projBounds: edges };
    let maxErr = 0;
    for (let i = 0; i < 300; i++) {
      const x = edges.west + 500 + ((i * 7919) % 49000), y = edges.south + 500 + ((i * 104729) % 39000);
      const g = toWgs84('EPSG:2039', x, y);
      const px = demLayerPixel(layer, g.lon, g.lat)!;
      maxErr = Math.max(maxErr, Math.abs(px.fx - ((x - edges.west) / 10)), Math.abs(px.fy - ((edges.north - y) / 10)));
    }
    expect(maxErr).toBeLessThan(0.02);
  });

  it('detects the coordinate system of ASC files from their ranges', () => {
    expect(detectCrs({ west: 34.9, south: 31.5, east: 35.0, north: 31.6 })?.crs).toBe('EPSG:4326');
    expect(detectCrs({ west: 219000, south: 630000, east: 221000, north: 632000 })?.crs).toBe('EPSG:2039');
    expect(detectCrs({ west: 190000, south: 380000, east: 200000, north: 390000 })?.crs).toBe('EPSG:2039'); // Eilat
    expect(detectCrs({ west: 169000, south: 1130000, east: 171000, north: 1132000 })?.crs).toBe('EPSG:28193');
    expect(detectCrs({ west: 169000, south: 130000, east: 171000, north: 132000 })).toEqual({ crs: 'EPSG:28193', northOffset: 1_000_000 });
    expect(detectCrs({ west: 709000, south: 3516000, east: 711000, north: 3518000 })?.crs).toBe('EPSG:32636');
    expect(detectCrs({ west: 9e6, south: 9e6, east: 9.1e6, north: 9.1e6 })).toBeNull();
  });

  const ascGrid = (xll: string, yll: string, cell: number, n: number, value: (r: number, c: number) => number) => {
    const rows = [`ncols ${n}`, `nrows ${n}`, `${xll}`, `${yll}`, `cellsize ${cell}`, 'NODATA_value -9999'];
    for (let r = 0; r < n; r++) rows.push(Array.from({ length: n }, (_, c) => value(r, c)).join(' '));
    return rows.join('\n');
  };

  it('places an ITM building where it is in WGS84 (datum regression: ~78 m)', () => {
    // A 10 m ITM grid around Jerusalem with a 30 m tall, 20 m wide wall at ITM easting 220,000.
    const wallE = 220000, x0 = 219000, y0 = 630000, n = 200, cell = 10;
    const asc = ascGrid(`xllcorner ${x0}`, `yllcorner ${y0}`, cell, n, (_r, c) => (Math.abs(x0 + (c + 0.5) * cell - wallE) < 10 ? 830 : 800));
    const res = parseASCIIText('wall.asc', asc);
    expect(res.success).toBe(true);
    const layer = res.layer!;
    expect(layer.crs).toBe('EPSG:2039');
    expect(layer.resolution).toBeCloseTo(10, 5);
    // The wall's true WGS84 position (via the datum-correct inverse).
    const wallMid = toWgs84('EPSG:2039', wallE, 631000);
    expect(sampleDemLayer(layer, wallMid.lon, wallMid.lat)!).toBeGreaterThan(820);
    // 78 m away along the datum shift direction there is no wall.
    const shifted = toWgs84('EPSG:2039', wallE + 66, 631041);
    expect(sampleDemLayer(layer, shifted.lon, shifted.lat)!).toBeLessThan(805);
    // In the LOS model: a path across the wall is blocked, a parallel path 300 m north of the grid is not.
    const J = frame(wallMid.lat, wallMid.lon);
    const p = J.at(-500, 0, 2), q = J.at(500, 0, 2);
    const s = lineSampler(J, p, q, 800, 12, [layer]);
    expect(evaluateLOS(s, p, q).status).toBe('blocked');
    const r = evaluateLOS(s, p, q, { collectProfile: true });
    expect(r.mixedSources).toBe(false); // all inside the DSM
  });

  it.each([[10, 5], [4, 1], [2, 1], [30, 10]])('a %d m wide wall in a %d m DSM blocks the path (not stepped over)', (wallW, cell) => {
    // E2E regression: a 10 m wall in a 5 m DSM fell between 16 m tile-pixel samples and the path read "clear".
    const x0 = 219500, y0 = 630500, n = Math.round(1000 / cell), wallE = 220000.3;
    const asc = ascGrid(`xllcorner ${x0}`, `yllcorner ${y0}`, cell, n, (_r, c) => (Math.abs(x0 + (c + 0.5) * cell - wallE) < wallW / 2 ? 840 : 800));
    const layer = parseASCIIText('w.asc', asc).layer!;
    const W = toWgs84('EPSG:2039', x0 + 100, 631000), E = toWgs84('EPSG:2039', x0 + 900, 631000);
    const J = frame(W.lat, W.lon);
    const p = { ...W, height: 2 }, q = { ...E, height: 2 };
    const s = lineSampler(J, p, q, 800, 12, [layer]);
    for (const collectProfile of [false, true]) {
      const r = evaluateLOS(s, p, q, { collectProfile });
      expect(r.status).toBe('blocked');
      // Without a profile the model stops at the first definitely-blocked sample; with one it finds the crest.
      if (collectProfile) expect(r.minClearance!).toBeLessThan(-30);
    }
    // ...and the halves on either side of the wall see each other's endpoints.
    const westOfWall = toWgs84('EPSG:2039', wallE - wallW / 2 - 3 * cell, 631000);
    expect(evaluateLOS(s, p, { ...westOfWall, height: 2 }).status).not.toBe('blocked');
  });

  it('reads ICS (both northing conventions) and xllcenter correctly', () => {
    const itm = fromWgs84('EPSG:2039', 31.77, 35.21);
    const ics = fromWgs84('EPSG:28193', 31.77, 35.21);
    const make = (northing: number, northLabel: string) => parseASCIIText('ics.asc',
      ascGrid(`xllcorner ${ics.x - 500}`, `${northLabel} ${northing - 500}`, 10, 100, () => 750));
    for (const res of [make(ics.y, 'yllcorner'), make(ics.y - 1_000_000, 'yllcorner')]) {
      expect(res.success).toBe(true);
      expect(res.layer!.crs).toBe('EPSG:28193');
      expect(sampleDemLayer(res.layer!, 35.21, 31.77)).toBeCloseTo(750, 3);
    }
    // xllcenter: the same grid described by its lower-left cell centre.
    const corner = parseASCIIText('a.asc', ascGrid(`xllcorner ${itm.x}`, `yllcorner ${itm.y}`, 10, 10, (r, c) => r * 10 + c));
    const center = parseASCIIText('b.asc', ascGrid(`xllcenter ${itm.x + 5}`, `yllcenter ${itm.y + 5}`, 10, 10, (r, c) => r * 10 + c));
    expect(center.layer!.projBounds).toEqual(corner.layer!.projBounds);
  });

  it('refuses rasters it cannot place', () => {
    expect(parseASCIIText('x.asc', ascGrid('xllcorner 9000000', 'yllcorner 9000000', 10, 5, () => 1)).success).toBe(false);
    expect(parseASCIIText('x.asc', 'ncols 5\nnrows 5\n1 2 3').success).toBe(false);
  });

  it('a mixed path (DSM + tiles) is flagged', () => {
    const tl = IL.at(-200, 200), br = IL.at(200, -200);
    const layer = makeLayer({ name: 'x', width: 40, height: 40, data: new Float32Array(1600).fill(100), noDataValue: -9999, crs: 'EPSG:4326', edges: { west: tl.lon, north: tl.lat, east: br.lon, south: br.lat } });
    const p = IL.at(0, 0, 10), q = IL.at(3000, 0, 2);
    const r = evaluateLOS(lineSampler(IL, p, q, 100, 12, [layer]), p, q, { collectProfile: true });
    expect(r.mixedSources).toBe(true);
  });
});

// ------------------------------------------------------------------ small utilities

describe('utilities', () => {
  it('numOr keeps typed zeros and rejects junk', () => {
    expect(numOr('0', 10)).toBe(0);
    expect(numOr('', 10)).toBe(10);
    expect(numOr('  ', 2)).toBe(2);
    expect(numOr('abc', 2)).toBe(2);
    expect(numOr('-3.5', 2)).toBe(-3.5);
    expect(numOr(0, 5)).toBe(0);
    expect(numOr(NaN, 5)).toBe(5);
    expect(numOr(undefined, 5)).toBe(5);
  });

  it('metres per degree match ellipsoidal distances', () => {
    for (const lat of [0, 29.5, 31.5, 33.3, 60]) {
      expect(metersPerDegreeLat(lat)).toBeCloseTo(geodesicDistance(lat - 0.5, 35, lat + 0.5, 35), -1);
      expect(metersPerDegreeLon(lat)).toBeCloseTo(geodesicDistance(lat, 34.5, lat, 35.5), -1);
    }
  });

  it('confidence follows decisiveness, data and refraction', () => {
    const base = { minClearance: 30, uncertaintyAtMin: 3, minClearanceWorstK: 20, nullRatio: 0, suspiciousJumps: 0, totalSamples: 1000, mixedSources: false };
    expect(assessConfidence({ ...base, status: 'clear' })).toBe('high');
    expect(assessConfidence({ ...base, status: 'clear', minClearance: 5 })).toBe('medium');
    expect(assessConfidence({ ...base, status: 'clear', minClearanceWorstK: -2 })).toBe('medium');
    expect(assessConfidence({ ...base, status: 'clear', mixedSources: true })).toBe('medium');
    expect(assessConfidence({ ...base, status: 'marginal', minClearance: 1 })).toBe('low');
    expect(assessConfidence({ ...base, status: 'blocked', minClearance: -40, minClearanceWorstK: -60 })).toBe('high');
    expect(assessConfidence({ ...base, status: 'clear', nullRatio: 0.2 })).toBe('low');
    expect(assessConfidence({ ...base, status: 'nodata', minClearance: null })).toBe('low');
  });
});
