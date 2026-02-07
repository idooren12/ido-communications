/**
 * Custom React hooks
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { sampleElevationAtLngLat, type EncodingType } from './elevation';

/**
 * Debounce a value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Throttle a value
 */
export function useThrottle<T>(value: T, delay: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastUpdate = useRef<number>(0);

  useEffect(() => {
    const now = Date.now();
    if (now - lastUpdate.current >= delay) {
      setThrottledValue(value);
      lastUpdate.current = now;
    } else {
      const timeout = setTimeout(() => {
        setThrottledValue(value);
        lastUpdate.current = Date.now();
      }, delay - (now - lastUpdate.current));
      return () => clearTimeout(timeout);
    }
  }, [value, delay]);

  return throttledValue;
}

/**
 * Detect mobile device
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(hasTouchScreen && isSmallScreen);
    };

    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}

/**
 * Get elevation at a position with throttling and fallback
 */
export function useElevation(
  position: { lng: number; lat: number } | null,
  zoom: number,
  tilesUrl: string,
  encoding: EncodingType
) {
  const [elevation, setElevation] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const throttledPosition = useThrottle(position, 150);

  useEffect(() => {
    if (!throttledPosition) {
      setElevation(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Use zoom level appropriate for the view, with wider range
    const baseZoom = Math.min(Math.max(Math.round(zoom), 2), 14);

    // Try to get elevation with fallback to lower zoom levels
    const tryGetElevation = async (tryZoom: number): Promise<number | null> => {
      if (tryZoom < 2) return null;

      const result = await sampleElevationAtLngLat(
        throttledPosition.lng,
        throttledPosition.lat,
        tryZoom,
        tilesUrl,
        encoding
      );

      // If failed and we can try lower zoom, do it
      if (result === null && tryZoom > 2) {
        return tryGetElevation(tryZoom - 2);
      }

      return result;
    };

    tryGetElevation(baseZoom).then((elev) => {
      if (!cancelled) {
        setElevation(elev);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setElevation(null);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [throttledPosition, zoom, tilesUrl, encoding]);

  return { elevation, loading };
}

/**
 * Local storage hook with SSR safety
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.error('Error reading localStorage:', error);
    }
  }, [key]);

  const setValue = useCallback((value: T) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Error writing localStorage:', error);
    }
  }, [key]);

  return [storedValue, setValue];
}

/**
 * Previous value hook
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}

/**
 * Mounted state hook
 */
export function useIsMounted(): () => boolean {
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return useCallback(() => mountedRef.current, []);
}
