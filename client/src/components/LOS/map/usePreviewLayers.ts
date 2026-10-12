import { useEffect, useRef } from 'react';
import type * as GeoJSON from 'geojson';
import * as maplibregl from '../../../utils/los/maplibre';
import { destinationPoint } from '../../../utils/los/geo';
import { useLOSState } from '../../../contexts/LOSContext';
import { peakPopup } from '../mapPopups';
import styles from '../UnifiedMap.module.css';

/** What the tool panels show before a calculation runs: points, line, polygon, sector, peaks. */
export function usePreviewLayers(mapLoaded: boolean) {
  const { mapRef, previewPoints, previewLine, previewPolygon, previewSector, previewPeaks, previewDragHandler } = useLOSState();
  const previewMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Update preview visualization (points selected by panels before calculation)
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const source = mapRef.current.getSource('preview-source') as maplibregl.GeoJSONSource;
    if (!source) return;

    const features: GeoJSON.Feature[] = [];

    // NOTE: We do NOT add preview points as GeoJSON Point features here,
    // because they are rendered as draggable HTML markers (see below).
    // Adding them as a GeoJSON circle layer would block mousedown events
    // needed for MapLibre's marker drag functionality.

    // Add preview line (e.g., LOS line between A and B)
    if (previewLine && previewLine.length >= 2) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: previewLine.map(p => [p.lon, p.lat]) }
      });
    }

    // Add preview polygon (e.g., peak finder area)
    if (previewPolygon && previewPolygon.points.length >= 3) {
      const coords = previewPolygon.points.map(p => [p.lon, p.lat]);
      features.push({
        type: 'Feature',
        properties: { color: previewPolygon.color || '#22d3ee' },
        geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
      });
      // Also add points for polygon vertices
      previewPolygon.points.forEach((p, i) => {
        features.push({
          type: 'Feature',
          properties: { color: previewPolygon.color || '#22d3ee', label: `${i + 1}` },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] }
        });
      });
    }

    // Add preview sector (e.g., LOS area scan range)
    if (previewSector) {
      const { origin, minDistance, maxDistance, minAzimuth, maxAzimuth, color = '#22d3ee' } = previewSector;

      // Normalize azimuths
      const normMinAz = ((minAzimuth % 360) + 360) % 360;
      const normMaxAz = ((maxAzimuth % 360) + 360) % 360;
      const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
      const fullCircle = azRange === 0 || azRange >= 360;

      const angularStep = fullCircle ? 5 : Math.max(2, azRange / 72);
      const effectiveAzRange = fullCircle ? 360 : azRange;

      // Generate outer arc
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
      if (fullCircle && outerArc.length > 0) {
        outerArc.push(outerArc[0]);
      }

      // Generate inner arc if minDistance > 0
      const innerArc: [number, number][] = [];
      if (minDistance > 0) {
        for (let az = 0; az <= effectiveAzRange; az += angularStep) {
          const bearing = (normMinAz + az) % 360;
          const p = destinationPoint(origin.lat, origin.lon, bearing, minDistance);
          innerArc.push([p.lon, p.lat]);
        }
        if (!fullCircle) {
          const endInner = destinationPoint(origin.lat, origin.lon, normMaxAz, minDistance);
          innerArc.push([endInner.lon, endInner.lat]);
        }
        if (fullCircle && innerArc.length > 0) {
          innerArc.push(innerArc[0]);
        }
      }

      // Build polygon - the preview-polygon-line layer will draw the dashed border
      if (fullCircle && minDistance > 0) {
        // Donut
        features.push({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Polygon', coordinates: [outerArc, innerArc] }
        });
      } else if (fullCircle && minDistance === 0) {
        features.push({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Polygon', coordinates: [outerArc] }
        });
      } else if (minDistance > 0) {
        const reversedInner = [...innerArc].reverse();
        const ring = [...outerArc, ...reversedInner];
        ring.push(ring[0]);
        features.push({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Polygon', coordinates: [ring] }
        });
      } else {
        const ring: [number, number][] = [[origin.lon, origin.lat], ...outerArc, [origin.lon, origin.lat]];
        features.push({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Polygon', coordinates: [ring] }
        });
      }
    }

    source.setData({ type: 'FeatureCollection', features });

    // Update preview markers — simple draggable dots
    previewMarkersRef.current.forEach(m => m.remove());
    previewMarkersRef.current = [];

    previewPoints.forEach((p, idx) => {
      const el = document.createElement('div');
      el.className = styles.marker;
      el.style.backgroundColor = p.color || '#22d3ee';
      if (p.label) {
        el.textContent = p.label;
      }

      const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
        .setLngLat([p.lon, p.lat])
        .addTo(mapRef.current!);

      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        if (previewDragHandler.current) {
          previewDragHandler.current(idx, lngLat.lat, lngLat.lng);
        }
      });

      previewMarkersRef.current.push(marker);
    });

    // Add preview peak markers
    previewPeaks.forEach(peak => {
      const el = document.createElement('div');
      el.className = styles.peakMarker;
      el.innerHTML = `<span class="${styles.peakRank}">${peak.rank}</span>`;
      el.style.backgroundColor = '#f59e0b';

      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(peakPopup(peak.rank, peak.lat, peak.lon, peak.elevation));

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([peak.lon, peak.lat])
        .setPopup(popup)
        .addTo(mapRef.current!);
      previewMarkersRef.current.push(marker);
    });

  }, [previewPoints, previewLine, previewPolygon, previewSector, previewPeaks, mapLoaded, mapRef, previewDragHandler]);
}
