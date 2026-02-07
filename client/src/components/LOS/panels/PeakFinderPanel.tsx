import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { pointInPolygon, metersToDegreesLat, metersToDegreesLon, haversineDistance, sphericalPolygonArea, formatArea, type LatLon } from '../../../utils/los/geo';
import { batchSampleElevations } from '../../../utils/los/elevation';
import { useLOSState, type PeakFinderParams, type PeakFinderResultData, type Peak } from '../../../contexts/LOSContext';
import { TERRAIN_CONFIG } from '../../../utils/los/constants';
import styles from './PeakFinderPanel.module.css';

const MAX_POINTS_WARNING = 100000;

export default function PeakFinderPanel() {
  const { t } = useTranslation();
  const { mapRef, addResult, setMapClickHandler, setPreviewPolygon, setPreviewPeaks } = useLOSState();
  const cancelRef = useRef(false);
  const drawingModeRef = useRef(false);

  const [drawingMode, setDrawingMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<LatLon[]>([]);
  const [maxPeaks, setMaxPeaks] = useState('10');
  const [minSeparation, setMinSeparation] = useState('500');
  const [resolution, setResolution] = useState('50');
  const [minElevation, setMinElevation] = useState('');
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [progress, setProgress] = useState(0);
  const [calculating, setCalculating] = useState(false);
  const [calcTime, setCalcTime] = useState<number | null>(null);
  const [sampledPoints, setSampledPoints] = useState(0);

  useEffect(() => { drawingModeRef.current = drawingMode; }, [drawingMode]);

  const polygonArea = useMemo(() => polygonPoints.length < 3 ? null : sphericalPolygonArea(polygonPoints), [polygonPoints]);
  const estimatedPoints = useMemo(() => {
    if (!polygonArea) return 0;
    const res = parseFloat(resolution) || 50;
    return Math.round(polygonArea / (res * res));
  }, [polygonArea, resolution]);

  // Update preview polygon when points change
  useEffect(() => {
    if (polygonPoints.length > 0) {
      setPreviewPolygon({ points: polygonPoints, color: '#f59e0b' });
    } else {
      setPreviewPolygon(null);
    }
    return () => setPreviewPolygon(null);
  }, [polygonPoints, setPreviewPolygon]);

  // Update preview peaks when they change
  useEffect(() => {
    if (peaks.length > 0) {
      setPreviewPeaks(peaks);
    } else {
      setPreviewPeaks([]);
    }
    return () => setPreviewPeaks([]);
  }, [peaks, setPreviewPeaks]);

  // Register click handler
  useEffect(() => {
    if (drawingMode) {
      setMapClickHandler((e) => {
        if (drawingModeRef.current) {
          setPolygonPoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }]);
        }
      }, 'crosshair');

      // Handle double click on map to finish drawing
      const handleDblClick = (mapEvent: any) => {
        if (drawingModeRef.current) {
          mapEvent.preventDefault?.();
          setDrawingMode(false);
        }
      };

      if (mapRef.current) {
        mapRef.current.on('dblclick', handleDblClick);
      }

      return () => {
        setMapClickHandler(null);
        if (mapRef.current) {
          mapRef.current.off('dblclick', handleDblClick);
        }
      };
    } else {
      setMapClickHandler(null);
    }

    return () => {
      setMapClickHandler(null);
    };
  }, [drawingMode, setMapClickHandler, mapRef]);

  const handleCalculate = async () => {
    if (polygonPoints.length < 3) return;

    if (estimatedPoints > MAX_POINTS_WARNING) {
      const confirm = window.confirm(t('los.peakFinder.heavyCalculationConfirm', { count: estimatedPoints.toLocaleString() }));
      if (!confirm) return;
    }

    cancelRef.current = false;
    setCalculating(true);
    setProgress(0);
    setPeaks([]);
    setSampledPoints(0);
    const startTime = performance.now();

    const res = parseFloat(resolution) || 50;
    const maxP = parseInt(maxPeaks) || 10;
    const minSep = parseFloat(minSeparation) || 500;
    const minElev = minElevation ? parseFloat(minElevation) : null;

    // Calculate bounds
    const lats = polygonPoints.map(p => p.lat);
    const lons = polygonPoints.map(p => p.lon);
    const bounds = {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons)
    };

    const latStep = metersToDegreesLat(res);
    const avgLat = (bounds.minLat + bounds.maxLat) / 2;
    const lonStep = metersToDegreesLon(res, avgLat);

    // Generate grid points inside polygon
    const gridPoints: Array<{ lat: number; lng: number }> = [];
    for (let lat = bounds.minLat; lat <= bounds.maxLat && !cancelRef.current; lat += latStep) {
      for (let lon = bounds.minLon; lon <= bounds.maxLon && !cancelRef.current; lon += lonStep) {
        if (pointInPolygon(lat, lon, polygonPoints)) {
          gridPoints.push({ lat, lng: lon });
        }
      }
    }

    if (cancelRef.current) {
      setCalculating(false);
      return;
    }

    // Sample elevations in batches
    const elevations: Array<{ lat: number; lon: number; elevation: number }> = [];
    const batchSize = 500;

    for (let i = 0; i < gridPoints.length && !cancelRef.current; i += batchSize) {
      const batch = gridPoints.slice(i, i + batchSize);
      const batchElevations = await batchSampleElevations(
        batch,
        12,
        TERRAIN_CONFIG.url,
        TERRAIN_CONFIG.encoding
      );

      for (let j = 0; j < batch.length; j++) {
        const elev = batchElevations[j];
        if (elev !== null && (minElev === null || elev >= minElev)) {
          elevations.push({ lat: batch[j].lat, lon: batch[j].lng, elevation: elev });
        }
      }

      setProgress(Math.min(100, Math.round((i + batchSize) / gridPoints.length * 100)));
    }

    if (cancelRef.current) {
      setCalculating(false);
      return;
    }

    setSampledPoints(elevations.length);

    // Sort by elevation and find peaks with minimum separation
    elevations.sort((a, b) => b.elevation - a.elevation);

    const foundPeaks: Peak[] = [];
    for (const point of elevations) {
      if (foundPeaks.length >= maxP) break;

      const tooClose = foundPeaks.some(p =>
        haversineDistance(point.lat, point.lon, p.lat, p.lon) < minSep
      );

      if (!tooClose) {
        foundPeaks.push({
          lat: point.lat,
          lon: point.lon,
          elevation: point.elevation,
          rank: foundPeaks.length + 1
        });
      }
    }

    setPeaks(foundPeaks);
    setCalcTime(performance.now() - startTime);
    setCalculating(false);
  };

  const handleCancel = () => {
    cancelRef.current = true;
  };

  const handleSaveResult = () => {
    if (peaks.length === 0 || polygonPoints.length < 3) return;

    const params: PeakFinderParams = {
      polygon: polygonPoints,
      maxPeaks: parseInt(maxPeaks) || 10,
      minSeparation: parseFloat(minSeparation) || 500,
      resolution: parseFloat(resolution) || 50,
      minElevation: minElevation ? parseFloat(minElevation) : undefined,
    };

    const resultData: PeakFinderResultData = {
      peaks,
      sampledPoints,
      polygonArea: polygonArea || 0,
    };

    addResult({
      type: 'peaks',
      name: `${peaks.length} ${t('los.peakFinder.peaks')}`,
      params,
      result: resultData,
      visible: true,
      color: '#f59e0b',
    });

    setPeaks([]);
  };

  const handleClearPolygon = () => {
    setPolygonPoints([]);
    setPeaks([]);
    setDrawingMode(false);
  };

  const handleExportCSV = () => {
    if (peaks.length === 0) return;

    const csv = [
      'Rank,Latitude,Longitude,Elevation (m)',
      ...peaks.map(p => `${p.rank},${p.lat.toFixed(6)},${p.lon.toFixed(6)},${Math.round(p.elevation)}`)
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `peaks_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.container}>
      <div className={styles.polygonCard}>
        <div className={styles.cardHeader}>
          <span>{t('los.peakFinder.searchArea')}</span>
          <button
            className={`${styles.drawBtn} ${drawingMode ? styles.active : ''}`}
            onClick={() => setDrawingMode(!drawingMode)}
          >
            {drawingMode ? t('los.peakFinder.finish') : t('los.peakFinder.draw')}
          </button>
        </div>

        {polygonPoints.length > 0 && (
          <div className={styles.polygonInfo}>
            <span>{polygonPoints.length} {t('los.peakFinder.points')}</span>
            {polygonArea && <span className={styles.separator}>|</span>}
            {polygonArea && <span>{formatArea(polygonArea)}</span>}
            <button className={styles.clearPolygonBtn} onClick={handleClearPolygon}>{t('los.peakFinder.clearPolygon')}</button>
          </div>
        )}

        {polygonPoints.length === 0 && !drawingMode && (
          <div className={styles.hint}>{t('los.peakFinder.drawHint')}</div>
        )}

        {drawingMode && (
          <div className={styles.drawHint}>
            {t('los.peakFinder.clickToAddPoints')}
            <br />
            {t('los.peakFinder.doubleClickToFinish')}
          </div>
        )}
      </div>

      <div className={styles.settingsCard}>
        <div className={styles.cardHeader}>{t('los.peakFinder.searchSettings')}</div>

        <div className={styles.settingRow}>
          <label>{t('los.peakFinder.maxPeaks')}:</label>
          <input
            type="number"
            value={maxPeaks}
            onChange={e => setMaxPeaks(e.target.value)}
            className={styles.settingInput}
          />
        </div>

        <div className={styles.settingRow}>
          <label>{t('los.peakFinder.minSeparation')} ({t('los.common.meters')}):</label>
          <input
            type="number"
            value={minSeparation}
            onChange={e => setMinSeparation(e.target.value)}
            className={styles.settingInput}
          />
        </div>

        <div className={styles.settingRow}>
          <label>{t('los.peakFinder.resolution')} ({t('los.common.meters')}):</label>
          <input
            type="number"
            value={resolution}
            onChange={e => setResolution(e.target.value)}
            className={styles.settingInput}
          />
        </div>

        <div className={styles.settingRow}>
          <label>{t('los.peakFinder.minElevation')} ({t('los.common.meters')}):</label>
          <input
            type="number"
            value={minElevation}
            onChange={e => setMinElevation(e.target.value)}
            className={styles.settingInput}
            placeholder={t('los.peakFinder.optional')}
          />
        </div>

        {polygonArea && (
          <div className={styles.estimate}>
            {t('los.peakFinder.estimatedPoints')}: <strong>{estimatedPoints.toLocaleString()}</strong>
          </div>
        )}
      </div>

      {calculating && (
        <div className={styles.progressCard}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
          <div className={styles.progressText}>{progress}%</div>
          <button className={styles.cancelBtn} onClick={handleCancel}>{t('los.common.cancel')}</button>
        </div>
      )}

      {peaks.length > 0 && !calculating && (
        <div className={styles.resultsCard}>
          <div className={styles.resultsHeader}>
            <span>{peaks.length} {t('los.peakFinder.peaksFound')}</span>
            <button className={styles.exportBtn} onClick={handleExportCSV}>CSV</button>
          </div>
          <div className={styles.peaksList}>
            {peaks.map(peak => (
              <div key={peak.rank} className={styles.peakItem}>
                <span className={styles.peakRank}>#{peak.rank}</span>
                <span className={styles.peakCoords}>
                  {peak.lat.toFixed(5)}, {peak.lon.toFixed(5)}
                </span>
                <span className={styles.peakElev}>{Math.round(peak.elevation)} {t('los.common.meters')}</span>
              </div>
            ))}
          </div>
          {calcTime && (
            <div className={styles.calcTime}>
              {t('los.peakFinder.time')}: {calcTime < 1000 ? `${calcTime.toFixed(0)}ms` : `${(calcTime/1000).toFixed(1)}s`}
              {sampledPoints > 0 && ` | ${sampledPoints.toLocaleString()} ${t('los.peakFinder.points')}`}
            </div>
          )}
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.calculateBtn}
          onClick={handleCalculate}
          disabled={calculating || polygonPoints.length < 3}
        >
          {calculating ? t('los.peakFinder.searching') : t('los.peakFinder.calculate')}
        </button>
        {peaks.length > 0 && !calculating && (
          <>
            <button className={styles.saveBtn} onClick={handleSaveResult}>{t('los.common.save')}</button>
            <button className={styles.clearBtn} onClick={() => setPeaks([])}>{t('los.common.clear')}</button>
          </>
        )}
      </div>
    </div>
  );
}
