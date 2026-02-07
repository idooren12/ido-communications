import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import { pointInPolygon, metersToDegreesLat, metersToDegreesLon, haversineDistance, sphericalPolygonArea, formatArea, type LatLon } from '../../utils/los/geo';
import { batchSampleElevations } from '../../utils/los/elevation';
import { ISRAEL_CENTER, BASEMAP_SOURCES } from '../../utils/los/constants';
import styles from './PeakFinder.module.css';

interface Peak { lat: number; lon: number; elevation: number; rank: number; }
interface Props { initialState?: any; onStateChange?: (state: any) => void; }

export default function PeakFinder({ initialState, onStateChange }: Props) {
  const { t } = useTranslation();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const polygonMarkersRef = useRef<maplibregl.Marker[]>([]);
  const peakMarkersRef = useRef<maplibregl.Marker[]>([]);
  const cancelRef = useRef(false);
  const drawingModeRef = useRef(false);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [basemap, setBasemap] = useState<'map' | 'satellite'>('map');
  const [drawingMode, setDrawingMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<LatLon[]>(initialState?.polygonPoints || []);
  const [maxPeaks, setMaxPeaks] = useState(initialState?.maxPeaks || '10');
  const [minSeparation, setMinSeparation] = useState(initialState?.minSeparation || '500');
  const [resolution, setResolution] = useState(initialState?.resolution || '50');
  const [minElevation, setMinElevation] = useState(initialState?.minElevation || '');
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [progress, setProgress] = useState(0);
  const [calculating, setCalculating] = useState(false);
  const [calcTime, setCalcTime] = useState<number | null>(null);
  const [sampledPoints, setSampledPoints] = useState(0);

  useEffect(() => { drawingModeRef.current = drawingMode; }, [drawingMode]);
  useEffect(() => { onStateChange?.({ polygonPoints, maxPeaks, minSeparation, resolution }); }, [polygonPoints, maxPeaks, minSeparation, resolution, onStateChange]);

  const polygonArea = useMemo(() => polygonPoints.length < 3 ? null : sphericalPolygonArea(polygonPoints), [polygonPoints]);
  const estimatedPoints = useMemo(() => { if (!polygonArea) return 0; const res = parseFloat(resolution) || 50; return Math.round(polygonArea / (res * res)); }, [polygonArea, resolution]);

  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    if (drawingModeRef.current) {
      setPolygonPoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }]);
    }
  }, []);

  const handleMapDblClick = useCallback((e: maplibregl.MapMouseEvent) => {
    if (drawingModeRef.current) {
      e.preventDefault();
      setDrawingMode(false);
    }
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: { version: 8, sources: {
        'carto-dark': { ...BASEMAP_SOURCES.cartoDark, maxzoom: 20 },
        'esri-satellite': { ...BASEMAP_SOURCES.esriSatellite, maxzoom: 19 },
        'carto-labels': { ...BASEMAP_SOURCES.cartoLabels, maxzoom: 20 }
      }, layers: [
        { id: 'carto-dark-layer', type: 'raster', source: 'carto-dark', layout: { visibility: 'visible' } },
        { id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite', layout: { visibility: 'none' } },
        { id: 'carto-labels-layer', type: 'raster', source: 'carto-labels', layout: { visibility: 'none' } },
      ]},
      center: ISRAEL_CENTER, zoom: 9, minZoom: 0.5, maxZoom: 22,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.on('load', () => {
      setMapLoaded(true);
      map.addSource('polygon', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'polygon-fill', type: 'fill', source: 'polygon', paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'polygon-line', type: 'line', source: 'polygon', paint: { 'line-color': '#22d3ee', 'line-width': 2 } });
    });
    map.on('click', handleMapClick);
    map.on('dblclick', handleMapDblClick);
    mapRef.current = map;
    return () => { map.off('click', handleMapClick); map.off('dblclick', handleMapDblClick); map.remove(); mapRef.current = null; };
  }, [handleMapClick, handleMapDblClick]);

  useEffect(() => { if (mapRef.current) mapRef.current.getCanvas().style.cursor = drawingMode ? 'crosshair' : ''; }, [drawingMode]);
  useEffect(() => { if (!mapRef.current || !mapLoaded) return; mapRef.current.setLayoutProperty('carto-dark-layer', 'visibility', basemap === 'map' ? 'visible' : 'none'); mapRef.current.setLayoutProperty('esri-satellite-layer', 'visibility', basemap === 'satellite' ? 'visible' : 'none'); mapRef.current.setLayoutProperty('carto-labels-layer', 'visibility', basemap === 'satellite' ? 'visible' : 'none'); }, [basemap, mapLoaded]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const source = mapRef.current.getSource('polygon') as maplibregl.GeoJSONSource;
    if (!source) return;
    if (polygonPoints.length >= 3) {
      const coords = polygonPoints.map(p => [p.lon, p.lat]);
      source.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } }] });
    } else if (polygonPoints.length >= 2) {
      source.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: polygonPoints.map(p => [p.lon, p.lat]) } }] });
    } else source.setData({ type: 'FeatureCollection', features: [] });

    polygonMarkersRef.current.forEach(m => m.remove());
    polygonMarkersRef.current = polygonPoints.map((p, i) => {
      const el = document.createElement('div'); el.className = styles.polygonMarker;
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.lon, p.lat]);
      marker.on('dragend', () => { const ll = marker.getLngLat(); setPolygonPoints(prev => prev.map((pt, idx) => idx === i ? { lat: ll.lat, lon: ll.lng } : pt)); });
      marker.addTo(mapRef.current!);
      return marker;
    });
  }, [polygonPoints, mapLoaded]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    peakMarkersRef.current.forEach(m => m.remove());
    peakMarkersRef.current = peaks.map(p => {
      const el = document.createElement('div'); el.className = styles.peakMarker;
      el.style.backgroundColor = p.rank === 1 ? '#ffd700' : p.rank <= 3 ? '#c0c0c0' : '#cd7f32';
      el.textContent = `${p.rank}`;
      const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<strong>#${p.rank}</strong><br/>${Math.round(p.elevation)} ${t('los.common.meters')}`));
      marker.addTo(mapRef.current!);
      return marker;
    });
  }, [peaks, mapLoaded, t]);

  const handleStartDraw = () => { if (drawingMode) { setDrawingMode(false); } else { setPolygonPoints([]); setPeaks([]); setDrawingMode(true); } };
  const handleClearPolygon = () => { setPolygonPoints([]); setPeaks([]); setDrawingMode(false); };

  const handleCalculate = async () => {
    if (polygonPoints.length < 3) return;
    cancelRef.current = false; setCalculating(true); setProgress(0); setPeaks([]); setSampledPoints(0);
    const startTime = performance.now();
    const res = parseFloat(resolution) || 50, maxP = parseInt(maxPeaks) || 10, minSep = parseFloat(minSeparation) || 500, minElev = minElevation ? parseFloat(minElevation) : null;

    const lats = polygonPoints.map(p => p.lat), lons = polygonPoints.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const dLat = metersToDegreesLat(res), dLon = metersToDegreesLon(res, (minLat + maxLat) / 2);

    const gridPoints: { lat: number; lon: number }[] = [];
    for (let lat = minLat; lat <= maxLat; lat += dLat) {
      for (let lon = minLon; lon <= maxLon; lon += dLon) {
        if (pointInPolygon(lat, lon, polygonPoints)) gridPoints.push({ lat, lon });
      }
    }

    if (gridPoints.length === 0) { setCalculating(false); return; }

    const BATCH_SIZE = 500;
    const allElevations: { lat: number; lon: number; elevation: number }[] = [];

    for (let i = 0; i < gridPoints.length && !cancelRef.current; i += BATCH_SIZE) {
      const batch = gridPoints.slice(i, i + BATCH_SIZE);
      const elevations = await batchSampleElevations(batch.map(p => ({ lng: p.lon, lat: p.lat })), 12);
      for (let j = 0; j < batch.length; j++) {
        const elev = elevations[j];
        if (elev !== null && (minElev === null || elev >= minElev)) {
          allElevations.push({ lat: batch[j].lat, lon: batch[j].lon, elevation: elev });
        }
      }
      setSampledPoints(i + batch.length);
      setProgress(Math.round(((i + batch.length) / gridPoints.length) * 100));
      await new Promise(r => setTimeout(r, 10));
    }

    if (cancelRef.current) { setCalculating(false); return; }

    allElevations.sort((a, b) => b.elevation - a.elevation);
    const selectedPeaks: Peak[] = [];
    for (const candidate of allElevations) {
      if (selectedPeaks.length >= maxP) break;
      let tooClose = false;
      for (const peak of selectedPeaks) { if (haversineDistance(candidate.lat, candidate.lon, peak.lat, peak.lon) < minSep) { tooClose = true; break; } }
      if (!tooClose) selectedPeaks.push({ ...candidate, rank: selectedPeaks.length + 1 });
    }

    setPeaks(selectedPeaks);
    setCalcTime(performance.now() - startTime);
    setCalculating(false);
    if (selectedPeaks.length > 0 && mapRef.current) {
      const bounds = new maplibregl.LngLatBounds();
      selectedPeaks.forEach(p => bounds.extend([p.lon, p.lat]));
      mapRef.current.fitBounds(bounds, { padding: 50 });
    }
  };

  const handleExportCSV = () => {
    const csv = ['#,Latitude,Longitude,Elevation (m)', ...peaks.map(p => `${p.rank},${p.lat.toFixed(6)},${p.lon.toFixed(6)},${p.elevation.toFixed(1)}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'peaks.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const handleExportGeoJSON = () => {
    const geojson = { type: 'FeatureCollection', features: peaks.map(p => ({ type: 'Feature', properties: { rank: p.rank, elevation: p.elevation }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) };
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'peaks.geojson'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.container}>
      <div className={styles.mapSection}>
        <div ref={mapContainerRef} className={styles.map} />
        <div className={styles.mapControls}>
          <button className={`${styles.mapBtn} ${basemap === 'map' ? styles.active : ''}`} onClick={() => setBasemap('map')}>{t('los.map.mapView')}</button>
          <button className={`${styles.mapBtn} ${basemap === 'satellite' ? styles.active : ''}`} onClick={() => setBasemap('satellite')}>{t('los.map.satellite')}</button>
        </div>
        {drawingMode && <div className={styles.pickHint}>{t('los.peakFinder.clickAddPoints')}</div>}
      </div>

      <div className={styles.panel}>
        <div className={styles.panelContent}>
          <div className={styles.card}>
            <div className={styles.cardHeader}><span className={styles.cardTitle}>{t('los.peakFinder.searchArea')}</span></div>
            <div className={styles.drawControls}>
              <button className={`${styles.drawBtn} ${drawingMode ? styles.active : ''}`} onClick={handleStartDraw}>{drawingMode ? `🎯 ${t('los.peakFinder.drawing')}` : `✏️ ${t('los.peakFinder.drawPolygon')}`}</button>
              <button className={styles.clearBtn} onClick={handleClearPolygon} disabled={polygonPoints.length === 0}>{t('los.peakFinder.clearPolygon')}</button>
            </div>
            {!drawingMode && polygonPoints.length > 0 && <div className={styles.polygonInfo}><span>{polygonPoints.length} {t('los.peakFinder.points')}</span>{polygonArea && <span>• {formatArea(polygonArea)}</span>}</div>}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}><span className={styles.cardTitle}>{t('los.peakFinder.parameters')}</span></div>
            <div className={styles.paramsGrid}>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.peakFinder.maxPeaks')}</span><input type="number" value={maxPeaks} onChange={e => setMaxPeaks(e.target.value)} className={styles.input} /></div>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.peakFinder.minSeparation')}</span><input type="number" value={minSeparation} onChange={e => setMinSeparation(e.target.value)} className={styles.input} /></div>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.peakFinder.resolution')}</span><input type="number" value={resolution} onChange={e => setResolution(e.target.value)} className={styles.input} /></div>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.peakFinder.minElevation')}</span><input type="number" value={minElevation} onChange={e => setMinElevation(e.target.value)} placeholder="—" className={styles.input} /></div>
            </div>
            {estimatedPoints > 0 && <div className={styles.pointEstimate}>~{estimatedPoints.toLocaleString()} {t('los.peakFinder.points')}</div>}
          </div>

          {peaks.length > 0 && (
            <div className={styles.resultsSection}>
              <div className={styles.resultsHeader}>
                <span>{peaks.length} {t('los.peakFinder.peaks')}</span>
                <div className={styles.exportBtns}><button className={styles.exportBtn} onClick={handleExportCSV}>CSV</button><button className={styles.exportBtn} onClick={handleExportGeoJSON}>GeoJSON</button></div>
              </div>
              {calcTime && <div className={styles.calcTime}>{t('los.peakFinder.time')} {(calcTime / 1000).toFixed(1)}s</div>}
              <div className={styles.peaksList}>
                {peaks.map(p => (
                  <div key={p.rank} className={styles.peakItem} onClick={() => mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: 14 })}>
                    <span className={styles.peakRank} style={{ backgroundColor: p.rank === 1 ? '#ffd700' : p.rank <= 3 ? '#c0c0c0' : '#cd7f32' }}>#{p.rank}</span>
                    <span className={styles.peakElev}>{Math.round(p.elevation)}m</span>
                    <span className={styles.peakCoords}>{p.lat.toFixed(4)}, {p.lon.toFixed(4)}</span>
                    <button className={styles.copyBtn} onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`); }}>📋</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.actions}>
            {calculating ? (
              <><div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progress}%` }} /></div><span className={styles.progressText}>{progress}%</span><button className={styles.cancelBtn} onClick={() => cancelRef.current = true}>{t('los.peakFinder.cancel')}</button></>
            ) : (
              <button className={styles.calculateBtn} onClick={handleCalculate} disabled={polygonPoints.length < 3}>🔍 {t('los.peakFinder.calculate')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
