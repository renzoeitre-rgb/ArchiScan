import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredFile, AuditReport, Project, ProjectFramework } from './types';

interface ArchiScanDB extends DBSchema {
	projects: {
		key: string;
		value: Project;
	};
	files: {
		key: string;
		value: StoredFile;
		indexes: { 'by-project': string };
	};
	reports: {
		key: string;
		value: AuditReport;
		indexes: { 'by-file': string; 'by-project': string };
	};
	config: {
		key: string;
		value: string;
	};
}

export type ConfigKey = 'geminiApiKey' | 'claudeApiKey' | 'openRouterApiKey' | 'selectedModel' | 'claudeSelectedModel' | 'openRouterSelectedModel' | 'activeProvider' | 'currentProjectId';

let dbPromise: Promise<IDBPDatabase<ArchiScanDB>>;

export function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<ArchiScanDB>('ArchiScanDB', 2, {
			upgrade(db, oldVersion, newVersion, transaction) {
				if (oldVersion < 1) {
					db.createObjectStore('files', { keyPath: 'id' });
					const reportStore = db.createObjectStore('reports', { keyPath: 'id' });
					reportStore.createIndex('by-file', 'fileId');
					db.createObjectStore('config');
				}
				if (oldVersion < 2) {
					db.createObjectStore('projects', { keyPath: 'id' });
					
					const fileStore = transaction.objectStore('files');
					if (!fileStore.indexNames.contains('by-project')) {
						fileStore.createIndex('by-project', 'projectId');
					}

					const reportStore = transaction.objectStore('reports');
					if (!reportStore.indexNames.contains('by-project')) {
						reportStore.createIndex('by-project', 'projectId');
					}
				}
			}
		});
	}
	return dbPromise;
}

// ── Project Management ──────────────────────────────────────────────────────

export async function createProject(name: string, framework: ProjectFramework): Promise<string> {
	const db = await getDB();
	const id = crypto.randomUUID();
	const project: Project = {
		id,
		name,
		createdAt: new Date(),
		framework
	};
	await db.put('projects', project);
	await setConfig('currentProjectId', id);
	return id;
}

export async function getAllProjects() {
	const db = await getDB();
	return db.getAll('projects');
}

export async function getProject(id: string) {
	const db = await getDB();
	return db.get('projects', id);
}

export async function deleteProject(id: string) {
	const db = await getDB();
	// Delete all files and reports associated with this project
	const tx = db.transaction(['projects', 'files', 'reports'], 'readwrite');
	
	const fileIds = await tx.objectStore('files').index('by-project').getAllKeys(id);
	for (const fileId of fileIds) {
		await tx.objectStore('files').delete(fileId);
	}

	const reportIds = await tx.objectStore('reports').index('by-project').getAllKeys(id);
	for (const reportId of reportIds) {
		await tx.objectStore('reports').delete(reportId);
	}

	await tx.objectStore('projects').delete(id);
	await tx.done;

	// If the deleted project was the current one, clear it
	const currentId = await getConfig('currentProjectId');
	if (currentId === id) {
		await setConfig('currentProjectId', '');
	}
}

// ── File Management ─────────────────────────────────────────────────────────

export async function addFile(file: Omit<StoredFile, 'id'>) {
	const db = await getDB();
	const id = crypto.randomUUID();
	const storedFile = { ...file, id };
	await db.put('files', storedFile);
	return id;
}

export async function getFilesForProject(projectId: string) {
	const db = await getDB();
	return db.getAllFromIndex('files', 'by-project', projectId);
}

export async function getAllFiles() {
	const currentProjectId = await getConfig('currentProjectId');
	if (!currentProjectId) return [];
	return getFilesForProject(currentProjectId);
}

export async function getFile(id: string) {
	const db = await getDB();
	return db.get('files', id);
}

export async function deleteFile(id: string) {
	const db = await getDB();
	await db.delete('files', id);
}

/**
 * Detaches the current project from the workspace without deleting data.
 * This allows the user to start a new analysis session.
 */
export async function detachProject() {
	await setConfig('currentProjectId', '');
}

/**
 * Cleanup orphaned files/reports that don't belong to any project.
 * (e.g. data from before the multi-project history update)
 */
export async function cleanupOrphanedData() {
	const db = await getDB();
	const tx = db.transaction(['files', 'reports'], 'readwrite');
	const fileStore = tx.objectStore('files');
	const reportStore = tx.objectStore('reports');

	const allFiles = await fileStore.getAll();
	for (const f of allFiles) {
		if (!f.projectId) await fileStore.delete(f.id);
	}
	const allReports = await reportStore.getAll();
	for (const r of allReports) {
		if (!r.projectId) await reportStore.delete(r.id);
	}
	await tx.done;
}

// ── Report Management ───────────────────────────────────────────────────────

export async function saveReport(report: Omit<AuditReport, 'id'>) {
	const db = await getDB();
	const id = crypto.randomUUID();
	const storedReport = { ...report, id };
	await db.put('reports', storedReport);

	// Update lastAudited in files store
	const file = await db.get('files', report.fileId);
	if (file) {
		file.lastAudited = report.createdAt;
		await db.put('files', file);
	}

	return id;
}

export async function getReportsForFile(fileId: string) {
	const db = await getDB();
	return db.getAllFromIndex('reports', 'by-file', fileId);
}

export async function getReportsForProject(projectId: string) {
	const db = await getDB();
	return db.getAllFromIndex('reports', 'by-project', projectId);
}

// ── Config Management ───────────────────────────────────────────────────────

export async function getConfig(key: ConfigKey) {
	const db = await getDB();
	return db.get('config', key);
}

export async function setConfig(key: ConfigKey, value: string) {
	const db = await getDB();
	await db.put('config', value, key);
}
