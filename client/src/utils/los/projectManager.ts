/**
 * Project Manager - Save and load calculation projects
 */

import type { CalculationResult, MapState, Project } from '../../contexts/LOSContext';

const STORAGE_KEY = 'elevation-map-projects';

// Generate unique ID
function generateId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Serialize dates for JSON storage
function serializeProject(project: Project): any {
  return {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    results: project.results.map(r => ({
      ...r,
      timestamp: r.timestamp.toISOString(),
    })),
  };
}

// Deserialize dates from JSON storage
function deserializeProject(data: any): Project {
  return {
    ...data,
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
    results: data.results.map((r: any) => ({
      ...r,
      timestamp: new Date(r.timestamp),
    })),
  };
}

/**
 * Get all projects from localStorage
 */
export function getLocalProjects(): Project[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const data = JSON.parse(stored);
    return data.map(deserializeProject);
  } catch (e) {
    console.error('Error loading projects:', e);
    return [];
  }
}

/**
 * Save a project to localStorage
 */
export function saveProjectToLocal(project: Project): void {
  if (typeof window === 'undefined') return;

  try {
    const projects = getLocalProjects();
    const existingIndex = projects.findIndex(p => p.id === project.id);

    if (existingIndex >= 0) {
      projects[existingIndex] = project;
    } else {
      projects.push(project);
    }

    const serialized = projects.map(serializeProject);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (e) {
    console.error('Error saving project:', e);
    throw new Error('Failed to save project');
  }
}

/**
 * Load a project by ID
 */
export function loadProjectFromLocal(id: string): Project | null {
  const projects = getLocalProjects();
  return projects.find(p => p.id === id) || null;
}

/**
 * Delete a project from localStorage
 */
export function deleteProjectFromLocal(id: string): void {
  if (typeof window === 'undefined') return;

  try {
    const projects = getLocalProjects().filter(p => p.id !== id);
    const serialized = projects.map(serializeProject);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (e) {
    console.error('Error deleting project:', e);
    throw new Error('Failed to delete project');
  }
}

/**
 * Create a new project from current state
 */
export function createProject(
  name: string,
  results: CalculationResult[],
  mapState: MapState
): Project {
  const now = new Date();
  return {
    id: generateId(),
    name,
    createdAt: now,
    updatedAt: now,
    results,
    mapState,
  };
}

/**
 * Export project to JSON file
 */
export function exportProjectToFile(project: Project): void {
  const serialized = serializeProject(project);
  const json = JSON.stringify(serialized, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^a-zA-Z0-9\u0590-\u05FF]/g, '_')}.elevmap.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import project from JSON file
 */
export async function importProjectFromFile(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);

        // Validate basic structure
        if (!data.id || !data.name || !data.results || !data.mapState) {
          throw new Error('Invalid project file format');
        }

        // Generate new ID to avoid conflicts
        const project = deserializeProject({
          ...data,
          id: generateId(),
          updatedAt: new Date().toISOString(),
        });

        resolve(project);
      } catch (e) {
        reject(new Error('Failed to parse project file'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsText(file);
  });
}

/**
 * Get storage usage info
 */
export function getStorageInfo(): { used: number; projects: number } {
  if (typeof window === 'undefined') return { used: 0, projects: 0 };

  try {
    const stored = localStorage.getItem(STORAGE_KEY) || '[]';
    return {
      used: new Blob([stored]).size,
      projects: JSON.parse(stored).length,
    };
  } catch {
    return { used: 0, projects: 0 };
  }
}

/**
 * Clear all projects
 */
export function clearAllProjects(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
