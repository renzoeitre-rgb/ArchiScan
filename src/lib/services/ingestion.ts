import { addFile } from '../db';
import type { ProjectFramework } from '../types';

export const ALLOWED_EXTENSIONS = new Set([
	'ts', 'svelte', 'js', 'mjs', 'cjs', 'json',
	'css', 'html', 'md', 'txt', 'env', 'toml', 'yaml', 'yml'
]);

export const BLOCKED_SEGMENTS = ['node_modules/', '/.git/', '/dist/', '/.svelte-kit/', '/build/'];

export function shouldSkipFile(path: string, fileName: string): boolean {
	const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
	if (!ALLOWED_EXTENSIONS.has(ext)) return true;
	if (BLOCKED_SEGMENTS.some((s) => path.includes(s))) return true;
	if (path.split('/').some((p) => p.startsWith('.'))) return true;
	return false;
}

/**
 * Detects all unique extensions present in a file list.
 * This is used for the extension selection UI.
 */
export function getAvailableExtensions(files: FileList | File[]): string[] {
	const extensions = new Set<string>();
	for (const file of Array.from(files)) {
		const path = file.webkitRelativePath || file.name;
		if (shouldSkipFile(path, file.name)) continue;
		const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
		if (ALLOWED_EXTENSIONS.has(ext)) {
			extensions.add(ext);
		}
	}
	return Array.from(extensions).sort();
}

/**
 * Counts how many files would be indexed based on skip rules.
 */
export function countEligibleFiles(files: FileList | File[]): number {
	let count = 0;
	for (const file of Array.from(files)) {
		const path = file.webkitRelativePath || file.name;
		if (!shouldSkipFile(path, file.name)) count++;
	}
	return count;
}

/**
 * Extracts the root folder name from a list of selected files.
 */
export function getRootFolderName(files: FileList | File[]): string {
	if (!files || files.length === 0) return '';
	const firstFile = files[0];
	const path = firstFile.webkitRelativePath || firstFile.name;
	return path.split('/')[0] || '';
}

export async function detectProjectFramework(files: FileList | File[]): Promise<ProjectFramework> {
	let svelteCount = 0;
	let reactCount = 0;
	let vueCount = 0;

	for (const file of Array.from(files)) {
		const path = file.webkitRelativePath || file.name;
		if (BLOCKED_SEGMENTS.some(s => path.includes(s))) continue;
		if (path.split('/').some(p => p.startsWith('.'))) continue;

		const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
		if (ALLOWED_EXTENSIONS.has(ext)) {
			if (ext === 'svelte') svelteCount++;
			if (ext === 'vue') vueCount++;
			if (ext === 'jsx' || ext === 'tsx') reactCount++;
			if (file.name === 'package.json') {
				const content = await file.slice(0, 5000).text();
				if (content.includes('"svelte"')) svelteCount += 100;
				if (content.includes('"react"')) reactCount += 100;
				if (content.includes('"vue"')) vueCount += 100;
			}
		}
	}

	if (svelteCount > reactCount && svelteCount > vueCount) return 'svelte';
	if (reactCount > svelteCount && reactCount > vueCount) return 'react';
	if (vueCount > svelteCount && vueCount > reactCount) return 'vue';
	return 'unknown';
}

/**
 * Orchestrates the ingestion of a list of files into the database.
 */
export async function processIngestion(
	projectId: string,
	files: File[],
	onProgress: (done: number) => void
): Promise<number> {
	return await ingestFiles(projectId, files, (done) => {
		onProgress(done);
	});
}

export interface ProjectDiscovery {
	framework: ProjectFramework;
	extensions: string[];
	eligibleCount: number;
	rootFolder: string;
}

/**
 * Orchestrates the discovery of a project's metadata from a file list.
 * This is a "Domain Orchestrator" that prevents logic leakage into UI components.
 */
export async function discoverProject(files: FileList | File[]): Promise<ProjectDiscovery> {
	const framework = await detectProjectFramework(files);
	const extensions = getAvailableExtensions(files);
	const eligibleCount = countEligibleFiles(files);
	const rootFolder = getRootFolderName(files);

	return {
		framework,
		extensions,
		eligibleCount,
		rootFolder
	};
}

export async function ingestFiles(
	projectId: string,
	files: File[], 
	onProgress: (done: number, total: number) => void
): Promise<number> {
	let processed = 0;
	for (const file of files) {
		const content = await file.text();
		await addFile({
			projectId,
			path: file.webkitRelativePath || file.name,
			content,
			extension: file.name.split('.').pop()?.toLowerCase() ?? 'txt',
			size: content.length,
			lastAudited: null
		});
		processed++;
		onProgress(processed, files.length);
	}
	return processed;
}

/**
 * Domain-specific filtering of file lists for ingestion.
 * This abstracts the "Business Rule" of which files are eligible for analysis.
 */
export function getEligibleFiles(files: FileList | File[], selectedExtensions: Set<string>): File[] {
	return Array.from(files).filter(f => {
		const path = f.webkitRelativePath || f.name;
		const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
		return selectedExtensions.has(ext) && !shouldSkipFile(path, f.name);
	});
}
