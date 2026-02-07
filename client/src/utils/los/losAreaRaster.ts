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
  /** Data URL of the PNG image */
  url: string;
  /** Corner coordinates for MapLibre ImageSource: [topLeft, topRight, bottomRight, bottomLeft] */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  /** Image dimensions */
  width: number;
  height: number;
}

export interface GridBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Compute geographic bounds from grid cells with half-cell padding
 */
function computeBounds(
  cells: GridCell[],
  resolution: number,
  refLat: number,
): GridBounds {
  if (cells.length === 0) {
    return { west: 0, south: 0, east: 0, north: 0 };
  }

  const halfLat = metersToDegreesLat(resolution) / 2;
  const halfLon = metersToDegreesLon(resolution, refLat) / 2;

  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  for (const cell of cells) {
    if (cell.clear === null) continue;
    if (cell.lat < minLat) minLat = cell.lat;
    if (cell.lat > maxLat) maxLat = cell.lat;
    if (cell.lon < minLon) minLon = cell.lon;
    if (cell.lon > maxLon) maxLon = cell.lon;
  }

  if (!isFinite(minLat)) {
    return { west: 0, south: 0, east: 0, north: 0 };
  }

  return {
    west: minLon - halfLon,
    south: minLat - halfLat,
    east: maxLon + halfLon,
    north: maxLat + halfLat,
  };
}

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
  // Filter to cells with actual results
  const validCells = cells.filter(c => c.clear !== null);
  if (validCells.length === 0) return null;

  const bounds = computeBounds(cells, resolution, refLat);
  if (bounds.east <= bounds.west || bounds.north <= bounds.south) return null;

  const latStep = metersToDegreesLat(resolution);
  const lonStep = metersToDegreesLon(resolution, refLat);

  // Image dimensions: one pixel per grid cell
  const width = Math.max(1, Math.ceil((bounds.east - bounds.west) / lonStep));
  const height = Math.max(1, Math.ceil((bounds.north - bounds.south) / latStep));

  // Safety: cap canvas size to prevent memory issues
  const maxDim = 4096;
  if (width > maxDim || height > maxDim) {
    // Scale down if too large
    const scale = maxDim / Math.max(width, height);
    const scaledWidth = Math.max(1, Math.round(width * scale));
    const scaledHeight = Math.max(1, Math.round(height * scale));
    return renderScaled(validCells, bounds, scaledWidth, scaledHeight, latStep, lonStep);
  }

  return render(validCells, bounds, width, height, latStep, lonStep);
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
  for (const cell of cells) {
    // Map lat/lon to pixel coordinates
    const px = Math.floor((cell.lon - bounds.west) / lonStep);
    // Flip Y: north is top (row 0), south is bottom
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

  for (const cell of cells) {
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
