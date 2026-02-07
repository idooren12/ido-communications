export interface ValidationError {
  field: string;
  messageKey: string;
}

export function validatePower(value: string): string | null {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 'errors.powerPositive';
  return null;
}

export function validateGain(value: string): string | null {
  const num = parseFloat(value);
  if (isNaN(num)) return 'errors.gainNumber';
  return null;
}

export function validateFrequency(value: string): string | null {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 'errors.frequencyPositive';
  return null;
}

export function validateSensitivity(value: string): string | null {
  const num = parseFloat(value);
  if (isNaN(num)) return 'errors.sensitivityNumber';
  return null;
}

export function validateDistance(value: string): string | null {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 'errors.distancePositive';
  return null;
}
