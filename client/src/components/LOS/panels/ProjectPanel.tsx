import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLOSState, type Project } from '../../../contexts/LOSContext';
import {
  getLocalProjects,
  saveProjectToLocal,
  deleteProjectFromLocal,
  createProject,
  exportProjectToFile,
  importProjectFromFile,
  getStorageInfo,
} from '../../../utils/los/projectManager';
import styles from './ProjectPanel.module.css';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectPanel() {
  const { t } = useTranslation();
  const { state, loadProject } = useLOSState();
  const [projects, setProjects] = useState<Project[]>([]);
  const [storageInfo, setStorageInfo] = useState({ used: 0, projects: 0 });
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load projects on mount
  useEffect(() => {
    const loadedProjects = getLocalProjects();
    setProjects(loadedProjects);
    setStorageInfo(getStorageInfo());
  }, []);

  const handleCreateProject = useCallback(() => {
    if (!newProjectName.trim()) {
      setError(t('los.projects.nameRequired'));
      return;
    }

    try {
      const project = createProject(newProjectName.trim(), state.results, state.mapState);
      saveProjectToLocal(project);
      setProjects(prev => [...prev, project]);
      setNewProjectName('');
      setShowNewForm(false);
      setError(null);
      setStorageInfo(getStorageInfo());
    } catch (e: any) {
      setError(e.message || t('los.projects.saveError'));
    }
  }, [newProjectName, state.results, state.mapState]);

  const handleLoadProject = useCallback((project: Project) => {
    loadProject(project);
  }, [loadProject]);

  const handleDeleteProject = useCallback((id: string) => {
    if (!confirm(t('los.projects.confirmDelete'))) return;

    try {
      deleteProjectFromLocal(id);
      setProjects(prev => prev.filter(p => p.id !== id));
      setStorageInfo(getStorageInfo());
    } catch (e: any) {
      setError(e.message || t('los.projects.deleteError'));
    }
  }, []);

  const handleExportProject = useCallback((project: Project) => {
    try {
      exportProjectToFile(project);
    } catch (e: any) {
      setError(e.message || t('los.projects.exportError'));
    }
  }, []);

  const handleImportProject = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const project = await importProjectFromFile(file);
      saveProjectToLocal(project);
      setProjects(prev => [...prev, project]);
      setStorageInfo(getStorageInfo());
      setError(null);
    } catch (e: any) {
      setError(e.message || t('los.projects.importError'));
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleUpdateProject = useCallback((project: Project) => {
    try {
      const updatedProject = {
        ...project,
        results: state.results,
        mapState: state.mapState,
        updatedAt: new Date(),
      };
      saveProjectToLocal(updatedProject);
      setProjects(prev => prev.map(p => p.id === project.id ? updatedProject : p));
      setStorageInfo(getStorageInfo());
    } catch (e: any) {
      setError(e.message || t('los.projects.updateError'));
    }
  }, [state.results, state.mapState]);

  return (
    <div className={styles.container}>
      <div className={styles.storageInfo}>
        <span>{t('los.projects.storage')}: <span dir="ltr">{formatBytes(storageInfo.used)}</span></span>
        <span className={styles.separator}>|</span>
        <span>{storageInfo.projects} {t('los.projects.projectsCount')}</span>
      </div>

      {error && (
        <div className={styles.error}>
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.newBtn}
          onClick={() => setShowNewForm(!showNewForm)}
        >
          + {t('los.projects.newProject')}
        </button>
        <button
          className={styles.importBtn}
          onClick={() => fileInputRef.current?.click()}
        >
          {t('los.projects.import')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.elevmap.json"
          onChange={handleImportProject}
          style={{ display: 'none' }}
        />
      </div>

      {showNewForm && (
        <div className={styles.newForm}>
          <input
            type="text"
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            placeholder={t('los.projects.projectName')}
            className={styles.newInput}
            onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
            autoFocus
          />
          <div className={styles.newFormActions}>
            <button className={styles.saveBtn} onClick={handleCreateProject}>
              {t('los.projects.save')}
            </button>
            <button className={styles.cancelBtn} onClick={() => setShowNewForm(false)}>
              {t('los.projects.cancel')}
            </button>
          </div>
          <div className={styles.newFormHint}>
            {t('los.projects.willSave', { count: state.results.length })}
          </div>
        </div>
      )}

      <div className={styles.projectsList}>
        {projects.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📁</div>
            <p>{t('los.projects.noProjects')}</p>
            <p className={styles.emptyHint}>{t('los.projects.noProjectsHint')}</p>
          </div>
        ) : (
          projects.map(project => (
            <div key={project.id} className={styles.projectItem}>
              <div className={styles.projectHeader}>
                <div className={styles.projectInfo}>
                  <span className={styles.projectName}>{project.name}</span>
                  <span className={styles.projectMeta}>
                    {project.results.length} {t('los.projects.results')} | {t('los.projects.updated')}: {formatDate(project.updatedAt)}
                  </span>
                </div>
              </div>

              <div className={styles.projectActions}>
                <button
                  className={styles.loadBtn}
                  onClick={() => handleLoadProject(project)}
                  title={t('los.projects.load')}
                >
                  {t('los.projects.load')}
                </button>
                <button
                  className={styles.updateBtn}
                  onClick={() => handleUpdateProject(project)}
                  title={t('los.projects.updateWithCurrent')}
                >
                  {t('los.projects.update')}
                </button>
                <button
                  className={styles.exportBtn}
                  onClick={() => handleExportProject(project)}
                  title={t('los.projects.exportToFile')}
                >
                  {t('los.projects.export')}
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleDeleteProject(project.id)}
                  title={t('los.projects.delete')}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
