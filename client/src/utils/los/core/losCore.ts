/**
 * The single line-of-sight model used by both the line tool and the area tool.
 *
 * Geometry: straight ray between the two antenna tips over a spherical Earth with
 * effective radius k·R (k = 4/3, standard atmosphere). Clearance at each sample is
 *   ray height − curvature drop − terrain elevation.
 *
 * Sampling: every half DEM pixel along the path, independent of distance (a fixed
 * sample count under-samples long paths and over-samples short ones, which is what
 * made the area tool disagree with the line tool before).
 *
 * Endpoints: samples closer than half a DEM pixel to either end are not treated as
 * obstacles. Terrain detail inside the endpoint's own cell is below the data's
 * resolution, and counting it made almost every target close to the observer red.
 *
 * Result classes:
 *   clear    – ray clears terrain (and, in RF mode, 60 % of the first Fresnel zone)
 *   fresnel  – RF only: ray clears terrain but the Fresnel zone is obstructed
 *   marginal – blocked by less than MARGINAL_CLEARANCE_M. That is within the vertical
 *              error of ~30 m terrain data (which also includes some buildings and
 *              trees), so the answer is genuinely uncertain.
 *   blocked  – blocked by more than that
 *   nodata   – no terrain at an endpoint, or too much of the path missing
 *
 * Pure module, safe to import from workers.
 */

import { TerrainSampler, groundResolution, globalPixelToLngLat, lngLatToGlobalPixel } from './terrain';

export const EARTH_RADIUS_M = 6371000;
export const STANDARD_K = 4 / 3;
export const MARGINAL_CLEARANCE_M = 3;
export const FRESNEL_CLEAR_FRACTION = 0.6;
const SPEED_OF_LIGHT = 299792458;
const MAX_SAMPLES = 20000;
/** More than this share of path samples without terrain data -> 'nodata'. */
const MAX_MISSING_FRACTION = 0.3;

export type LosStatus = 'clear' | 'fresnel' | 'marginal' | 'blocked' | 'nodata';

export interface LosEndpoint {
  lat: number;
  lon: number;
  /** Antenna / observer height above ground, metres. */
  height: number;
}

export interface LosEvalOptions {
  frequencyMHz?: number;
  refractionK?: number;
  marginM?: number;
  /** Collect every sample (for the elevation profile chart). Disables early exit. */
  collectProfile?: boolean;
}

export interface LosProfileSample {
  lat: number;
  lon: number;
  distance: number;
  groundElevation: number | null;
  /** Height of the ray at this point, after the curvature drop. */
  losHeight: number;
  clearance: number | null;
  fresnelRadius?: number;
  fresnelClearance?: number | null;
}

export interface LosObstructionPoint {
  lat: number;
  lon: number;
  distance: number;
  elevation: number;
  blockageAmount: number;
}

export interface LosCoreResult {
  status: LosStatus;
  distance: number;
  startGround: number | null;
  endGround: number | null;
  /** Lowest clearance along the path (negative = blocked by that many metres). */
  minClearance: number | null;
  minClearanceDistance: number;
  /** RF only: lowest (clearance − required Fresnel clearance). */
  minFresnelClearance: number | null;
  obstruction?: LosObstructionPoint;
  samples: number;
  missingSamples: number;
  profile?: LosProfileSample[];
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function classify(minClearance: number | null, minFresnelClearance: number | null, rf: boolean, marginM = MARGINAL_CLEARANCE_M): LosStatus {
  if (minClearance === null) return 'clear';
  if (minClearance < -marginM) return 'blocked';
  if (minClearance < 0) return 'marginal';
  if (rf && minFresnelClearance !== null && minFresnelClearance < 0) return 'fresnel';
  return 'clear';
}

/** True for the classes a user would call "has line of sight". */
export const hasLineOfSight = (status: LosStatus) => status === 'clear' || status === 'fresnel';

export function evaluateLOS(sampler: TerrainSampler, a: LosEndpoint, b: LosEndpoint, options: LosEvalOptions = {}): LosCoreResult {
  const z = sampler.zoom;
  const k = options.refractionK ?? STANDARD_K;
  const marginM = options.marginM ?? MARGINAL_CLEARANCE_M;
  const collect = options.collectProfile === true;
  const lambda = options.frequencyMHz ? SPEED_OF_LIGHT / (options.frequencyMHz * 1e6) : null;

  const distance = haversineMeters(a.lat, a.lon, b.lat, b.lon);
  const pa = lngLatToGlobalPixel(a.lon, a.lat, z);
  const pb = lngLatToGlobalPixel(b.lon, b.lat, z);
  const startGround = sampler.atGlobal(pa.x, pa.y);
  const endGround = sampler.atGlobal(pb.x, pb.y);

  const base = { distance, startGround, endGround, minFresnelClearance: null, samples: 0, missingSamples: 0 };
  if (startGround === null || endGround === null) {
    return { ...base, status: 'nodata', minClearance: null, minClearanceDistance: 0 };
  }

  const h1 = startGround + a.height;
  const h2 = endGround + b.height;
  const pixelM = groundResolution((a.lat + b.lat) / 2, z);
  const n = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(distance / (pixelM / 2))));
  const exclude = pixelM / 2;
  const curvatureDenominator = 2 * EARTH_RADIUS_M * k;

  const profile: LosProfileSample[] | undefined = collect ? [] : undefined;
  if (profile) {
    profile.push({ lat: a.lat, lon: a.lon, distance: 0, groundElevation: startGround, losHeight: h1, clearance: a.height, fresnelRadius: lambda ? 0 : undefined, fresnelClearance: lambda ? a.height : undefined });
  }

  let minClearance = Infinity;
  let minClearanceDistance = 0;
  let minFresnel = Infinity;
  let obstruction: LosObstructionPoint | undefined;
  let missing = 0;
  let earlyBlocked = false;

  for (let i = 1; i < n; i++) {
    const f = i / n;
    const d1 = distance * f;
    const d2 = distance - d1;
    const gx = pa.x + (pb.x - pa.x) * f;
    const gy = pa.y + (pb.y - pa.y) * f;
    const ground = sampler.atGlobal(gx, gy);
    const losHeight = h1 + (h2 - h1) * f - (d1 * d2) / curvatureDenominator;
    const fresnelRadius = lambda ? Math.sqrt((lambda * d1 * d2) / distance) : undefined;

    if (ground === null) {
      missing++;
      if (profile) {
        const ll = globalPixelToLngLat(gx, gy, z);
        profile.push({ lat: ll.lat, lon: ll.lng, distance: d1, groundElevation: null, losHeight, clearance: null, fresnelRadius, fresnelClearance: null });
      }
      continue;
    }

    const clearance = losHeight - ground;
    const fresnelClearance = fresnelRadius !== undefined ? clearance - FRESNEL_CLEAR_FRACTION * fresnelRadius : undefined;

    if (profile) {
      const ll = globalPixelToLngLat(gx, gy, z);
      profile.push({ lat: ll.lat, lon: ll.lng, distance: d1, groundElevation: ground, losHeight, clearance, fresnelRadius, fresnelClearance });
    }

    if (d1 < exclude || d2 < exclude) continue;

    if (clearance < minClearance) {
      minClearance = clearance;
      minClearanceDistance = d1;
      if (clearance < 0) {
        const ll = globalPixelToLngLat(gx, gy, z);
        obstruction = { lat: ll.lat, lon: ll.lng, distance: d1, elevation: ground, blockageAmount: -clearance };
      }
    }
    if (fresnelClearance !== undefined && fresnelClearance < minFresnel) minFresnel = fresnelClearance;

    // Definitely blocked: nothing later on the path can change the class.
    if (!collect && clearance < -marginM) {
      earlyBlocked = true;
      break;
    }
  }

  if (profile) {
    profile.push({ lat: b.lat, lon: b.lon, distance, groundElevation: endGround, losHeight: h2, clearance: b.height, fresnelRadius: lambda ? 0 : undefined, fresnelClearance: lambda ? b.height : undefined });
  }

  const interior = n - 1;
  const minC = minClearance === Infinity ? null : minClearance;
  const minF = minFresnel === Infinity ? null : minFresnel;
  let status: LosStatus;
  if (!earlyBlocked && interior > 0 && missing / interior > MAX_MISSING_FRACTION) status = 'nodata';
  else status = classify(minC, minF, lambda !== null, marginM);

  return {
    status,
    distance,
    startGround,
    endGround,
    minClearance: minC,
    minClearanceDistance,
    minFresnelClearance: minF,
    obstruction,
    samples: interior,
    missingSamples: missing,
    profile,
  };
}
