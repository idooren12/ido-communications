import { useEffect, useRef } from 'react';
import * as maplibregl from '../../../utils/los/maplibre';
import { useLOSState } from '../../../contexts/LOSContext';
import { gridToImageUrl } from '../../../utils/los/losAreaRaster';

/** Live raster of an LOS-area calculation while it is running. */
export function usePreviewRaster(mapLoaded: boolean) {
  const { mapRef, previewGridCells, previewRasterResult, previewSector } = useLOSState();
  const previewRasterActiveRef = useRef(false);

  // Update preview grid cells (for LOS Area calculation preview) - raster image
  // Handles both streaming (previewRasterResult) and legacy (previewGridCells) paths
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const sourceId = 'preview-grid-raster';
    const layerId = 'preview-grid-raster-layer';

    // Determine raster source: streaming takes priority over legacy
    let rasterUrl: string | undefined;
    let rasterCoords: number[][] | undefined;

    if (previewRasterResult) {
      // Streaming path: use pre-rendered raster directly
      rasterUrl = previewRasterResult.url;
      rasterCoords = previewRasterResult.coordinates;
    } else if (previewGridCells.length > 0) {
      // Legacy path: render from cells
      const res = previewSector?.resolution || 100;
      const refLat = previewSector?.origin.lat || 31.5;
      const raster = gridToImageUrl(previewGridCells, res, refLat);
      if (raster) {
        rasterUrl = raster.url;
        rasterCoords = raster.coordinates;
      }
    }

    if (!rasterUrl || !rasterCoords) {
      // Remove raster if no data
      if (previewRasterActiveRef.current) {
        if (mapRef.current.getLayer(layerId)) mapRef.current.removeLayer(layerId);
        if (mapRef.current.getSource(sourceId)) mapRef.current.removeSource(sourceId);
        previewRasterActiveRef.current = false;
      }
      return;
    }

    const existingSource = mapRef.current.getSource(sourceId) as maplibregl.ImageSource;
    if (existingSource) {
      existingSource.updateImage({ url: rasterUrl, coordinates: rasterCoords as maplibregl.Coordinates });
    } else {
      mapRef.current.addSource(sourceId, {
        type: 'image',
        url: rasterUrl,
        coordinates: rasterCoords as maplibregl.Coordinates,
      });
      mapRef.current.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 },
      });
      previewRasterActiveRef.current = true;
    }
  }, [previewGridCells, previewRasterResult, previewSector, mapLoaded, mapRef]);
}
