export function wattToDbm(watts: number): number {
  if (watts <= 0) return -Infinity;
  return 10 * Math.log10(watts * 1000);
}

export function dbmToWatt(dbm: number): number {
  return Math.pow(10, dbm / 10) / 1000;
}

export function calculateFSPL(distanceKm: number, frequencyMhz: number): number {
  return 20 * Math.log10(distanceKm) + 20 * Math.log10(frequencyMhz) + 32.44;
}

export interface CalculationDetails {
  txPowerDbm: number;
  totalGain: number;
  maxFSPL?: number;
  fspl?: number;
  frequencyMhz: number;
  rxSensitivityDbm?: number;
  distanceKm?: number;
}

export interface MaxDistanceResult {
  distanceKm: number;
  details: CalculationDetails;
}

export interface ReceivedPowerResult {
  receivedPowerDbm: number;
  details: CalculationDetails;
}

export function calculateMaxDistance(
  txPowerWatts: number,
  txGainDbi: number,
  rxGainDbi: number,
  frequencyMhz: number,
  rxSensitivityDbm: number
): MaxDistanceResult {
  const txPowerDbm = wattToDbm(txPowerWatts);
  const totalGain = txGainDbi + rxGainDbi;
  const maxFSPL = txPowerDbm + totalGain - rxSensitivityDbm;

  const frequencyComponent = 20 * Math.log10(frequencyMhz);
  const distanceKm = Math.pow(10, (maxFSPL - frequencyComponent - 32.44) / 20);

  return {
    distanceKm,
    details: {
      txPowerDbm,
      totalGain,
      maxFSPL,
      frequencyMhz,
      rxSensitivityDbm
    }
  };
}

export function calculateReceivedPower(
  txPowerWatts: number,
  txGainDbi: number,
  rxGainDbi: number,
  frequencyMhz: number,
  distanceKm: number
): ReceivedPowerResult {
  const txPowerDbm = wattToDbm(txPowerWatts);
  const totalGain = txGainDbi + rxGainDbi;
  const fspl = calculateFSPL(distanceKm, frequencyMhz);
  const receivedPowerDbm = txPowerDbm + totalGain - fspl;

  return {
    receivedPowerDbm,
    details: {
      txPowerDbm,
      totalGain,
      fspl,
      frequencyMhz,
      distanceKm
    }
  };
}
