// Israeli geographic regions with RF propagation parameters
// Based on terrain, vegetation, urbanization, and climate characteristics

export type EnvironmentType =
  | 'urban_dense'
  | 'urban_moderate'
  | 'suburban'
  | 'rural'
  | 'open_flat'
  | 'hilly'
  | 'mountainous'
  | 'desert'
  | 'coastal';

export type RegionGroup = 'north' | 'center' | 'mountains' | 'south';

export interface RegionData {
  id: string;
  nameHe: string;
  nameEn: string;
  group: RegionGroup;
  coordinates: { lat: number; lon: number };
  environmentType: EnvironmentType;
  pathLossExponent: number;      // n in Log-Distance model (2 = free space, up to 4+ urban)
  baseAttenuation: number;       // additional base loss in dB
  vegetationFactor: number;      // 0-1, vegetation absorption influence
  urbanDensity: number;          // 0-1, building clutter density
  terrainVariation: number;      // 0-1, topographic irregularity
  avgHumidity: number;           // average humidity %
  dustProbability: number;       // 0-1, likelihood of dust/sand conditions
}

export const REGION_GROUPS: { id: RegionGroup; nameKey: string }[] = [
  { id: 'north', nameKey: 'realistic.regions.groups.north' },
  { id: 'center', nameKey: 'realistic.regions.groups.center' },
  { id: 'mountains', nameKey: 'realistic.regions.groups.mountains' },
  { id: 'south', nameKey: 'realistic.regions.groups.south' },
];

export const ISRAEL_REGIONS: RegionData[] = [
  // ===== NORTH =====
  {
    id: 'upper_galilee',
    nameHe: 'גליל עליון',
    nameEn: 'Upper Galilee',
    group: 'north',
    coordinates: { lat: 33.05, lon: 35.50 },
    environmentType: 'mountainous',
    pathLossExponent: 3.5,
    baseAttenuation: 8,
    vegetationFactor: 0.7,
    urbanDensity: 0.2,
    terrainVariation: 0.9,
    avgHumidity: 60,
    dustProbability: 0.1,
  },
  {
    id: 'lower_galilee',
    nameHe: 'גליל תחתון',
    nameEn: 'Lower Galilee',
    group: 'north',
    coordinates: { lat: 32.80, lon: 35.45 },
    environmentType: 'hilly',
    pathLossExponent: 3.0,
    baseAttenuation: 5,
    vegetationFactor: 0.5,
    urbanDensity: 0.3,
    terrainVariation: 0.6,
    avgHumidity: 55,
    dustProbability: 0.15,
  },
  {
    id: 'golan',
    nameHe: 'רמת הגולן',
    nameEn: 'Golan Heights',
    group: 'north',
    coordinates: { lat: 33.00, lon: 35.75 },
    environmentType: 'mountainous',
    pathLossExponent: 3.2,
    baseAttenuation: 6,
    vegetationFactor: 0.3,
    urbanDensity: 0.1,
    terrainVariation: 0.8,
    avgHumidity: 50,
    dustProbability: 0.2,
  },
  {
    id: 'jezreel_valley',
    nameHe: 'עמק יזרעאל',
    nameEn: 'Jezreel Valley',
    group: 'north',
    coordinates: { lat: 32.60, lon: 35.30 },
    environmentType: 'open_flat',
    pathLossExponent: 2.4,
    baseAttenuation: 2,
    vegetationFactor: 0.3,
    urbanDensity: 0.2,
    terrainVariation: 0.2,
    avgHumidity: 55,
    dustProbability: 0.2,
  },
  {
    id: 'north_coastal_plain',
    nameHe: 'מישור החוף הצפוני',
    nameEn: 'Northern Coastal Plain',
    group: 'north',
    coordinates: { lat: 32.80, lon: 35.00 },
    environmentType: 'coastal',
    pathLossExponent: 2.8,
    baseAttenuation: 4,
    vegetationFactor: 0.3,
    urbanDensity: 0.5,
    terrainVariation: 0.2,
    avgHumidity: 70,
    dustProbability: 0.1,
  },

  // ===== CENTER =====
  {
    id: 'central_coastal_plain',
    nameHe: 'מישור החוף המרכזי',
    nameEn: 'Central Coastal Plain',
    group: 'center',
    coordinates: { lat: 32.10, lon: 34.80 },
    environmentType: 'urban_dense',
    pathLossExponent: 3.8,
    baseAttenuation: 12,
    vegetationFactor: 0.1,
    urbanDensity: 0.9,
    terrainVariation: 0.1,
    avgHumidity: 70,
    dustProbability: 0.1,
  },
  {
    id: 'south_coastal_plain',
    nameHe: 'מישור החוף הדרומי',
    nameEn: 'Southern Coastal Plain',
    group: 'center',
    coordinates: { lat: 31.65, lon: 34.55 },
    environmentType: 'suburban',
    pathLossExponent: 3.0,
    baseAttenuation: 5,
    vegetationFactor: 0.2,
    urbanDensity: 0.5,
    terrainVariation: 0.15,
    avgHumidity: 65,
    dustProbability: 0.2,
  },
  {
    id: 'shfela',
    nameHe: 'שפלה',
    nameEn: 'Shfela (Lowlands)',
    group: 'center',
    coordinates: { lat: 31.75, lon: 34.90 },
    environmentType: 'hilly',
    pathLossExponent: 2.9,
    baseAttenuation: 4,
    vegetationFactor: 0.3,
    urbanDensity: 0.4,
    terrainVariation: 0.4,
    avgHumidity: 60,
    dustProbability: 0.15,
  },
  {
    id: 'jerusalem_hills',
    nameHe: 'הרי ירושלים',
    nameEn: 'Jerusalem Hills',
    group: 'mountains',
    coordinates: { lat: 31.75, lon: 35.20 },
    environmentType: 'mountainous',
    pathLossExponent: 3.5,
    baseAttenuation: 10,
    vegetationFactor: 0.4,
    urbanDensity: 0.6,
    terrainVariation: 0.8,
    avgHumidity: 55,
    dustProbability: 0.15,
  },

  // ===== MOUNTAINS =====
  {
    id: 'samaria',
    nameHe: 'שומרון',
    nameEn: 'Samaria',
    group: 'mountains',
    coordinates: { lat: 32.20, lon: 35.25 },
    environmentType: 'mountainous',
    pathLossExponent: 3.3,
    baseAttenuation: 7,
    vegetationFactor: 0.35,
    urbanDensity: 0.25,
    terrainVariation: 0.75,
    avgHumidity: 50,
    dustProbability: 0.2,
  },
  {
    id: 'judea',
    nameHe: 'יהודה',
    nameEn: 'Judea',
    group: 'mountains',
    coordinates: { lat: 31.55, lon: 35.10 },
    environmentType: 'hilly',
    pathLossExponent: 3.1,
    baseAttenuation: 6,
    vegetationFactor: 0.25,
    urbanDensity: 0.3,
    terrainVariation: 0.65,
    avgHumidity: 45,
    dustProbability: 0.25,
  },

  // ===== SOUTH & DESERT =====
  {
    id: 'judean_desert',
    nameHe: 'מדבר יהודה',
    nameEn: 'Judean Desert',
    group: 'south',
    coordinates: { lat: 31.45, lon: 35.35 },
    environmentType: 'desert',
    pathLossExponent: 2.5,
    baseAttenuation: 2,
    vegetationFactor: 0.05,
    urbanDensity: 0.02,
    terrainVariation: 0.7,
    avgHumidity: 30,
    dustProbability: 0.4,
  },
  {
    id: 'jordan_valley',
    nameHe: 'בקעת הירדן',
    nameEn: 'Jordan Valley',
    group: 'south',
    coordinates: { lat: 32.10, lon: 35.50 },
    environmentType: 'desert',
    pathLossExponent: 2.4,
    baseAttenuation: 2,
    vegetationFactor: 0.15,
    urbanDensity: 0.1,
    terrainVariation: 0.3,
    avgHumidity: 35,
    dustProbability: 0.35,
  },
  {
    id: 'dead_sea',
    nameHe: 'ים המלח',
    nameEn: 'Dead Sea',
    group: 'south',
    coordinates: { lat: 31.50, lon: 35.45 },
    environmentType: 'desert',
    pathLossExponent: 2.3,
    baseAttenuation: 1,
    vegetationFactor: 0.02,
    urbanDensity: 0.05,
    terrainVariation: 0.4,
    avgHumidity: 35,
    dustProbability: 0.3,
  },
  {
    id: 'north_negev',
    nameHe: 'נגב צפוני',
    nameEn: 'Northern Negev',
    group: 'south',
    coordinates: { lat: 31.25, lon: 34.80 },
    environmentType: 'desert',
    pathLossExponent: 2.6,
    baseAttenuation: 3,
    vegetationFactor: 0.1,
    urbanDensity: 0.3,
    terrainVariation: 0.3,
    avgHumidity: 40,
    dustProbability: 0.4,
  },
  {
    id: 'arava',
    nameHe: 'ערבה',
    nameEn: 'Arava Valley',
    group: 'south',
    coordinates: { lat: 30.50, lon: 35.10 },
    environmentType: 'desert',
    pathLossExponent: 2.2,
    baseAttenuation: 1,
    vegetationFactor: 0.03,
    urbanDensity: 0.02,
    terrainVariation: 0.25,
    avgHumidity: 25,
    dustProbability: 0.5,
  },
  {
    id: 'eilat',
    nameHe: 'אילת והרי אילת',
    nameEn: 'Eilat Region',
    group: 'south',
    coordinates: { lat: 29.55, lon: 34.95 },
    environmentType: 'desert',
    pathLossExponent: 2.5,
    baseAttenuation: 3,
    vegetationFactor: 0.02,
    urbanDensity: 0.2,
    terrainVariation: 0.6,
    avgHumidity: 30,
    dustProbability: 0.45,
  },
];

/** Find a region by its ID */
export function getRegionById(id: string): RegionData | undefined {
  return ISRAEL_REGIONS.find(r => r.id === id);
}

/** Get regions grouped by their group key */
export function getRegionsByGroup(): Map<RegionGroup, RegionData[]> {
  const grouped = new Map<RegionGroup, RegionData[]>();
  for (const group of REGION_GROUPS) {
    grouped.set(group.id, ISRAEL_REGIONS.filter(r => r.group === group.id));
  }
  return grouped;
}
