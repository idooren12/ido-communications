import { describe, it, expect } from 'vitest';
import {
  TILE_SIZE,
  TerrainSampler,
  decodeTerrarium,
  demZoomForExtent,
  encodeTerrarium,
  globalPixelToLngLat,
  groundResolution,
  lngLatToGlobalPixel,
  tileKeysForBounds,
  type DemLayer,
  type GeoBounds,
} from '../core/terrain';
import { evaluateLOS, classify, MARGINAL_CLEARANCE_M } from '../core/losCore';
import { calcPoints } from '../workers/areaLosWorker';

// Synthetic terrain around Jerusalem, at the DEM zoom both tools use for < 60 km.
const Z = 12;
const LAT0 = 31.77;
const LON0 = 35.2;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

/** Local metric coordinates (east, north) of a lon/lat relative to (LON0, LAT0). */
const toLocal = (lng: number, lat: number) => ({ x: (lng - LON0) * M_PER_DEG_LON, y: (lat - LAT0) * M_PER_DEG_LAT });
/** lon/lat of a point `east`, `north` metres from (LON0, LAT0). */
const at = (east: number, north = 0, height = 2) => ({ lat: LAT0 + north / M_PER_DEG_LAT, lon: LON0 + east / M_PER_DEG_LON, height });

const AREA: GeoBounds = { west: LON0 - 0.15, east: LON0 + 0.15, south: LAT0 - 0.1, north: LAT0 + 0.1 };

/** Build Terrarium tiles whose pixel centres hold elevation(x, y) (local metres). */
function makeSampler(elevation: (x: number, y: number) => number, layers: DemLayer[] = [], bounds = AREA): TerrainSampler {
  const tiles = new Map<string, Uint8ClampedArray>();
  for (const key of tileKeysForBounds(bounds, Z)) {
    const [, tx, ty] = key.split('/').map(Number);
    const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    for (let py = 0; py < TILE_SIZE; py++) {
      for (let px = 0; px < TILE_SIZE; px++) {
        const ll = globalPixelToLngLat(tx * TILE_SIZE + px + 0.5, ty * TILE_SIZE + py + 0.5, Z);
        const { x, y } = toLocal(ll.lng, ll.lat);
        const [r, g, b] = encodeTerrarium(elevation(x, y));
        const i = (py * TILE_SIZE + px) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    tiles.set(key, data);
  }
  return new TerrainSampler(Z, tiles, layers);
}

const flat = makeSampler(() => 100);

describe('terrain encoding and sampling', () => {
  it('round-trips Terrarium encoding', () => {
    for (const e of [-50, 0, 0.5, 123.25, 812.75, 2500]) {
      expect(decodeTerrarium(...encodeTerrarium(e))).toBeCloseTo(e, 2);
    }
  });

  it('interpolates bilinearly between pixel centres', () => {
    const plane = makeSampler((x) => 100 + 0.1 * x); // exact for bilinear
    for (const east of [0, 7, 15.3, 333, 1250]) {
      const p = at(east);
      expect(plane.at(p.lon, p.lat)).toBeCloseTo(100 + 0.1 * east, 1);
    }
  });

  it('returns null where there are no tiles', () => {
    const p = at(0, 0);
    const empty = new TerrainSampler(Z, new Map());
    expect(empty.at(p.lon, p.lat)).toBeNull();
  });

  it('uses the same DEM zoom rule for line and area extents', () => {
    expect(demZoomForExtent(500)).toBe(12);
    expect(demZoomForExtent(60_000)).toBe(12);
    expect(demZoomForExtent(100_000)).toBe(11);
    expect(demZoomForExtent(300_000)).toBe(10);
  });
});

describe('evaluateLOS', () => {
  it('flat terrain over a short path is clear', () => {
    const r = evaluateLOS(flat, at(0, 0, 10), at(5000, 0, 2));
    expect(r.status).toBe('clear');
    expect(r.minClearance!).toBeGreaterThan(1);
    expect(Math.abs(r.distance - 5000)).toBeLessThan(20);
  });

  it('samples every half DEM pixel, regardless of distance', () => {
    const pixel = groundResolution(LAT0, Z);
    for (const d of [300, 3000, 12000]) {
      const r = evaluateLOS(flat, at(0), at(d), { collectProfile: true });
      expect(r.samples).toBeGreaterThanOrEqual(Math.floor(d / (pixel / 2)) - 1);
      expect(r.samples).toBeLessThanOrEqual(Math.ceil(d / (pixel / 2)));
    }
  });

  it('a tall ridge blocks the path, and the obstruction is on the ridge', () => {
    const ridge = makeSampler((x) => 100 + 60 * Math.exp(-(((x - 2500) / 150) ** 2)));
    // The line tool collects the full profile, so the worst point is reported.
    const r = evaluateLOS(ridge, at(0, 0, 10), at(5000, 0, 2), { collectProfile: true });
    expect(r.status).toBe('blocked');
    expect(r.obstruction).toBeDefined();
    expect(Math.abs(r.obstruction!.distance - 2500)).toBeLessThan(100);
  });

  it('a ridge that blocks by less than the data accuracy is "marginal"', () => {
    // Ray from 110 m to 102 m: about 106 m (minus ~0.4 m curvature) at the middle.
    const ridge = makeSampler((x) => 100 + 7 * Math.exp(-(((x - 2500) / 150) ** 2)));
    const r = evaluateLOS(ridge, at(0, 0, 10), at(5000, 0, 2));
    expect(r.minClearance!).toBeLessThan(0);
    expect(r.minClearance!).toBeGreaterThan(-MARGINAL_CLEARANCE_M);
    expect(r.status).toBe('marginal');
  });

  it('RF mode reports an obstructed Fresnel zone separately', () => {
    // 10 km, 5 m masts, 2.4 GHz: 60 % of F1 at mid-path ~ 10.6 m > 5 m of clearance.
    const optical = evaluateLOS(flat, at(0, 0, 5), at(10_000, 0, 5));
    const rf = evaluateLOS(flat, at(0, 0, 5), at(10_000, 0, 5), { frequencyMHz: 2400 });
    expect(optical.status).toBe('clear');
    expect(rf.status).toBe('fresnel');
    expect(rf.minFresnelClearance!).toBeLessThan(0);
  });

  it('targets close to the observer on a steady slope are visible (no staircase artefact)', () => {
    // A uniform 15 % slope: the ray between 2 m masts is parallel to the ground, 2 m above it.
    // With nearest-pixel lookup each 32 m pixel is a ~5 m step, which used to make these red.
    for (const slope of [0.15, -0.15]) {
      const hill = makeSampler((x, y) => 400 + slope * (x + 0.3 * y));
      for (const [east, north] of [[60, 0], [120, 40], [250, -90], [500, 200], [900, 0]]) {
        const r = evaluateLOS(hill, at(0, 0, 2), at(east, north, 2));
        expect(r.status, `slope ${slope}, target ${east},${north}`).toBe('clear');
      }
    }
  });

  it('a target inside the observer\'s own DEM pixel is not blocked by that pixel', () => {
    const rough = makeSampler((x) => 100 + (x > 5 ? 20 : 0));
    const r = evaluateLOS(rough, at(0, 0, 2), at(10, 0, 2));
    expect(r.status).not.toBe('blocked');
  });

  it('missing terrain gives "nodata"', () => {
    const empty = new TerrainSampler(Z, new Map());
    expect(evaluateLOS(empty, at(0), at(1000)).status).toBe('nodata');
  });

  it('custom DSM layers override terrain tiles', () => {
    // A 40 m "building" 20 m wide across the path, from a user-uploaded DSM.
    const w = 200, h = 200;
    const tl = at(-500, 500), br = at(500, -500);
    const bounds: GeoBounds = { west: tl.lon, north: tl.lat, east: br.lon, south: br.lat };
    const data = new Float32Array(w * h);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const x = -500 + (col + 0.5) * (1000 / w);
        data[row * w + col] = Math.abs(x - 100) < 10 ? 140 : 100;
      }
    }
    const layer: DemLayer = { bounds, width: w, height: h, data, noDataValue: -9999 };
    const withDsm = makeSampler(() => 100, [layer]);
    expect(evaluateLOS(flat, at(0, 0, 10), at(400, 0, 2)).status).toBe('clear');
    expect(evaluateLOS(withDsm, at(0, 0, 10), at(400, 0, 2)).status).toBe('blocked');
  });
});

describe('classify', () => {
  it('maps clearances to classes', () => {
    expect(classify(5, null, false)).toBe('clear');
    expect(classify(-1, null, false)).toBe('marginal');
    expect(classify(-10, null, false)).toBe('blocked');
    expect(classify(5, -2, true)).toBe('fresnel');
    expect(classify(5, -2, false)).toBe('clear');
  });
});

describe('area worker', () => {
  it('gives exactly the line tool\'s answer for every grid point', () => {
    const terrain = makeSampler((x, y) => 300 + 40 * Math.sin(x / 700) * Math.cos(y / 500) + 0.02 * x);
    const origin = at(0, 0, 10);
    const points: Array<{ lat: number; lon: number }> = [];
    for (let e = -3000; e <= 3000; e += 250) for (let n = -3000; n <= 3000; n += 250) points.push(at(e, n));

    for (const freqMHz of [undefined, 900]) {
      const area = calcPoints({ origin, points, targetHeight: 2, freqMHz }, terrain);
      const statuses = new Set<string>();
      area.forEach((cell, i) => {
        const line = evaluateLOS(terrain, origin, { ...points[i], height: 2 }, { frequencyMHz: freqMHz });
        expect(cell.status).toBe(line.status);
        statuses.add(cell.status);
      });
      // The terrain is varied enough to exercise more than one class.
      expect(statuses.size).toBeGreaterThan(1);
    }
  });

  it('pixel coordinates are consistent', () => {
    const p = lngLatToGlobalPixel(LON0, LAT0, Z);
    const back = globalPixelToLngLat(p.x, p.y, Z);
    expect(back.lng).toBeCloseTo(LON0, 9);
    expect(back.lat).toBeCloseTo(LAT0, 9);
  });
});
