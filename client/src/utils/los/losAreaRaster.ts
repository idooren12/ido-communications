/**
 * LOS Area Raster Renderer
 * Converts grid cells to a Canvas-based raster image for efficient MapLibre rendering.
 * Instead of creating thousands of GeoJSON polygon features, we paint cells onto a
 * single Canvas and use MapLibre's ImageSource for display.
 */

import type { GridCell } from '../../contexts/LOSContext';
import { metersToDegreesLat, metersToDegreesLon } from './geo';

// Colors for clear/blocked cells (RGBA)
const COLOR_CLEAR: [number, number, number, number] = [16, 185, 129, 200]; // #10b981 with alpha
const COLOR_BLOCKED: [number, number, number, number] = [244, 63, 94, 200]; // #f43f5e with alpha

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

// ==================== Streaming Raster Canvas ====================

/**
 * Pixel state enum for the state machine merge.
 * Merge rule: max(old, incoming) — commutative and associative.
 */
const PIXEL_EMPTY = 0;    // No cell landed on this pixel
const PIXEL_NO_DATA = 1;  // hasData === false
const PIXEL_BLOCKED = 2;  // clear === false
const PIXEL_CLEAR = 3;    // clear === true

/**
 * Color LUT: state → RGBA. NOT part of determinism contract.
 * Determinism is defined by stateBuffer content only.
 */
const STATE_COLORS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],          // EMPTY: transparent
  [128, 128, 128, 100],   // NO_DATA: gray semi-transparent
  [244, 63, 94, 200],     // BLOCKED: red
  [16, 185, 129, 200],    // CLEAR: green
] as const;

/** Input cell type for streaming paint */
export interface RasterCell {
  lat: number;
  lon: number;
  clear: boolean | null;
  fresnelClear?: boolean | null;
  hasData: boolean;
}

/** Raster mapping configuration — shared source of truth for main thread and workers */
export interface RasterMapping {
  W: number;
  H: number;
  effLonStepDeg: number;
  effLatStepDeg: number;
  effectiveResolutionXM: number;
  effectiveResolutionYM: number;
  midLat: number;
  bounds: GridBounds;
}

/**
 * Compute raster mapping from geographic bounds and resolution.
 * This is a pure function used by both StreamingRasterCanvas and workers (packed payload).
 * The mapping guarantees pixelX ∈ [0, W-1] and pixelY ∈ [0, H-1].
 */
export function computeRasterMapping(bounds: GridBounds, resolution: number, maxDim = 4096): RasterMapping {
  // Bounds validation
  if (bounds.east <= bounds.west) throw new Error(`Invalid bounds: east (${bounds.east}) <= west (${bounds.west})`);
  if (bounds.north <= bounds.south) throw new Error(`Invalid bounds: north (${bounds.north}) <= south (${bounds.south})`);

  const midLat = (bounds.north + bounds.south) / 2;
  const boundsWidthDeg = bounds.east - bounds.west;
  const boundsHeightDeg = bounds.north - bounds.south;

  // Step 1: requested step from resolution
  const reqLatStepDeg = resolution / 111_320;
  const reqLonStepDeg = resolution / (111_320 * Math.cos(midLat * Math.PI / 180));

  // Step 2: requested dims
  const reqW = Math.ceil(boundsWidthDeg / reqLonStepDeg);
  const reqH = Math.ceil(boundsHeightDeg / reqLatStepDeg);

  // Step 3: clamp dims
  const W = Math.max(1, Math.min(reqW, maxDim));
  const H = Math.max(1, Math.min(reqH, maxDim));

  // Step 4: effective step — DERIVED from final dims (prevents pixel overflow)
  const effLonStepDeg = boundsWidthDeg / W;
  const effLatStepDeg = boundsHeightDeg / H;

  // Step 5: effective resolution in meters (both axes)
  const effectiveResolutionXM = effLonStepDeg * 111_320 * Math.cos(midLat * Math.PI / 180);
  const effectiveResolutionYM = effLatStepDeg * 111_320;

  return { W, H, effLonStepDeg, effLatStepDeg, effectiveResolutionXM, effectiveResolutionYM, midLat, bounds };
}

/** Cell-level statistics (exact, independent of raster resolution) */
export interface CellStats {
  total: number;
  clear: number;
  blocked: number;
  noData: number;
}

/**
 * StreamingRasterCanvas — zero-copy streaming raster for 100B+ point calculations.
 *
 * Architecture: state-only paint + RGBA build on flush.
 * - paintBatch/paintPackedBatch write ONLY to stateBuffer (Uint8Array)
 * - flush() builds RGBA from stateBuffer via LUT, then encodes to PNG Blob URL
 * - Single-flight: max 1 concurrent flush, with coalescing
 */
export class StreamingRasterCanvas {
  private stateBuffer: Uint8Array;
  private imageData: ImageData;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private mapping: RasterMapping;
  private corners: RasterResult['coordinates'];

  private isFlushing = false;
  private flushPending = false;
  private currentBlobUrl: string | null = null;
  private lastResult: RasterResult | null = null;

  // Tracking
  dirty = false;
  dirtyCells = 0;
  dirtyPixels = 0;
  private cellStats: CellStats = { total: 0, clear: 0, blocked: 0, noData: 0 };

  constructor(bounds: GridBounds, resolution: number, maxDim = 4096) {
    this.mapping = computeRasterMapping(bounds, resolution, maxDim);
    const { W, H } = this.mapping;

    this.stateBuffer = new Uint8Array(W * H); // initialized to 0 (EMPTY)

    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(W, H);
    } else {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      this.canvas = c;
    }

    this.ctx = this.canvas.getContext('2d') as any;
    if (!this.ctx) throw new Error('Could not get canvas context');
    this.imageData = this.ctx.createImageData(W, H);

    this.corners = [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ];
  }

  getMapping(): RasterMapping {
    return this.mapping;
  }

  /** Paint a batch of RasterCell objects (Phase 1 path — debug/legacy after Phase 2.5) */
  paintBatch(cells: RasterCell[]): void {
    const { W, H, effLonStepDeg, effLatStepDeg, bounds } = this.mapping;
    const sb = this.stateBuffer;

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const incoming = !cell.hasData ? PIXEL_NO_DATA
        : cell.clear === true ? PIXEL_CLEAR
        : cell.clear === false ? PIXEL_BLOCKED
        : PIXEL_NO_DATA;

      // Cell-level stats (exact, not pixel-dependent)
      if (incoming === PIXEL_CLEAR) this.cellStats.clear++;
      else if (incoming === PIXEL_BLOCKED) this.cellStats.blocked++;
      else this.cellStats.noData++;
      this.cellStats.total++;

      const px = Math.min(Math.floor((cell.lon - bounds.west) / effLonStepDeg), W - 1);
      const py = Math.min(Math.floor((bounds.north - cell.lat) / effLatStepDeg), H - 1);
      if (px < 0 || py < 0) continue;

      const idx = py * W + px;
      if (incoming > sb[idx]) {
        sb[idx] = incoming;
        this.dirtyPixels++;
      }
    }

    this.dirty = true;
    this.dirtyCells += cells.length;
  }

  /** Paint a packed Uint32Array from worker (Phase 2.5 default path — no float math) */
  paintPackedBatch(packed: Uint32Array): void {
    const sb = this.stateBuffer;
    const W = this.mapping.W;

    for (let i = 0; i < packed.length; i++) {
      const v = packed[i];
      const px = (v >>> 20) & 0xFFF;
      const py = (v >>> 8) & 0xFFF;
      const state = v & 0xFF;

      const idx = py * W + px;
      if (state > sb[idx]) {
        sb[idx] = state;
        this.dirtyPixels++;
      }
    }

    this.dirty = true;
    this.dirtyCells += packed.length;
  }

  /** Update cell-level stats from a packed batch (caller must track separately) */
  updateCellStats(clear: number, blocked: number, noData: number): void {
    this.cellStats.clear += clear;
    this.cellStats.blocked += blocked;
    this.cellStats.noData += noData;
    this.cellStats.total += clear + blocked + noData;
  }

  /** Flush stateBuffer to PNG Blob URL. Single-flight: max 1 concurrent encode. */
  async flush(): Promise<RasterResult | null> {
    if (this.isFlushing) {
      this.flushPending = true;
      return this.lastResult;
    }
    this.isFlushing = true;
    this.dirty = false;
    this.dirtyCells = 0;
    this.dirtyPixels = 0;

    const { W, H, effectiveResolutionXM, effectiveResolutionYM } = this.mapping;

    // Build RGBA from stateBuffer via LUT — O(W×H), cache-friendly
    const sb = this.stateBuffer;
    const data = this.imageData.data;
    for (let i = 0; i < sb.length; i++) {
      const color = STATE_COLORS[sb[i]];
      const j = i * 4;
      data[j] = color[0];
      data[j + 1] = color[1];
      data[j + 2] = color[2];
      data[j + 3] = color[3];
    }

    this.ctx.putImageData(this.imageData, 0, 0);

    // Revoke old URL before creating new
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }

    // Encode to PNG via Blob URL (much cheaper than toDataURL base64)
    let url: string;
    if (this.canvas instanceof OffscreenCanvas) {
      const blob = await this.canvas.convertToBlob({ type: 'image/png' });
      url = URL.createObjectURL(blob);
    } else {
      // Fallback for browsers without OffscreenCanvas
      url = await new Promise<string>((resolve) => {
        (this.canvas as HTMLCanvasElement).toBlob((blob) => {
          resolve(blob ? URL.createObjectURL(blob) : (this.canvas as HTMLCanvasElement).toDataURL('image/png'));
        }, 'image/png');
      });
    }

    this.currentBlobUrl = url;
    this.lastResult = {
      url,
      coordinates: this.corners,
      width: W,
      height: H,
      effectiveResolutionXM,
      effectiveResolutionYM,
    };

    this.isFlushing = false;

    // Only re-flush if new data arrived during encode
    if (this.flushPending && this.dirty) {
      this.flushPending = false;
      return this.flush();
    }
    this.flushPending = false;

    return this.lastResult;
  }

  /** Get cell-level statistics (exact, not pixel-dependent) */
  getCellStats(): CellStats {
    return { ...this.cellStats };
  }

  /** Get pixel-level statistics (for debugging) */
  getPixelStats(): { empty: number; noData: number; blocked: number; clear: number } {
    let empty = 0, noData = 0, blocked = 0, clear = 0;
    for (let i = 0; i < this.stateBuffer.length; i++) {
      switch (this.stateBuffer[i]) {
        case PIXEL_EMPTY: empty++; break;
        case PIXEL_NO_DATA: noData++; break;
        case PIXEL_BLOCKED: blocked++; break;
        case PIXEL_CLEAR: clear++; break;
      }
    }
    return { empty, noData, blocked, clear };
  }

  /** Get last flushed result (for saving) */
  getLastResult(): RasterResult | null {
    return this.lastResult;
  }

  /** Get stateBuffer for determinism testing (SHA-256 hash) */
  getStateBuffer(): Uint8Array {
    return this.stateBuffer;
  }

  /** Clean up resources */
  destroy(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
    this.lastResult = null;
  }
}

// ==================== Legacy gridToImageUrl (unchanged) ====================

/**
 * Convert grid cells to a raster image URL suitable for MapLibre ImageSource.
 *
 * Each grid cell maps to one pixel in the output image. The image is stretched
 * over the geographic bounds by MapLibre's raster layer.
 *
 * @param cells - Array of grid cells with lat/lon/clear values
 * @param resolution - Grid resolution in meters
 * @param refLat - Reference latitude for lon→degree conversion (typically origin lat)
 * @returns RasterResult with data URL and corner coordinates, or null if no valid cells
 */
export function gridToImageUrl(
  cells: GridCell[],
  resolution: number,
  refLat: number,
): RasterResult | null {
  if (cells.length === 0) return null;

  // Compute bounds and count valid cells in a single pass (avoid extra .filter())
  const halfLat = metersToDegreesLat(resolution) / 2;
  const halfLon = metersToDegreesLon(resolution, refLat) / 2;
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  let validCount = 0;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.clear === null) continue;
    validCount++;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lon < minLon) minLon = c.lon;
    if (c.lon > maxLon) maxLon = c.lon;
  }

  if (validCount === 0) return null;

  const bounds: GridBounds = {
    west: minLon - halfLon,
    south: minLat - halfLat,
    east: maxLon + halfLon,
    north: maxLat + halfLat,
  };
  if (bounds.east <= bounds.west || bounds.north <= bounds.south) return null;

  const latStep = metersToDegreesLat(resolution);
  const lonStep = metersToDegreesLon(resolution, refLat);

  // Image dimensions: one pixel per grid cell
  const width = Math.max(1, Math.ceil((bounds.east - bounds.west) / lonStep));
  const height = Math.max(1, Math.ceil((bounds.north - bounds.south) / latStep));

  // Safety: cap canvas size to prevent memory issues
  const maxDim = 4096;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    const scaledWidth = Math.max(1, Math.round(width * scale));
    const scaledHeight = Math.max(1, Math.round(height * scale));
    // Pass all cells directly - render functions skip null cells
    return renderScaled(cells, bounds, scaledWidth, scaledHeight, latStep, lonStep);
  }

  return render(cells, bounds, width, height, latStep, lonStep);
}

function render(
  cells: GridCell[],
  bounds: GridBounds,
  width: number,
  height: number,
  latStep: number,
  lonStep: number,
): RasterResult {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : createFallbackCanvas(width, height);

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  if (!ctx) throw new Error('Could not get canvas context');

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // Paint each cell as a single pixel
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.clear === null) continue;

    const px = Math.floor((cell.lon - bounds.west) / lonStep);
    const py = Math.floor((bounds.north - cell.lat) / latStep);

    if (px < 0 || px >= width || py < 0 || py >= height) continue;

    const idx = (py * width + px) * 4;
    const color = cell.clear ? COLOR_CLEAR : COLOR_BLOCKED;
    data[idx] = color[0];
    data[idx + 1] = color[1];
    data[idx + 2] = color[2];
    data[idx + 3] = color[3];
  }

  ctx.putImageData(imageData, 0, 0);

  const url = canvasToDataUrl(canvas);

  return {
    url,
    coordinates: [
      [bounds.west, bounds.north], // top-left
      [bounds.east, bounds.north], // top-right
      [bounds.east, bounds.south], // bottom-right
      [bounds.west, bounds.south], // bottom-left
    ],
    width,
    height,
  };
}

function renderScaled(
  cells: GridCell[],
  bounds: GridBounds,
  width: number,
  height: number,
  latStep: number,
  lonStep: number,
): RasterResult {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : createFallbackCanvas(width, height);

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  if (!ctx) throw new Error('Could not get canvas context');

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const lonRange = bounds.east - bounds.west;
  const latRange = bounds.north - bounds.south;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.clear === null) continue;

    const px = Math.floor(((cell.lon - bounds.west) / lonRange) * width);
    const py = Math.floor(((bounds.north - cell.lat) / latRange) * height);

    if (px < 0 || px >= width || py < 0 || py >= height) continue;

    const idx = (py * width + px) * 4;
    const color = cell.clear ? COLOR_CLEAR : COLOR_BLOCKED;
    data[idx] = color[0];
    data[idx + 1] = color[1];
    data[idx + 2] = color[2];
    data[idx + 3] = color[3];
  }

  ctx.putImageData(imageData, 0, 0);

  const url = canvasToDataUrl(canvas);

  return {
    url,
    coordinates: [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ],
    width,
    height,
  };
}

function createFallbackCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToDataUrl(canvas: OffscreenCanvas | HTMLCanvasElement): string {
  if (canvas instanceof HTMLCanvasElement) {
    return canvas.toDataURL('image/png');
  }
  // OffscreenCanvas doesn't have toDataURL, so we need to use a regular canvas
  const regular = document.createElement('canvas');
  regular.width = canvas.width;
  regular.height = canvas.height;
  const ctx = regular.getContext('2d');
  if (ctx) {
    // Transfer OffscreenCanvas content
    const bitmap = (canvas as any).transferToImageBitmap();
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }
  return regular.toDataURL('image/png');
}
