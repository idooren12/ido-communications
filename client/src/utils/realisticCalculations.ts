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

/**
 * Rain attenuation (dB) based on rain rate, frequency, and distance.
 * Simplified ITU-R P.838 model.
 */
function rainAttenuation(rainMmH: number, frequencyMhz: number, distanceKm: number): number {
  if (rainMmH <= 0) return 0;

  let specificAtten: number; // dB/km per mm/h
  if (frequencyMhz < 1000) {
    // VHF/UHF — minimal rain effect
    specificAtten = 0.01;
  } else if (frequencyMhz < 5000) {
    // Low microwave
    specificAtten = 0.03;
  } else if (frequencyMhz < 10000) {
    // Mid microwave
    specificAtten = 0.05;
  } else if (frequencyMhz < 30000) {
    // High microwave
    specificAtten = 0.15;
  } else {
    // mmWave
    specificAtten = 0.3;
  }

  // Effective path length reduction for longer distances
  const effectiveDistance = distanceKm * (1 / (1 + distanceKm / 35));
  return rainMmH * specificAtten * effectiveDistance;
}

/**
 * Fog / low visibility attenuation (dB).
 * When visibility drops below 10 km, signal propagation is affected.
 */
function fogAttenuation(visibility: number, frequencyMhz: number, distanceKm: number): number {
  if (visibility >= 10000) return 0;

  // Fog is most impactful at higher frequencies
  const freqFactor = frequencyMhz > 10000 ? 2.0 : frequencyMhz > 3000 ? 1.0 : 0.3;
  // Loss scales inversely with visibility
  const visibilityKm = visibility / 1000;
  const lossPerKm = freqFactor * (1 - visibilityKm / 10);
  return Math.max(0, lossPerKm * Math.min(distanceKm, 20));
}

/**
 * Humidity absorption (dB).
 * Water vapor causes molecular absorption, especially above 10 GHz.
 * Simplified model for planning purposes.
 */
function humidityAbsorption(humidity: number, frequencyMhz: number, distanceKm: number): number {
  if (humidity <= 50) return 0;

  // Excess humidity above 50%
  const excessHumidity = (humidity - 50) / 100;

  // Frequency-dependent factor
  let freqFactor: number;
  if (frequencyMhz < 2000) freqFactor = 0.01;
  else if (frequencyMhz < 10000) freqFactor = 0.03;
  else if (frequencyMhz < 30000) freqFactor = 0.08;
  else freqFactor = 0.15;

  return excessHumidity * freqFactor * distanceKm * 10;
}

/**
 * Dust / sand attenuation (dB).
 * Relevant primarily for desert regions (Negev, Arava, etc.).
 */
function dustAttenuation(
  dustProbability: number,
  visibility: number,
  frequencyMhz: number,
  distanceKm: number
): number {
  if (dustProbability < 0.1) return 0;
  // Only apply if visibility is reduced (possible dust condition)
  if (visibility >= 8000) return 0;

  const freqFactor = frequencyMhz > 10000 ? 2.0 : frequencyMhz > 3000 ? 1.0 : 0.5;
  const visReduction = (8000 - visibility) / 8000;
  return dustProbability * freqFactor * visReduction * 5 * Math.min(distanceKm, 15);
}

export function calculateAtmosphericLoss(
  region: RegionData,
  weather: WeatherData,
  frequencyMhz: number,
  distanceKm: number
): AtmosphericLoss {
  return {
    rainDb: Math.max(0, rainAttenuation(weather.rainMmH, frequencyMhz, distanceKm)),
    fogDb: Math.max(0, fogAttenuation(weather.visibility, frequencyMhz, distanceKm)),
    humidityDb: Math.max(0, humidityAbsorption(weather.humidity, frequencyMhz, distanceKm)),
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

  // 4. Recommendations
  const reductionPercent = freeSpacePowerDbm !== 0
    ? (extraLossDb / Math.abs(freeSpacePowerDbm)) * 100
    : 0;
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
