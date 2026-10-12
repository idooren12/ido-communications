/**
 * Custom React hooks for the LOS map
 */

import { useState, useEffect, useRef } from 'react';
import { sampleElevationAtLngLat, type EncodingType } from './elevation';

/**
 * Throttle a value: updates at most once per `delay` ms, always ending on the latest value.
 */
export function useThrottle<T>(value: T, delay: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastUpdate = useRef<number>(0);

  useEffect(() => {
    const wait = Math.max(0, delay - (Date.now() - lastUpdate.current));
    const timeout = setTimeout(() => {
      setThrottledValue(value);
      lastUpdate.current = Date.now();
    }, wait);
    return () => clearTimeout(timeout);
  }, [value, delay]);

  return throttledValue;
}

function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return hasTouchScreen && window.innerWidth < 768;
}

/**
 * Detect a small touch device (updates on resize).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(detectMobile);

  useEffect(() => {
    const onResize = () => setIsMobile(detectMobile());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}

/**
 * Get elevation at a position with throttling and fallback to coarser zoom levels.
 */
export function useElevation(
  position: { lng: number; lat: number } | null,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType
) {
  const throttledPosition = useThrottle(position, 150);
  const baseZoom = Math.min(Math.max(Math.round(zoom), 2), 14);
  const requestKey = throttledPosition
    ? `${throttledPosition.lng},${throttledPosition.lat},${baseZoom},${tilesUrl},${encoding}`
    : null;

  // The last answered request; "loading" is derived from whether it matches the current one.
  const [answer, setAnswer] = useState<{ key: string; elevation: number | null } | null>(null);

  useEffect(() => {
    if (!throttledPosition || !requestKey) return;
    let cancelled = false;

    const tryGetElevation = async (tryZoom: number): Promise<number | null> => {
      if (tryZoom < 2) return null;
      const result = await sampleElevationAtLngLat(throttledPosition.lng, throttledPosition.lat, tryZoom, tilesUrl, encoding);
      if (result === null && tryZoom > 2) return tryGetElevation(tryZoom - 2);
      return result;
    };

    tryGetElevation(baseZoom)
      .catch(() => null)
      .then(elevation => {
        if (!cancelled) setAnswer({ key: requestKey, elevation });
      });

    return () => { cancelled = true; };
  }, [throttledPosition, requestKey, baseZoom, tilesUrl, encoding]);

  if (!requestKey) return { elevation: null, loading: false };
  return {
    elevation: answer?.elevation ?? null,
    loading: answer?.key !== requestKey,
  };
}
