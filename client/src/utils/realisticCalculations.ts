// Realistic range calculator — accounts for environment and weather conditions
// Extends the basic Friis free-space model with:
//   1. Environment losses (path loss exponent, vegetation, urban clutter, terrain)
//   2. Atmospheric losses (rain, fog, humidity absorption, dust)

import { calculateFSPL, wattToDbm, calculateMaxDistance } from './friisCalculations';
import type { RegionData } from './israelRegions';

// ── Types ──────────────────────────────────────────────────────────────

export interface WeatherData {
  temperature: number;      // Celsius
  humidity: number;         // 0-100 %
  windSpeed: number;        // m/s
  rainMmH: number;          // mm/hour (0 if no rain)
  visibility: number;       // meters
  description: string;      // e.g. "light rain"
  icon: string;             // OpenWeatherMap icon code
  fetchedAt: number;        // Unix timestamp ms
}

export interface EnvironmentLoss {
  pathLossExcessDb: number;
  vegetationDb: number;
  urbanClutterDb: number;
  terrainDb: number;
}

export interface AtmosphericLoss {
  rainDb: number;
  fogDb: number;
  humidityDb: number;
  dustDb: number;
}

export interface RealisticResult {
  realisticDistanceKm: number;
  freeSpaceDistanceKm: number;
  reductionPercent: number;
  totalExtraLossDb: number;
  environmentLoss: EnvironmentLoss;
  atmosphericLoss: AtmosphericLoss;
  freeSpaceFsplDb: number;
  recommendations: string[];   // i18n key suffixes
}

export interface RealisticPowerResult {
  realisticPowerDbm: number;
  freeSpacePowerDbm: number;
  extraLossDb: number;
  environmentLoss: EnvironmentLoss;
  atmosphericLoss: AtmosphericLoss;
  recommendations: string[];
}

// ── Environment Loss Calculation ───────────────────────────────────────

/**
 * Vegetation attenuation factor (dB/km) based on frequency.
 * Simplified ITU-R P.833 model.
 */
function vegetationAttenuationPerKm(frequencyMhz: number): number {
  if (frequencyMhz < 200) return 0.5;
  if (frequencyMhz < 1000) return 1.5;
  if (frequencyMhz < 5000) return 3.0;
  if (frequencyMhz < 10000) return 5.0;
  return 8.0;
}

/**
 * Urban clutter loss (dB) based on density and frequency.
 * Simplified from ITU-R P.1411 and Okumura-Hata concepts.
 */
function urbanClutterLoss(urbanDensity: number, frequencyMhz: number): number {
  if (urbanDensity < 0.05) return 0;
  // Base clutter ranges from 0 to ~20 dB for very dense urban at high freq
  const freqFactor = Math.min(1 + Math.log10(Math.max(frequencyMhz, 100) / 100) * 0.5, 2.5);
  return urbanDensity * 15 * freqFactor;
}

/**
 * Terrain diffraction loss (dB) based on terrain variability and distance.
 * Simplified knife-edge model — more terrain irregularity = more loss.
 */
function terrainDiffractionLoss(terrainVariation: number, distanceKm: number): number {
  if (terrainVariation < 0.05) return 0;
  // Scales with sqrt of distance (diffraction effect)
  return terrainVariation * 6 * Math.sqrt(Math.max(distanceKm, 0.1));
}

export function calculateEnvironmentLoss(
  region: RegionData,
  frequencyMhz: number,
  distanceKm: number
): EnvironmentLoss {
  // Path loss exponent excess: extra dB beyond free-space (n=2)
  // In log-distance model: PL = PL0 + 10*n*log10(d/d0)
  // Excess over free space: 10*(n-2)*log10(d)
  const pathLossExcessDb = distanceKm > 0.01
    ? 10 * (region.pathLossExponent - 2) * Math.log10(Math.max(distanceKm, 0.01))
    : 0;

  // Vegetation loss: factor × attenuation per km × distance (capped)
  const vegPerKm = vegetationAttenuationPerKm(frequencyMhz);
  const vegetationDb = region.vegetationFactor * vegPerKm * Math.min(distanceKm, 10);

  // Urban clutter
  const urbanClutterDb = urbanClutterLoss(region.urbanDensity, frequencyMhz);

  // Terrain diffraction
  const terrainDb = terrainDiffractionLoss(region.terrainVariation, distanceKm);

  return {
    pathLossExcessDb: Math.max(0, pathLossExcessDb),
    vegetationDb: Math.max(0, vegetationDb),
    urbanClutterDb: Math.max(0, urbanClutterDb),
    terrainDb: Math.max(0, terrainDb),
  };
}

// ── Atmospheric Loss Calculation ───────────────────────────────────────

// ITU-R P.838-3 coefficients (horizontal polarisation) for specific rain attenuation
// γ = k · R^α  (dB/km, R in mm/h). Interpolated linearly in log(f) for log(k) and α.
const P838_TABLE: ReadonlyArray<readonly [fGHz: number, k: number, alpha: number]> = [
  [1, 0.0000259, 0.9691],
  [1.5, 0.0000443, 1.0185],
  [2, 0.0000847, 1.0664],
  [2.5, 0.0001321, 1.1209],
  [3, 0.000139, 1.2322],
  [3.5, 0.0001155, 1.4189],
  [4, 0.0001071, 1.6009],
  [4.5, 0.000134, 1.6948],
  [5, 0.0002162, 1.6969],
  [5.5, 0.0003909, 1.6499],
  [6, 0.0007056, 1.59],
  [7, 0.001915, 1.481],
  [8, 0.004115, 1.3905],
  [9, 0.007535, 1.3155],
  [10, 0.01217, 1.2571],
  [12, 0.02386, 1.1825],
  [15, 0.04481, 1.1233],
  [20, 0.09164, 1.0568],
  [25, 0.1571, 0.9991],
  [30, 0.2403, 0.9485],
  [35, 0.3374, 0.9047],
  [40, 0.4431, 0.8673],
  [50, 0.66, 0.8084],
  [60, 0.8606, 0.7656],
  [70, 1.0315, 0.7345],
  [80, 1.1704, 0.7115],
  [90, 1.2807, 0.6944],
  [100, 1.3671, 0.6815],
];

/** k and α of ITU-R P.838-3 for a frequency (GHz). */
export function rainCoefficients(fGHz: number): { k: number; alpha: number } {
  const first = P838_TABLE[0];
  const last = P838_TABLE[P838_TABLE.length - 1];
  if (fGHz <= first[0]) {
    // Below 1 GHz rain attenuation is negligible; k falls off roughly as f².
    return { k: first[1] * (fGHz / first[0]) ** 2, alpha: first[2] };
  }
  if (fGHz >= last[0]) return { k: last[1], alpha: last[2] };

  for (let i = 1; i < P838_TABLE.length; i++) {
    const [f1, k1, a1] = P838_TABLE[i - 1];
    const [f2, k2, a2] = P838_TABLE[i];
    if (fGHz <= f2) {
      const t = Math.log10(fGHz / f1) / Math.log10(f2 / f1);
      return {
        k: 10 ** (Math.log10(k1) + t * (Math.log10(k2) - Math.log10(k1))),
        alpha: a1 + t * (a2 - a1),
      };
    }
  }
  return { k: last[1], alpha: last[2] };
}

/**
 * Rain attenuation (dB): ITU-R P.838-3 specific attenuation times an effective path
 * length (rain cells are smaller than long links; distance factor from ITU-R P.530).
 */
export function rainAttenuation(rainMmH: number, frequencyMhz: number, distanceKm: number): number {
  if (rainMmH <= 0 || distanceKm <= 0) return 0;
  const { k, alpha } = rainCoefficients(frequencyMhz / 1000);
  const specificDbPerKm = k * rainMmH ** alpha;
  const d0 = 35 * Math.exp(-0.015 * Math.min(rainMmH, 100));
  const effectiveDistance = distanceKm / (1 + distanceKm / d0);
  return specificDbPerKm * effectiveDistance;
}

/**
 * Specific attenuation coefficient of liquid water in cloud/fog, ITU-R P.840
 * (double-Debye model). Returns (dB/km)/(g/m³).
 */
export function fogSpecificCoefficient(fGHz: number, temperatureC: number): number {
  const theta = 300 / (temperatureC + 273.15);
  const e0 = 77.66 + 103.3 * (theta - 1);
  const e1 = 0.0671 * e0;
  const e2 = 3.52;
  const fp = 20.2 - 146 * (theta - 1) + 316 * (theta - 1) ** 2;
  const fs = 39.8 * fp;
  const ePrime2 = (fGHz * (e0 - e1)) / (fp * (1 + (fGHz / fp) ** 2)) + (fGHz * (e1 - e2)) / (fs * (1 + (fGHz / fs) ** 2));
  const ePrime = (e0 - e1) / (1 + (fGHz / fp) ** 2) + (e1 - e2) / (1 + (fGHz / fs) ** 2) + e2;
  const eta = (2 + ePrime) / ePrime2;
  return (0.819 * fGHz) / (ePrime2 * (1 + eta ** 2));
}

/**
 * Fog attenuation (dB). Liquid water content is estimated from visibility
 * (M = (0.024 / V_km)^1.54 g/m³, Eldridge) and only applied in actual fog (V < 1 km).
 * Fog banks are local, so at most 10 km of the path is assumed to be in fog.
 */
export function fogAttenuation(visibilityM: number, frequencyMhz: number, distanceKm: number, temperatureC = 15): number {
  if (visibilityM >= 1000 || distanceKm <= 0) return 0;
  const visibilityKm = Math.max(visibilityM, 10) / 1000;
  const liquidWater = (0.024 / visibilityKm) ** 1.54;
  return fogSpecificCoefficient(frequencyMhz / 1000, temperatureC) * liquidWater * Math.min(distanceKm, 10);
}

/** Water-vapour density (g/m³) from relative humidity and temperature (Magnus formula). */
export function waterVapourDensity(humidityPercent: number, temperatureC: number): number {
  const saturationHpa = 6.1121 * Math.exp((17.502 * temperatureC) / (temperatureC + 240.97));
  const vapourHpa = (Math.min(Math.max(humidityPercent, 0), 100) / 100) * saturationHpa;
  return (216.7 * vapourHpa) / (temperatureC + 273.15);
}

/**
 * Water-vapour absorption (dB), simplified ITU-R P.676 sea-level model (valid < 350 GHz).
 * Negligible below a few GHz; peaks around the 22 GHz water line.
 */
export function humidityAbsorption(humidityPercent: number, frequencyMhz: number, distanceKm: number, temperatureC = 15): number {
  if (distanceKm <= 0 || humidityPercent <= 0) return 0;
  const f = Math.min(frequencyMhz / 1000, 350);
  const rho = waterVapourDensity(humidityPercent, temperatureC);
  const gammaW =
    (0.05 + 0.0021 * rho + 3.6 / ((f - 22.2) ** 2 + 8.5) + 10.6 / ((f - 183.3) ** 2 + 9.0) + 8.9 / ((f - 325.4) ** 2 + 26.3)) *
    f ** 2 *
    rho *
    1e-4;
  return gammaW * distanceKm;
}

/**
 * Dust / sand attenuation (dB) — engineering approximation for desert regions.
 * Measured values are ~0.1–1 dB/km at 10 GHz in severe storms (visibility tens of metres)
 * and scale roughly with frequency and inversely with visibility. Applied only when
 * visibility is reduced, weighted by how likely dust is the cause in this region.
 */
export function dustAttenuation(dustProbability: number, visibilityM: number, frequencyMhz: number, distanceKm: number): number {
  if (dustProbability < 0.1 || visibilityM >= 8000 || distanceKm <= 0) return 0;
  const visibilityKm = Math.max(visibilityM, 10) / 1000;
  const specificDbPerKm = Math.min((1.5e-3 * (frequencyMhz / 1000)) / visibilityKm, 5);
  return dustProbability * specificDbPerKm * Math.min(distanceKm, 15);
}

export function calculateAtmosphericLoss(
  region: RegionData,
  weather: WeatherData,
  frequencyMhz: number,
  distanceKm: number
): AtmosphericLoss {
  return {
    rainDb: Math.max(0, rainAttenuation(weather.rainMmH, frequencyMhz, distanceKm)),
    fogDb: Math.max(0, fogAttenuation(weather.visibility, frequencyMhz, distanceKm, weather.temperature)),
    humidityDb: Math.max(0, humidityAbsorption(weather.humidity, frequencyMhz, distanceKm, weather.temperature)),
    dustDb: Math.max(0, dustAttenuation(region.dustProbability, weather.visibility, frequencyMhz, distanceKm)),
  };
}

// ── Total Extra Loss ───────────────────────────────────────────────────

function totalEnvironmentLoss(e: EnvironmentLoss): number {
  return e.pathLossExcessDb + e.vegetationDb + e.urbanClutterDb + e.terrainDb;
}

function totalAtmosphericLoss(a: AtmosphericLoss): number {
  return a.rainDb + a.fogDb + a.humidityDb + a.dustDb;
}

// ── Iterative Realistic Distance Solver ────────────────────────────────

/**
 * Total path loss at a given distance including environment + atmosphere.
 */
function totalPathLoss(
  distanceKm: number,
  frequencyMhz: number,
  region: RegionData,
  weather: WeatherData
): number {
  if (distanceKm <= 0) return 0;
  const fspl = calculateFSPL(distanceKm, frequencyMhz);
  const env = calculateEnvironmentLoss(region, frequencyMhz, distanceKm);
  const atmos = calculateAtmosphericLoss(region, weather, frequencyMhz, distanceKm);
  return fspl + region.baseAttenuation + totalEnvironmentLoss(env) + totalAtmosphericLoss(atmos);
}

/**
 * Binary search for the maximum distance where total loss equals the link budget.
 * Since total loss is monotonically increasing with distance, binary search works.
 */
function findRealisticDistance(
  linkBudgetDb: number,
  frequencyMhz: number,
  region: RegionData,
  weather: WeatherData,
  maxSearchKm: number
): number {
  let lo = 0.001; // 1 meter
  let hi = maxSearchKm * 2; // Search up to 2x free-space distance
  const maxIterations = 50;

  for (let i = 0; i < maxIterations; i++) {
    const mid = (lo + hi) / 2;
    const loss = totalPathLoss(mid, frequencyMhz, region, weather);

    if (Math.abs(loss - linkBudgetDb) < 0.01) {
      return mid;
    }

    if (loss < linkBudgetDb) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}

// ── Main Calculation Functions ─────────────────────────────────────────

export function calculateRealisticMaxDistance(
  txPowerWatts: number,
  txGainDbi: number,
  rxGainDbi: number,
  frequencyMhz: number,
  rxSensitivityDbm: number,
  region: RegionData,
  weather: WeatherData
): RealisticResult {
  // 1. Free-space result (existing Friis)
  const fsResult = calculateMaxDistance(txPowerWatts, txGainDbi, rxGainDbi, frequencyMhz, rxSensitivityDbm);
  const freeSpaceDistanceKm = fsResult.distanceKm;

  // 2. Link budget
  const txPowerDbm = wattToDbm(txPowerWatts);
  const linkBudgetDb = txPowerDbm + txGainDbi + rxGainDbi - rxSensitivityDbm;

  // 3. Find realistic distance via binary search
  const realisticDistanceKm = findRealisticDistance(
    linkBudgetDb,
    frequencyMhz,
    region,
    weather,
    freeSpaceDistanceKm
  );

  // 4. Calculate loss breakdown at realistic distance
  const environmentLoss = calculateEnvironmentLoss(region, frequencyMhz, realisticDistanceKm);
  const atmosphericLoss = calculateAtmosphericLoss(region, weather, frequencyMhz, realisticDistanceKm);
  const totalExtraLossDb = region.baseAttenuation +
    totalEnvironmentLoss(environmentLoss) + totalAtmosphericLoss(atmosphericLoss);
  const freeSpaceFsplDb = calculateFSPL(realisticDistanceKm, frequencyMhz);

  // 5. Reduction percentage
  const reductionPercent = freeSpaceDistanceKm > 0
    ? ((freeSpaceDistanceKm - realisticDistanceKm) / freeSpaceDistanceKm) * 100
    : 0;

  // 6. Recommendations
  const recommendations = generateRecommendations(region, weather, frequencyMhz, reductionPercent);

  return {
    realisticDistanceKm,
    freeSpaceDistanceKm,
    reductionPercent,
    totalExtraLossDb,
    environmentLoss,
    atmosphericLoss,
    freeSpaceFsplDb,
    recommendations,
  };
}

export function calculateRealisticReceivedPower(
  txPowerWatts: number,
  txGainDbi: number,
  rxGainDbi: number,
  frequencyMhz: number,
  distanceKm: number,
  region: RegionData,
  weather: WeatherData
): RealisticPowerResult {
  // 1. Free-space received power
  const txPowerDbm = wattToDbm(txPowerWatts);
  const totalGain = txGainDbi + rxGainDbi;
  const fspl = calculateFSPL(distanceKm, frequencyMhz);
  const freeSpacePowerDbm = txPowerDbm + totalGain - fspl;

  // 2. Environment + atmospheric losses
  const environmentLoss = calculateEnvironmentLoss(region, frequencyMhz, distanceKm);
  const atmosphericLoss = calculateAtmosphericLoss(region, weather, frequencyMhz, distanceKm);
  const extraLossDb = region.baseAttenuation +
    totalEnvironmentLoss(environmentLoss) + totalAtmosphericLoss(atmosphericLoss);

  // 3. Realistic received power
  const realisticPowerDbm = freeSpacePowerDbm - extraLossDb;

  // 4. Recommendations. Express the extra loss as the equivalent range reduction, the same
  // quantity the max-distance mode reports, so both modes share the recommendation thresholds.
  const reductionPercent = extraLossToRangeReductionPercent(extraLossDb);
  const recommendations = generateRecommendations(region, weather, frequencyMhz, reductionPercent);

  return {
    realisticPowerDbm,
    freeSpacePowerDbm,
    extraLossDb,
    environmentLoss,
    atmosphericLoss,
    recommendations,
  };
}

/**
 * Range reduction (%) equivalent to an extra loss, for a free-space (20 dB/decade) link:
 * d_new / d_old = 10^(-L/20).
 */
export function extraLossToRangeReductionPercent(extraLossDb: number): number {
  if (extraLossDb <= 0) return 0;
  return (1 - 10 ** (-extraLossDb / 20)) * 100;
}

// ── Recommendations ────────────────────────────────────────────────────

function generateRecommendations(
  region: RegionData,
  weather: WeatherData,
  frequencyMhz: number,
  reductionPercent: number
): string[] {
  const recs: string[] = [];

  // Rain
  if (weather.rainMmH > 2) {
    recs.push('rain');
  }

  // Fog / low visibility
  if (weather.visibility < 3000) {
    recs.push('fog');
  }

  // Dense urban — suggest elevating antennas
  if (region.urbanDensity > 0.5) {
    recs.push('elevateAntennas');
  }

  // High vegetation + high frequency — suggest lower frequency
  if (region.vegetationFactor > 0.4 && frequencyMhz > 2000) {
    recs.push('lowerFrequency');
  }

  // Dust risk
  if (region.dustProbability > 0.3 && weather.visibility < 8000) {
    recs.push('dust');
  }

  // Mountainous terrain
  if (region.terrainVariation > 0.6) {
    recs.push('terrain');
  }

  // High overall reduction
  if (reductionPercent > 30) {
    recs.push('addMargin');
  }

  return recs;
}
