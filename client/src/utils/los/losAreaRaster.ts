/**
 * LOS Area Raster Renderer
 * Paints grid cells onto a single image for MapLibre's ImageSource (instead of thousands of
 * GeoJSON polygons).
 *
 * Two geometric rules make the picture land where the cells are:
 * 1. Pixel = grid node. Columns/rows come from the grid's integer indices (GridLayout), so every
 *    node has its own pixel and there are no empty stripes. (Before, the grid and the raster used
 *    different metres-per-degree constants and ~0.3 % of rows/columns stayed transparent.)
 * 2. Mercator rows. MapLibre stretches an image linearly in Web Mercator between its corners,
 *    while the grid rows are equally spaced in latitude. The image's rows are therefore resampled
 *    to equal Mercator steps when it is built. (Before, a 50 km radius map was drawn up to 120 m
 *    too far north in the middle, 480 m at 100 km.)
 *
 * When the grid is larger than the maximum image size, several nodes share a pixel; the pixel
 * shows the majority (visible vs not visible), ties shown as "marginal". (Before: any visible
 * node made the whole pixel green.)
 */

import type { GridCell } from '../../contexts/LOSContext';
import type { LosStatus } from './core/losCore';
import { lngLatToGlobalPixel, globalPixelToLngLat } from './core/terrain';
import { metersPerDegreeLat, metersPerDegreeLon } from './geo';
import { layoutBounds, type GridLayout } from './gridGenerator';

export interface RasterResult {
  /** Data URL or Blob URL of the PNG image */
  url: string;
  /** Corner coordinates for MapLibre ImageSource: [topLeft, topRight, bottomRight, bottomLeft] */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  /** Image dimensions */
  width: number;
  height: number;
  /** Effective resolution in meters per pixel (X/Y may differ) */
  effectiveResolutionXM?: number;
  effectiveResolutionYM?: number;
}

export interface GridBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

// ==================== States ====================

const PIXEL_EMPTY = 0;    // No cell landed on this pixel
const PIXEL_NO_DATA = 1;
const PIXEL_BLOCKED = 2;
const PIXEL_MARGINAL = 3; // within the terrain data's uncertainty
const PIXEL_FRESNEL = 4;  // RF: line of sight, Fresnel zone obstructed
const PIXEL_CLEAR = 5;

/** Map colours, shared with the legend and the line tool's status badge. */
export const LOS_STATUS_COLORS: Record<Exclude<LosStatus, 'nodata'>, string> = {
  clear: '#10b981',
  fresnel: '#eab308',
  marginal: '#f97316',
  blocked: '#f43f5e',
};

export const losStatusColor = (status: LosStatus): string =>
  status === 'nodata' ? '#94a3b8' : LOS_STATUS_COLORS[status];

/** Colour LUT: state -> RGBA. */
const STATE_COLORS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],          // EMPTY: transparent
  [128, 128, 128, 100],  // NO_DATA: gray semi-transparent
  [244, 63, 94, 200],    // BLOCKED: red
  [249, 115, 22, 200],   // MARGINAL: orange
  [234, 179, 8, 200],    // FRESNEL: yellow
  [16, 185, 129, 200],   // CLEAR: green
] as const;

function cellState(cell: { status?: LosStatus; clear: boolean | null; hasData?: boolean }): number {
  switch (cell.status) {
    case 'clear': return PIXEL_CLEAR;
    case 'fresnel': return PIXEL_FRESNEL;
    case 'marginal': return PIXEL_MARGINAL;
    case 'blocked': return PIXEL_BLOCKED;
    case 'nodata': return PIXEL_NO_DATA;
  }
  // Results saved before statuses existed
  if (cell.hasData === false) return PIXEL_NO_DATA;
  return cell.clear === true ? PIXEL_CLEAR : cell.clear === false ? PIXEL_BLOCKED : PIXEL_NO_DATA;
}

/** Input cell type for streaming paint */
export interface RasterCell {
  lat: number;
  lon: number;
  status?: LosStatus;
  clear: boolean | null;
  fresnelClear?: boolean | null;
  hasData: boolean;
}

/** Cell-level statistics (exact, independent of raster resolution) */
export interface CellStats {
  total: number;
  clear: number;
  fresnel: number;
  marginal: number;
  blocked: number;
  noData: number;
}

// ==================== Geometry ====================

export interface RasterGeometry {
  layout: GridLayout;
  bounds: GridBounds;
  /** Image size. */
  W: number;
  H: number;
  /** True when several grid nodes share a pixel. */
  aggregated: boolean;
  effectiveResolutionXM: number;
  effectiveResolutionYM: number;
  /** For each image row (Mercator-uniform), the grid-row-space row it shows (latitude-uniform). */
  rowMap: Int32Array;
}

export function rasterGeometry(layout: GridLayout, maxDim = 4096): RasterGeometry {
  if (layout.nLat < 1 || layout.nLon < 1) throw new Error('Empty grid layout');
  const bounds = layoutBounds(layout);
  const W = Math.min(layout.nLon, maxDim);
  const H = Math.min(layout.nLat, maxDim);
  const midLat = (bounds.north + bounds.south) / 2;

  // Image row r covers Mercator y in [yN + r*dy, yN + (r+1)*dy]; show the lat-row at its centre.
  const yN = lngLatToGlobalPixel(0, bounds.north, 0).y;
  const yS = lngLatToGlobalPixel(0, bounds.south, 0).y;
  const rowMap = new Int32Array(H);
  for (let r = 0; r < H; r++) {
    const lat = globalPixelToLngLat(0, yN + ((r + 0.5) / H) * (yS - yN), 0).lat;
    const src = Math.floor(((bounds.north - lat) / (bounds.north - bounds.south)) * H);
    rowMap[r] = Math.max(0, Math.min(H - 1, src));
  }

  return {
    layout, bounds, W, H,
    aggregated: W < layout.nLon || H < layout.nLat,
    effectiveResolutionXM: (layout.lonStep * layout.nLon / W) * metersPerDegreeLon(midLat),
    effectiveResolutionYM: (layout.latStep * layout.nLat / H) * metersPerDegreeLat(midLat),
    rowMap,
  };
}

/** Pixel (column, row from north, in latitude-uniform row space) of a grid node, or -1 if outside. */
function pixelIndex(g: RasterGeometry, lat: number, lon: number): number {
  const l = g.layout;
  const iLon = Math.round((lon - l.lonMin) / l.lonStep);
  const iLat = Math.round((lat - l.latMin) / l.latStep);
  if (iLon < 0 || iLat < 0 || iLon >= l.nLon || iLat >= l.nLat) return -1;
  const px = Math.floor((iLon * g.W) / l.nLon);
  const py = Math.floor(((l.nLat - 1 - iLat) * g.H) / l.nLat);
  return py * g.W + px;
}

function cornersOf(b: GridBounds): RasterResult['coordinates'] {
  return [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]];
}

/** RGBA pixels of a state buffer, with rows resampled to Mercator. */
function buildRgba(state: Uint8Array, g: RasterGeometry, out: Uint8ClampedArray): void {
  const { W, H, rowMap } = g;
  for (let r = 0; r < H; r++) {
    const src = rowMap[r] * W;
    let j = r * W * 4;
    for (let x = 0; x < W; x++, j += 4) {
      const c = STATE_COLORS[state[src + x]];
      out[j] = c[0]; out[j + 1] = c[1]; out[j + 2] = c[2]; out[j + 3] = c[3];
    }
  }
}

// ==================== Streaming canvas ====================

/**
 * StreamingRasterCanvas — paint cells as they arrive, encode to PNG on flush.
 * Single-flight flush (max one encode at a time, coalesced).
 */
export class StreamingRasterCanvas {
  private readonly geometry: RasterGeometry;
  /** Final state per pixel (latitude-uniform row space). */
  private readonly stateBuffer: Uint8Array;
  /** Aggregated mode only: counts and best state per group. */
  private readonly visCount: Uint8Array | null;
  private readonly blkCount: Uint8Array | null;
  private readonly visBest: Uint8Array | null;
  private readonly blkBest: Uint8Array | null;
  private readonly dataCount: Uint8Array | null;
  private imageData: ImageData;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private isFlushing = false;
  private flushPending = false;
  private currentBlobUrl: string | null = null;
  private lastResult: RasterResult | null = null;

  dirty = false;
  dirtyCells = 0;
  private cellStats: CellStats = { total: 0, clear: 0, fresnel: 0, marginal: 0, blocked: 0, noData: 0 };

  constructor(layout: GridLayout, maxDim = 4096) {
    this.geometry = rasterGeometry(layout, maxDim);
    const { W, H, aggregated } = this.geometry;
    this.stateBuffer = new Uint8Array(W * H);
    const n = aggregated ? W * H : 0;
    this.visCount = aggregated ? new Uint8Array(n) : null;
    this.blkCount = aggregated ? new Uint8Array(n) : null;
    this.visBest = aggregated ? new Uint8Array(n) : null;
    this.blkBest = aggregated ? new Uint8Array(n) : null;
    this.dataCount = aggregated ? new Uint8Array(n) : null;

    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(W, H);
    } else {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      this.canvas = c;
    }
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    if (!this.ctx) throw new Error('Could not get canvas context');
    this.imageData = this.ctx.createImageData(W, H);
  }

  getGeometry(): RasterGeometry {
    return this.geometry;
  }

  /** Paint a batch of cells. */
  paintBatch(cells: RasterCell[]): void {
    const g = this.geometry;
    const sb = this.stateBuffer;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const s = cellState(cell);
      if (s === PIXEL_CLEAR) this.cellStats.clear++;
      else if (s === PIXEL_FRESNEL) this.cellStats.fresnel++;
      else if (s === PIXEL_MARGINAL) this.cellStats.marginal++;
      else if (s === PIXEL_BLOCKED) this.cellStats.blocked++;
      else this.cellStats.noData++;
      this.cellStats.total++;

      const idx = pixelIndex(g, cell.lat, cell.lon);
      if (idx < 0) continue;
      if (!g.aggregated) {
        sb[idx] = s;
        continue;
      }
      // Majority of nodes in this pixel; counts saturate at 255.
      if (s === PIXEL_CLEAR || s === PIXEL_FRESNEL) {
        if (this.visCount![idx] < 255) this.visCount![idx]++;
        if (s > this.visBest![idx]) this.visBest![idx] = s;
      } else if (s === PIXEL_BLOCKED || s === PIXEL_MARGINAL) {
        if (this.blkCount![idx] < 255) this.blkCount![idx]++;
        if (s > this.blkBest![idx]) this.blkBest![idx] = s;
      } else if (this.dataCount![idx] < 255) {
        this.dataCount![idx]++;
      }
      const v = this.visCount![idx], b = this.blkCount![idx];
      sb[idx] = v + b === 0 ? PIXEL_NO_DATA : v > b ? this.visBest![idx] : v < b ? this.blkBest![idx] : PIXEL_MARGINAL;
    }
    this.dirty = true;
    this.dirtyCells += cells.length;
  }

  /** Flush the state to a PNG Blob URL. */
  async flush(): Promise<RasterResult | null> {
    if (this.isFlushing) {
      this.flushPending = true;
      return this.lastResult;
    }
    this.isFlushing = true;
    this.dirty = false;
    this.dirtyCells = 0;

    const g = this.geometry;
    buildRgba(this.stateBuffer, g, this.imageData.data);
    this.ctx.putImageData(this.imageData, 0, 0);

    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }

    let url: string;
    if (typeof OffscreenCanvas !== 'undefined' && this.canvas instanceof OffscreenCanvas) {
      const blob = await this.canvas.convertToBlob({ type: 'image/png' });
      url = URL.createObjectURL(blob);
    } else {
      url = await new Promise<string>((resolve) => {
        (this.canvas as HTMLCanvasElement).toBlob((blob) => {
          resolve(blob ? URL.createObjectURL(blob) : (this.canvas as HTMLCanvasElement).toDataURL('image/png'));
        }, 'image/png');
      });
    }

    this.currentBlobUrl = url;
    this.lastResult = {
      url,
      coordinates: cornersOf(g.bounds),
      width: g.W,
      height: g.H,
      effectiveResolutionXM: g.effectiveResolutionXM,
      effectiveResolutionYM: g.effectiveResolutionYM,
    };
    this.isFlushing = false;

    if (this.flushPending && this.dirty) {
      this.flushPending = false;
      return this.flush();
    }
    this.flushPending = false;
    return this.lastResult;
  }

  /** Cell-level statistics (exact, not pixel-dependent). */
  getCellStats(): CellStats {
    return { ...this.cellStats };
  }

  /** Pixel-level statistics (for tests/debugging). */
  getPixelStats(): { empty: number; noData: number; blocked: number; marginal: number; fresnel: number; clear: number } {
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < this.stateBuffer.length; i++) counts[this.stateBuffer[i]]++;
    return { empty: counts[PIXEL_EMPTY], noData: counts[PIXEL_NO_DATA], blocked: counts[PIXEL_BLOCKED], marginal: counts[PIXEL_MARGINAL], fresnel: counts[PIXEL_FRESNEL], clear: counts[PIXEL_CLEAR] };
  }

  getLastResult(): RasterResult | null {
    return this.lastResult;
  }

  /** State buffer (latitude-uniform rows), for tests. */
  getStateBuffer(): Uint8Array {
    return this.stateBuffer;
  }

  destroy(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
    this.lastResult = null;
  }
}

// ==================== Legacy: results saved as cells ====================

/** Legacy grids were generated with 111,000 m per degree; reconstruct their layout from the cells. */
export function legacyLayout(cells: Array<{ lat: number; lon: number; clear: boolean | null }>, resolution: number, refLat: number): GridLayout | null {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const c of cells) {
    if (c.clear === null) continue;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lon < minLon) minLon = c.lon;
    if (c.lon > maxLon) maxLon = c.lon;
  }
  if (minLat === Infinity) return null;
  const latStep = resolution / 111000;
  const lonStep = resolution / (111000 * Math.cos((refLat * Math.PI) / 180));
  return {
    latMin: minLat, lonMin: minLon, latStep, lonStep,
    nLat: Math.round((maxLat - minLat) / latStep) + 1,
    nLon: Math.round((maxLon - minLon) / lonStep) + 1,
  };
}

/**
 * Raster image (data URL) for results saved as a list of cells (before the streaming raster).
 * Same pixel and Mercator rules as the streaming canvas.
 */
export function gridToImageUrl(cells: GridCell[], resolution: number, refLat: number): RasterResult | null {
  if (cells.length === 0) return null;
  const layout = legacyLayout(cells, resolution, refLat);
  if (!layout) return null;
  const g = rasterGeometry(layout);
  const state = new Uint8Array(g.W * g.H);
  for (const c of cells) {
    if (c.clear === null) continue;
    const idx = pixelIndex(g, c.lat, c.lon);
    if (idx >= 0) state[idx] = Math.max(state[idx], cellState(c));
  }
  const canvas = document.createElement('canvas');
  canvas.width = g.W;
  canvas.height = g.H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  const img = ctx.createImageData(g.W, g.H);
  buildRgba(state, g, img.data);
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), coordinates: cornersOf(g.bounds), width: g.W, height: g.H };
}
