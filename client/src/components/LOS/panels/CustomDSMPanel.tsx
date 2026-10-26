import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './CustomDSMPanel.module.css';
import type { CustomDSMLayer } from '../../../utils/los/customDSM';

interface DSMLayer {
  id: string;
  name: string;
  resolution: number;
  pointCount: number;
}

function toPanelLayer(layer: CustomDSMLayer): DSMLayer {
  return {
    id: layer.id,
    name: layer.name,
    resolution: layer.resolution || 0,
    pointCount: layer.data?.length || 0,
  };
}

// The DSM module pulls in geotiff, so it is only loaded when this panel is used.
const loadDsmModule = () => import('../../../utils/los/customDSM');

export default function CustomDSMPanel() {
  const { t } = useTranslation();
  const [layers, setLayers] = useState<DSMLayer[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Mirror the module's layer list (also reflects layers added or removed elsewhere).
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    loadDsmModule()
      .then(dsm => {
        if (cancelled) return;
        setLayers(dsm.getCustomLayers().map(toPanelLayer));
        unsubscribe = dsm.onLayersChange(next => setLayers(next.map(toPanelLayer)));
      })
      .catch(e => console.warn('Could not load DSM layers:', e));

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const handleFiles = useCallback(async (files: FileList) => {
    if (files.length === 0) return;

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      const dsm = await loadDsmModule();
      const failures: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(Math.round(((i + 0.5) / files.length) * 100));

        const result = await dsm.parseUploadedDSM(file);
        if (result.success && result.layer) {
          dsm.addCustomLayer(result.layer);
        } else {
          failures.push(`${file.name}: ${result.error || t('los.dsm.uploadError')}`);
        }

        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

      if (failures.length > 0) setError(failures.join('\n'));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('los.dsm.uploadError'));
      console.error('DSM upload error:', e);
    } finally {
      setUploading(false);
    }
  }, [t]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
    e.target.value = ''; // allow selecting the same file again
  }, [handleFiles]);

  const handleRemoveLayer = useCallback(async (id: string) => {
    try {
      const dsm = await loadDsmModule();
      dsm.removeCustomLayer(id);
    } catch (e) {
      console.error('Error removing layer:', e);
    }
  }, []);

  return (
    <div className={styles.container}>
      <div
        className={`${styles.dropzone} ${dragActive ? styles.active : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id="dsm-file-input"
          className={styles.fileInput}
          multiple
          accept=".tif,.tiff,.asc,.hgt,.res,.img"
          onChange={handleFileInput}
        />
        <label htmlFor="dsm-file-input" className={styles.dropzoneLabel}>
          <span className={styles.dropzoneIcon}>📂</span>
          <span className={styles.dropzoneText}>
            {t('los.dsm.dropzoneText')}
          </span>
          <span className={styles.dropzoneFormats}>
            GeoTIFF, ASC, HGT, RES, IMG
          </span>
        </label>
      </div>

      {uploading && (
        <div className={styles.progressCard}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
          <div className={styles.progressText}>{t('los.dsm.uploading')} {progress}%</div>
        </div>
      )}

      {error && (
        <div className={styles.error} style={{ whiteSpace: 'pre-line' }}>{error}</div>
      )}

      <div className={styles.layersList}>
        <div className={styles.layersHeader}>
          <span>{t('los.dsm.layers')}</span>
          <span className={styles.layerCount}>{layers.length}</span>
        </div>

        {layers.length === 0 ? (
          <div className={styles.emptyLayers}>
            {t('los.dsm.noLayers')}
          </div>
        ) : (
          layers.map(layer => (
            <div key={layer.id} className={styles.layerItem}>
              <div className={styles.layerInfo}>
                <span className={styles.layerName}>{layer.name}</span>
                <span className={styles.layerMeta}>
                  {layer.pointCount > 0 && `${layer.pointCount.toLocaleString()} ${t('los.dsm.points')}`}
                  {layer.resolution > 0 && ` | ${layer.resolution}m`}
                </span>
              </div>
              <button
                className={styles.removeBtn}
                onClick={() => handleRemoveLayer(layer.id)}
                title={t('los.dsm.remove')}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className={styles.info}>
        <h4>{t('los.dsm.info')}</h4>
        <p>
          {t('los.dsm.infoDescription')}
        </p>
        <p>
          <strong>{t('los.dsm.supportedFormats')}:</strong><br />
          • GeoTIFF (.tif, .tiff)<br />
          • ESRI ASCII Grid (.asc)<br />
          • SRTM HGT (.hgt)<br />
          • RES
        </p>
        <p>
          <strong>{t('los.dsm.coordinateSystems')}:</strong><br />
          {t('los.dsm.coordinateSystemsList')}
        </p>
      </div>
    </div>
  );
}
