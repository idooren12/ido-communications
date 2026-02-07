/**
 * Line of Sight calculation utilities
 * Supports optical and RF calculations with Fresnel zone
 */

import { haversineDistance, initialBearing, interpolateGreatCircle, type LatLon } from './geo';
import { batchSampleElevations, type EncodingType } from './elevation';
import { TERRAIN_CONFIG } from './constants';

// Re-export geo functions for backwards compatibility
export { haversineDistance, initialBearing as calculateBearing } from './geo';

// Speed of light in m/s
const SPEED_OF_LIGHT = 299792458;
const EARTH_RADIUS = 6371000;

export const K_FACTORS = {
  standard: 1.33,    // 4/3 Earth radius for standard atmosphere
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
  earthRadius?: number;
  refractionK?: number;
  sampleStepMeters?: number;
  minSamples?: number;
  maxSamples?: number;           // Now defaults to unlimited
  frequencyMHz?: number;         // RF frequency for Fresnel calculation
  fresnelZonePercent?: number;   // What % of Fresnel zone must be clear (default 60%)
  tilesUrl?: string;
  encoding?: EncodingType;
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
 * Main LOS calculation - optimized with batch sampling
 */
export async function calculateLOS(
  pointA: LOSPoint,
  pointB: LOSPoint,
  getElevation?: (lat: number, lon: number) => Promise<number | null>,
  options: LOSOptions = {}
): Promise<LOSResult> {
  const {
    earthRadius = EARTH_RADIUS,
    refractionK = K_FACTORS.standard,
    sampleStepMeters = 30,
    minSamples = 10,
    maxSamples = 10000,  // Effectively unlimited for most cases
    frequencyMHz,
    fresnelZonePercent = 60,
    tilesUrl = TERRAIN_CONFIG.url,
    encoding = TERRAIN_CONFIG.encoding,
  } = options;

  const totalDistance = haversineDistance(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
  const bearing = initialBearing(pointA.lat, pointA.lon, pointB.lat, pointB.lon);

  // Calculate number of samples - no artificial limit, based on DSM resolution
  const calculatedSamples = Math.ceil(totalDistance / sampleStepMeters);
  const numSamples = Math.max(minSamples, Math.min(maxSamples, calculatedSamples));

  // Calculate wavelength if frequency provided
  const wavelength = frequencyMHz ? frequencyToWavelength(frequencyMHz) : undefined;

  // Generate all sample points first
  const samplePoints: Array<{ lat: number; lon: number; distance: number; fraction: number }> = [];

  for (let i = 0; i <= numSamples; i++) {
    const fraction = i / numSamples;
    const point = interpolateGreatCircle(
      { lat: pointA.lat, lon: pointA.lon },
      { lat: pointB.lat, lon: pointB.lon },
      fraction
    );
    samplePoints.push({
      lat: point.lat,
      lon: point.lon,
      distance: totalDistance * fraction,
      fraction,
    });
  }

  // Batch sample all elevations at once - MUCH faster!
  let elevations: Array<number | null>;

  if (getElevation) {
    // Legacy mode: use provided function (for backwards compatibility)
    elevations = await Promise.all(
      samplePoints.map(p => getElevation(p.lat, p.lon))
    );
  } else {
    // New mode: use batch sampling
    const zoom = calculateOptimalZoom(totalDistance);
    elevations = await batchSampleElevations(
      samplePoints.map(p => ({ lng: p.lon, lat: p.lat })),
      zoom,
      tilesUrl,
      encoding
    );
  }

  // Get endpoint elevations
  const startGroundElev = elevations[0] ?? 0;
  const endGroundElev = elevations[elevations.length - 1] ?? 0;

  const startHeight = startGroundElev + pointA.antennaHeight;
  const endHeight = endGroundElev + pointB.antennaHeight;

  // Process all points
  const profile: LOSProfilePoint[] = [];
  let minClearance: number | null = null;
  let minClearanceDistance = 0;
  let minFresnelClearance: number | null = null;
  let obstruction: LOSObstruction | undefined;
  let nullSamples = 0;

  for (let i = 0; i < samplePoints.length; i++) {
    const { lat, lon, distance, fraction } = samplePoints[i];
    const groundElevation = elevations[i];

    if (groundElevation === null) {
      nullSamples++;
    }

    // Calculate curvature drop
    const d1 = distance;
    const d2 = totalDistance - distance;
    const curvatureDrop = calculateCurvatureDrop(d1, d2, earthRadius, refractionK);

    // LOS line height at this point
    const losHeight = startHeight + (endHeight - startHeight) * fraction - curvatureDrop;

    // Calculate clearance
    const clearance = groundElevation !== null ? losHeight - groundElevation : null;

    // Calculate Fresnel zone if frequency provided
    let fresnelRadius: number | undefined;
    let fresnelClearance: number | null | undefined;

    if (wavelength && d1 > 0 && d2 > 0) {
      fresnelRadius = calculateFresnelRadius(d1, d2, wavelength);
      if (clearance !== null) {
        // Fresnel clearance: how much of the required Fresnel zone is clear
        const requiredClearance = fresnelRadius * (fresnelZonePercent / 100);
        fresnelClearance = clearance - requiredClearance;

        if (minFresnelClearance === null || fresnelClearance < minFresnelClearance) {
          minFresnelClearance = fresnelClearance;
        }
      }
    }

    profile.push({
      lat,
      lon,
      distance,
      groundElevation,
      losHeight,
      clearance,
      fresnelRadius,
      fresnelClearance,
    });

    // Track minimum clearance
    if (clearance !== null) {
      if (minClearance === null || clearance < minClearance) {
        minClearance = clearance;
        minClearanceDistance = distance;

        if (clearance < 0 && (!obstruction || -clearance > obstruction.blockageAmount)) {
          const fresnelIntrusion = fresnelRadius
            ? Math.min(100, (-clearance / fresnelRadius) * 100)
            : undefined;

          obstruction = {
            lat,
            lon,
            distance,
            elevation: groundElevation!,
            blockageAmount: -clearance,
            fresnelIntrusion,
          };
        }
      }
    }
  }

  // Calculate confidence details
  const validElevations = elevations.filter((e): e is number => e !== null);
  const dataCompleteness = validElevations.length / elevations.length;

  // Calculate elevation variance
  let elevationVariance = 0;
  if (validElevations.length > 1) {
    const mean = validElevations.reduce((a, b) => a + b, 0) / validElevations.length;
    const squaredDiffs = validElevations.map(v => Math.pow(v - mean, 2));
    elevationVariance = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / validElevations.length);
  }

  // Count suspicious jumps (elevation changes that seem unrealistic)
  const stepDistance = totalDistance / numSamples;
  const maxReasonableChange = 500 * (stepDistance / 30); // 500m per 30m is very steep
  let suspiciousJumps = 0;
  let prevValid: number | null = null;
  for (const elev of elevations) {
    if (elev !== null) {
      if (prevValid !== null && Math.abs(elev - prevValid) > maxReasonableChange) {
        suspiciousJumps++;
      }
      prevValid = elev;
    }
  }

  const confidenceDetails: ConfidenceDetails = {
    dataCompleteness,
    elevationVariance,
    suspiciousJumps,
    interpolatedPoints: nullSamples,
  };

  // Determine confidence based on multiple factors
  const nullRatio = nullSamples / samplePoints.length;
  let confidence: 'high' | 'medium' | 'low';

  if (nullRatio < 0.05 && suspiciousJumps === 0) {
    confidence = 'high';
  } else if (nullRatio < 0.15 && suspiciousJumps < samplePoints.length * 0.02) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // Validation
  const validation = validateLOSInput(pointA, pointB, totalDistance, elevations);

  // Determine if LOS is clear
  const clear = obstruction === undefined && (minClearance === null || minClearance >= 0);

  // Determine if Fresnel zone is clear (for RF)
  const fresnelClear = wavelength
    ? (minFresnelClearance === null || minFresnelClearance >= 0)
    : undefined;

  return {
    clear,
    fresnelClear,
    totalDistance,
    bearing,
    minClearance,
    minClearanceDistance,
    minFresnelClearance,
    profile,
    obstruction,
    confidence,
    confidenceDetails,
    nullSamples,
    totalSamples: samplePoints.length,
    frequencyMHz,
    validation,
  };
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
    errors.push('\u05E7\u05D5\u05D0\u05D5\u05E8\u05D3\u05D9\u05E0\u05D8\u05D5\u05EA \u05DC\u05D0 \u05D7\u05D5\u05E7\u05D9\u05D5\u05EA');
  }

  // Check antenna heights are reasonable
  if (pointA.antennaHeight < 0 || pointA.antennaHeight > 1000) {
    warnings.push('\u05D2\u05D5\u05D1\u05D4 \u05D0\u05E0\u05D8\u05E0\u05D4 A \u05D7\u05E8\u05D9\u05D2');
  }
  if (pointB.antennaHeight < 0 || pointB.antennaHeight > 1000) {
    warnings.push('\u05D2\u05D5\u05D1\u05D4 \u05D0\u05E0\u05D8\u05E0\u05D4 B \u05D7\u05E8\u05D9\u05D2');
  }

  // Check distance
  if (distance > 200000) {
    warnings.push('\u05DE\u05E8\u05D7\u05E7 \u05D2\u05D3\u05D5\u05DC \u05DE-200 \u05E7"\u05DE - \u05D3\u05D9\u05D5\u05E7 \u05E2\u05E9\u05D5\u05D9 \u05DC\u05E8\u05D3\u05EA');
  }
  if (distance < 10) {
    warnings.push('\u05DE\u05E8\u05D7\u05E7 \u05E7\u05E6\u05E8 \u05DE\u05D0\u05D5\u05D3 - \u05D9\u05D9\u05EA\u05DB\u05DF \u05E9\u05D0\u05D9\u05DF \u05E6\u05D5\u05E8\u05DA \u05D1\u05D7\u05D9\u05E9\u05D5\u05D1 LOS');
  }

  // Check data quality
  const validCount = elevations.filter(e => e !== null).length;
  const coverage = validCount / elevations.length;

  if (coverage < 0.5) {
    warnings.push(`\u05E0\u05EA\u05D5\u05E0\u05D9 \u05D2\u05D5\u05D1\u05D4 \u05D7\u05DC\u05E7\u05D9\u05D9\u05DD (${Math.round(coverage * 100)}% \u05D1\u05DC\u05D1\u05D3)`);
  }

  // Check for constant elevations (might indicate data issue)
  const uniqueElevations = new Set(elevations.filter(e => e !== null).map(e => Math.round(e!))).size;
  if (uniqueElevations === 1 && elevations.length > 20) {
    warnings.push('\u05DB\u05DC \u05E0\u05E7\u05D5\u05D3\u05D5\u05EA \u05D4\u05D2\u05D5\u05D1\u05D4 \u05D6\u05D4\u05D5\u05EA - \u05D9\u05D9\u05EA\u05DB\u05DF \u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD');
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Calculate optimal zoom level based on distance
 * Higher zoom = more detail but more tiles to load
 */
function calculateOptimalZoom(distanceMeters: number): number {
  // At zoom 12, one tile covers ~38m per pixel at equator
  // We want ~30m resolution, so zoom 12-13 is good
  // But for very long distances, use lower zoom to reduce tile count

  if (distanceMeters > 100000) return 10;      // >100km
  if (distanceMeters > 50000) return 11;       // >50km
  if (distanceMeters > 10000) return 12;       // >10km
  return 13;                                    // <10km
}

/**
 * Quick LOS check without full profile (faster for area calculations)
 */
export async function quickLOSCheck(
  pointA: LOSPoint,
  pointB: LOSPoint,
  options: LOSOptions = {}
): Promise<{ clear: boolean; confidence: 'high' | 'medium' | 'low' }> {
  // Use larger step for quick check
  const quickOptions = {
    ...options,
    sampleStepMeters: options.sampleStepMeters || 100,
    maxSamples: 100,
  };

  const result = await calculateLOS(pointA, pointB, undefined, quickOptions);
  return { clear: result.clear, confidence: result.confidence };
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} \u05DE'`;
  return `${(meters / 1000).toFixed(2)} \u05E7"\u05DE`;
}

/**
 * Format frequency for display
 */
export function formatFrequency(mhz: number): string {
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(1)} GHz`;
  return `${mhz} MHz`;
}
