/**
 * Elevation sampling utilities - Enhanced Version
 * Handles terrain tile loading, caching, elevation decoding with improved accuracy
 */

import { generateBoundsSamplePoints, clampLat, normalizeLng, type Bounds } from './geo';

// Custom DSM support - lazy loaded
let customDSMModule: { getCustomElevation: (lat: number, lng: number) => number | null } | null = null;

async function loadCustomDSM() {
  if (customDSMModule) return customDSMModule;
  try {
    customDSMModule = await import('./customDSM');
  } catch (e) {
    customDSMModule = { getCustomElevation: () => null };
  }
  return customDSMModule;
}

// Initialize on client side
if (typeof window !== 'undefined') {
  loadCustomDSM();
}

function getCustomElevation(lat: number, lng: number): number | null {
  return customDSMModule?.getCustomElevation?.(lat, lng) ?? null;
}

export type EncodingType = 'terrarium' | 'mapbox';

// Quality/confidence levels for elevation data
export type ElevationQuality = 'high' | 'medium' | 'low' | 'interpolated' | 'unknown';

export interface ElevationResult {
  elevation: number | null;
  quality: ElevationQuality;
  source?: string;
}

export interface ElevationStats {
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  validSamples: number;
  totalSamples: number;
  quality: ElevationQuality;
}

// Validation limits
const ELEVATION_LIMITS = {
  min: -500,      // Dead Sea ~-430m, allow some margin
  max: 9000,      // Everest ~8848m
  maxChange: 500, // Max elevation change per 30m (very steep cliff)
};

// LRU Cache for tiles
class LRUTileCache {
  private cache: Map<string, HTMLCanvasElement> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 300) {
    this.maxSize = maxSize;
  }

  get(key: string): HTMLCanvasElement | undefined {
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  set(key: string, value: HTMLCanvasElement): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

const tileCache = new LRUTileCache(300);
const pendingLoads: Map<string, Promise<HTMLCanvasElement | null>> = new Map();

/**
 * Decode elevation from RGB values
 */
function decodeElevation(r: number, g: number, b: number, encoding: EncodingType): number {
  if (encoding === 'terrarium') {
    return (r * 256 + g + b / 256) - 32768;
  }
  return ((r * 65536 + g * 256 + b) * 0.1) - 10000;
}

/**
 * Check if a pixel represents NoData
 */
function isNoData(r: number, g: number, b: number, a: number, encoding: EncodingType): boolean {
  // Transparent pixel
  if (a === 0) return true;

  // Check for invalid elevation values
  if (encoding === 'terrarium') {
    const elev = (r * 256 + g + b / 256) - 32768;
    // Terrarium uses very low values for NoData
    if (elev < -11000) return true;
    // Also check for suspiciously uniform values (often indicates NoData)
    if (r === 0 && g === 0 && b === 0) return true;
  }

  return false;
}

/**
 * Validate elevation value is within reasonable bounds
 */
function validateElevation(elevation: number): boolean {
  return elevation >= ELEVATION_LIMITS.min && elevation <= ELEVATION_LIMITS.max;
}

/**
 * Bilinear interpolation with NoData handling
 */
function bilinearInterpolation(
  v00: number | null, v10: number | null,
  v01: number | null, v11: number | null,
  fracX: number, fracY: number
): { value: number | null; quality: ElevationQuality } {
  const values = [v00, v10, v01, v11].filter(v => v !== null) as number[];

  if (values.length === 0) {
    return { value: null, quality: 'unknown' };
  }

  // If we have fewer than 4 values, use average (lower quality)
  if (values.length < 4) {
    return {
      value: values.reduce((a, b) => a + b, 0) / values.length,
      quality: values.length >= 3 ? 'medium' : 'interpolated'
    };
  }

  // Full bilinear interpolation
  const top = v00! + (v10! - v00!) * fracX;
  const bottom = v01! + (v11! - v01!) * fracX;
  return {
    value: top + (bottom - top) * fracY,
    quality: 'high'
  };
}

/**
 * Bicubic interpolation kernel
 */
function cubicInterpolate(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const c = -0.5 * p0 + 0.5 * p2;
  const d = p1;
  return a * t * t * t + b * t * t + c * t + d;
}

/**
 * Bicubic interpolation for higher accuracy
 */
function bicubicInterpolation(
  values: (number | null)[][],  // 4x4 grid of values
  fracX: number,
  fracY: number
): { value: number | null; quality: ElevationQuality } {
  // Check if we have enough valid values
  let validCount = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (values[i]?.[j] !== null && values[i]?.[j] !== undefined) {
        validCount++;
      }
    }
  }

  // If too many missing values, fall back to bilinear
  if (validCount < 12) {
    // Extract center 2x2 for bilinear
    const v00 = values[1]?.[1] ?? null;
    const v10 = values[2]?.[1] ?? null;
    const v01 = values[1]?.[2] ?? null;
    const v11 = values[2]?.[2] ?? null;
    return bilinearInterpolation(v00, v10, v01, v11, fracX, fracY);
  }

  // Fill missing values with nearest neighbor for bicubic
  const filled: number[][] = [];
  for (let i = 0; i < 4; i++) {
    filled[i] = [];
    for (let j = 0; j < 4; j++) {
      if (values[i]?.[j] !== null && values[i]?.[j] !== undefined) {
        filled[i][j] = values[i][j]!;
      } else {
        // Find nearest valid value
        let nearest: number | null = null;
        let minDist = Infinity;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const ni = i + di, nj = j + dj;
            if (ni >= 0 && ni < 4 && nj >= 0 && nj < 4 &&
                values[ni]?.[nj] !== null && values[ni]?.[nj] !== undefined) {
              const dist = Math.abs(di) + Math.abs(dj);
              if (dist < minDist) {
                minDist = dist;
                nearest = values[ni][nj]!;
              }
            }
          }
        }
        filled[i][j] = nearest ?? 0;
      }
    }
  }

  // Perform bicubic interpolation
  const cols: number[] = [];
  for (let i = 0; i < 4; i++) {
    cols[i] = cubicInterpolate(filled[i][0], filled[i][1], filled[i][2], filled[i][3], fracY);
  }

  const result = cubicInterpolate(cols[0], cols[1], cols[2], cols[3], fracX);

  return {
    value: result,
    quality: validCount === 16 ? 'high' : 'medium'
  };
}

/**
 * Convert lng/lat to tile coordinates
 */
function lngLatToTileCoords(lng: number, lat: number, zoom: number) {
  lng = normalizeLng(lng);
  lat = clampLat(lat);

  const n = Math.pow(2, zoom);
  const tileX = Math.floor(((lng + 180) / 360) * n);
  const latRad = lat * Math.PI / 180;
  const tileY = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);

  const clampedTileX = Math.max(0, Math.min(n - 1, tileX));
  const clampedTileY = Math.max(0, Math.min(n - 1, tileY));

  const xInTile = ((lng + 180) / 360) * n - clampedTileX;
  const yInTile = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n - clampedTileY;

  const pixelX = Math.floor(xInTile * 256);
  const pixelY = Math.floor(yInTile * 256);
  const fracX = (xInTile * 256) - pixelX;
  const fracY = (yInTile * 256) - pixelY;

  return {
    tileX: clampedTileX,
    tileY: clampedTileY,
    pixelX: Math.min(255, Math.max(0, pixelX)),
    pixelY: Math.min(255, Math.max(0, pixelY)),
    fracX,
    fracY
  };
}

/**
 * Load a tile as canvas with retry support
 */
async function loadTileAsCanvas(
  tileX: number,
  tileY: number,
  zoom: number,
  tilesUrl: string,
  retries: number = 2
): Promise<HTMLCanvasElement | null> {
  const cacheKey = `${zoom}/${tileX}/${tileY}`;

  const cached = tileCache.get(cacheKey);
  if (cached) return cached;

  if (pendingLoads.has(cacheKey)) {
    return pendingLoads.get(cacheKey)!;
  }

  const loadWithRetry = async (attempt: number): Promise<HTMLCanvasElement | null> => {
    return new Promise((resolve) => {
      const url = tilesUrl
        .replace('{z}', String(zoom))
        .replace('{x}', String(tileX))
        .replace('{y}', String(tileY));

      const img = new Image();
      img.crossOrigin = 'anonymous';

      const timeout = setTimeout(() => {
        img.src = '';
        if (attempt < retries) {
          setTimeout(() => {
            loadWithRetry(attempt + 1).then(resolve);
          }, 500 * Math.pow(2, attempt));
        } else {
          resolve(null);
        }
      }, 10000);

      img.onload = () => {
        clearTimeout(timeout);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          tileCache.set(cacheKey, canvas);
          resolve(canvas);
        } else {
          resolve(null);
        }
      };

      img.onerror = () => {
        clearTimeout(timeout);
        if (attempt < retries) {
          setTimeout(() => {
            loadWithRetry(attempt + 1).then(resolve);
          }, 500 * Math.pow(2, attempt));
        } else {
          resolve(null);
        }
      };

      img.src = url;
    });
  };

  const loadPromise = loadWithRetry(0);
  pendingLoads.set(cacheKey, loadPromise);

  const result = await loadPromise;
  pendingLoads.delete(cacheKey);
  return result;
}

/**
 * Get elevation at a single pixel
 */
function getElevationAtPixel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  encoding: EncodingType
): number | null {
  const px = Math.max(0, Math.min(255, Math.round(x)));
  const py = Math.max(0, Math.min(255, Math.round(y)));
  const data = ctx.getImageData(px, py, 1, 1).data;

  if (isNoData(data[0], data[1], data[2], data[3], encoding)) {
    return null;
  }

  const elev = decodeElevation(data[0], data[1], data[2], encoding);
  return validateElevation(elev) ? elev : null;
}

/**
 * Sample elevation from a canvas tile with improved accuracy
 */
function sampleElevationFromCanvas(
  canvas: HTMLCanvasElement,
  pixelX: number,
  pixelY: number,
  encoding: EncodingType,
  fracX?: number,
  fracY?: number,
  useBicubic: boolean = false
): { elevation: number | null; quality: ElevationQuality } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { elevation: null, quality: 'unknown' };

  // Simple case: no interpolation needed
  if (fracX === undefined || fracY === undefined) {
    const elev = getElevationAtPixel(ctx, pixelX, pixelY, encoding);
    return { elevation: elev, quality: elev !== null ? 'high' : 'unknown' };
  }

  if (useBicubic) {
    // Get 4x4 grid for bicubic interpolation
    const values: (number | null)[][] = [];
    for (let i = -1; i <= 2; i++) {
      values[i + 1] = [];
      for (let j = -1; j <= 2; j++) {
        values[i + 1][j + 1] = getElevationAtPixel(ctx, pixelX + i, pixelY + j, encoding);
      }
    }
    const result = bicubicInterpolation(values, fracX, fracY);
    return { elevation: result.value, quality: result.quality };
  } else {
    // Bilinear interpolation (faster, still good)
    const x0 = Math.max(0, Math.min(255, pixelX));
    const y0 = Math.max(0, Math.min(255, pixelY));
    const x1 = Math.min(255, x0 + 1);
    const y1 = Math.min(255, y0 + 1);

    const v00 = getElevationAtPixel(ctx, x0, y0, encoding);
    const v10 = getElevationAtPixel(ctx, x1, y0, encoding);
    const v01 = getElevationAtPixel(ctx, x0, y1, encoding);
    const v11 = getElevationAtPixel(ctx, x1, y1, encoding);

    const result = bilinearInterpolation(v00, v10, v01, v11, fracX, fracY);
    return { elevation: result.value, quality: result.quality };
  }
}

/**
 * Sample elevation at lng/lat with fallback zoom levels
 */
export async function sampleElevationAtLngLat(
  lng: number,
  lat: number,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType,
  options: { useBicubic?: boolean; fallbackZoom?: boolean } = {}
): Promise<number | null> {
  const { useBicubic = false, fallbackZoom = true } = options;

  // Check custom DSM first
  const customElev = getCustomElevation(lat, lng);
  if (customElev !== null) {
    return customElev;
  }

  // Try at requested zoom
  const { tileX, tileY, pixelX, pixelY, fracX, fracY } = lngLatToTileCoords(lng, lat, zoom);
  const canvas = await loadTileAsCanvas(tileX, tileY, zoom, tilesUrl);

  if (canvas) {
    const result = sampleElevationFromCanvas(canvas, pixelX, pixelY, encoding, fracX, fracY, useBicubic);
    if (result.elevation !== null) {
      return result.elevation;
    }
  }

  // Fallback to lower zoom levels if enabled
  if (fallbackZoom) {
    for (let z = zoom - 1; z >= Math.max(zoom - 3, 5); z--) {
      const coords = lngLatToTileCoords(lng, lat, z);
      const fallbackCanvas = await loadTileAsCanvas(coords.tileX, coords.tileY, z, tilesUrl);
      if (fallbackCanvas) {
        const result = sampleElevationFromCanvas(
          fallbackCanvas, coords.pixelX, coords.pixelY, encoding, coords.fracX, coords.fracY, useBicubic
        );
        if (result.elevation !== null) {
          return result.elevation;
        }
      }
    }
  }

  return null;
}

/**
 * Sample elevation with full quality information
 */
export async function sampleElevationWithQuality(
  lng: number,
  lat: number,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType
): Promise<ElevationResult> {
  const { tileX, tileY, pixelX, pixelY, fracX, fracY } = lngLatToTileCoords(lng, lat, zoom);
  const canvas = await loadTileAsCanvas(tileX, tileY, zoom, tilesUrl);

  if (!canvas) {
    // Try fallback
    for (let z = zoom - 1; z >= Math.max(zoom - 3, 5); z--) {
      const coords = lngLatToTileCoords(lng, lat, z);
      const fallbackCanvas = await loadTileAsCanvas(coords.tileX, coords.tileY, z, tilesUrl);
      if (fallbackCanvas) {
        const result = sampleElevationFromCanvas(
          fallbackCanvas, coords.pixelX, coords.pixelY, encoding, coords.fracX, coords.fracY
        );
        return {
          elevation: result.elevation,
          quality: result.elevation !== null ? 'low' : 'unknown',
          source: `fallback-z${z}`
        };
      }
    }
    return { elevation: null, quality: 'unknown' };
  }

  const result = sampleElevationFromCanvas(canvas, pixelX, pixelY, encoding, fracX, fracY, true);
  return { elevation: result.elevation, quality: result.quality, source: `z${zoom}` };
}

/**
 * Batch sample elevations with quality tracking
 */
export async function batchSampleElevations(
  points: Array<{ lng: number; lat: number }>,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType
): Promise<Array<number | null>> {
  const results: Array<number | null> = new Array(points.length).fill(null);
  const pointsNeedingTiles: Array<{ originalIndex: number; lng: number; lat: number }> = [];

  // First pass: check custom DSM
  for (let i = 0; i < points.length; i++) {
    const customElev = getCustomElevation(points[i].lat, points[i].lng);
    if (customElev !== null) {
      results[i] = customElev;
    } else {
      pointsNeedingTiles.push({ originalIndex: i, lng: points[i].lng, lat: points[i].lat });
    }
  }

  // If all covered by custom DSM, return early
  if (pointsNeedingTiles.length === 0) {
    return results;
  }

  // Second pass: fetch from tiles
  const tileGroups: Map<string, Array<{
    index: number;
    pixelX: number;
    pixelY: number;
    fracX: number;
    fracY: number
  }>> = new Map();

  pointsNeedingTiles.forEach(({ originalIndex, lng, lat }) => {
    const { tileX, tileY, pixelX, pixelY, fracX, fracY } = lngLatToTileCoords(lng, lat, zoom);
    const key = `${tileX}/${tileY}`;
    if (!tileGroups.has(key)) {
      tileGroups.set(key, []);
    }
    tileGroups.get(key)!.push({ index: originalIndex, pixelX, pixelY, fracX, fracY });
  });

  await Promise.all(
    Array.from(tileGroups.entries()).map(async ([key, samples]) => {
      const [tileX, tileY] = key.split('/').map(Number);
      const canvas = await loadTileAsCanvas(tileX, tileY, zoom, tilesUrl);
      if (!canvas) return;

      for (const sample of samples) {
        const result = sampleElevationFromCanvas(
          canvas, sample.pixelX, sample.pixelY, encoding, sample.fracX, sample.fracY
        );
        results[sample.index] = result.elevation;
      }
    })
  );

  return results;
}

/**
 * Batch sample with quality information
 */
export async function batchSampleElevationsWithQuality(
  points: Array<{ lng: number; lat: number }>,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType
): Promise<Array<ElevationResult>> {
  const tileGroups: Map<string, Array<{
    index: number;
    pixelX: number;
    pixelY: number;
    fracX: number;
    fracY: number
  }>> = new Map();

  points.forEach((point, index) => {
    const { tileX, tileY, pixelX, pixelY, fracX, fracY } = lngLatToTileCoords(point.lng, point.lat, zoom);
    const key = `${tileX}/${tileY}`;
    if (!tileGroups.has(key)) {
      tileGroups.set(key, []);
    }
    tileGroups.get(key)!.push({ index, pixelX, pixelY, fracX, fracY });
  });

  const results: Array<ElevationResult> = new Array(points.length).fill({ elevation: null, quality: 'unknown' as ElevationQuality });

  await Promise.all(
    Array.from(tileGroups.entries()).map(async ([key, samples]) => {
      const [tileX, tileY] = key.split('/').map(Number);
      const canvas = await loadTileAsCanvas(tileX, tileY, zoom, tilesUrl);
      if (!canvas) return;

      for (const sample of samples) {
        const result = sampleElevationFromCanvas(
          canvas, sample.pixelX, sample.pixelY, encoding, sample.fracX, sample.fracY, true
        );
        results[sample.index] = {
          elevation: result.elevation,
          quality: result.quality,
          source: `z${zoom}`
        };
      }
    })
  );

  return results;
}

/**
 * Calculate statistics for a set of elevations
 */
export function calculateElevationStats(elevations: Array<number | null>): ElevationStats | null {
  const valid = elevations.filter((e): e is number => e !== null);

  if (valid.length === 0) {
    return null;
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;

  const squaredDiffs = valid.map(v => Math.pow(v - mean, 2));
  const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / valid.length);

  // Determine quality based on coverage
  const coverage = valid.length / elevations.length;
  let quality: ElevationQuality;
  if (coverage >= 0.95) quality = 'high';
  else if (coverage >= 0.8) quality = 'medium';
  else if (coverage >= 0.5) quality = 'low';
  else quality = 'interpolated';

  return {
    min,
    max,
    mean,
    stdDev,
    validSamples: valid.length,
    totalSamples: elevations.length,
    quality,
  };
}

/**
 * Calculate viewport min/max with statistics
 */
export async function calculateViewportMinMax(
  bounds: Bounds,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType
): Promise<ElevationStats | null> {
  const points = generateBoundsSamplePoints(bounds, 15);

  if (points.length === 0) return null;

  const elevations = await batchSampleElevations(
    points.map(p => ({ lng: p.lon, lat: p.lat })),
    Math.min(zoom, 10),
    tilesUrl,
    encoding
  );

  return calculateElevationStats(elevations);
}

/**
 * Validate a LOS path for data quality
 */
export function validatePathElevations(
  elevations: Array<number | null>,
  distanceMeters: number
): { valid: boolean; issues: string[]; quality: ElevationQuality } {
  const issues: string[] = [];
  const valid = elevations.filter((e): e is number => e !== null);

  // Check coverage
  const coverage = valid.length / elevations.length;
  if (coverage < 0.5) {
    issues.push(`\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D7\u05E1\u05E8\u05D9\u05DD: ${Math.round((1 - coverage) * 100)}% \u05DE\u05D4\u05E0\u05E7\u05D5\u05D3\u05D5\u05EA`);
  }

  // Check for suspicious jumps
  const stepDistance = distanceMeters / (elevations.length - 1);
  const maxAllowedChange = ELEVATION_LIMITS.maxChange * (stepDistance / 30); // Scale by step size

  let jumpCount = 0;
  for (let i = 1; i < valid.length; i++) {
    if (Math.abs(valid[i] - valid[i-1]) > maxAllowedChange) {
      jumpCount++;
    }
  }

  if (jumpCount > valid.length * 0.1) {
    issues.push(`\u05E7\u05E4\u05D9\u05E6\u05D5\u05EA \u05D7\u05E8\u05D9\u05D2\u05D5\u05EA \u05D1\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD (${jumpCount} \u05E0\u05E7\u05D5\u05D3\u05D5\u05EA)`);
  }

  // Check for constant values (might indicate data issue)
  const uniqueValues = new Set(valid.map(v => Math.round(v))).size;
  if (uniqueValues === 1 && valid.length > 10) {
    issues.push('\u05DB\u05DC \u05D4\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D6\u05D4\u05D9\u05DD - \u05D9\u05D9\u05EA\u05DB\u05DF \u05E9\u05D2\u05D9\u05D0\u05D4');
  }

  // Determine quality
  let quality: ElevationQuality;
  if (coverage >= 0.95 && jumpCount === 0) quality = 'high';
  else if (coverage >= 0.8 && jumpCount < valid.length * 0.05) quality = 'medium';
  else if (coverage >= 0.5) quality = 'low';
  else quality = 'interpolated';

  return {
    valid: issues.length === 0,
    issues,
    quality,
  };
}

/**
 * Format elevation for display
 */
export function formatElevation(elevation: number | null): string {
  if (elevation === null) return '\u2014';
  return `${Math.round(elevation)} \u05DE'`;
}

/**
 * Format quality for display
 */
export function formatQuality(quality: ElevationQuality): string {
  const labels: Record<ElevationQuality, string> = {
    high: '\u05D2\u05D1\u05D5\u05D4',
    medium: '\u05D1\u05D9\u05E0\u05D5\u05E0\u05D9',
    low: '\u05E0\u05DE\u05D5\u05DA',
    interpolated: '\u05DE\u05E9\u05D5\u05E2\u05E8\u05DA',
    unknown: '\u05DC\u05D0 \u05D9\u05D3\u05D5\u05E2',
  };
  return labels[quality];
}

/**
 * Clear the tile cache
 */
export function clearTileCache(): void {
  tileCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return { size: tileCache.size(), maxSize: 300 };
}
