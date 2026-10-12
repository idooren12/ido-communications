/**
 * Terrain sampling shared by every LOS calculation: the line tool (main thread)
 * and the area / coverage tool (Web Workers) read terrain through the same code,
 * so they cannot disagree because of how elevations are looked up.
 *
 * Source: AWS Terrain Tiles, Terrarium encoding, 256x256 Web Mercator tiles.
 *   elevation = R * 256 + G + B / 256 - 32768   (metres)
 * In Israel the underlying data is ~30 m (SRTM-class), so zoom 12 (~32 m/px) is
 * close to the native resolution; higher zooms are only upsampled.
 *
 * Pure module (no DOM access), safe to import from workers.
 */

import { wgs84ToItm } from './itm';

export const TILE_SIZE = 256;
const MAX_LAT = 85.05112878;

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

/**
 * DEM zoom for a calculation whose extent is `extentMeters` (line length, or area
 * radius / diagonal). Line and area use this same rule, so a point gets the same
 * terrain in both tools. Zoom 12 up to 60 km; coarser only for very large areas,
 * to keep the tile count (memory) bounded.
 */
export function demZoomForExtent(extentMeters: number): number {
  if (extentMeters <= 60_000) return 12;
  if (extentMeters <= 150_000) return 11;
  return 10;
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

/** A user-uploaded elevation model (see customDSM.ts). Takes priority over terrain tiles. */
export interface DemLayer {
  bounds: GeoBounds;
  width: number;
  height: number;
  data: ArrayLike<number>;
  noDataValue: number;
  /** Raster is in ITM; `originalBounds` are its ITM bounds. */
  isITM?: boolean;
  originalBounds?: GeoBounds;
}

/** Elevation in a DEM layer by bilinear interpolation between pixel centres, or null outside / no data. */
export function sampleDemLayer(layer: DemLayer, lng: number, lat: number): number | null {
  const { width, height, data, noDataValue } = layer;
  let fx: number, fy: number;
  if (layer.isITM && layer.originalBounds) {
    const ob = layer.originalBounds;
    const itm = wgs84ToItm(lat, lng);
    fx = ((itm.east - ob.west) / (ob.east - ob.west)) * width;
    fy = ((ob.north - itm.north) / (ob.north - ob.south)) * height;
  } else {
    const b = layer.bounds;
    fx = ((lng - b.west) / (b.east - b.west)) * width;
    fy = ((b.north - lat) / (b.north - b.south)) * height;
  }
  if (fx < 0 || fy < 0 || fx >= width || fy >= height) return null;

  const valid = (v: number) => v !== noDataValue && Number.isFinite(v) && v > -1000 && v < 10000;
  const read = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    return data[cy * width + cx];
  };

  const x = fx - 0.5, y = fy - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const a = read(x0, y0), b = read(x0 + 1, y0), c = read(x0, y0 + 1), d = read(x0 + 1, y0 + 1);
  if (valid(a) && valid(b) && valid(c) && valid(d)) {
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }
  const nearest = read(Math.floor(fx), Math.floor(fy));
  return valid(nearest) ? nearest : null;
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
  private readonly tiles: Map<string, ArrayLike<number>>;
  private readonly layers: DemLayer[];
  /** Layer bounding boxes in global pixel space, to skip the lon/lat conversion when not needed. */
  private readonly layerBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }>;

  constructor(zoom: number, tiles: Map<string, ArrayLike<number>>, layers: DemLayer[] = []) {
    this.zoom = zoom;
    this.tiles = tiles;
    this.layers = layers;
    this.layerBoxes = layers.map(l => {
      const tl = lngLatToGlobalPixel(l.bounds.west, l.bounds.north, zoom);
      const br = lngLatToGlobalPixel(l.bounds.east, l.bounds.south, zoom);
      return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
    });
  }

  get hasLayers(): boolean {
    return this.layers.length > 0;
  }

  /** Elevation of one tile pixel (integer global pixel coordinates), or null. */
  private pixel(px: number, py: number): number | null {
    const tx = Math.floor(px / TILE_SIZE), ty = Math.floor(py / TILE_SIZE);
    const data = this.tiles.get(tileKey(this.zoom, tx, ty));
    if (!data) return null;
    const i = ((py - ty * TILE_SIZE) * TILE_SIZE + (px - tx * TILE_SIZE)) * 4;
    if (data[i + 3] === 0) return null;
    const e = data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
    return e < -500 || e > 9000 ? null : e;
  }

  /** Terrain-tile elevation at fractional global pixel coordinates. */
  private tileAt(gx: number, gy: number): number | null {
    const x = gx - 0.5, y = gy - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const a = this.pixel(x0, y0), b = this.pixel(x0 + 1, y0);
    const c = this.pixel(x0, y0 + 1), d = this.pixel(x0 + 1, y0 + 1);
    if (a !== null && b !== null && c !== null && d !== null) {
      return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    }
    return this.pixel(Math.floor(gx), Math.floor(gy));
  }

  /** Elevation at global pixel coordinates: custom DSM layers first, then terrain tiles. */
  atGlobal(gx: number, gy: number): number | null {
    for (let i = 0; i < this.layers.length; i++) {
      const box = this.layerBoxes[i];
      if (gx < box.x0 || gx > box.x1 || gy < box.y0 || gy > box.y1) continue;
      const { lng, lat } = globalPixelToLngLat(gx, gy, this.zoom);
      const v = sampleDemLayer(this.layers[i], lng, lat);
      if (v !== null) return v;
    }
    return this.tileAt(gx, gy);
  }

  /** Elevation at a lon/lat. */
  at(lng: number, lat: number): number | null {
    const p = lngLatToGlobalPixel(lng, lat, this.zoom);
    return this.atGlobal(p.x, p.y);
  }
}
