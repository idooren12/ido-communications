import { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from '../../../utils/los/maplibre';
import { TERRAIN_CONFIG } from '../../../utils/los/constants';
import { metersToDegreesLat, metersToDegreesLon, pointInPolygon, type LatLon } from '../../../utils/los/geo';
import { batchSampleElevations } from '../../../utils/los/elevation';
import { updateElevationLUT, getTintTilesTemplate, setClipPolygon } from '../../../utils/los/elevtintProtocol';
import { useLOSState } from '../../../contexts/LOSContext';

interface Options {
  setElevRange: (range: { min: number; max: number }) => void;
  setScaleMode: (mode: 'fixed' | 'viewport') => void;
}

/**
 * Draw a polygon on the map and fit the elevation colour scale to the terrain inside it
 * (the tint is also clipped to the polygon).
 */
export function useElevationPolygon({ setElevRange, setScaleMode }: Options) {
  const { mapRef, setMapClickHandler, setPreviewPolygon } = useLOSState();
  const [elevPolygonDrawing, setElevPolygonDrawing] = useState(false);
  const [elevPolygonPoints, setElevPolygonPoints] = useState<LatLon[]>([]);
  const [elevPolygonLoading, setElevPolygonLoading] = useState(false);
  const elevPolygonDrawingRef = useRef(false);

  // Elevation polygon drawing ref sync
  useEffect(() => { elevPolygonDrawingRef.current = elevPolygonDrawing; }, [elevPolygonDrawing]);

  // Elevation polygon drawing handler
  useEffect(() => {
    if (!elevPolygonDrawing) return;

    setMapClickHandler((e) => {
      if (elevPolygonDrawingRef.current) {
        setElevPolygonPoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }]);
      }
    }, 'crosshair');

    const handleDblClick = (mapEvent: maplibregl.MapMouseEvent) => {
      if (elevPolygonDrawingRef.current) {
        mapEvent.preventDefault?.();
        setElevPolygonDrawing(false);
      }
    };

    const map = mapRef.current;
    map?.on('dblclick', handleDblClick);

    return () => {
      setMapClickHandler(null);
      map?.off('dblclick', handleDblClick);
    };
  }, [elevPolygonDrawing, setMapClickHandler, mapRef]);

  // Update preview polygon for elevation drawing
  useEffect(() => {
    if (elevPolygonPoints.length > 0) {
      setPreviewPolygon({ points: elevPolygonPoints, color: '#f59e0b' });
    } else {
      setPreviewPolygon(null);
      setClipPolygon(null);
    }
    return () => {
      setClipPolygon(null);
    };
  }, [elevPolygonPoints, setPreviewPolygon]);

  // Calculate elevation range within polygon
  const calculatePolygonElevRange = useCallback(async () => {
    if (elevPolygonPoints.length < 3) return;
    setElevPolygonLoading(true);

    try {
      // Compute bounding box
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      for (const p of elevPolygonPoints) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
      }

      // Sample every ~200m inside polygon
      const step = 200;
      const latStep = metersToDegreesLat(step, (minLat + maxLat) / 2);
      const lonStep = metersToDegreesLon(step, (minLat + maxLat) / 2);
      const samplePoints: Array<{ lng: number; lat: number }> = [];

      for (let lat = minLat; lat <= maxLat; lat += latStep) {
        for (let lon = minLon; lon <= maxLon; lon += lonStep) {
          if (pointInPolygon(lat, lon, elevPolygonPoints)) {
            samplePoints.push({ lng: lon, lat });
          }
        }
      }

      if (samplePoints.length === 0) {
        setElevPolygonLoading(false);
        return;
      }

      // Cap samples to prevent excessive load
      const maxSamples = 5000;
      const sampled = samplePoints.length > maxSamples
        ? samplePoints.filter((_, i) => i % Math.ceil(samplePoints.length / maxSamples) === 0)
        : samplePoints;

      const elevations = await batchSampleElevations(sampled, 12, TERRAIN_CONFIG.url, TERRAIN_CONFIG.encoding);
      const valid = elevations.filter((e): e is number => e !== null);

      if (valid.length > 0) {
        const minE = Math.floor(Math.min(...valid));
        const maxE = Math.ceil(Math.max(...valid));
        updateElevationLUT(minE, maxE);
        setElevRange({ min: minE, max: maxE });
        setClipPolygon(elevPolygonPoints);

        // Refresh tiles
        try {
          const source = mapRef.current?.getSource('elevation-tint') as maplibregl.RasterTileSource;
          if (source && typeof source.setTiles === 'function') {
            source.setTiles([getTintTilesTemplate()]);
          }
        } catch { /* ignore */ }

        setScaleMode('fixed'); // Switch to fixed to prevent viewport overwriting
      }
    } catch (e) {
      console.error('Error calculating polygon elevation:', e);
    } finally {
      setElevPolygonLoading(false);
    }
  }, [elevPolygonPoints, mapRef, setElevRange, setScaleMode]);

  // Auto-calculate when polygon drawing finishes (3+ points and not drawing)
  useEffect(() => {
    if (!elevPolygonDrawing && elevPolygonPoints.length >= 3) {
      calculatePolygonElevRange();
    }
  }, [elevPolygonDrawing, elevPolygonPoints.length, calculatePolygonElevRange]);

  const startDrawing = () => {
    setElevPolygonDrawing(true);
    setElevPolygonPoints([]);
  };

  const clear = () => {
    setElevPolygonPoints([]);
    setPreviewPolygon(null);
    setClipPolygon(null);
    setScaleMode('fixed');
  };

  return {
    drawing: elevPolygonDrawing,
    stopDrawing: () => setElevPolygonDrawing(false),
    startDrawing,
    clear,
    hasPolygon: elevPolygonPoints.length > 0,
    loading: elevPolygonLoading,
  };
}
