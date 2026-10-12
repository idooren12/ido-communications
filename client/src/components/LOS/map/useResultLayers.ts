import { useEffect, useRef } from 'react';
import type * as GeoJSON from 'geojson';
import * as maplibregl from '../../../utils/los/maplibre';
import { destinationPoint } from '../../../utils/los/geo';
import { useLOSState, isLOSLineResult, isLOSAreaResult, isPeakFinderResult } from '../../../contexts/LOSContext';
import { gridToImageUrl } from '../../../utils/los/losAreaRaster';
import { peakPopup, losLinePointPopup, losAreaOriginPopup } from '../mapPopups';
import styles from '../UnifiedMap.module.css';

/** Saved calculation results on the map: lines, coverage rasters, sectors, peaks and their markers. */
export function useResultLayers(mapLoaded: boolean) {
  const { state, mapRef, getVisibleResults, editResultInPanel, removeResult, previewDragHandler } = useLOSState();
  const resultMarkersRef = useRef<Map<string, maplibregl.Marker[]>>(new Map());
  const resultRasterIdsRef = useRef<Set<string>>(new Set());

  // Update results layers from context
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const visibleResults = getVisibleResults();

    // LOS Lines
    const losLineFeatures: GeoJSON.Feature[] = [];
    visibleResults.filter(isLOSLineResult).forEach(r => {
      losLineFeatures.push({
        type: 'Feature',
        properties: { id: r.id, color: r.color, clear: r.result.clear },
        geometry: {
          type: 'LineString',
          coordinates: [
            [r.params.pointA.lon, r.params.pointA.lat],
            [r.params.pointB.lon, r.params.pointB.lat]
          ]
        }
      });
    });
    const losLinesSource = mapRef.current.getSource('results-los-lines') as maplibregl.GeoJSONSource;
    if (losLinesSource) {
      losLinesSource.setData({ type: 'FeatureCollection', features: losLineFeatures });
    }

    // LOS Area - raster images for results
    const losAreaBoundaryFeatures: GeoJSON.Feature[] = [];
    const newRasterIds = new Set<string>();

    visibleResults.filter(isLOSAreaResult).forEach(r => {
      const { origin, resolution, minDistance, maxDistance, minAzimuth, maxAzimuth } = r.params;
      const sourceId = `result-raster-${r.id}`;
      const layerId = `result-raster-layer-${r.id}`;
      newRasterIds.add(r.id);

      // Render raster image: use pre-rendered rasterUrl if available, else legacy gridToImageUrl
      let rasterUrl: string | undefined;
      let rasterCoords: number[][] | undefined;

      if (r.result.rasterUrl && r.result.rasterCoordinates) {
        // Streaming path: raster already rendered
        rasterUrl = r.result.rasterUrl;
        rasterCoords = r.result.rasterCoordinates;
      } else if (r.result.cells && r.result.cells.length > 0) {
        // Legacy path: render from cells
        const raster = gridToImageUrl(r.result.cells, resolution, origin.lat);
        if (raster) {
          rasterUrl = raster.url;
          rasterCoords = raster.coordinates;
        }
      }

      if (rasterUrl && rasterCoords) {
        const existingSource = mapRef.current!.getSource(sourceId) as maplibregl.ImageSource;
        if (existingSource) {
          existingSource.updateImage({ url: rasterUrl, coordinates: rasterCoords as maplibregl.Coordinates });
        } else {
          mapRef.current!.addSource(sourceId, {
            type: 'image',
            url: rasterUrl,
            coordinates: rasterCoords as maplibregl.Coordinates,
          });
          // Insert before boundary layer so boundary lines draw on top
          const beforeLayer = mapRef.current!.getLayer('results-los-area-boundary-line') ? 'results-los-area-boundary-line' : undefined;
          mapRef.current!.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 },
          }, beforeLayer);
        }
      }

      // Generate boundary - polygon or sector
      if (r.params.polygon && r.params.polygon.length >= 3) {
        // Polygon boundary
        const coords = r.params.polygon.map(p => [p.lon, p.lat] as [number, number]);
        coords.push(coords[0]); // close ring
        losAreaBoundaryFeatures.push({
          type: 'Feature',
          properties: { id: r.id, color: r.color || '#22d3ee' },
          geometry: { type: 'LineString', coordinates: coords }
        });
      } else {
        // Sector boundary
        const normMinAz = ((minAzimuth % 360) + 360) % 360;
        const normMaxAz = ((maxAzimuth % 360) + 360) % 360;
        const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
        const fullCircle = azRange === 0 || azRange >= 360;
        const angularStep = fullCircle ? 5 : Math.max(1, azRange / 72);
        const effectiveAzRange = fullCircle ? 360 : azRange;

        const outerArc: [number, number][] = [];
        for (let az = 0; az <= effectiveAzRange; az += angularStep) {
          const bearing = (normMinAz + az) % 360;
          const p = destinationPoint(origin.lat, origin.lon, bearing, maxDistance);
          outerArc.push([p.lon, p.lat]);
        }
        if (!fullCircle) {
          const endOuter = destinationPoint(origin.lat, origin.lon, normMaxAz, maxDistance);
          outerArc.push([endOuter.lon, endOuter.lat]);
        }

        const innerArc: [number, number][] = [];
        if (minDistance > 0) {
          for (let az = effectiveAzRange; az >= 0; az -= angularStep) {
            const bearing = (normMinAz + az) % 360;
            const p = destinationPoint(origin.lat, origin.lon, bearing, minDistance);
            innerArc.push([p.lon, p.lat]);
          }
          const startInner = destinationPoint(origin.lat, origin.lon, normMinAz, minDistance);
          innerArc.push([startInner.lon, startInner.lat]);
        }

        let boundaryRing: [number, number][];
        if (fullCircle && minDistance > 0) {
          const outerRing = [...outerArc]; outerRing.push(outerRing[0]);
          const innerRing: [number, number][] = [];
          for (let az = 0; az <= 360; az += angularStep) {
            const bearing = (normMinAz + az) % 360;
            const p = destinationPoint(origin.lat, origin.lon, bearing, minDistance);
            innerRing.push([p.lon, p.lat]);
          }
          innerRing.push(innerRing[0]);
          losAreaBoundaryFeatures.push({
            type: 'Feature',
            properties: { id: r.id, color: r.color || '#22d3ee' },
            geometry: { type: 'MultiLineString', coordinates: [outerRing, innerRing] }
          });
          boundaryRing = [];
        } else if (fullCircle && minDistance === 0) {
          boundaryRing = [...outerArc]; boundaryRing.push(boundaryRing[0]);
        } else if (minDistance > 0) {
          boundaryRing = [...outerArc, ...innerArc]; boundaryRing.push(boundaryRing[0]);
        } else {
          boundaryRing = [[origin.lon, origin.lat], ...outerArc, [origin.lon, origin.lat]];
        }

        if (boundaryRing.length > 0) {
          losAreaBoundaryFeatures.push({
            type: 'Feature',
            properties: { id: r.id, color: r.color || '#22d3ee' },
            geometry: { type: 'LineString', coordinates: boundaryRing }
          });
        }
      }
    });

    // Remove old raster sources that are no longer in visible results
    for (const oldId of resultRasterIdsRef.current) {
      if (!newRasterIds.has(oldId)) {
        const layerId = `result-raster-layer-${oldId}`;
        const sourceId = `result-raster-${oldId}`;
        if (mapRef.current!.getLayer(layerId)) mapRef.current!.removeLayer(layerId);
        if (mapRef.current!.getSource(sourceId)) mapRef.current!.removeSource(sourceId);
      }
    }
    resultRasterIdsRef.current = newRasterIds;

    const losAreaBoundarySource = mapRef.current.getSource('results-los-area-boundary') as maplibregl.GeoJSONSource;
    if (losAreaBoundarySource) {
      losAreaBoundarySource.setData({ type: 'FeatureCollection', features: losAreaBoundaryFeatures });
    }

    // Peaks
    const peakFeatures: GeoJSON.Feature[] = [];
    visibleResults.filter(isPeakFinderResult).forEach(r => {
      r.result.peaks.forEach(peak => {
        peakFeatures.push({
          type: 'Feature',
          properties: {
            id: r.id,
            color: r.color,
            elevation: peak.elevation,
            rank: peak.rank
          },
          geometry: { type: 'Point', coordinates: [peak.lon, peak.lat] }
        });
      });
    });
    const peaksSource = mapRef.current.getSource('results-peaks') as maplibregl.GeoJSONSource;
    if (peaksSource) {
      peaksSource.setData({ type: 'FeatureCollection', features: peakFeatures });
    }

    // Peak Finder search polygons
    const peakPolygonFeatures: GeoJSON.Feature[] = [];
    visibleResults.filter(isPeakFinderResult).forEach(r => {
      if (r.params.polygon && r.params.polygon.length >= 3) {
        const coords = r.params.polygon.map(p => [p.lon, p.lat]);
        peakPolygonFeatures.push({
          type: 'Feature',
          properties: { id: r.id, color: r.color },
          geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
        });
      }
    });
    const peakPolygonSource = mapRef.current.getSource('results-peaks-polygon') as maplibregl.GeoJSONSource;
    if (peakPolygonSource) {
      peakPolygonSource.setData({ type: 'FeatureCollection', features: peakPolygonFeatures });
    }

    // Clean up old markers and create new ones for peaks (with labels)
    resultMarkersRef.current.forEach(markers => markers.forEach(m => m.remove()));
    resultMarkersRef.current.clear();

    visibleResults.filter(isPeakFinderResult).forEach(r => {
      const markers: maplibregl.Marker[] = [];
      r.result.peaks.forEach(peak => {
        const el = document.createElement('div');
        el.className = styles.peakMarker;
        el.innerHTML = `<span class="${styles.peakRank}">${peak.rank}</span>`;
        el.style.backgroundColor = r.color;

        const popup = new maplibregl.Popup({ offset: 25 }).setHTML(peakPopup(peak.rank, peak.lat, peak.lon, peak.elevation));

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([peak.lon, peak.lat])
          .setPopup(popup)
          .addTo(mapRef.current!);
        markers.push(marker);
      });
      resultMarkersRef.current.set(r.id, markers);
    });

    // LOS Line markers — simple dots with popups
    visibleResults.filter(isLOSLineResult).forEach(r => {
      const markers: maplibregl.Marker[] = [];
      const buildPointPopup = (label: string, lat: number, lon: number, height: number) =>
        losLinePointPopup({
          label, lat, lon, height,
          mode: r.params.mode,
          rfFrequency: r.params.rfFrequency,
          clear: r.result.clear,
          resultId: r.id,
        });

      // Point A — labeled dot
      const elA = document.createElement('div');
      elA.className = styles.marker;
      elA.style.backgroundColor = r.color;
      elA.textContent = 'A';
      const popupA = new maplibregl.Popup({ offset: 25, closeButton: true }).setHTML(
        buildPointPopup('A', r.params.pointA.lat, r.params.pointA.lon, r.params.pointA.height)
      );
      const origPosA: [number, number] = [r.params.pointA.lon, r.params.pointA.lat];
      const markerA = new maplibregl.Marker({ element: elA, draggable: true, anchor: 'center' })
        .setLngLat(origPosA)
        .setPopup(popupA)
        .addTo(mapRef.current!);
      markerA.on('dragend', () => {
        editResultInPanel(r.id);
        markerA.setLngLat(origPosA);
      });
      markers.push(markerA);

      // Point B — labeled dot
      const elB = document.createElement('div');
      elB.className = styles.marker;
      elB.style.backgroundColor = r.color;
      elB.textContent = 'B';
      const popupB = new maplibregl.Popup({ offset: 25, closeButton: true }).setHTML(
        buildPointPopup('B', r.params.pointB.lat, r.params.pointB.lon, r.params.pointB.height)
      );
      const origPosB: [number, number] = [r.params.pointB.lon, r.params.pointB.lat];
      const markerB = new maplibregl.Marker({ element: elB, draggable: true, anchor: 'center' })
        .setLngLat(origPosB)
        .setPopup(popupB)
        .addTo(mapRef.current!);
      markerB.on('dragend', () => {
        editResultInPanel(r.id);
        markerB.setLngLat(origPosB);
      });
      markers.push(markerB);

      resultMarkersRef.current.set(r.id, markers);
    });

    // LOS Area origin marker — simple dot with popup
    visibleResults.filter(isLOSAreaResult).forEach(r => {
      const markers: maplibregl.Marker[] = [];
      const { origin, targetHeight, minDistance, maxDistance, minAzimuth, maxAzimuth, resolution, mode } = r.params;

      const el = document.createElement('div');
      el.className = styles.marker;
      el.style.backgroundColor = r.color;

      const popup = new maplibregl.Popup({ offset: 25, closeButton: true }).setHTML(
        losAreaOriginPopup({
          lat: origin.lat,
          lon: origin.lon,
          height: origin.height,
          targetHeight, minDistance, maxDistance, minAzimuth, maxAzimuth, resolution, mode,
          rfFrequency: r.params.rfFrequency,
          resultId: r.id,
        })
      );

      const origPosOrigin: [number, number] = [origin.lon, origin.lat];
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(origPosOrigin)
        .setPopup(popup)
        .addTo(mapRef.current!);
      marker.on('dragend', () => {
        editResultInPanel(r.id);
        marker.setLngLat(origPosOrigin);
      });
      markers.push(marker);

      resultMarkersRef.current.set(`${r.id}-origin`, markers);
    });

  }, [state.results, mapLoaded, mapRef, getVisibleResults, editResultInPanel]);

  // Event handler for popup action buttons (edit, delete)
  useEffect(() => {
    const handlePopupAction = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;
      if (!action) return;

      e.preventDefault();
      e.stopPropagation();

      if (action === 'edit' && target.dataset.resultId) {
        editResultInPanel(target.dataset.resultId);
      } else if (action === 'delete' && target.dataset.resultId) {
        removeResult(target.dataset.resultId);
      } else if (action === 'delete-preview' && target.dataset.previewIndex !== undefined) {
        const idx = parseInt(target.dataset.previewIndex, 10);
        if (!isNaN(idx)) {
          if (previewDragHandler.current) {
            previewDragHandler.current(idx, NaN, NaN);
          }
        }
      }
    };

    document.addEventListener('click', handlePopupAction);
    return () => document.removeEventListener('click', handlePopupAction);
  }, [editResultInPanel, removeResult, previewDragHandler]);
}
