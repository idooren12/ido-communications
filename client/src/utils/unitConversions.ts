// --- Distance units ---
export type DistanceUnit = 'km' | 'mi' | 'm' | 'ft' | 'nmi';

const distanceToKm: Record<DistanceUnit, number> = {
  km: 1,
  mi: 1.60934,
  m: 0.001,
  ft: 0.0003048,
  nmi: 1.852,
};

export function toKm(value: number, unit: DistanceUnit): number {
  return value * distanceToKm[unit];
}

export function fromKm(km: number, unit: DistanceUnit): number {
  return km / distanceToKm[unit];
}

// --- Power units ---
export type PowerUnit = 'W' | 'mW' | 'dBm' | 'dBW';

export function toWatts(value: number, unit: PowerUnit): number {
  switch (unit) {
    case 'W': return value;
    case 'mW': return value / 1000;
    case 'dBm': return Math.pow(10, value / 10) / 1000;
    case 'dBW': return Math.pow(10, value / 10);
  }
}

export function fromWatts(watts: number, unit: PowerUnit): number {
  switch (unit) {
    case 'W': return watts;
    case 'mW': return watts * 1000;
    case 'dBm': return watts <= 0 ? -Infinity : 10 * Math.log10(watts * 1000);
    case 'dBW': return watts <= 0 ? -Infinity : 10 * Math.log10(watts);
  }
}

// --- Frequency units ---
export type FrequencyUnit = 'Hz' | 'kHz' | 'MHz' | 'GHz';

const freqToMhz: Record<FrequencyUnit, number> = {
  Hz: 1e-6,
  kHz: 0.001,
  MHz: 1,
  GHz: 1000,
};

export function toMhz(value: number, unit: FrequencyUnit): number {
  return value * freqToMhz[unit];
}

export function fromMhz(mhz: number, unit: FrequencyUnit): number {
  return mhz / freqToMhz[unit];
}

// --- Labels ---
export const distanceUnits: DistanceUnit[] = ['km', 'mi', 'm', 'ft', 'nmi'];
export const powerUnits: PowerUnit[] = ['W', 'mW', 'dBm', 'dBW'];
export const frequencyUnits: FrequencyUnit[] = ['Hz', 'kHz', 'MHz', 'GHz'];
