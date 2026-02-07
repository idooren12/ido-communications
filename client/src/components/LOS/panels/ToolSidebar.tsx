import React, { Suspense, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLOSState, type PanelType } from '../../../contexts/LOSContext';
import styles from './ToolSidebar.module.css';

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 280;
const LS_WIDTH_KEY = 'los-sidebar-width';

// Lazy load panels
const LOSLinePanel = React.lazy(() => import('./LOSLinePanel'));
const LOSAreaPanel = React.lazy(() => import('./LOSAreaPanel'));
const PeakFinderPanel = React.lazy(() => import('./PeakFinderPanel'));
const CustomDSMPanel = React.lazy(() => import('./CustomDSMPanel'));
const ResultsPanel = React.lazy(() => import('./ResultsPanel'));
const ProjectPanel = React.lazy(() => import('./ProjectPanel'));

interface Tool {
  id: PanelType;
  labelKey: string;
  icon: string;
  shortcut: string;
}

const tools: Tool[] = [
  { id: 'los-line', labelKey: 'los.sidebar.losLine', icon: '━', shortcut: '1' },
  { id: 'los-area', labelKey: 'los.sidebar.losArea', icon: '◎', shortcut: '2' },
  { id: 'peaks', labelKey: 'los.sidebar.peaks', icon: '△', shortcut: '3' },
  { id: 'dsm', labelKey: 'los.sidebar.dsm', icon: '▤', shortcut: '4' },
  { id: 'results', labelKey: 'los.sidebar.results', icon: '☰', shortcut: '5' },
  { id: 'projects', labelKey: 'los.sidebar.projects', icon: '◎', shortcut: '6' },
];

export default function ToolSidebar() {
  const { t } = useTranslation();
  const { state, setActivePanel, getResultsByType, toggleSidebar } = useLOSState();
  const { activePanel, sidebarCollapsed, results } = state;

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_WIDTH_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, parsed));
      }
    } catch {}
    return SIDEBAR_DEFAULT_WIDTH;
  });
  const isDragging = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      // RTL: sidebar is on the right. Dragging handle LEFT increases width.
      const delta = startX - ev.clientX;
      const newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Save final width
      setSidebarWidth(w => {
        try { localStorage.setItem(LS_WIDTH_KEY, String(w)); } catch {}
        return w;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  // Handle keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key;
      const tool = tools.find(t => t.shortcut === key);
      if (tool) {
        e.preventDefault();
        setActivePanel(activePanel === tool.id ? null : tool.id);
      }

      // Escape to close panel
      if (key === 'Escape' && activePanel) {
        setActivePanel(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePanel, setActivePanel]);

  // Count results by type
  const getResultCount = (type: PanelType): number => {
    if (type === 'los-line') return getResultsByType('los-line').length;
    if (type === 'los-area') return getResultsByType('los-area').length;
    if (type === 'peaks') return getResultsByType('peaks').length;
    if (type === 'results') return results.length;
    return 0;
  };

  const handleToolClick = (toolId: PanelType) => {
    setActivePanel(activePanel === toolId ? null : toolId);
  };

  return (
    <div
      className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ''}`}
      style={{ width: sidebarCollapsed ? 56 : sidebarWidth }}
    >
      {!sidebarCollapsed && (
        <div className={styles.resizeHandle} onMouseDown={handleResizeStart} />
      )}
      <div className={styles.header}>
        <h1 className={styles.logo}>{t('los.sidebar.title')}</h1>
        <button className={styles.collapseBtn} onClick={toggleSidebar} title={sidebarCollapsed ? t('los.sidebar.expand') : t('los.sidebar.collapse')}>
          {sidebarCollapsed ? '»' : '«'}
        </button>
      </div>

      <nav className={styles.tabs}>
        {tools.map((tool) => {
          const count = getResultCount(tool.id);
          return (
            <button
              key={tool.id}
              className={`${styles.tab} ${activePanel === tool.id ? styles.active : ''}`}
              onClick={() => handleToolClick(tool.id)}
              title={`${t(tool.labelKey)} (${tool.shortcut})`}
            >
              <span className={styles.tabIcon}>{tool.icon}</span>
              {!sidebarCollapsed && (
                <>
                  <span className={styles.tabLabel}>{t(tool.labelKey)}</span>
                  {count > 0 && <span className={styles.badge}>{count}</span>}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {activePanel && !sidebarCollapsed && (
        <div className={styles.panelContainer}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              {(() => { const tool = tools.find(tl => tl.id === activePanel); return tool ? t(tool.labelKey) : ''; })()}
            </h2>
            <button className={styles.closeBtn} onClick={() => setActivePanel(null)}>×</button>
          </div>
          <div className={styles.panelContent}>
            <Suspense fallback={<div className={styles.panelLoading}>{t('common.loading')}</div>}>
              {activePanel === 'los-line' && <LOSLinePanel />}
              {activePanel === 'los-area' && <LOSAreaPanel />}
              {activePanel === 'peaks' && <PeakFinderPanel />}
              {activePanel === 'dsm' && <CustomDSMPanel />}
              {activePanel === 'results' && <ResultsPanel />}
              {activePanel === 'projects' && <ProjectPanel />}
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
