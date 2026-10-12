/**
 * HTML builders for MapLibre popups on the LOS map.
 *
 * MapLibre popups take raw HTML, so every dynamic value is escaped (geocoder names
 * and imported project data are not trusted), and all text is localized.
 */
import i18n from '../../i18n/config';

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const dir = () => (i18n.language === 'he' ? 'rtl' : 'ltr');
const meters = (value: number) => `${escapeHtml(value)} ${escapeHtml(t('units.m'))}`;

function modeLabel(mode: string, rfFrequency?: string): string {
  const base = mode === 'optical' ? t('los.popup.optical') : 'RF';
  return escapeHtml(rfFrequency ? `${base} (${rfFrequency})` : base);
}

function actionButtons(resultId: string): string {
  const id = escapeHtml(resultId);
  return `
    <div style="display:flex;gap:6px;margin-top:8px;">
      <button data-action="edit" data-result-id="${id}"
        style="flex:1;padding:6px;background:#22d3ee;color:#0a0a0c;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer;">
        ${escapeHtml(t('los.popup.edit'))}
      </button>
      <button data-action="delete" data-result-id="${id}"
        style="padding:6px 10px;background:rgba(244,63,94,0.15);color:#f43f5e;border:1px solid rgba(244,63,94,0.3);border-radius:6px;font-weight:600;font-size:12px;cursor:pointer;">
        ${escapeHtml(t('los.popup.delete'))}
      </button>
    </div>`;
}

function coordinateRows(lat: number, lon: number, height: number): string {
  return `
    <div>${escapeHtml(t('los.popup.latitude'))}: <span style="color:white;font-family:monospace;">${lat.toFixed(6)}</span></div>
    <div>${escapeHtml(t('los.popup.longitude'))}: <span style="color:white;font-family:monospace;">${lon.toFixed(6)}</span></div>
    <div>${escapeHtml(t('los.popup.height'))}: <span style="color:white;">${meters(height)}</span></div>`;
}

export function searchResultPopup(displayName: string, lat: number, lon: number, elevation: number | null): string {
  const name = displayName.split(',').slice(0, 2).join(', ');
  const elev = elevation !== null ? meters(Math.round(elevation)) : escapeHtml(t('los.popup.unavailable'));
  return `<div style="direction:${dir()};padding:4px;">
    <div style="font-weight:600;">${escapeHtml(name)}</div>
    <div style="font-size:12px;color:#888;">${lat.toFixed(5)}, ${lon.toFixed(5)}<br/>
      <span style="color:#22d3ee;">${escapeHtml(t('los.popup.height'))}: ${elev}</span>
    </div>
  </div>`;
}

export function peakPopup(rank: number, lat: number, lon: number, elevation: number): string {
  return `<div style="direction:${dir()};padding:4px;">
    <div style="font-weight:600;">${escapeHtml(t('los.popup.peak', { rank }))}</div>
    <div style="font-size:12px;color:#888;">
      ${lat.toFixed(5)}, ${lon.toFixed(5)}<br/>
      <span style="color:#22d3ee;">${escapeHtml(t('los.popup.height'))}: ${meters(Math.round(elevation))}</span>
    </div>
  </div>`;
}

export function losLinePointPopup(params: {
  label: string;
  lat: number;
  lon: number;
  height: number;
  mode: string;
  rfFrequency?: string;
  clear: boolean;
  resultId: string;
}): string {
  const resultColor = params.clear ? '#10b981' : '#f43f5e';
  const resultText = params.clear ? `✓ ${t('los.popup.losClear')}` : `✕ ${t('los.popup.losBlocked')}`;
  return `<div style="direction:${dir()};padding:8px;min-width:180px;">
    <div style="font-weight:600;font-size:13px;color:white;margin-bottom:6px;">${escapeHtml(t('los.popup.point', { label: params.label }))}</div>
    <div style="font-size:11px;color:#aaa;line-height:1.6;">${coordinateRows(params.lat, params.lon, params.height)}</div>
    <hr style="border-color:#333;margin:8px 0;" />
    <div style="font-size:11px;color:#aaa;">
      <div>${escapeHtml(t('los.popup.mode'))}: ${modeLabel(params.mode, params.rfFrequency)}</div>
      <div style="color:${resultColor};">${escapeHtml(resultText)}</div>
    </div>
    ${actionButtons(params.resultId)}
  </div>`;
}

export function losAreaOriginPopup(params: {
  lat: number;
  lon: number;
  height: number;
  targetHeight: number;
  minDistance: number;
  maxDistance: number;
  minAzimuth: number;
  maxAzimuth: number;
  resolution: number;
  mode: string;
  rfFrequency?: string;
  resultId: string;
}): string {
  const m = escapeHtml(t('units.m'));
  return `<div style="direction:${dir()};padding:8px;min-width:180px;">
    <div style="font-weight:600;font-size:13px;color:white;margin-bottom:6px;">${escapeHtml(t('los.popup.origin'))}</div>
    <div style="font-size:11px;color:#aaa;line-height:1.6;">${coordinateRows(params.lat, params.lon, params.height)}</div>
    <hr style="border-color:#333;margin:8px 0;" />
    <div style="font-size:11px;color:#aaa;line-height:1.6;">
      <div>${escapeHtml(t('los.popup.targetHeight'))}: ${meters(params.targetHeight)}</div>
      <div>${escapeHtml(t('los.popup.range'))}: ${escapeHtml(params.minDistance)}-${escapeHtml(params.maxDistance)} ${m}</div>
      <div>${escapeHtml(t('los.popup.azimuth'))}: ${escapeHtml(params.minAzimuth)}°-${escapeHtml(params.maxAzimuth)}°</div>
      <div>${escapeHtml(t('los.popup.resolution'))}: ${meters(params.resolution)}</div>
      <div>${escapeHtml(t('los.popup.mode'))}: ${modeLabel(params.mode, params.rfFrequency)}</div>
    </div>
    ${actionButtons(params.resultId)}
  </div>`;
}
