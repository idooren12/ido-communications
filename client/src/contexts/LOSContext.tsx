import React, { createContext, useContext, useReducer, useCallback, useRef, useState, ReactNode } from 'react';
import type { LOSResult, LOSProfilePoint } from '../utils/los/los';
import type maplibregl from 'maplibre-gl';
import type { RasterResult } from '../utils/los/losAreaRaster';

// ==================== Types ====================

export type ResultType = 'los-line' | 'los-area' | 'peaks';
export type PanelType = 'los-line' | 'los-area' | 'peaks' | 'dsm' | 'projects' | 'comparison' | 'results' | null;
export type BasemapType = 'map' | 'satellite';

// LOS Line Result
export interface LOSLineParams {
  pointA: { lat: number; lon: number; height: number; name?: string };
  pointB: { lat: number; lon: number; height: number; name?: string };
  mode: 'optical' | 'rf';
  rfFrequency?: string;
}

export interface LOSLineResultData {
  clear: boolean;
  fresnelClear?: boolean;
  totalDistance: number;
  bearing: number;
  minClearance: number | null;
  minClearanceDistance: number;
  profile: LOSProfilePoint[];
  confidence: 'high' | 'medium' | 'low';
}

// LOS Area Result
export interface LOSAreaParams {
  origin: { lat: number; lon: number; height: number; name?: string };
  targetHeight: number;
  minDistance: number;
  maxDistance: number;
  minAzimuth: number;
  maxAzimuth: number;
  resolution: number;
  mode: 'optical' | 'rf';
  rfFrequency?: string;
  polygon?: Array<{ lat: number; lon: number }>;
}

export interface GridCell {
  lat: number;
  lon: number;
  clear: boolean | null;
  fresnelClear?: boolean | null;
  bearing?: number;
  distance?: number;
}

export interface LOSAreaResultData {
  cells?: GridCell[];              // legacy path
  rasterUrl?: string;              // streaming: Blob URL for raster image
  rasterCoordinates?: number[][];  // streaming: [[W,N],[E,N],[E,S],[W,S]] corners
  effectiveResolutionXM?: number;  // streaming: meters/pixel in X
  effectiveResolutionYM?: number;  // streaming: meters/pixel in Y
  clearCount: number;
  blockedCount: number;
  totalCount: number;
  clearPercentage: number;
}

// Peak Finder Result
export interface PeakFinderParams {
  polygon: Array<{ lat: number; lon: number }>;
  maxPeaks: number;
  minSeparation: number;
  resolution: number;
  minElevation?: number;
}

export interface Peak {
  lat: number;
  lon: number;
  elevation: number;
  rank: number;
}

export interface PeakFinderResultData {
  peaks: Peak[];
  sampledPoints: number;
  polygonArea: number;
}

// Union types for results
export type CalculationParams = LOSLineParams | LOSAreaParams | PeakFinderParams;
export type CalculationResultData = LOSLineResultData | LOSAreaResultData | PeakFinderResultData;

// Calculation Result (stored in state)
export interface CalculationResult {
  id: string;
  type: ResultType;
  name: string;
  timestamp: Date;
  params: CalculationParams;
  result: CalculationResultData;
  visible: boolean;
  color: string;
}

// Map State
export interface MapState {
  center: [number, number];
  zoom: number;
  basemap: BasemapType;
  elevationTintVisible: boolean;
  elevationOpacity: number;
}

// Project
export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  results: CalculationResult[];
  mapState: MapState;
}

// LOS State
export interface LOSState {
  activePanel: PanelType;
  results: CalculationResult[];
  mapState: MapState;
  selectedResultIds: string[];
  sidebarCollapsed: boolean;
}

// ==================== Actions ====================

type LOSAction =
  | { type: 'SET_ACTIVE_PANEL'; panel: PanelType }
  | { type: 'ADD_RESULT'; result: CalculationResult }
  | { type: 'UPDATE_RESULT'; id: string; updates: Partial<CalculationResult> }
  | { type: 'UPDATE_RESULT_POINT'; id: string; point: 'A' | 'B' | 'origin'; updates: { name?: string; lat?: number; lon?: number; height?: number } }
  | { type: 'REMOVE_RESULT'; id: string }
  | { type: 'TOGGLE_RESULT_VISIBILITY'; id: string }
  | { type: 'SET_RESULT_COLOR'; id: string; color: string }
  | { type: 'CLEAR_ALL_RESULTS' }
  | { type: 'SET_MAP_STATE'; mapState: Partial<MapState> }
  | { type: 'SET_SELECTED_RESULTS'; ids: string[] }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'LOAD_PROJECT'; project: Project }
  | { type: 'RESET_STATE' };

// ==================== Initial State ====================

const initialMapState: MapState = {
  center: [35.2, 31.5],
  zoom: 8,
  basemap: 'satellite',
  elevationTintVisible: false,
  elevationOpacity: 0.7,
};

const initialState: LOSState = {
  activePanel: null,
  results: [],
  mapState: initialMapState,
  selectedResultIds: [],
  sidebarCollapsed: false,
};

// ==================== Reducer ====================

function losReducer(state: LOSState, action: LOSAction): LOSState {
  switch (action.type) {
    case 'SET_ACTIVE_PANEL':
      return { ...state, activePanel: action.panel };

    case 'ADD_RESULT':
      return { ...state, results: [...state.results, action.result] };

    case 'UPDATE_RESULT':
      return {
        ...state,
        results: state.results.map(r =>
          r.id === action.id ? { ...r, ...action.updates } : r
        ),
      };

    case 'UPDATE_RESULT_POINT':
      return {
        ...state,
        results: state.results.map(r => {
          if (r.id !== action.id) return r;

          // Clone the params and update the specific point
          const newParams = { ...r.params } as any;

          if (r.type === 'los-line') {
            const pointKey = action.point === 'A' ? 'pointA' : 'pointB';
            newParams[pointKey] = { ...newParams[pointKey], ...action.updates };
          } else if (r.type === 'los-area' && action.point === 'origin') {
            newParams.origin = { ...newParams.origin, ...action.updates };
          }

          return { ...r, params: newParams };
        }),
      };

    case 'REMOVE_RESULT':
      return {
        ...state,
        results: state.results.filter(r => r.id !== action.id),
        selectedResultIds: state.selectedResultIds.filter(id => id !== action.id),
      };

    case 'TOGGLE_RESULT_VISIBILITY':
      return {
        ...state,
        results: state.results.map(r =>
          r.id === action.id ? { ...r, visible: !r.visible } : r
        ),
      };

    case 'SET_RESULT_COLOR':
      return {
        ...state,
        results: state.results.map(r =>
          r.id === action.id ? { ...r, color: action.color } : r
        ),
      };

    case 'CLEAR_ALL_RESULTS':
      return { ...state, results: [], selectedResultIds: [] };

    case 'SET_MAP_STATE':
      return { ...state, mapState: { ...state.mapState, ...action.mapState } };

    case 'SET_SELECTED_RESULTS':
      return { ...state, selectedResultIds: action.ids };

    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };

    case 'LOAD_PROJECT':
      return {
        ...state,
        results: action.project.results,
        mapState: action.project.mapState,
        selectedResultIds: [],
      };

    case 'RESET_STATE':
      return initialState;

    default:
      return state;
  }
}

// ==================== Context ====================

// Map click handler type
export type MapClickHandler = ((e: { lngLat: { lat: number; lng: number } }) => void) | null;

// Preview point for displaying selected points before calculation
export interface PreviewPoint {
  lat: number;
  lon: number;
  label?: string;
  name?: string;
  color?: string;
}

// Preview polygon for peak finder
export interface PreviewPolygon {
  points: Array<{ lat: number; lon: number }>;
  color?: string;
}

// Preview sector for LOS Area
export interface PreviewSector {
  origin: { lat: number; lon: number };
  minDistance: number;
  maxDistance: number;
  minAzimuth: number;
  maxAzimuth: number;
  resolution?: number;
  color?: string;
}

// Preview peaks for peak finder
export interface PreviewPeak {
  lat: number;
  lon: number;
  elevation: number;
  rank: number;
}

// Preview grid cells for LOS Area calculation
export interface PreviewGridCell {
  lat: number;
  lon: number;
  clear: boolean | null;
  fresnelClear?: boolean | null;
  bearing?: number;
  distance?: number;
}

interface LOSContextValue {
  state: LOSState;
  dispatch: React.Dispatch<LOSAction>;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;

  // Map click handling - central mechanism for panels to handle map clicks
  mapClickHandler: React.MutableRefObject<MapClickHandler>;
  setMapClickHandler: (handler: MapClickHandler, cursor?: string) => void;
  mapCursor: React.MutableRefObject<string>;

  // Preview points - for showing selected points before calculation
  previewPoints: PreviewPoint[];
  setPreviewPoints: (points: PreviewPoint[]) => void;
  previewPolygon: PreviewPolygon | null;
  setPreviewPolygon: (polygon: PreviewPolygon | null) => void;
  previewLine: Array<{ lat: number; lon: number }> | null;
  setPreviewLine: (line: Array<{ lat: number; lon: number }> | null) => void;
  previewSector: PreviewSector | null;
  setPreviewSector: (sector: PreviewSector | null) => void;
  previewPeaks: PreviewPeak[];
  setPreviewPeaks: (peaks: PreviewPeak[]) => void;
  previewGridCells: PreviewGridCell[];
  setPreviewGridCells: (cells: PreviewGridCell[]) => void;
  previewRasterResult: RasterResult | null;
  setPreviewRasterResult: (result: RasterResult | null) => void;

  // Convenience actions
  setActivePanel: (panel: PanelType) => void;
  addResult: (result: Omit<CalculationResult, 'id' | 'timestamp'>) => string;
  removeResult: (id: string) => void;
  toggleResultVisibility: (id: string) => void;
  setResultColor: (id: string, color: string) => void;
  updateResultPoint: (id: string, point: 'A' | 'B' | 'origin', updates: { name?: string; lat?: number; lon?: number; height?: number }) => void;
  updateResultName: (id: string, name: string) => void;
  clearAllResults: () => void;
  updateMapState: (mapState: Partial<MapState>) => void;
  setSelectedResults: (ids: string[]) => void;
  toggleSidebar: () => void;
  loadProject: (project: Project) => void;

  // Drag handling for preview markers
  previewDragHandler: React.MutableRefObject<((index: number, lat: number, lon: number) => void) | null>;
  setPreviewDragHandler: (handler: ((index: number, lat: number, lon: number) => void) | null) => void;

  // Edit from saved result
  editingResultData: { type: ResultType; params: CalculationParams } | null;
  editResultInPanel: (resultId: string) => void;
  clearEditingResultData: () => void;

  // Getters
  getResultsByType: (type: ResultType) => CalculationResult[];
  getVisibleResults: () => CalculationResult[];
}

const LOSContext = createContext<LOSContextValue | null>(null);

// ==================== Provider ====================

interface LOSProviderProps {
  children: ReactNode;
}

// Color palette for results
const RESULT_COLORS = [
  '#22d3ee', // cyan
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // teal
  '#f97316', // orange
  '#84cc16', // lime
];

let colorIndex = 0;
function getNextColor(): string {
  const color = RESULT_COLORS[colorIndex % RESULT_COLORS.length];
  colorIndex++;
  return color;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function LOSProvider({ children }: LOSProviderProps) {
  const [state, dispatch] = useReducer(losReducer, initialState);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapClickHandler = useRef<MapClickHandler>(null);
  const mapCursor = useRef<string>('');

  // Preview state for panels to show points before calculation
  const [previewPoints, setPreviewPoints] = useState<PreviewPoint[]>([]);
  const [previewPolygon, setPreviewPolygon] = useState<PreviewPolygon | null>(null);
  const [previewLine, setPreviewLine] = useState<Array<{ lat: number; lon: number }> | null>(null);
  const [previewSector, setPreviewSector] = useState<PreviewSector | null>(null);
  const [previewPeaks, setPreviewPeaks] = useState<PreviewPeak[]>([]);
  const [previewGridCells, setPreviewGridCells] = useState<PreviewGridCell[]>([]);
  const [previewRasterResult, setPreviewRasterResult] = useState<RasterResult | null>(null);

  // Drag handler ref for preview markers
  const previewDragHandler = useRef<((index: number, lat: number, lon: number) => void) | null>(null);
  const setPreviewDragHandler = useCallback((handler: ((index: number, lat: number, lon: number) => void) | null) => {
    previewDragHandler.current = handler;
  }, []);

  // Edit from saved result
  const [editingResultData, setEditingResultData] = useState<{ type: ResultType; params: CalculationParams } | null>(null);

  const editResultInPanel = useCallback((resultId: string) => {
    const result = state.results.find(r => r.id === resultId);
    if (!result) return;

    // Create a hidden backup copy of the result (not displayed, just kept in saves)
    const backupResult: CalculationResult = {
      ...JSON.parse(JSON.stringify(result)),
      id: generateId(),
      name: `${result.name} (גיבוי)`,
      visible: false,
      timestamp: new Date(),
    };
    dispatch({ type: 'ADD_RESULT', result: backupResult });

    // Set the editing data with deep-copied params
    setEditingResultData({ type: result.type, params: JSON.parse(JSON.stringify(result.params)) });
    // Switch to the correct panel
    const panelMap: Record<ResultType, PanelType> = {
      'los-line': 'los-line',
      'los-area': 'los-area',
      'peaks': 'peaks',
    };
    dispatch({ type: 'SET_ACTIVE_PANEL', panel: panelMap[result.type] || null });
  }, [state.results]);

  const clearEditingResultData = useCallback(() => {
    setEditingResultData(null);
  }, []);

  const setMapClickHandler = useCallback((handler: MapClickHandler, cursor: string = '') => {
    mapClickHandler.current = handler;
    mapCursor.current = cursor;
    // Update cursor on map if available
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = cursor;
    }
  }, []);

  const setActivePanel = useCallback((panel: PanelType) => {
    dispatch({ type: 'SET_ACTIVE_PANEL', panel });
  }, []);

  const addResult = useCallback((result: Omit<CalculationResult, 'id' | 'timestamp'>): string => {
    const id = generateId();
    const fullResult: CalculationResult = {
      ...result,
      id,
      timestamp: new Date(),
      color: result.color || getNextColor(),
    };
    dispatch({ type: 'ADD_RESULT', result: fullResult });
    return id;
  }, []);

  const removeResult = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_RESULT', id });
  }, []);

  const toggleResultVisibility = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_RESULT_VISIBILITY', id });
  }, []);

  const setResultColor = useCallback((id: string, color: string) => {
    dispatch({ type: 'SET_RESULT_COLOR', id, color });
  }, []);

  const clearAllResults = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL_RESULTS' });
  }, []);

  const updateResultPoint = useCallback((
    id: string,
    point: 'A' | 'B' | 'origin',
    updates: { name?: string; lat?: number; lon?: number; height?: number }
  ) => {
    dispatch({ type: 'UPDATE_RESULT_POINT', id, point, updates });
  }, []);

  const updateResultName = useCallback((id: string, name: string) => {
    dispatch({ type: 'UPDATE_RESULT', id, updates: { name } });
  }, []);

  const updateMapState = useCallback((mapState: Partial<MapState>) => {
    dispatch({ type: 'SET_MAP_STATE', mapState });
  }, []);

  const setSelectedResults = useCallback((ids: string[]) => {
    dispatch({ type: 'SET_SELECTED_RESULTS', ids });
  }, []);

  const toggleSidebar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  }, []);

  const loadProject = useCallback((project: Project) => {
    dispatch({ type: 'LOAD_PROJECT', project });
  }, []);

  const getResultsByType = useCallback((type: ResultType): CalculationResult[] => {
    return state.results.filter(r => r.type === type);
  }, [state.results]);

  const getVisibleResults = useCallback((): CalculationResult[] => {
    return state.results.filter(r => r.visible);
  }, [state.results]);

  const value: LOSContextValue = {
    state,
    dispatch,
    mapRef,
    mapClickHandler,
    setMapClickHandler,
    mapCursor,
    previewPoints,
    setPreviewPoints,
    previewPolygon,
    setPreviewPolygon,
    previewLine,
    setPreviewLine,
    previewSector,
    setPreviewSector,
    previewPeaks,
    setPreviewPeaks,
    previewGridCells,
    setPreviewGridCells,
    previewRasterResult,
    setPreviewRasterResult,
    setActivePanel,
    addResult,
    removeResult,
    toggleResultVisibility,
    setResultColor,
    updateResultPoint,
    updateResultName,
    clearAllResults,
    updateMapState,
    setSelectedResults,
    toggleSidebar,
    loadProject,
    previewDragHandler,
    setPreviewDragHandler,
    editingResultData,
    editResultInPanel,
    clearEditingResultData,
    getResultsByType,
    getVisibleResults,
  };

  return <LOSContext.Provider value={value}>{children}</LOSContext.Provider>;
}

// ==================== Hook ====================

export function useLOSState(): LOSContextValue {
  const context = useContext(LOSContext);
  if (!context) {
    throw new Error('useLOSState must be used within LOSProvider');
  }
  return context;
}

// ==================== Type Guards ====================

export function isLOSLineResult(result: CalculationResult): result is CalculationResult & {
  type: 'los-line';
  params: LOSLineParams;
  result: LOSLineResultData;
} {
  return result.type === 'los-line';
}

export function isLOSAreaResult(result: CalculationResult): result is CalculationResult & {
  type: 'los-area';
  params: LOSAreaParams;
  result: LOSAreaResultData;
} {
  return result.type === 'los-area';
}

export function isPeakFinderResult(result: CalculationResult): result is CalculationResult & {
  type: 'peaks';
  params: PeakFinderParams;
  result: PeakFinderResultData;
} {
  return result.type === 'peaks';
}
