/**
 * Point elevation readouts (cursor, search result, peak finder, elevation polygon, viewport
 * range). They use the same tiles and the same TerrainSampler as the LOS model, so the
 * elevation shown on the map is exactly the ground the LOS profile uses. (Before, a separate
 * canvas-based sampler interpolated from pixel corners, half a pixel - ~16 m - off, and did
 * not interpolate across tile edges.)
 */

import i18n from '../../i18n/config';
import { generateBoundsSamplePoints, clampLat, normalizeLng, type Bounds } from './geo';
import { TerrainSampler, MAX_DEM_ZOOM, tileKey, lngLatToGlobalPixel, TILE_SIZE, type DemLayer } from './core/terrain';
import { loadTiles } from './core/tileLoader';

// Custom DSM layers - lazy loaded
let customLayersGetter: (() => DemLayer[]) | null = null;

async function loadCustomDSM(): Promise<() => DemLayer[]> {
  if (customLayersGetter) return customLayersGetter;
  try {
    const dsm = await import('./customDSM');
    customLayersGetter = dsm.getCustomLayers;
  } catch {
    customLayersGetter = () => [];
  }
  return customLayersGetter;
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
  maxChange: 500, // Max elevation change per 30m (very steep cliff)
};

/** Tiles needed for bilinear lookups at these points (the 2x2 pixel neighbourhood can cross a tile edge). */
function keysForPoints(points: Array<{ lng: number; lat: number }>, z: number): string[] {
  const n = 2 ** z;
  const keys = new Set<string>();
  for (const p of points) {
    const g = lngLatToGlobalPixel(normalizeLng(p.lng), clampLat(p.lat), z);
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      const tx = Math.floor((g.x + dx) / TILE_SIZE), ty = Math.floor((g.y + dy) / TILE_SIZE);
      if (tx >= 0 && ty >= 0 && tx < n && ty < n) keys.add(tileKey(z, tx, ty));
    }
  }
  return [...keys];
}

async function samplerFor(points: Array<{ lng: number; lat: number }>, z: number, tilesUrl: string): Promise<TerrainSampler> {
  const [tiles, getLayers] = await Promise.all([loadTiles(keysForPoints(points, z), tilesUrl), loadCustomDSM()]);
  return new TerrainSampler(z, tiles, getLayers());
}

/** Point readouts use the LOS model's zoom; coarser only when asked for a lower zoom. */
const pointZoom = (zoom: number) => Math.max(0, Math.min(MAX_DEM_ZOOM, Math.round(zoom)));

/**
 * Elevation at lng/lat, trying up to three coarser zooms if the tile is missing.
 * `encoding` is kept for the API; the tiles are Terrarium.
 */
export async function sampleElevationAtLngLat(
  lng: number,
  lat: number,
  zoom: number,
  tilesUrl: string,
  _encoding: EncodingType = 'terrarium',
  options: { fallbackZoom?: boolean } = {}
): Promise<number | null> {
  const { fallbackZoom = true } = options;
  const z0 = pointZoom(zoom);
  const minZ = fallbackZoom ? Math.max(z0 - 3, 5) : z0;
  for (let z = z0; z >= Math.min(z0, minZ); z--) {
    const s = await samplerFor([{ lng, lat }], z, tilesUrl);
    const v = s.at(normalizeLng(lng), clampLat(lat));
    if (v !== null) return v;
  }
  return null;
}

/**
 * Sample elevation with quality information
 */
export async function sampleElevationWithQuality(
  lng: number,
  lat: number,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType = 'terrarium'
): Promise<ElevationResult> {
  const z0 = pointZoom(zoom);
  const first = await sampleElevationAtLngLat(lng, lat, z0, tilesUrl, encoding, { fallbackZoom: false });
  if (first !== null) return { elevation: first, quality: 'high', source: `z${z0}` };
  for (let z = z0 - 1; z >= Math.max(z0 - 3, 5); z--) {
    const v = await sampleElevationAtLngLat(lng, lat, z, tilesUrl, encoding, { fallbackZoom: false });
    if (v !== null) return { elevation: v, quality: 'low', source: `fallback-z${z}` };
  }
  return { elevation: null, quality: 'unknown' };
}

/**
 * Batch sample elevations (custom DSM first, then terrain tiles).
 */
export async function batchSampleElevations(
  points: Array<{ lng: number; lat: number }>,
  zoom: number,
  tilesUrl: string,
  _encoding: EncodingType = 'terrarium'
): Promise<Array<number | null>> {
  if (points.length === 0) return [];
  const z = pointZoom(zoom);
  const s = await samplerFor(points, z, tilesUrl);
  return points.map(p => s.at(normalizeLng(p.lng), clampLat(p.lat)));
}

/**
 * Batch sample with quality information
 */
export async function batchSampleElevationsWithQuality(
  points: Array<{ lng: number; lat: number }>,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType = 'terrarium'
): Promise<Array<ElevationResult>> {
  const z = pointZoom(zoom);
  const values = await batchSampleElevations(points, z, tilesUrl, encoding);
  return values.map(v => (v === null ? { elevation: null, quality: 'unknown' } : { elevation: v, quality: 'high', source: `z${z}` }));
}

/**
 * Calculate statistics for a set of elevations
 */
export function calculateElevationStats(elevations: Array<number | null>): ElevationStats | null {
  const valid = elevations.filter((e): e is number => e !== null);
  if (valid.length === 0) return null;

  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of valid) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  const mean = sum / valid.length;
  const stdDev = Math.sqrt(valid.reduce((a, v) => a + (v - mean) ** 2, 0) / valid.length);

  const coverage = valid.length / elevations.length;
  let quality: ElevationQuality;
  if (coverage >= 0.95) quality = 'high';
  else if (coverage >= 0.8) quality = 'medium';
  else if (coverage >= 0.5) quality = 'low';
  else quality = 'interpolated';

  return { min, max, mean, stdDev, validSamples: valid.length, totalSamples: elevations.length, quality };
}

/**
 * Calculate viewport min/max with statistics (coarse: zoom at most 10, 16x16 samples).
 */
export async function calculateViewportMinMax(
  bounds: Bounds,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType = 'terrarium'
): Promise<ElevationStats | null> {
  const points = generateBoundsSamplePoints(bounds, 15);
  if (points.length === 0) return null;
  const elevations = await batchSampleElevations(points.map(p => ({ lng: p.lon, lat: p.lat })), Math.min(zoom, 10), tilesUrl, encoding);
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

  const coverage = elevations.length ? valid.length / elevations.length : 0;
  if (coverage < 0.5) {
    issues.push(i18n.t('los.validation.missingData', { percent: Math.round((1 - coverage) * 100) }));
  }

  const stepDistance = distanceMeters / Math.max(1, elevations.length - 1);
  const maxAllowedChange = ELEVATION_LIMITS.maxChange * (stepDistance / 30);
  let jumpCount = 0;
  for (let i = 1; i < valid.length; i++) {
    if (Math.abs(valid[i] - valid[i - 1]) > maxAllowedChange) jumpCount++;
  }
  if (jumpCount > valid.length * 0.1) {
    issues.push(i18n.t('los.validation.suspiciousJumps', { count: jumpCount }));
  }

  const uniqueValues = new Set(valid.map(v => Math.round(v))).size;
  if (uniqueValues === 1 && valid.length > 10) {
    issues.push(i18n.t('los.validation.constantElevation'));
  }

  let quality: ElevationQuality;
  if (coverage >= 0.95 && jumpCount === 0) quality = 'high';
  else if (coverage >= 0.8 && jumpCount < valid.length * 0.05) quality = 'medium';
  else if (coverage >= 0.5) quality = 'low';
  else quality = 'interpolated';

  return { valid: issues.length === 0, issues, quality };
}

/** Kept for the API; tiles are cached in core/tileLoader. */
export function clearTileCache(): void {
  // The shared tile cache is an LRU; nothing to clear here.
}

export function getCacheStats(): { size: number; maxSize: number } {
  return { size: 0, maxSize: 512 };
}
