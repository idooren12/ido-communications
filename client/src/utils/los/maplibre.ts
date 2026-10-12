/**
 * Single entry point for MapLibre GL.
 *
 * MapLibre 6 is ESM-only and runs its worker from a separate file
 * (maplibre-gl-worker.mjs). By default it looks for that file next to its own
 * module, which does not exist once Vite has bundled the library, so the map would
 * never load. Importing the worker with `?url` makes Vite emit it as an asset, and
 * setWorkerUrl points MapLibre at it. Always import maplibregl from here
 * (`import * as maplibregl from '.../utils/los/maplibre'`).
 */
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);

export * from 'maplibre-gl';
