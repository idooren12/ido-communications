/**
 * RF Safety Distance Calculator
 *
 * Far-field power density estimate (FCC OET Bulletin 65, eq. 3/6):
 *   S = F · EIRP / (4 · π · R²)   →   R = sqrt(F · EIRP / (4 · π · S))
 * where
 *   EIRP = P · G_linear           (W)
 *   S    = allowed power density  (W/m²)
 *   F    = ground-reflection factor: 1 (free space) or 2.56 (a reflected ray adding in
 *          phase can raise the field by up to 1.6×, i.e. power density by 1.6² = 2.56).
 *
 * Power-density limits: ICNIRP 2020 reference levels, whole-body exposure averaged
 * over 30 minutes (Table 5 / Table 6 of the guidelines).
 */

export type PopulationType = 'public' | 'occupational';

/** OET-65 ground-reflection factor (1.6² — reflected field adding in phase). */
export const GROUND_REFLECTION_FACTOR = 2.56;

/** ICNIRP 2020 reference levels cover 100 kHz – 300 GHz. */
export const ICNIRP_MIN_MHZ = 0.1;
export const ICNIRP_MAX_MHZ = 300_000;

export interface ICNIRPLimit {
  /** Power density limit, W/m². */
  limit: number;
  /**
   * True below 30 MHz: ICNIRP 2020 sets E/H-field limits there, not a power density.
   * The value returned is the 30 MHz power density, which is stricter than the plane-wave
   * equivalent of the HF field limits (conservative), and at HF the "safe distance" is
   * usually inside the reactive near field, where the far-field formula does not hold.
   */
  approximate: boolean;
}

/**
 * ICNIRP 2020 power-density reference level for a frequency, or null when the frequency
 * is outside the range the guidelines cover.
 */
export function getICNIRPLimit(frequencyMhz: number, population: PopulationType): ICNIRPLimit | null {
  if (!Number.isFinite(frequencyMhz) || frequencyMhz < ICNIRP_MIN_MHZ || frequencyMhz > ICNIRP_MAX_MHZ) {
    return null;
  }

  const occupational = population === 'occupational';

  if (frequencyMhz <= 30) {
    return { limit: occupational ? 10 : 2, approximate: true };
  }
  if (frequencyMhz <= 400) {
    return { limit: occupational ? 10 : 2, approximate: false };
  }
  if (frequencyMhz <= 2000) {
    return { limit: occupational ? frequencyMhz / 40 : frequencyMhz / 200, approximate: false };
  }
  return { limit: occupational ? 50 : 10, approximate: false };
}

/** Convert dBi to linear gain multiplier. */
export function dbiToLinear(dbi: number): number {
  return Math.pow(10, dbi / 10);
}

/** EIRP (Effective Isotropic Radiated Power), W. */
export function calculateEIRP(powerWatts: number, gainDbi: number): number {
  return powerWatts * dbiToLinear(gainDbi);
}

/** Free-space wavelength in metres. */
export function wavelengthMeters(frequencyMhz: number): number {
  return 299.792458 / frequencyMhz;
}

export interface RFSafetyResult {
  safeDistanceMeters: number;
  eirpWatts: number;
  gainLinear: number;
  powerDensityLimit: number;
  powerWatts: number;
  gainDbi: number;
  /** 1 or GROUND_REFLECTION_FACTOR. */
  reflectionFactor: number;
}

export interface SafeDistanceOptions {
  /** Apply the OET-65 ground-reflection factor (recommended; conservative). Default true. */
  groundReflection?: boolean;
}

/**
 * Calculate the minimum safe distance from a transmitting antenna.
 * R = sqrt(F · EIRP / (4 · π · S))
 */
export function calculateSafeDistance(
  powerWatts: number,
  gainDbi: number,
  powerDensityLimit: number,
  options: SafeDistanceOptions = {}
): RFSafetyResult {
  const reflectionFactor = options.groundReflection === false ? 1 : GROUND_REFLECTION_FACTOR;
  const gainLinear = dbiToLinear(gainDbi);
  const eirpWatts = powerWatts * gainLinear;
  const safeDistanceMeters = Math.sqrt((reflectionFactor * eirpWatts) / (4 * Math.PI * powerDensityLimit));

  return {
    safeDistanceMeters,
    eirpWatts,
    gainLinear,
    powerDensityLimit,
    powerWatts,
    gainDbi,
    reflectionFactor,
  };
}

/**
 * The far-field formula is only meaningful beyond roughly one wavelength from the antenna
 * (and beyond 2D²/λ for electrically large antennas). Closer than that the result is not reliable.
 */
export function isWithinNearField(distanceMeters: number, frequencyMhz: number): boolean {
  return distanceMeters < wavelengthMeters(frequencyMhz);
}

/** Common frequency presets. */
export const FREQUENCY_PRESETS = [
  { label: '144 MHz (VHF)', mhz: 144 },
  { label: '433 MHz (UHF)', mhz: 433 },
  { label: '900 MHz (GSM)', mhz: 900 },
  { label: '2400 MHz (WiFi)', mhz: 2400 },
  { label: '5800 MHz (WiFi 5G)', mhz: 5800 },
] as const;
