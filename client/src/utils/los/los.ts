/**
 * Line of Sight calculation for the line tool.
 * The model itself lives in core/losCore.ts and is shared with the area tool.
 */

import i18n from '../../i18n/config';
import { initialBearing } from './geo';
import { TERRAIN_CONFIG } from './constants';
import { TerrainSampler, boundsOf, demZoomForExtent, type DemLayer } from './core/terrain';
import { evaluateLOS, haversineMeters, hasLineOfSight, STANDARD_K, type LosStatus } from './core/losCore';
import { loadTilesForBounds } from './core/tileLoader';

// Re-export geo functions for backwards compatibility
export { haversineDistance, initialBearing as calculateBearing } from './geo';

// Speed of light in m/s
const SPEED_OF_LIGHT = 299792458;
const EARTH_RADIUS = 6371000;

export const K_FACTORS = {
  standard: STANDARD_K, // 4/3 Earth radius for standard atmosphere
  minimum: 0.67,     // Super-refraction
  maximum: 4.0,      // Sub-refraction
  none: 1.0,         // No refraction correction
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
}

export interface LOSObstruction {
  lat: number;
  lon: number;
  distance: number;
  elevation: number;
  blockageAmount: number;
  fresnelIntrusion?: number;  // How much into Fresnel zone (%)
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
  minFresnelClearance?: number | null;
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
  dataCompleteness: number;      // 0-1, percentage of valid samples
  elevationVariance: number;     // Standard deviation of elevations
  suspiciousJumps: number;       // Count of unusually large elevation changes
  interpolatedPoints: number;    // Points that were interpolated
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface LOSOptions {
  refractionK?: number;
  frequencyMHz?: number;         // RF frequency for Fresnel calculation (60 % of F1 must be clear)
  tilesUrl?: string;
  /** DEM zoom; defaults to demZoomForExtent(distance), the same rule the area tool uses. */
  zoom?: number;
}

/**
 * Calculate wavelength from frequency
 */
export function frequencyToWavelength(frequencyMHz: number): number {
  return SPEED_OF_LIGHT / (frequencyMHz * 1_000_000);
}

/**
 * Calculate first Fresnel zone radius at a point along the path
 * @param d1 - Distance from transmitter (meters)
 * @param d2 - Distance to receiver (meters)
 * @param wavelength - Wavelength in meters
 * @returns Radius of first Fresnel zone in meters
 */
export function calculateFresnelRadius(d1: number, d2: number, wavelength: number): number {
  const totalDistance = d1 + d2;
  if (totalDistance === 0) return 0;
  return Math.sqrt((wavelength * d1 * d2) / totalDistance);
}

/**
 * Calculate earth curvature drop at a given point
 * @param d1 - Distance from first point
 * @param d2 - Distance to second point
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
 * Line of sight between two points (with full elevation profile).
 */
export async function calculateLOS(pointA: LOSPoint, pointB: LOSPoint, options: LOSOptions = {}): Promise<LOSResult> {
  const totalDistance = haversineMeters(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
  const bearing = initialBearing(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
  const zoom = options.zoom ?? demZoomForExtent(totalDistance);

  const [tiles, layers] = await Promise.all([
    loadTilesForBounds(boundsOf([pointA, pointB]), zoom, options.tilesUrl ?? TERRAIN_CONFIG.url),
    loadCustomLayers(),
  ]);
  const sampler = new TerrainSampler(zoom, tiles, layers);

  const core = evaluateLOS(
    sampler,
    { lat: pointA.lat, lon: pointA.lon, height: pointA.antennaHeight },
    { lat: pointB.lat, lon: pointB.lon, height: pointB.antennaHeight },
    { frequencyMHz: options.frequencyMHz, refractionK: options.refractionK, collectProfile: true }
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
  const confidence: 'high' | 'medium' | 'low' =
    core.status === 'nodata' ? 'low'
      : nullRatio < 0.05 && suspiciousJumps === 0 ? 'high'
        : nullRatio < 0.15 && suspiciousJumps < elevations.length * 0.02 ? 'medium'
          : 'low';

  const obstruction: LOSObstruction | undefined = core.obstruction
    ? {
        ...core.obstruction,
        fresnelIntrusion: options.frequencyMHz
          ? (() => {
              const r = calculateFresnelRadius(core.obstruction.distance, totalDistance - core.obstruction.distance, frequencyToWavelength(options.frequencyMHz));
              return r > 0 ? Math.min(100, (core.obstruction.blockageAmount / r) * 100) : undefined;
            })()
          : undefined,
      }
    : undefined;

  return {
    status: core.status,
    clear: hasLineOfSight(core.status),
    fresnelClear: options.frequencyMHz ? core.status === 'clear' : undefined,
    totalDistance,
    bearing,
    minClearance: core.minClearance,
    minClearanceDistance: core.minClearanceDistance,
    minFresnelClearance: core.minFresnelClearance,
    profile,
    obstruction,
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
function validateLOSInput(
  pointA: LOSPoint,
  pointB: LOSPoint,
  distance: number,
  elevations: Array<number | null>
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check coordinates are valid
  if (pointA.lat < -90 || pointA.lat > 90 || pointB.lat < -90 || pointB.lat > 90) {
    errors.push(i18n.t('los.validation.invalidCoordinates'));
  }

  // Check antenna heights are reasonable
  if (pointA.antennaHeight < 0 || pointA.antennaHeight > 1000) {
    warnings.push(i18n.t('los.validation.antennaHeightA'));
  }
  if (pointB.antennaHeight < 0 || pointB.antennaHeight > 1000) {
    warnings.push(i18n.t('los.validation.antennaHeightB'));
  }

  // Check distance
  if (distance > 200000) {
    warnings.push(i18n.t('los.validation.longDistance'));
  }
  if (distance < 10) {
    warnings.push(i18n.t('los.validation.shortDistance'));
  }

  // Check data quality
  const validCount = elevations.filter(e => e !== null).length;
  const coverage = validCount / elevations.length;

  if (coverage < 0.5) {
    warnings.push(i18n.t('los.validation.partialData', { percent: Math.round(coverage * 100) }));
  }

  // Check for constant elevations (might indicate data issue)
  const uniqueElevations = new Set(elevations.filter(e => e !== null).map(e => Math.round(e!))).size;
  if (uniqueElevations === 1 && elevations.length > 20) {
    warnings.push(i18n.t('los.validation.constantElevation'));
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

export { formatDistance } from './geo';

/**
 * Format frequency for display
 */
export function formatFrequency(mhz: number): string {
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(1)} GHz`;
  return `${mhz} MHz`;
}
