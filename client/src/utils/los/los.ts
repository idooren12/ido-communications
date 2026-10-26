/**
 * Line of Sight calculation for the line tool.
 * The model itself lives in core/losCore.ts and is shared with the area tool.
 */

import i18n from '../../i18n/config';
import { TERRAIN_CONFIG } from './constants';
import { TerrainSampler, MAX_DEM_ZOOM, tileKeysAlongPath, type DemLayer } from './core/terrain';
import { evaluateLOS, hasLineOfSight, MARGINAL_CLEARANCE_M, OPTICAL_K, STANDARD_K, WORST_K, type LosStatus } from './core/losCore';
import { geodesicDistance, greatCircleKnots } from './core/geodesy';
import { loadTiles } from './core/tileLoader';

// Re-export geo functions for backwards compatibility
export { haversineDistance, initialBearing as calculateBearing } from './geo';

// Speed of light in m/s
const SPEED_OF_LIGHT = 299792458;
const EARTH_RADIUS = 6371000;

/**
 * Refraction factors k (effective Earth radius = k * R).
 * k > 1: the ray bends with the Earth and sees further (normal); k < 1: sub-refraction, sees less.
 */
export const K_FACTORS = {
  standard: STANDARD_K, // 4/3: radio, standard atmosphere
  optical: OPTICAL_K,   // ~1.15: visible light (refraction coefficient 0.13)
  none: 1.0,            // no refraction (geometric line)
  worst: WORST_K,       // 2/3: sub-refraction, the usual worst case for microwave links
  ducting: 4.0,         // strong super-refraction (unusual)
};

// Common RF frequencies in MHz
export const RF_FREQUENCIES = {
  '433MHz': 433,
  '868MHz': 868,
  '915MHz': 915,
  '2.4GHz': 2400,
  '5GHz': 5000,
  '5.8GHz': 5800,
};

export interface LOSPoint {
  lat: number;
  lon: number;
  antennaHeight: number;
}

export interface LOSProfilePoint {
  lat: number;
  lon: number;
  distance: number;
  groundElevation: number | null;
  losHeight: number;
  clearance: number | null;
  fresnelRadius?: number;
  fresnelClearance?: number | null;
  fromLayer?: boolean;
}

export interface LOSObstruction {
  lat: number;
  lon: number;
  distance: number;
  elevation: number;
  blockageAmount: number;
}

export interface LOSResult {
  /** Detailed class, identical to what the area tool paints for the same point. */
  status: LosStatus;
  clear: boolean;
  fresnelClear?: boolean;      // True if 60% of first Fresnel zone is clear
  totalDistance: number;
  bearing: number;
  minClearance: number | null;
  minClearanceDistance: number;
  /** Half-width of the uncertainty band at the point of minimum clearance (metres). */
  uncertaintyAtMin: number;
  minFresnelClearance?: number | null;
  /** RF: lowest clearance / F1 radius (0.6 or more meets the Fresnel criterion). */
  minFresnelRatio?: number | null;
  /** Refraction factor the class was computed with. */
  refractionK: number;
  /** Worst-case refraction factor, and the lowest clearance with it (does not change the class). */
  worstK: number;
  minClearanceWorstK: number | null;
  /** Ground switches between an uploaded DSM and the terrain tiles along the path. */
  mixedSources: boolean;
  /** DEM pixel size used, metres. */
  pixelM: number;
  profile: LOSProfilePoint[];
  obstruction?: LOSObstruction;
  confidence: 'high' | 'medium' | 'low';
  confidenceDetails: ConfidenceDetails;
  nullSamples: number;
  totalSamples: number;
  frequencyMHz?: number;
  validation: ValidationResult;
}

export interface ConfidenceDetails {
  dataCompleteness: number;      // 0-1, share of samples with terrain data
  elevationVariance: number;     // Standard deviation of elevations
  suspiciousJumps: number;       // Count of unusually large elevation changes
  interpolatedPoints: number;    // Samples without data
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface LOSOptions {
  /** Refraction factor; default 4/3 in RF mode, 1.15 in optical mode. */
  refractionK?: number;
  frequencyMHz?: number;         // RF frequency for Fresnel calculation (60 % of F1 must be clear)
  tilesUrl?: string;
  /** DEM zoom; defaults to the finest (MAX_DEM_ZOOM) for any length. */
  zoom?: number;
}

/**
 * Calculate wavelength from frequency
 */
export function frequencyToWavelength(frequencyMHz: number): number {
  return SPEED_OF_LIGHT / (frequencyMHz * 1_000_000);
}

/**
 * First Fresnel zone radius at a point along the path (metres).
 */
export function calculateFresnelRadius(d1: number, d2: number, wavelength: number): number {
  const totalDistance = d1 + d2;
  if (totalDistance === 0) return 0;
  return Math.sqrt((wavelength * d1 * d2) / totalDistance);
}

/**
 * Earth curvature drop of a straight ray at distances d1, d2 from its ends (metres).
 */
export function calculateCurvatureDrop(
  d1: number,
  d2: number,
  earthRadius: number = EARTH_RADIUS,
  refractionK: number = K_FACTORS.standard
): number {
  return (d1 * d2) / (2 * earthRadius * refractionK);
}

/**
 * How sure the answer is: how far the minimum clearance is from the uncertainty band, how
 * complete the data is, and whether the answer holds in a worse atmosphere.
 */
export function assessConfidence(args: {
  status: LosStatus;
  minClearance: number | null;
  uncertaintyAtMin: number;
  minClearanceWorstK: number | null;
  nullRatio: number;
  suspiciousJumps: number;
  totalSamples: number;
  mixedSources: boolean;
}): 'high' | 'medium' | 'low' {
  const { status, minClearance, uncertaintyAtMin, minClearanceWorstK, nullRatio, suspiciousJumps, totalSamples, mixedSources } = args;
  if (status === 'nodata' || status === 'marginal') return 'low';
  if (nullRatio >= 0.15 || suspiciousJumps > totalSamples * 0.02) return 'low';
  const band = Math.max(uncertaintyAtMin, 1);
  const decisive = minClearance === null || Math.abs(minClearance) >= 3 * band;
  const robustToRefraction = status === 'blocked' || minClearanceWorstK === null || minClearanceWorstK >= 0;
  if (!decisive || !robustToRefraction || nullRatio >= 0.05 || suspiciousJumps > 0 || mixedSources) return 'medium';
  return 'high';
}

/**
 * Line of sight between two points (with full elevation profile).
 */
export async function calculateLOS(pointA: LOSPoint, pointB: LOSPoint, options: LOSOptions = {}): Promise<LOSResult> {
  const totalDistance = geodesicDistance(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
  const zoom = options.zoom ?? MAX_DEM_ZOOM;
  const rf = options.frequencyMHz !== undefined;
  const refractionK = options.refractionK ?? (rf ? K_FACTORS.standard : K_FACTORS.optical);
  // Worst case: sub-refraction for radio; no refraction at all for light.
  const worstK = rf ? K_FACTORS.worst : K_FACTORS.none;

  // Only the tiles the great circle crosses (a corridor), not its whole bounding box.
  const knots = greatCircleKnots(pointA.lat, pointA.lon, pointB.lat, pointB.lon, Math.max(1, Math.ceil(totalDistance / 1000)));
  const keys = tileKeysAlongPath(knots.lat, knots.lon, zoom, 2);

  const [tiles, layers] = await Promise.all([
    loadTiles(keys, options.tilesUrl ?? TERRAIN_CONFIG.url),
    loadCustomLayers(),
  ]);
  const sampler = new TerrainSampler(zoom, tiles, layers);

  const core = evaluateLOS(
    sampler,
    { lat: pointA.lat, lon: pointA.lon, height: pointA.antennaHeight },
    { lat: pointB.lat, lon: pointB.lon, height: pointB.antennaHeight },
    { frequencyMHz: options.frequencyMHz, refractionK, worstK, collectProfile: true }
  );

  const profile: LOSProfilePoint[] = core.profile ?? [];
  const elevations = profile.map(p => p.groundElevation);
  const valid = elevations.filter((e): e is number => e !== null);
  const dataCompleteness = elevations.length ? valid.length / elevations.length : 0;

  let elevationVariance = 0;
  if (valid.length > 1) {
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    elevationVariance = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length);
  }

  // Unrealistic jumps between neighbouring samples (likely data errors).
  const step = profile.length > 1 ? totalDistance / (profile.length - 1) : totalDistance;
  const maxReasonableChange = Math.max(50, 500 * (step / 30));
  let suspiciousJumps = 0;
  let prev: number | null = null;
  for (const e of elevations) {
    if (e === null) continue;
    if (prev !== null && Math.abs(e - prev) > maxReasonableChange) suspiciousJumps++;
    prev = e;
  }

  const nullSamples = elevations.length - valid.length;
  const nullRatio = elevations.length ? nullSamples / elevations.length : 1;
  const confidence = assessConfidence({
    status: core.status,
    minClearance: core.minClearance,
    uncertaintyAtMin: core.uncertaintyAtMin,
    minClearanceWorstK: core.minClearanceWorstK,
    nullRatio,
    suspiciousJumps,
    totalSamples: elevations.length,
    mixedSources: core.mixedSources,
  });

  return {
    status: core.status,
    clear: hasLineOfSight(core.status),
    fresnelClear: rf ? core.status === 'clear' : undefined,
    totalDistance,
    bearing: core.bearing,
    minClearance: core.minClearance,
    minClearanceDistance: core.minClearanceDistance,
    uncertaintyAtMin: core.uncertaintyAtMin,
    minFresnelClearance: core.minFresnelClearance,
    minFresnelRatio: core.minFresnelRatio,
    refractionK: core.refractionK,
    worstK,
    minClearanceWorstK: core.minClearanceWorstK,
    mixedSources: core.mixedSources,
    pixelM: core.pixelM,
    profile,
    obstruction: core.obstruction,
    confidence,
    confidenceDetails: {
      dataCompleteness,
      elevationVariance,
      suspiciousJumps,
      interpolatedPoints: nullSamples,
    },
    nullSamples,
    totalSamples: elevations.length,
    frequencyMHz: options.frequencyMHz,
    validation: validateLOSInput(pointA, pointB, totalDistance, elevations),
  };
}

/** Uploaded custom DSM layers (they override the terrain tiles where they exist). */
async function loadCustomLayers(): Promise<DemLayer[]> {
  try {
    const dsm = await import('./customDSM');
    return dsm.getCustomLayers();
  } catch {
    return [];
  }
}

/**
 * Validate LOS input parameters
 */
export function validateLOSInput(
  pointA: LOSPoint,
  pointB: LOSPoint,
  distance: number,
  elevations: Array<number | null>
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (pointA.lat < -90 || pointA.lat > 90 || pointB.lat < -90 || pointB.lat > 90) {
    errors.push(i18n.t('los.validation.invalidCoordinates'));
  }

  if (pointA.antennaHeight < 0 || pointA.antennaHeight > 1000) {
    warnings.push(i18n.t('los.validation.antennaHeightA'));
  }
  if (pointB.antennaHeight < 0 || pointB.antennaHeight > 1000) {
    warnings.push(i18n.t('los.validation.antennaHeightB'));
  }

  if (distance > 200000) {
    warnings.push(i18n.t('los.validation.longDistance'));
  }
  if (distance < 10) {
    warnings.push(i18n.t('los.validation.shortDistance'));
  }

  const validCount = elevations.filter(e => e !== null).length;
  const coverage = elevations.length ? validCount / elevations.length : 0;
  if (coverage < 0.5) {
    warnings.push(i18n.t('los.validation.partialData', { percent: Math.round(coverage * 100) }));
  }

  const uniqueElevations = new Set(elevations.filter(e => e !== null).map(e => Math.round(e!))).size;
  if (uniqueElevations === 1 && elevations.length > 20) {
    warnings.push(i18n.t('los.validation.constantElevation'));
  }

  return { valid: errors.length === 0, warnings, errors };
}

export { formatDistance } from './geo';
export { MARGINAL_CLEARANCE_M };

/**
 * Format frequency for display
 */
export function formatFrequency(mhz: number): string {
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(1)} GHz`;
  return `${mhz} MHz`;
}
