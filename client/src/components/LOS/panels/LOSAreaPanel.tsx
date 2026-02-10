import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RF_FREQUENCIES } from '../../../utils/los/los';
import { smartCalculate, getMassiveEngine, type TaskConfig, type TaskProgress } from '../../../utils/los/MassiveCalculationEngine';
import { haversineDistance, initialBearing, metersToDegreesLat, metersToDegreesLon, pointInPolygon, sphericalPolygonArea, type LatLon } from '../../../utils/los/geo';
import { useLOSState, type LOSAreaParams, type LOSAreaResultData, type GridCell } from '../../../contexts/LOSContext';
import styles from './LOSAreaPanel.module.css';

type CalculationMode = 'optical' | 'rf';

const MAX_POINTS_WARNING = 5000000;
const MAX_POINTS_ABSOLUTE = 500000000;

export default function LOSAreaPanel() {
  const { t } = useTranslation();
  const { mapRef, addResult, setMapClickHandler, setPreviewPoints, setPreviewSector, setPreviewPolygon, setPreviewGridCells, setPreviewDragHandler, editingResultData, clearEditingResultData } = useLOSState();
  const cancelRef = useRef(false);
  const pickingOriginRef = useRef(false);
  const drawingPolygonRef = useRef(false);

  type AreaMode = 'sector' | 'polygon';
  const [areaMode, setAreaMode] = useState<AreaMode>('sector');
  const [drawingPolygon, setDrawingPolygon] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<LatLon[]>([]);

  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [height, setHeight] = useState('10');
  const [targetHeight, setTargetHeight] = useState('2');
  const [distanceUnit, setDistanceUnit] = useState<'m' | 'km'>('m');
  const [minDistance, setMinDistance] = useState('100');
  const [maxDistance, setMaxDistance] = useState('5000');
  const [minAzimuth, setMinAzimuth] = useState('0');
  const [maxAzimuth, setMaxAzimuth] = useState('360');
  const [resolution, setResolution] = useState('100');

  const [calcMode, setCalcMode] = useState<CalculationMode>('optical');
  const [rfFrequency, setRfFrequency] = useState<string>('2.4GHz');

  const [gridCells, setGridCells] = useState<GridCell[]>([]);
  const [progress, setProgress] = useState(0);
  const [calculating, setCalculating] = useState(false);
  const [calcTime, setCalcTime] = useState<number | null>(null);

  useEffect(() => { pickingOriginRef.current = pickingOrigin; }, [pickingOrigin]);
  useEffect(() => { drawingPolygonRef.current = drawingPolygon; }, [drawingPolygon]);
  useEffect(() => { setGridCells([]); setPreviewGridCells([]); setCalcTime(null); }, [lat, lon, height, targetHeight, minDistance, maxDistance, minAzimuth, maxAzimuth, resolution, calcMode, rfFrequency, polygonPoints.length, areaMode, setPreviewGridCells]);

  // Register drag handler for preview markers (NaN = delete point)
  useEffect(() => {
    setPreviewDragHandler((index: number, newLat: number, newLon: number) => {
      if (isNaN(newLat) || isNaN(newLon)) {
        // Delete signal
        if (index === 0) { setLat(''); setLon(''); }
      } else {
        if (index === 0) { setLat(newLat.toFixed(6)); setLon(newLon.toFixed(6)); }
      }
      setGridCells([]);
      setCalcTime(null);
    });
    return () => setPreviewDragHandler(null);
  }, [setPreviewDragHandler]);

  // Consume editingResultData when editing from a saved result
  useEffect(() => {
    if (editingResultData && editingResultData.type === 'los-area') {
      const params = editingResultData.params as any;
      setLat(params.origin.lat.toFixed(6));
      setLon(params.origin.lon.toFixed(6));
      setHeight(String(params.origin.height || 10));
      setTargetHeight(String(params.targetHeight || 2));
      setMinDistance(String(params.minDistance || 100));
      setMaxDistance(String(params.maxDistance || 5000));
      setMinAzimuth(String(params.minAzimuth || 0));
      setMaxAzimuth(String(params.maxAzimuth || 360));
      setResolution(String(params.resolution || 100));
      if (params.mode) setCalcMode(params.mode);
      if (params.rfFrequency) setRfFrequency(params.rfFrequency);
      setGridCells([]);
      setCalcTime(null);
      clearEditingResultData();
    }
  }, [editingResultData, clearEditingResultData]);

  const toMeters = useCallback((val: string) => {
    const n = parseFloat(val) || 0;
    return distanceUnit === 'km' ? n * 1000 : n;
  }, [distanceUnit]);

  const origin = useMemo(() => {
    const la = parseFloat(lat), lo = parseFloat(lon);
    return isNaN(la) || isNaN(lo) ? null : { lat: la, lon: lo };
  }, [lat, lon]);

  const estimatedPointCount = useMemo(() => {
    const res = parseFloat(resolution) || 100;
    const cellArea = res * res;

    if (areaMode === 'polygon') {
      if (polygonPoints.length < 3) return 0;
      const area = sphericalPolygonArea(polygonPoints);
      return Math.ceil(area / cellArea);
    }

    if (!origin) return 0;
    const minD = toMeters(minDistance), maxD = toMeters(maxDistance);
    const minAz = parseFloat(minAzimuth) || 0, maxAz = parseFloat(maxAzimuth) || 360;
    const normMinAz = ((minAz % 360) + 360) % 360;
    const normMaxAz = ((maxAz % 360) + 360) % 360;
    const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
    const fullCircle = azRange === 0 || azRange >= 360;
    const sectorFraction = fullCircle ? 1 : (azRange / 360);
    const areaSquareMeters = Math.PI * (maxD * maxD - minD * minD) * sectorFraction;
    return Math.ceil(areaSquareMeters / cellArea);
  }, [origin, minDistance, maxDistance, resolution, minAzimuth, maxAzimuth, toMeters, areaMode, polygonPoints]);

  // Update preview point and sector/polygon when parameters change
  useEffect(() => {
    if (areaMode === 'polygon') {
      // Polygon mode - show polygon preview, clear sector
      setPreviewSector(null);
      if (polygonPoints.length > 0) {
        setPreviewPolygon({ points: polygonPoints, color: '#22d3ee' });
      } else {
        setPreviewPolygon(null);
      }
      // Show origin if set
      if (origin) {
        setPreviewPoints([{ lat: origin.lat, lon: origin.lon, label: '⊙', name: t('los.losArea.origin'), color: '#22d3ee' }]);
      } else {
        setPreviewPoints([]);
      }
    } else {
      // Sector mode - show sector preview, clear polygon
      setPreviewPolygon(null);
      if (origin) {
        setPreviewPoints([{ lat: origin.lat, lon: origin.lon, label: '⊙', name: t('los.losArea.origin'), color: '#22d3ee' }]);

        const minD = toMeters(minDistance);
        const maxD = toMeters(maxDistance);
        const minAz = parseFloat(minAzimuth) || 0;
        const maxAz = parseFloat(maxAzimuth) || 360;

        if (maxD > 0) {
          setPreviewSector({
            origin: { lat: origin.lat, lon: origin.lon },
            minDistance: minD,
            maxDistance: maxD,
            minAzimuth: minAz,
            maxAzimuth: maxAz,
            resolution: parseFloat(resolution) || 100,
            color: '#22d3ee'
          });
        }
      } else {
        setPreviewPoints([]);
        setPreviewSector(null);
      }
    }
    return () => {
      setPreviewPoints([]);
      setPreviewSector(null);
      setPreviewPolygon(null);
      setPreviewGridCells([]);
    };
  }, [origin, minDistance, maxDistance, minAzimuth, maxAzimuth, resolution, toMeters, areaMode, polygonPoints, setPreviewPoints, setPreviewSector, setPreviewPolygon, setPreviewGridCells]);

  // Register click handler for origin picking
  useEffect(() => {
    if (pickingOrigin) {
      setMapClickHandler((e) => {
        if (pickingOriginRef.current) {
          setLat(e.lngLat.lat.toFixed(6));
          setLon(e.lngLat.lng.toFixed(6));
          setPickingOrigin(false);
          setGridCells([]);
        }
      }, 'crosshair');
    } else if (!drawingPolygon) {
      setMapClickHandler(null);
    }

    return () => {
      if (!drawingPolygonRef.current) setMapClickHandler(null);
    };
  }, [pickingOrigin, drawingPolygon, setMapClickHandler]);

  // Register click handler for polygon drawing
  useEffect(() => {
    if (!drawingPolygon) return;

    setMapClickHandler((e) => {
      if (drawingPolygonRef.current) {
        setPolygonPoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }]);
      }
    }, 'crosshair');

    const handleDblClick = (mapEvent: any) => {
      if (drawingPolygonRef.current) {
        mapEvent.preventDefault?.();
        setDrawingPolygon(false);
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
  }, [drawingPolygon, setMapClickHandler, mapRef]);

  const handleCalculate = async () => {
    if (!origin) return;
    if (areaMode === 'polygon' && polygonPoints.length < 3) return;

    // Check point count
    if (estimatedPointCount > MAX_POINTS_ABSOLUTE) {
      alert(t('los.losArea.tooManyPoints', { count: estimatedPointCount.toLocaleString(), max: MAX_POINTS_ABSOLUTE.toLocaleString() }));
      return;
    }

    if (estimatedPointCount > MAX_POINTS_WARNING) {
      const confirm = window.confirm(t('los.losArea.heavyCalculationConfirm', { count: estimatedPointCount.toLocaleString() }));
      if (!confirm) return;
    }

    cancelRef.current = false;
    setCalculating(true);
    setProgress(0);
    setGridCells([]);
    const startTime = performance.now();

    const res = parseFloat(resolution) || 100;
    const hOrigin = parseFloat(height) || 10;
    const hTarget = parseFloat(targetHeight) || 2;

    const points: Array<{ lat: number; lon: number }> = [];
    const latStep = metersToDegreesLat(res);
    const lonStep = metersToDegreesLon(res, origin.lat);
    let maxD: number;

    if (areaMode === 'polygon' && polygonPoints.length >= 3) {
      // Polygon mode: generate grid inside polygon
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      for (const p of polygonPoints) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
      }

      for (let pLat = minLat; pLat <= maxLat && !cancelRef.current; pLat += latStep) {
        for (let pLon = minLon; pLon <= maxLon && !cancelRef.current; pLon += lonStep) {
          if (!pointInPolygon(pLat, pLon, polygonPoints)) continue;
          points.push({ lat: pLat, lon: pLon });
        }
      }

      // Max distance for zoom calculation = diagonal of bounding box
      maxD = haversineDistance(minLat, minLon, maxLat, maxLon);
    } else {
      // Sector mode: generate grid filtered by sector
      const minD = toMeters(minDistance);
      maxD = toMeters(maxDistance);
      const minAz = parseFloat(minAzimuth) || 0, maxAz = parseFloat(maxAzimuth) || 360;

      const latMin = origin.lat - metersToDegreesLat(maxD);
      const latMax = origin.lat + metersToDegreesLat(maxD);
      const lonMin = origin.lon - metersToDegreesLon(maxD, origin.lat);
      const lonMax = origin.lon + metersToDegreesLon(maxD, origin.lat);

      const normMinAz = ((minAz % 360) + 360) % 360;
      const normMaxAz = ((maxAz % 360) + 360) % 360;
      const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
      const fullCircle = azRange === 0 || azRange >= 360;

      for (let pLat = latMin; pLat <= latMax && !cancelRef.current; pLat += latStep) {
        for (let pLon = lonMin; pLon <= lonMax && !cancelRef.current; pLon += lonStep) {
          const dist = haversineDistance(origin.lat, origin.lon, pLat, pLon);
          if (dist < minD || dist > maxD) continue;

          if (!fullCircle) {
            const bearing = initialBearing(origin.lat, origin.lon, pLat, pLon);
            const normBearing = ((bearing % 360) + 360) % 360;
            let inRange: boolean;
            if (normMinAz <= normMaxAz) {
              inRange = normBearing >= normMinAz && normBearing <= normMaxAz;
            } else {
              inRange = normBearing >= normMinAz || normBearing <= normMaxAz;
            }
            if (!inRange) continue;
          }
          points.push({ lat: pLat, lon: pLon });
        }
      }
    }

    // Pick zoom level based on max distance
    const areaZoom = maxD > 100000 ? 10 : maxD > 50000 ? 11 : maxD > 10000 ? 12 : 13;

    const config: TaskConfig = {
      origin: { lat: origin.lat, lon: origin.lon, height: hOrigin },
      targetHeight: hTarget,
      points,
      zoom: areaZoom,
      frequencyMHz: calcMode === 'rf' ? RF_FREQUENCIES[rfFrequency as keyof typeof RF_FREQUENCIES] : undefined,
    };

    try {
      await smartCalculate(config, {
        onProgress: (prog: TaskProgress) => {
          if (cancelRef.current) {
            getMassiveEngine().cancel();
            return;
          }
          setProgress(prog.percent);
        },
        onPartialResult: (partialResults, prog) => {
          if (cancelRef.current) return;
          setGridCells(partialResults as GridCell[]);
          // Only update map preview at low frequency to avoid expensive raster re-renders
          // For large calcs, only update every ~25% progress
          const threshold = points.length > 1000000 ? 25 : points.length > 100000 ? 10 : 5;
          if (prog.percent % threshold < 2) {
            setPreviewGridCells(partialResults as GridCell[]);
          }
        },
        onComplete: (allResults) => {
          if (cancelRef.current) return;
          setGridCells(allResults as GridCell[]);
          setPreviewGridCells(allResults as GridCell[]);
        },
      });
    } catch (e) {
      console.error('Calculation failed:', e);
    }

    setCalcTime(performance.now() - startTime);
    setCalculating(false);
  };

  const handleCancel = () => {
    cancelRef.current = true;
    getMassiveEngine().cancel();
  };

  const handleSaveResult = () => {
    if (gridCells.length === 0 || !origin) return;

    const clearCount = gridCells.filter(c => c.clear === true).length;
    const blockedCount = gridCells.filter(c => c.clear === false).length;
    const totalCount = clearCount + blockedCount;

    const minD = toMeters(minDistance);
    const maxD = toMeters(maxDistance);
    const minAz = parseFloat(minAzimuth) || 0;
    const maxAz = parseFloat(maxAzimuth) || 360;
    const res = parseFloat(resolution) || 100;

    const params: LOSAreaParams = {
      origin: { lat: origin.lat, lon: origin.lon, height: parseFloat(height) || 10 },
      targetHeight: parseFloat(targetHeight) || 2,
      minDistance: minD,
      maxDistance: maxD,
      minAzimuth: minAz,
      maxAzimuth: maxAz,
      resolution: res,
      mode: calcMode,
      rfFrequency: calcMode === 'rf' ? rfFrequency : undefined,
      polygon: areaMode === 'polygon' && polygonPoints.length >= 3 ? polygonPoints : undefined,
    };

    const resultData: LOSAreaResultData = {
      cells: gridCells,
      clearCount,
      blockedCount,
      totalCount,
      clearPercentage: totalCount > 0 ? (clearCount / totalCount) * 100 : 0,
    };

    addResult({
      type: 'los-area',
      name: `${t('los.losArea.coverage')} ${(maxD / 1000).toFixed(1)} ${t('los.common.km')}`,
      params,
      result: resultData,
      visible: true,
      color: '#22d3ee',
    });

    setGridCells([]);
    setPreviewGridCells([]);
  };

  const handleClearResults = () => {
    setGridCells([]);
    setPreviewGridCells([]);
    setCalcTime(null);
  };

  const clearCount = gridCells.filter(c => c.clear === true).length;
  const blockedCount = gridCells.filter(c => c.clear === false).length;
  const totalCount = clearCount + blockedCount;

  return (
    <div className={styles.container}>
      <div className={styles.modeToggle}>
        <button
          className={`${styles.modeBtn} ${calcMode === 'optical' ? styles.active : ''}`}
          onClick={() => { setCalcMode('optical'); handleClearResults(); }}
        >
          {t('los.losArea.optical')}
        </button>
        <button
          className={`${styles.modeBtn} ${calcMode === 'rf' ? styles.active : ''}`}
          onClick={() => { setCalcMode('rf'); handleClearResults(); }}
        >
          RF
        </button>
      </div>

      {calcMode === 'rf' && (
        <div className={styles.rfSettings}>
          <label>{t('los.losArea.frequency')}:</label>
          <select
            value={rfFrequency}
            onChange={(e) => { setRfFrequency(e.target.value); handleClearResults(); }}
            className={styles.freqSelect}
          >
            {Object.keys(RF_FREQUENCIES).map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.originCard}>
        <div className={styles.cardHeader}>
          <span>{t('los.losArea.origin')}</span>
          <button
            className={`${styles.pickBtn} ${pickingOrigin ? styles.active : ''}`}
            onClick={() => setPickingOrigin(!pickingOrigin)}
          >
            {pickingOrigin ? '✕' : '📍'}
          </button>
        </div>

        <div className={styles.coordsGrid}>
          <div className={styles.inputGroup}>
            <span className={styles.inputLabel}>lat</span>
            <input
              type="text"
              value={lat}
              onChange={e => setLat(e.target.value)}
              className={styles.input}
              placeholder="32.0853"
            />
          </div>
          <div className={styles.inputGroup}>
            <span className={styles.inputLabel}>lon</span>
            <input
              type="text"
              value={lon}
              onChange={e => setLon(e.target.value)}
              className={styles.input}
              placeholder="34.7818"
            />
          </div>
        </div>

        <div className={styles.heightsRow}>
          <div className={styles.heightInput}>
            <label>{t('los.losArea.originHeight')} ({t('los.common.meters')})</label>
            <input type="number" value={height} onChange={e => setHeight(e.target.value)} />
          </div>
          <div className={styles.heightInput}>
            <label>{t('los.losArea.targetHeight')} ({t('los.common.meters')})</label>
            <input type="number" value={targetHeight} onChange={e => setTargetHeight(e.target.value)} />
          </div>
        </div>
      </div>

      {pickingOrigin && (
        <div className={styles.pickHint}>{t('los.losArea.selectOnMap')}</div>
      )}

      <div className={styles.settingsCard}>
        <div className={styles.cardHeader}>
          <span>{t('los.losArea.scanSettings')}</span>
          <div className={styles.unitToggle}>
            <button className={areaMode === 'sector' ? styles.active : ''} onClick={() => { setAreaMode('sector'); setDrawingPolygon(false); handleClearResults(); }}>{t('los.losArea.sectorMode')}</button>
            <button className={areaMode === 'polygon' ? styles.active : ''} onClick={() => { setAreaMode('polygon'); handleClearResults(); }}>{t('los.losArea.polygonMode')}</button>
          </div>
        </div>

        {areaMode === 'sector' ? (
          <>
            <div className={styles.rangeRow}>
              <label>{t('los.losArea.distanceRange')}:</label>
              <div className={styles.unitToggle} style={{ marginLeft: 'auto' }}>
                <button className={distanceUnit === 'm' ? styles.active : ''} onClick={() => setDistanceUnit('m')}>{t('los.common.meters')}</button>
                <button className={distanceUnit === 'km' ? styles.active : ''} onClick={() => setDistanceUnit('km')}>{t('los.common.km')}</button>
              </div>
            </div>
            <div className={styles.rangeRow}>
              <input type="number" value={minDistance} onChange={e => setMinDistance(e.target.value)} className={styles.rangeInput} />
              <span>-</span>
              <input type="number" value={maxDistance} onChange={e => setMaxDistance(e.target.value)} className={styles.rangeInput} />
            </div>

            <div className={styles.rangeRow}>
              <label>{t('los.losArea.azimuthRange')}:</label>
              <input type="number" value={minAzimuth} onChange={e => setMinAzimuth(e.target.value)} className={styles.rangeInput} />
              <span>-</span>
              <input type="number" value={maxAzimuth} onChange={e => setMaxAzimuth(e.target.value)} className={styles.rangeInput} />
              <span>°</span>
            </div>
          </>
        ) : (
          <div className={styles.polygonSection}>
            <div className={styles.rangeRow}>
              {drawingPolygon ? (
                <button className={`${styles.pickBtn} ${styles.active}`} onClick={() => setDrawingPolygon(false)} style={{ flex: 1 }}>
                  {t('los.losArea.finishDrawing')} ({polygonPoints.length})
                </button>
              ) : polygonPoints.length >= 3 ? (
                <>
                  <span className={styles.inputLabel}>{polygonPoints.length} {t('los.losArea.pointsCount')}</span>
                  <button className={styles.pickBtn} onClick={() => { setPolygonPoints([]); setPreviewPolygon(null); }}>
                    {t('los.common.clear')}
                  </button>
                </>
              ) : (
                <button className={styles.pickBtn} onClick={() => { setDrawingPolygon(true); setPolygonPoints([]); }} style={{ flex: 1 }}>
                  {t('los.losArea.drawPolygon')}
                </button>
              )}
            </div>
            {drawingPolygon && (
              <div className={styles.pickHint} style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2)', fontSize: '11px' }}>
                {t('los.map.elevPolygonHint')}
              </div>
            )}
          </div>
        )}

        <div className={styles.resolutionRow}>
          <label>{t('los.losArea.resolution')} ({t('los.common.meters')}):</label>
          <input type="number" value={resolution} onChange={e => setResolution(e.target.value)} className={styles.resInput} />
        </div>

        <div className={styles.estimate}>
          {t('los.losArea.estimatedPoints')}: <strong>{estimatedPointCount.toLocaleString()}</strong>
          {estimatedPointCount > MAX_POINTS_WARNING && (
            <span className={styles.warning}> ({t('los.losArea.heavyCalculation')})</span>
          )}
        </div>
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

      {gridCells.length > 0 && !calculating && (
        <div className={styles.resultCard}>
          <div className={styles.resultStats}>
            <div className={styles.statItem}>
              <span className={styles.statValue} style={{ color: '#10b981' }}>{clearCount}</span>
              <span className={styles.statLabel}>{t('los.losArea.clear')}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue} style={{ color: '#f43f5e' }}>{blockedCount}</span>
              <span className={styles.statLabel}>{t('los.losArea.blocked')}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{totalCount > 0 ? ((clearCount / totalCount) * 100).toFixed(1) : 0}%</span>
              <span className={styles.statLabel}>{t('los.losArea.coverage')}</span>
            </div>
          </div>
          {calcTime && (
            <div className={styles.calcTime}>
              {t('los.losArea.time')}: {calcTime < 1000 ? `${calcTime.toFixed(0)}ms` : `${(calcTime/1000).toFixed(1)}s`}
            </div>
          )}
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.calculateBtn}
          onClick={handleCalculate}
          disabled={calculating || !origin || (areaMode === 'polygon' && polygonPoints.length < 3)}
        >
          {calculating ? t('los.losArea.calculating') : t('los.losArea.calculate')}
        </button>
        {gridCells.length > 0 && !calculating && (
          <>
            <button className={styles.saveBtn} onClick={handleSaveResult}>{t('los.common.save')}</button>
            <button className={styles.clearBtn} onClick={handleClearResults}>{t('los.common.clear')}</button>
          </>
        )}
      </div>
    </div>
  );
}
