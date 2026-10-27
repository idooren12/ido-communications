/**
 * Terrain sampling shared by every LOS calculation: the line tool (main thread), the area
 * tool (Web Workers) and the point-elevation readouts all read terrain through this code,
 * so they cannot disagree because of how elevations are looked up.
 *
 * Source: AWS Terrain Tiles (Mapzen "Terrarium" encoding), 256x256 Web Mercator tiles:
 *   elevation = R * 256 + G + B / 256 - 32768   (metres)
 * In Israel the land data is SRTM (~30 m grid, 90 m nominal quality, surface model from 2000).
 * Zoom 12 (~33 m/px at 31.5N) is about the native resolution; higher zooms are only upsampled.
 *
 * Storage: each tile is decoded once to a Uint16Array (quarter-metre steps, 0 = no data),
 * half the memory of RGBA, and looked up by integer tile index instead of a string key.
 *
 * Pure module (no DOM access), safe to import from workers.
 */

import { fromWgs84, type CrsCode } from './projections';

export const TILE_SIZE = 256;
const TILE_PIXELS = TILE_SIZE * TILE_SIZE;
const MAX_LAT = 85.05112878;

/** Finest DEM zoom: about the native resolution of the data in Israel. The line tool always uses it. */
export const MAX_DEM_ZOOM = 12;
/** Coarsest zoom the area tool will fall back to. */
export const MIN_DEM_ZOOM = 9;
/**
 * Area tool memory budget per worker, in DEM pixels (2 bytes each). 24 M px = 48 MB, which keeps
 * zoom 12 for a full circle of radius up to ~80 km.
 */
export const AREA_PIXEL_BUDGET = 24_000_000;

/** Elevation range the decoder accepts; anything outside is treated as no data. */
const MIN_VALID_ELEVATION = -500;
const MAX_VALID_ELEVATION = 9000;

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const tileKey = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

/** Global pixel coordinates (pixel centres at +0.5) of a lon/lat at zoom z. */
export function lngLatToGlobalPixel(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = TILE_SIZE * 2 ** z;
  const latRad = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

export function globalPixelToLngLat(x: number, y: number, z: number): { lng: number; lat: number } {
  const n = TILE_SIZE * 2 ** z;
  return {
    lng: (x / n) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
  };
}

/** Ground size of one tile pixel in metres at a latitude. */
export function groundResolution(lat: number, z: number): number {
  return (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** z);
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Inverse of decodeTerrarium (used by tests and synthetic tiles). */
export function encodeTerrarium(elevation: number): [number, number, number] {
  const v = elevation + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - r * 256 - g) * 256);
  return [r, g, Math.min(255, b)];
}

/** Packed elevation: 0 = no data, otherwise (e + 500) * 4 + 1, i.e. quarter-metre steps from -500 m. */
export const packElevation = (e: number) => Math.max(1, Math.min(65535, Math.round((e - MIN_VALID_ELEVATION) * 4) + 1));
export const unpackElevation = (v: number) => (v - 1) / 4 + MIN_VALID_ELEVATION;

/** Decode one RGBA Terrarium tile to packed Uint16 elevations. */
export function packTerrariumTile(rgba: ArrayLike<number>): Uint16Array {
  const out = new Uint16Array(TILE_PIXELS);
  for (let i = 0, j = 0; i < TILE_PIXELS; i++, j += 4) {
    if (rgba[j + 3] === 0) continue;
    const e = rgba[j] * 256 + rgba[j + 1] + rgba[j + 2] / 256 - 32768;
    if (e < MIN_VALID_ELEVATION || e > MAX_VALID_ELEVATION) continue;
    out[i] = packElevation(e);
  }
  return out;
}

/** Tile keys covering a lon/lat box at zoom z, with a 1-pixel margin for bilinear interpolation. */
export function tileKeysForBounds(bounds: GeoBounds, z: number): string[] {
  const n = 2 ** z;
  const tl = lngLatToGlobalPixel(bounds.west, bounds.north, z);
  const br = lngLatToGlobalPixel(bounds.east, bounds.south, z);
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
  const x0 = clamp(Math.floor((tl.x - 1) / TILE_SIZE));
  const x1 = clamp(Math.floor((br.x + 1) / TILE_SIZE));
  const y0 = clamp(Math.floor((tl.y - 1) / TILE_SIZE));
  const y1 = clamp(Math.floor((br.y + 1) / TILE_SIZE));
  const keys: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(tileKey(z, x, y));
  return keys;
}

/**
 * Tile keys touched by a path (a polyline of lat/lon points, e.g. great-circle knots), with a
 * `marginPx` pixel margin on each side. A long diagonal line needs a corridor of tiles, not
 * the whole bounding box (a 60 km diagonal: ~15 tiles instead of ~50).
 */
export function tileKeysAlongPath(lats: ArrayLike<number>, lons: ArrayLike<number>, z: number, marginPx = 2): string[] {
  const n = 2 ** z;
  const keys = new Set<string>();
  const add = (gx: number, gy: number) => {
    const x0 = Math.max(0, Math.floor((gx - marginPx) / TILE_SIZE)), x1 = Math.min(n - 1, Math.floor((gx + marginPx) / TILE_SIZE));
    const y0 = Math.max(0, Math.floor((gy - marginPx) / TILE_SIZE)), y1 = Math.min(n - 1, Math.floor((gy + marginPx) / TILE_SIZE));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.add(tileKey(z, x, y));
  };
  let prev = lngLatToGlobalPixel(lons[0], lats[0], z);
  add(prev.x, prev.y);
  for (let i = 1; i < lats.length; i++) {
    const p = lngLatToGlobalPixel(lons[i], lats[i], z);
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / (marginPx + 1)));
    for (let s = 1; s <= steps; s++) add(prev.x + ((p.x - prev.x) * s) / steps, prev.y + ((p.y - prev.y) * s) / steps);
    prev = p;
  }
  return [...keys];
}

/**
 * DEM zoom for an area calculation: the finest zoom (up to MAX_DEM_ZOOM) whose tiles over
 * `bounds` fit the per-worker pixel budget. A 60 km radius keeps zoom 12 (before: dropped to
 * 11 at 60 km), so the area tool agrees with the line tool for most real coverage maps.
 */
export function chooseAreaZoom(bounds: GeoBounds, pixelBudget = AREA_PIXEL_BUDGET): number {
  for (let z = MAX_DEM_ZOOM; z > MIN_DEM_ZOOM; z--) {
    if (tileKeysForBounds(bounds, z).length * TILE_PIXELS <= pixelBudget) return z;
  }
  return MIN_DEM_ZOOM;
}

/** Bounding box of a set of points. */
export function boundsOf(points: Array<{ lat: number; lon: number }>): GeoBounds {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const p of points) {
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  return { west, south, east, north };
}

// ------------------------------------------------------------------ uploaded DEM layers

/**
 * A user-uploaded elevation model (see customDSM.ts). Takes priority over terrain tiles.
 * Plain data (structured-clonable) so it can be posted to workers.
 */
export interface DemLayer {
  /** WGS84 box that contains the whole raster (used for quick rejection). */
  bounds: GeoBounds;
  width: number;
  height: number;
  data: ArrayLike<number>;
  noDataValue: number;
  /** Raster CRS; absent = EPSG:4326 with `bounds` as the raster's edges. */
  crs?: CrsCode;
  /** Raster edges in `crs` units (metres for projected CRSs). */
  projBounds?: GeoBounds;
  /** Added to projected northings before comparing with projBounds (ICS files with the leading 1,000,000 dropped). */
  northOffset?: number;
  /** Legacy fields of layers made before `crs` existed: ITM raster with these ITM edges. */
  isITM?: boolean;
  originalBounds?: GeoBounds;
}

const CONTROL_N = 16;

/** Prepared lookup: WGS84 lon/lat -> fractional raster pixel, through a control grid for projected rasters. */
interface PreparedLayer {
  layer: DemLayer;
  /** Smallest pixel side in metres (the sampling step inside this layer is half of it). */
  pixelM: number;
  /** Control grid of fractional pixel coords over `bounds`, (CONTROL_N+1)^2 entries each, or null for EPSG:4326. */
  cx: Float64Array | null;
  cy: Float64Array | null;
}

function layerCrs(layer: DemLayer): { crs: CrsCode; edges: GeoBounds; northOffset: number } {
  if (layer.crs && layer.crs !== 'EPSG:4326' && layer.projBounds) return { crs: layer.crs, edges: layer.projBounds, northOffset: layer.northOffset ?? 0 };
  if (layer.isITM && layer.originalBounds) return { crs: 'EPSG:2039', edges: layer.originalBounds, northOffset: 0 };
  return { crs: 'EPSG:4326', edges: layer.bounds, northOffset: 0 };
}

function layerPixelMeters(layer: DemLayer, crs: CrsCode, edges: GeoBounds): number {
  const w = Math.abs(edges.east - edges.west) / layer.width;
  const h = Math.abs(edges.north - edges.south) / layer.height;
  if (crs !== 'EPSG:4326') return Math.min(w, h);
  const midLat = ((edges.north + edges.south) / 2) * Math.PI / 180;
  return Math.min(w * 111320 * Math.cos(midLat), h * 110950);
}

export function prepareDemLayer(layer: DemLayer): PreparedLayer {
  const { crs, edges, northOffset } = layerCrs(layer);
  const pixelM = layerPixelMeters(layer, crs, edges);
  if (crs === 'EPSG:4326') return { layer, pixelM, cx: null, cy: null };
  // Projections are smooth, so bilinear interpolation of exact pixel positions on a 16x16 grid
  // over the raster's footprint is accurate to millimetres for any raster up to a few tens of km,
  // and keeps the per-sample cost of the datum shift + projection out of the inner loop.
  const n = CONTROL_N + 1;
  const cx = new Float64Array(n * n), cy = new Float64Array(n * n);
  const b = layer.bounds;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const lon = b.west + ((b.east - b.west) * i) / CONTROL_N;
      const lat = b.north - ((b.north - b.south) * j) / CONTROL_N;
      const p = fromWgs84(crs, lat, lon);
      cx[j * n + i] = ((p.x - edges.west) / (edges.east - edges.west)) * layer.width;
      cy[j * n + i] = ((edges.north - (p.y - northOffset)) / (edges.north - edges.south)) * layer.height;
    }
  }
  return { layer, pixelM, cx, cy };
}

/** Fractional raster pixel (fx, fy) of a lon/lat, or null outside the raster. */
function layerPixel(pl: PreparedLayer, lng: number, lat: number, out: { fx: number; fy: number }): boolean {
  const { layer } = pl;
  const b = layer.bounds;
  if (lng < b.west || lng > b.east || lat < b.south || lat > b.north) return false;
  if (!pl.cx || !pl.cy) {
    out.fx = ((lng - b.west) / (b.east - b.west)) * layer.width;
    out.fy = ((b.north - lat) / (b.north - b.south)) * layer.height;
  } else {
    const n = CONTROL_N + 1;
    const u = ((lng - b.west) / (b.east - b.west)) * CONTROL_N;
    const v = ((b.north - lat) / (b.north - b.south)) * CONTROL_N;
    const i = Math.min(CONTROL_N - 1, Math.max(0, Math.floor(u))), j = Math.min(CONTROL_N - 1, Math.max(0, Math.floor(v)));
    const tu = u - i, tv = v - j;
    const k = j * n + i;
    const lerp = (a: Float64Array) => a[k] * (1 - tu) * (1 - tv) + a[k + 1] * tu * (1 - tv) + a[k + n] * (1 - tu) * tv + a[k + n + 1] * tu * tv;
    out.fx = lerp(pl.cx);
    out.fy = lerp(pl.cy);
  }
  return out.fx >= 0 && out.fy >= 0 && out.fx < layer.width && out.fy < layer.height;
}

const scratchPx = { fx: 0, fy: 0 };

/** Fractional raster pixel of a lon/lat in a layer (pixel edges at integers), or null outside. For tests and tools. */
export function demLayerPixel(layer: DemLayer, lng: number, lat: number): { fx: number; fy: number } | null {
  const out = { fx: 0, fy: 0 };
  return layerPixel(prepareDemLayer(layer), lng, lat, out) ? out : null;
}

function samplePrepared(pl: PreparedLayer, lng: number, lat: number): number | null {
  if (!layerPixel(pl, lng, lat, scratchPx)) return null;
  const { width, height, data, noDataValue } = pl.layer;
  const valid = (v: number) => v !== noDataValue && Number.isFinite(v) && v > -1000 && v < 10000;
  const read = (x: number, y: number) => data[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  const x = scratchPx.fx - 0.5, y = scratchPx.fy - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const a = read(x0, y0), b = read(x0 + 1, y0), c = read(x0, y0 + 1), d = read(x0 + 1, y0 + 1);
  if (valid(a) && valid(b) && valid(c) && valid(d)) {
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }
  const nearest = read(Math.floor(scratchPx.fx), Math.floor(scratchPx.fy));
  return valid(nearest) ? nearest : null;
}

const preparedCache = new WeakMap<DemLayer, PreparedLayer>();

/** Elevation in a DEM layer by bilinear interpolation between pixel centres, or null outside / no data. */
export function sampleDemLayer(layer: DemLayer, lng: number, lat: number): number | null {
  let pl = preparedCache.get(layer);
  if (!pl) {
    pl = prepareDemLayer(layer);
    preparedCache.set(layer, pl);
  }
  return samplePrepared(pl, lng, lat);
}

// ------------------------------------------------------------------ sampler

/** Result of one terrain lookup (reused object, see TerrainSampler.sample). */
export interface TerrainSample {
  /** Elevation in metres, or null for no data. */
  value: number | null;
  /** True when the value came from an uploaded DEM layer rather than the terrain tiles. */
  fromLayer: boolean;
}

/**
 * Terrain elevation lookup at one DEM zoom, with bilinear interpolation.
 *
 * Bilinear (instead of "nearest pixel") matters for LOS: nearest-pixel turns every
 * slope into a staircase whose steps (slope x pixel size) are often taller than a
 * 2 m target, which made points next to the observer look hidden when they were not.
 */
export class TerrainSampler {
  readonly zoom: number;
  private readonly tx0: number;
  private readonly ty0: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly slots: Array<Uint16Array | null>;
  private readonly layers: PreparedLayer[];
  /** Layer boxes in global pixel space, to skip the lon/lat conversion when not needed. */
  private readonly layerBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  readonly tileCount: number;

  /**
   * @param tiles key "z/x/y" -> either packed Uint16 elevations (65,536 values) or RGBA Terrarium bytes.
   */
  constructor(zoom: number, tiles: Map<string, ArrayLike<number>>, layers: DemLayer[] = []) {
    this.zoom = zoom;
    let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity;
    const parsed: Array<[number, number, ArrayLike<number>]> = [];
    for (const [key, data] of tiles) {
      const [z, x, y] = key.split('/').map(Number);
      if (z !== zoom) continue;
      parsed.push([x, y, data]);
      tx0 = Math.min(tx0, x); ty0 = Math.min(ty0, y); tx1 = Math.max(tx1, x); ty1 = Math.max(ty1, y);
    }
    if (parsed.length === 0) { tx0 = ty0 = 0; tx1 = ty1 = -1; }
    this.tx0 = tx0; this.ty0 = ty0;
    this.nx = tx1 - tx0 + 1; this.ny = ty1 - ty0 + 1;
    this.slots = new Array(Math.max(0, this.nx * this.ny)).fill(null);
    for (const [x, y, data] of parsed) {
      this.slots[(y - ty0) * this.nx + (x - tx0)] =
        data instanceof Uint16Array && data.length === TILE_PIXELS ? data : packTerrariumTile(data);
    }
    this.tileCount = parsed.length;

    this.layers = layers.map(prepareDemLayer);
    this.layerBoxes = layers.map(l => {
      const tl = lngLatToGlobalPixel(l.bounds.west, l.bounds.north, zoom);
      const br = lngLatToGlobalPixel(l.bounds.east, l.bounds.south, zoom);
      return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
    });
  }

  get hasLayers(): boolean {
    return this.layers.length > 0;
  }

  /**
   * Pixel size (metres) of the finest uploaded layer whose box contains this global pixel
   * position, or Infinity outside all layers. The LOS model samples more densely there, so a
   * narrow building in a fine DSM cannot fall between two samples.
   */
  layerPixelAt(gx: number, gy: number): number {
    let best = Infinity;
    for (let i = 0; i < this.layers.length; i++) {
      const box = this.layerBoxes[i];
      if (gx < box.x0 || gx > box.x1 || gy < box.y0 || gy > box.y1) continue;
      if (this.layers[i].pixelM < best) best = this.layers[i].pixelM;
    }
    return best;
  }

  /** Packed value of one tile pixel (integer global pixel coordinates); 0 = no data. */
  private packed(px: number, py: number): number {
    const tx = (px >> 8) - this.tx0, ty = (py >> 8) - this.ty0;
    if (tx < 0 || ty < 0 || tx >= this.nx || ty >= this.ny) return 0;
    const tile = this.slots[ty * this.nx + tx];
    return tile ? tile[((py & 255) << 8) | (px & 255)] : 0;
  }

  /** Terrain-tile elevation at fractional global pixel coordinates. */
  private tileAt(gx: number, gy: number): number | null {
    const x = gx - 0.5, y = gy - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const a = this.packed(x0, y0), b = this.packed(x0 + 1, y0);
    const c = this.packed(x0, y0 + 1), d = this.packed(x0 + 1, y0 + 1);
    if (a && b && c && d) {
      return unpackElevation(a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty);
    }
    const nearest = this.packed(Math.floor(gx), Math.floor(gy));
    return nearest ? unpackElevation(nearest) : null;
  }

  /** Elevation at global pixel coordinates (custom DSM layers first, then terrain tiles), written into `out`. */
  sample(gx: number, gy: number, out: TerrainSample): TerrainSample {
    for (let i = 0; i < this.layers.length; i++) {
      const box = this.layerBoxes[i];
      if (gx < box.x0 || gx > box.x1 || gy < box.y0 || gy > box.y1) continue;
      const { lng, lat } = globalPixelToLngLat(gx, gy, this.zoom);
      const v = samplePrepared(this.layers[i], lng, lat);
      if (v !== null) { out.value = v; out.fromLayer = true; return out; }
    }
    out.value = this.tileAt(gx, gy);
    out.fromLayer = false;
    return out;
  }

  /** Elevation at global pixel coordinates: custom DSM layers first, then terrain tiles. */
  atGlobal(gx: number, gy: number): number | null {
    return this.sample(gx, gy, { value: null, fromLayer: false }).value;
  }

  /** Elevation at a lon/lat. */
  at(lng: number, lat: number): number | null {
    const p = lngLatToGlobalPixel(lng, lat, this.zoom);
    return this.atGlobal(p.x, p.y);
  }
}
