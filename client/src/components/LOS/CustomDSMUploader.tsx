import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  parseUploadedDSM,
  addCustomLayer,
  removeCustomLayer,
  getCustomLayers,
  onLayersChange,
  clearCustomLayers,
  type CustomDSMLayer,
  type DSMBounds
} from '../../utils/los/customDSM';
import styles from './CustomDSMUploader.module.css';

interface Props {
  onLayerChange?: (layers: CustomDSMLayer[]) => void;
  compact?: boolean;
}

export default function CustomDSMUploader({ onLayerChange, compact = false }: Props) {
  const { t } = useTranslation();
  const [layers, setLayers] = useState<CustomDSMLayer[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [editingBounds, setEditingBounds] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLayers(getCustomLayers());
    const unsubscribe = onLayersChange((newLayers) => {
      setLayers(newLayers);
      onLayerChange?.(newLayers);
    });
    return unsubscribe;
  }, [onLayerChange]);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);

    try {
      const result = await parseUploadedDSM(file);

      if (result.success && result.layer) {
        addCustomLayer(result.layer);
        setExpandedLayer(result.layer.id);
      } else {
        setError(result.error || t('los.dsm.unknownError'));
      }
    } catch (e) {
      setError(`${t('los.dsm.error')}: ${(e as Error).message}`);
    }

    setUploading(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ''; // Reset for same file selection
  }, [handleFile]);

  const handleRemoveLayer = useCallback((id: string) => {
    removeCustomLayer(id);
    if (expandedLayer === id) setExpandedLayer(null);
  }, [expandedLayer]);

  const formatBounds = (bounds: DSMBounds) => {
    return `${bounds.south.toFixed(4)}°-${bounds.north.toFixed(4)}°N, ${bounds.west.toFixed(4)}°-${bounds.east.toFixed(4)}°E`;
  };

  const formatSize = (layer: CustomDSMLayer) => {
    return `${layer.width}×${layer.height} (${(layer.width * layer.height / 1000000).toFixed(2)}M ${t('los.dsm.pixels')})`;
  };

  if (compact) {
    return (
      <div className={styles.compactContainer}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tif,.tiff,.asc,.res,.hgt,.img"
          onChange={handleFileSelect}
          className={styles.hiddenInput}
        />
        <button
          className={styles.compactButton}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '⏳' : '📁'} {t('los.dsm.customDSM')}
          {layers.length > 0 && <span className={styles.layerBadge}>{layers.length}</span>}
        </button>
        {error && <div className={styles.compactError}>{error}</div>}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>🗺️ {t('los.dsm.customDSMTitle')}</h3>
        <span className={styles.subtitle}>{t('los.dsm.uploadLocalFiles')}</span>
      </div>

      {/* Drop zone */}
      <div
        className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''} ${uploading ? styles.uploading : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".tif,.tiff,.asc,.res,.hgt,.img"
          onChange={handleFileSelect}
          className={styles.hiddenInput}
        />

        {uploading ? (
          <div className={styles.uploading}>
            <span className={styles.spinner}>⏳</span>
            <span>{t('los.dsm.processing')}</span>
          </div>
        ) : (
          <>
            <span className={styles.dropIcon}>📁</span>
            <span className={styles.dropText}>{t('los.dsm.dropzoneText')}</span>
            <span className={styles.dropFormats}>GeoTIFF, ASC, RES, HGT, IMG</span>
          </>
        )}
      </div>

      {error && (
        <div className={styles.error}>
          <span>⚠️</span>
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Layers list */}
      {layers.length > 0 && (
        <div className={styles.layersList}>
          <div className={styles.layersHeader}>
            <span>{t('los.dsm.activeLayers')} ({layers.length})</span>
            <button
              className={styles.clearAllBtn}
              onClick={() => clearCustomLayers()}
              title={t('los.dsm.removeAll')}
            >
              🗑️
            </button>
          </div>

          {layers.map(layer => (
            <div
              key={layer.id}
              className={`${styles.layerItem} ${expandedLayer === layer.id ? styles.expanded : ''}`}
            >
              <div
                className={styles.layerHeader}
                onClick={() => setExpandedLayer(expandedLayer === layer.id ? null : layer.id)}
              >
                <span className={styles.layerIcon}>🏔️</span>
                <span className={styles.layerName}>{layer.name}</span>
                <span className={styles.layerExpand}>{expandedLayer === layer.id ? '▼' : '▶'}</span>
                <button
                  className={styles.removeBtn}
                  onClick={(e) => { e.stopPropagation(); handleRemoveLayer(layer.id); }}
                  title={t('los.dsm.remove')}
                >
                  ✕
                </button>
              </div>

              {expandedLayer === layer.id && (
                <div className={styles.layerDetails}>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>{t('los.dsm.size')}:</span>
                    <span className={styles.detailValue}>{formatSize(layer)}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>{t('los.dsm.resolution')}:</span>
                    <span className={styles.detailValue}>{layer.resolution.toFixed(2)} {t('los.dsm.metersPerPixel')}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>{t('los.dsm.elevationRange')}:</span>
                    <span className={styles.detailValue}>{layer.minElevation.toFixed(1)} - {layer.maxElevation.toFixed(1)} {t('los.dsm.metersUnit')}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>{t('los.dsm.bounds')}:</span>
                    <span className={styles.detailValue}>{formatBounds(layer.bounds)}</span>
                  </div>

                  {/* Bounds editor for RES files without proper georeferencing */}
                  {editingBounds === layer.id ? (
                    <BoundsEditor
                      layer={layer}
                      onSave={(newBounds) => {
                        // Update layer bounds
                        layer.bounds = newBounds;
                        setEditingBounds(null);
                      }}
                      onCancel={() => setEditingBounds(null)}
                    />
                  ) : (
                    <button
                      className={styles.editBoundsBtn}
                      onClick={() => setEditingBounds(layer.id)}
                    >
                      ✏️ {t('los.dsm.editBounds')}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={styles.info}>
        <span className={styles.infoIcon}>ℹ️</span>
        <span>{t('los.dsm.infoNote')}</span>
      </div>
    </div>
  );
}

// Bounds editor sub-component
interface BoundsEditorProps {
  layer: CustomDSMLayer;
  onSave: (bounds: DSMBounds) => void;
  onCancel: () => void;
}

function BoundsEditor({ layer, onSave, onCancel }: BoundsEditorProps) {
  const { t } = useTranslation();
  const [bounds, setBounds] = useState<DSMBounds>({ ...layer.bounds });

  return (
    <div className={styles.boundsEditor}>
      <div className={styles.boundsGrid}>
        <div className={styles.boundsInput}>
          <label>{t('los.dsm.north')}</label>
          <input
            type="number"
            step="0.0001"
            value={bounds.north}
            onChange={(e) => setBounds({ ...bounds, north: parseFloat(e.target.value) })}
          />
        </div>
        <div className={styles.boundsInput}>
          <label>{t('los.dsm.south')}</label>
          <input
            type="number"
            step="0.0001"
            value={bounds.south}
            onChange={(e) => setBounds({ ...bounds, south: parseFloat(e.target.value) })}
          />
        </div>
        <div className={styles.boundsInput}>
          <label>{t('los.dsm.east')}</label>
          <input
            type="number"
            step="0.0001"
            value={bounds.east}
            onChange={(e) => setBounds({ ...bounds, east: parseFloat(e.target.value) })}
          />
        </div>
        <div className={styles.boundsInput}>
          <label>{t('los.dsm.west')}</label>
          <input
            type="number"
            step="0.0001"
            value={bounds.west}
            onChange={(e) => setBounds({ ...bounds, west: parseFloat(e.target.value) })}
          />
        </div>
      </div>
      <div className={styles.boundsActions}>
        <button className={styles.saveBtn} onClick={() => onSave(bounds)}>{t('los.dsm.save')}</button>
        <button className={styles.cancelBtn} onClick={onCancel}>{t('los.dsm.cancel')}</button>
      </div>
    </div>
  );
}
