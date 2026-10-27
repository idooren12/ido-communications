/**
 * Israel Transverse Mercator (ITM, EPSG:2039) <-> WGS84 lat/lon.
 *
 * Includes the Israel 1993 -> WGS84 datum shift (~78 m in Israel; leaving it out puts an
 * ITM raster a city block away from where it belongs). Implementation in projections.ts.
 */
export { wgs84ToItm, itmToWgs84 } from './projections';
