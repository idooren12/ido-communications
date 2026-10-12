import { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from '../../../utils/los/maplibre';
import { TERRAIN_CONFIG } from '../../../utils/los/constants';
import { sampleElevationAtLngLat } from '../../../utils/los/elevation';
import type { GeocodingResult } from '../../../utils/los/geocoding';
import { useLOSState } from '../../../contexts/LOSContext';
import { searchResultPopup } from '../mapPopups';
import styles from '../UnifiedMap.module.css';

/** Place / coordinate search box: Nominatim lookup, result list and a temporary marker. */
export function useMapSearch() {
  const { mapRef } = useLOSState();
  const searchMarkerRef = useRef<{ marker: maplibregl.Marker; popup: maplibregl.Popup } | null>(null);
  const searchSectionRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Click-outside to close search results
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchSectionRef.current && !searchSectionRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setSearchResults([]); return; }
    const coordMatch = query.match(/^\s*(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)\s*$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]), lon = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        setSearchResults([{ lat, lon, displayName: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, type: 'coordinates' }]);
        setShowSearchResults(true);
        return;
      }
    }
    try {
      const params = new URLSearchParams({ q: query, format: 'json', limit: '5', countrycodes: 'il', viewbox: '34.0,29.0,36.0,34.0', bounded: '1', 'accept-language': 'he,en' });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      if (response.ok) {
        const results = await response.json();
        setSearchResults((results as Array<{ lat: string; lon: string; display_name: string }>).map(r => ({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), displayName: r.display_name, type: 'place' })));
        setShowSearchResults(true);
      }
    } catch (e) { console.error('Search error:', e); }
  }, []);

  const handleSearchResultClick = useCallback(async (result: GeocodingResult) => {
    if (!mapRef.current) return;
    setShowSearchResults(false);
    setSearchQuery(result.displayName.split(',')[0]);
    mapRef.current.flyTo({ center: [result.lon, result.lat], zoom: 14, duration: 1500 });
    if (searchMarkerRef.current) { searchMarkerRef.current.marker.remove(); searchMarkerRef.current.popup.remove(); }
    const elev = await sampleElevationAtLngLat(result.lon, result.lat, 12, TERRAIN_CONFIG.url, TERRAIN_CONFIG.encoding);
    const el = document.createElement('div'); el.className = styles.searchMarker;
    const popup = new maplibregl.Popup({ offset: 25 }).setHTML(searchResultPopup(result.displayName, result.lat, result.lon, elev));
    const marker = new maplibregl.Marker({ element: el }).setLngLat([result.lon, result.lat]).setPopup(popup).addTo(mapRef.current);
    popup.addTo(mapRef.current);
    searchMarkerRef.current = { marker, popup };
    setTimeout(() => popup.remove(), 5000);
  }, [mapRef]);

  return {
    searchSectionRef,
    searchQuery,
    setSearchQuery,
    searchResults,
    showSearchResults,
    setShowSearchResults,
    handleSearch,
    handleSearchResultClick,
  };
}
