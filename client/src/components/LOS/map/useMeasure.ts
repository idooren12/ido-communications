import { useCallback, useEffect, useState } from 'react';
import type * as GeoJSON from 'geojson';
import * as maplibregl from '../../../utils/los/maplibre';
import { haversineDistance, initialBearing, sphericalPolygonArea, type LatLon } from '../../../utils/los/geo';
import { useLOSState } from '../../../contexts/LOSContext';

export type MeasureMode = 'none' | 'distance' | 'area';

/** Distance / area measuring tool: click to add points, double-click to finish. */
export function useMeasure(mapLoaded: boolean) {
  const { mapRef } = useLOSState();
  const [measureMode, setMeasureMode] = useState<MeasureMode>('none');
  const [measurePoints, setMeasurePoints] = useState<LatLon[]>([]);
  const [measureFinished, setMeasureFinished] = useState(false);

  // Measure mode handlers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || measureMode === 'none' || measureFinished) return;
    const handleClick = (e: maplibregl.MapMouseEvent) => setMeasurePoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }]);
    const handleDblClick = (e: maplibregl.MapMouseEvent) => { e.preventDefault(); setMeasureFinished(true); };
    map.on('click', handleClick);
    map.on('dblclick', handleDblClick);
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDblClick);
      map.getCanvas().style.cursor = '';
    };
  }, [measureMode, measureFinished, mapRef]);

  // Update measure visualization
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const source = mapRef.current.getSource('measure-source') as maplibregl.GeoJSONSource;
    if (!source) return;
    const features: GeoJSON.Feature[] = [];
    measurePoints.forEach((p, i) => features.push({ type: 'Feature', properties: { index: i }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
    if (measurePoints.length >= 2) {
      const coords = measurePoints.map(p => [p.lon, p.lat]);
      if (measureMode === 'area' && measurePoints.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } });
      else features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    }
    source.setData({ type: 'FeatureCollection', features });
  }, [measurePoints, measureMode, mapLoaded, mapRef]);

  const calcDistance = useCallback(() => { if (measurePoints.length < 2) return 0; let t = 0; for (let i = 1; i < measurePoints.length; i++) t += haversineDistance(measurePoints[i-1].lat, measurePoints[i-1].lon, measurePoints[i].lat, measurePoints[i].lon); return t; }, [measurePoints]);
  const calcBearing = useCallback(() => measurePoints.length < 2 ? 0 : initialBearing(measurePoints[0].lat, measurePoints[0].lon, measurePoints[measurePoints.length-1].lat, measurePoints[measurePoints.length-1].lon), [measurePoints]);
  const calcArea = useCallback(() => measurePoints.length < 3 ? 0 : sphericalPolygonArea(measurePoints), [measurePoints]);
  const clearMeasure = () => { setMeasureMode('none'); setMeasurePoints([]); setMeasureFinished(false); };
  const startMeasure = (mode: MeasureMode) => { setMeasureMode(mode); setMeasurePoints([]); setMeasureFinished(false); };

  return { measureMode, measurePoints, calcDistance, calcBearing, calcArea, clearMeasure, startMeasure };
}
