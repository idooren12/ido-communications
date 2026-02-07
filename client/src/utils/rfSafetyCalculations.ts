/**
 * RF Safety Distance Calculator
 * Based on ICNIRP 2020 reference levels
 *
 * Formula: R = sqrt(P * G_linear / (4 * pi * S))
 * Where:
 *   R = safe distance (meters)
 *   P = transmitter power (watts)
 *   G_linear = antenna gain (linear, not dBi)
 *   S = allowed power density (W/m^2)
 */

export type PopulationType = 'public' | 'occupational';

/**
 * Get ICNIRP power density limit based on frequency and population type
 * @param frequencyMhz - Frequency in MHz
 * @param population - 'public' (general) or 'occupational' (workers)
 * @returns Power density limit in W/m^2
 */
export function getICNIRPLimit(frequencyMhz: number, population: PopulationType): number {
  if (frequencyMhz >= 10 && frequencyMhz <= 400) {
    return population === 'occupational' ? 10 : 2;
  } else if (frequencyMhz > 400 && frequencyMhz <= 2000) {
    const base = frequencyMhz / 200;
    return population === 'occupational' ? base * 5 : base;
  } else if (frequencyMhz > 2000 && frequencyMhz <= 300000) {
    return population === 'occupational' ? 50 : 10;
  }
  // Default for out-of-range frequencies
  return population === 'occupational' ? 10 : 2;
}

/**
 * Convert dBi to linear gain multiplier
 */
export function dbiToLinear(dbi: number): number {
  return Math.pow(10, dbi / 10);
}

/**
 * Calculate EIRP (Effective Isotropic Radiated Power)
 */
export function calculateEIRP(powerWatts: number, gainDbi: number): number {
  return powerWatts * dbiToLinear(gainDbi);
}

export interface RFSafetyResult {
  safeDistanceMeters: number;
  eirpWatts: number;
  gainLinear: number;
  powerDensityLimit: number;
  powerWatts: number;
  gainDbi: number;
}

/**
 * Calculate safe distance from a transmitting antenna
 * R = sqrt(EIRP / (4 * pi * S))
 */
export function calculateSafeDistance(
  powerWatts: number,
  gainDbi: number,
  powerDensityLimit: number
): RFSafetyResult {
  const gainLinear = dbiToLinear(gainDbi);
  const eirpWatts = powerWatts * gainLinear;
  const safeDistanceMeters = Math.sqrt(eirpWatts / (4 * Math.PI * powerDensityLimit));

  return {
    safeDistanceMeters,
    eirpWatts,
    gainLinear,
    powerDensityLimit,
    powerWatts,
    gainDbi,
  };
}

/**
 * Common frequency presets with their ICNIRP limits
 */
export const FREQUENCY_PRESETS = [
  { label: '144 MHz (VHF)', mhz: 144 },
  { label: '433 MHz (UHF)', mhz: 433 },
  { label: '900 MHz (GSM)', mhz: 900 },
  { label: '2400 MHz (WiFi)', mhz: 2400 },
  { label: '5800 MHz (WiFi 5G)', mhz: 5800 },
] as const;
