import { saveReport, getConfig, getReportsForProject } from '../db';
import { audit, judgeBatch, getActiveProvider } from './aiProvider';
import type { StoredFile, Violation, RuleId, AuditStatus, ProjectFramework } from '../types';
import { SvelteMap } from 'svelte/reactivity';
import { detectProtocol } from '../protocols';
import type { FrameworkProtocol } from '../protocols/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function calculateScore(violations: Violation[]): number {
	const errors   = violations.filter((v) => v.severity === 'error' && !v.isFalsePositive).length;
	const warnings = violations.filter((v) => v.severity === 'warning' && !v.isFalsePositive).length;
	const info     = violations.filter((v) => v.severity === 'info' && !v.isFalsePositive).length;
	return Math.max(0, 100 - errors * 10 - warnings * 0.5 - info * 0.1);
}

/**
 * ── Pass 1: Regex & Local Heuristics ─────────────────────────────────────────
 */
function runRegex(file: StoredFile, protocol: FrameworkProtocol, framework: ProjectFramework): Violation[] {
	const violations: Violation[] = [];

	const isUIFile = (f: StoredFile, fw: ProjectFramework) => {
		if (f.extension === 'svelte' || f.extension === 'vue') return true;
		if (fw === 'react' && (f.extension === 'jsx' || f.extension === 'tsx')) return true;
		if (fw === 'react' && f.extension === 'js' && (f.content.includes("from 'react'") || f.content.includes("from \"react\""))) return true;
		return false;
	};

	for (const rule of protocol.regexRules) {
		const isComponentRule = ['LOGIC_SEP', 'FRAMEWORK_INT', 'PORT_LAW'].includes(rule.ruleId);
		
		// Skip component-specific rules if the file is not a UI component
		if (isComponentRule && !isUIFile(file, framework)) continue;
		
		rule.pattern.lastIndex = 0;
		let match;
		while ((match = rule.pattern.exec(file.content)) !== null) {
			const lines = file.content.substring(0, match.index).split('\n');
			violations.push({
				id: crypto.randomUUID(),
				file: file.path,
				ruleId: rule.ruleId,
				severity: rule.severity,
				line: lines.length,
				column: lines[lines.length - 1].length + 1,
				message: rule.message,
				snippet: match[0],
				reasoning: 'Regex Pass 1: Potential architectural violation detected.'
			});
		}
	}

	return violations;
}

/**
 * ── Pass 1.5: Ingestion Flattening (Source Slimming) ─────────────────────────
 * Prunes non-essential code (comments, whitespace) while PRESERVING line counts.
 * This significantly reduces token usage without breaking line-number mapping.
 */
export function pruneSourceForAI(content: string): string {
	return content.split('\n').map(line => {
		const trimmed = line.trim();
		
		// 1. Remove single-line comments (but keep the line)
		if (trimmed.startsWith('//')) return '';
		
		// 2. Remove block comment starts/ends/middles if they are the only thing on the line
		if (trimmed.startsWith('/*') || trimmed.startsWith('*/') || trimmed.startsWith('*')) {
			// Only clear if it looks like a pure comment line
			if (!trimmed.includes(';') && !trimmed.includes('{') && !trimmed.includes('}')) return '';
		}

		// 3. Inline comment stripping (basic)
		// We only strip if // is preceded by a space to avoid breaking URLs
		const commentIdx = line.indexOf(' //');
		if (commentIdx !== -1) return line.substring(0, commentIdx);

		return line;
	}).join('\n');
}

// ── Project Vision System (Universal Auditor) ────────────────────────────────

export type FileRole = 'Component' | 'Service' | 'Route' | 'Tool' | 'Generated' | 'Unknown';

export function detectFramework(files: StoredFile[]): ProjectFramework {
	// 1. Search for package.json
	const pkg = files.find(f => f.path.endsWith('package.json'));
	if (pkg) {
		try {
			const json = pkg.content;
			if (json.includes('"svelte"')) return 'svelte';
			if (json.includes('"react"')) return 'react';
			if (json.includes('"vue"')) return 'vue';
		} catch {
			console.error('Failed to parse package.json during framework detection');
		}
	}
	
	// 2. Fallback heuristic signatures across the corpus
	let svelteCount = 0;
	let reactCount  = 0;
	let vueCount    = 0;

	for (const f of files) {
		if (f.extension === 'svelte') svelteCount++;
		if (f.extension === 'vue') vueCount++;
		if (f.extension === 'jsx' || f.extension === 'tsx') reactCount++;
		if (f.content.includes("from 'react'") || f.content.includes("from \"react\"")) reactCount++;
	}

	if (svelteCount > reactCount && svelteCount > vueCount) return 'svelte';
	if (reactCount > svelteCount && reactCount > vueCount) return 'react';
	if (vueCount > svelteCount && vueCount > reactCount) return 'vue';
	
	return 'unknown';
}

/**
 * Classifies a file based on its content and path heuristics.
 * This is the "Vision" that makes the auditor universal.
 */
function classifyFile(f: StoredFile, framework: ProjectFramework): FileRole {
	const path = f.path.replace(/\\/g, '/').toLowerCase();

	// 1. Skip Rules
	if (path.includes('/_generated/') || path.includes('/scripts/') || path.includes('/tools/') || path.includes('/dist/') || path.includes('/node_modules/') || path.includes('.spec.') || path.includes('.test.')) return 'Generated';
	if (f.content.toLowerCase().includes('@generated')) return 'Generated';

	// 2. Path-Based Layering
	if (path.includes('/convex/')) return 'Service'; // The Brain is 100% Logic
	if (path.includes('/services/') || path.includes('/lib/logic/') || path.includes('/api/')) return 'Service';

	// 3. Framework-Specific Component Detection
	if (framework === 'react') {
		if (f.extension === 'jsx' || f.extension === 'tsx') return 'Component';
		if (f.extension === 'js' && (f.content.includes("from 'react'") || f.content.includes("from \"react\""))) return 'Component';
	}
	
	if (framework === 'vue' && f.extension === 'vue') return 'Component';
	if (framework === 'svelte' && f.extension === 'svelte') {
		if (path.includes('+page') || path.includes('+layout')) return 'Route';
		return 'Component';
	}

	// 4. Fallback Logic
	if (f.extension === 'ts' || f.extension === 'js') {
		return 'Service'; 
	}

	if (f.extension === 'svelte' || f.extension === 'vue' || f.extension === 'tsx' || f.extension === 'jsx' || f.extension === 'html') {
		return 'Component'; 
	}

	return 'Unknown';
}

/**
 * Extracts imports to build a dependency graph.
 */
function getDependencies(content: string): string[] {
	const imports: string[] = [];
	const regex = /import\s+.*\s+from\s+['"](.*)['"]/g;
	let match;
	while ((match = regex.exec(content)) !== null) {
		imports.push(match[1]);
	}
	return imports;
}

// ── Reactive state ─────────────────────────────────────────────────────────────

class AuditorState {
	status       = $state<AuditStatus>('pending');
	currentFile  = $state<string | null>(null);
	/** How many files have been audited in the current batch */
	batchDone    = $state(0);
	/** Total files in the current batch */
	batchTotal   = $state(0);
	/** Detected Global Framework */
	framework    = $state<ProjectFramework>('unknown');
	/** Detected Active Protocol */
	protocol     = $state<FrameworkProtocol | null>(null);
	violations   = $state(new SvelteMap<string, Violation[]>());
	scores       = $state(new SvelteMap<string, number>());
	
	get hasResults() { return this.scores.size > 0; }

	/**
	 * Loads stored reports for a project into the reactive state.
	 */
	async loadProjectResults(projectId: string) {
		// CRITICAL: Do not interrupt or overwrite state if an audit is currently running.
		// This prevents infinite loops and state wiping when UI effects trigger refreshes.
		if (this.status === 'running') return;

		const reports = await getReportsForProject(projectId);
		this.violations.clear();
		this.scores.clear();
		
		for (const r of reports) {
			this.violations.set(r.fileId, r.violations);
			this.scores.set(r.fileId, r.score);
		}

		// Set status so the UI knows we have a completed audit view
		if (reports.length > 0) {
			const anyFailed = reports.some(r => r.score < 80);
			this.status = anyFailed ? 'failed' : 'passed';
		} else {
			this.status = 'pending';
		}
	}

	/**
	 * Clears all results from the reactive UI state.
	 */
	clearResults() {
		this.violations.clear();
		this.scores.clear();
		this.status = 'pending';
		this.batchDone = 0;
		this.batchTotal = 0;
	}

	/** Summary Metrics (Derived from violations state) */
	summary = $derived(() => {
		let errors = 0;
		let warnings = 0;
		let cleared = 0;
		let totalScoredFiles = 0;
		let sumScores = 0;

		for (const [fileId, vList] of this.violations.entries()) {
			errors += vList.filter(v => v.severity === 'error' && !v.isFalsePositive).length;
			warnings += vList.filter(v => v.severity === 'warning' && !v.isFalsePositive).length;
			cleared += vList.filter(v => v.isFalsePositive).length;
			
			const score = this.scores.get(fileId);
			if (score !== undefined) {
				totalScoredFiles++;
				sumScores += score;
			}
		}

		return {
			totalErrors: errors,
			totalWarnings: warnings,
			totalCleared: cleared,
			avgScore: totalScoredFiles > 0 ? Math.round(sumScores / totalScoredFiles) : 0,
			auditedCount: totalScoredFiles
		};
	});

	/** Domain Selectors: Filters violations based on UI criteria */
	getAuditedFiles(files: StoredFile[], filter: 'all' | 'errors' | 'warnings' | 'false-positives') {
		return files
			.filter((f) => this.scores.has(f.id))
			.filter((f) => {
				if (filter === 'all') return true;
				const vList = this.violations.get(f.id) ?? [];
				if (filter === 'errors') return vList.some(v => v.severity === 'error' && !v.isFalsePositive);
				if (filter === 'warnings') return vList.some(v => v.severity === 'warning' && !v.isFalsePositive);
				if (filter === 'false-positives') return vList.some(v => v.isFalsePositive);
				return true;
			});
	}

	getFileViolations(fileId: string, filter: 'all' | 'errors' | 'warnings' | 'false-positives') {
		const all = this.violations.get(fileId) ?? [];
		if (filter === 'all') return all;
		return all.filter(v => 
			(filter === 'errors' && v.severity === 'error' && !v.isFalsePositive) || 
			(filter === 'warnings' && v.severity === 'warning' && !v.isFalsePositive) ||
			(filter === 'false-positives' && v.isFalsePositive)
		);
	}

	/**
	 * Maps violations to their line numbers for code-gutter rendering.
	 * Encapsulates UI data-shaping in the service layer.
	 */
	getViolationsByLine(violations: Violation[]) {
		const map = new SvelteMap<number, Violation[]>();
		for (const v of violations) {
			if (v.line === null) continue;
			const existing = map.get(v.line) ?? [];
			map.set(v.line, [...existing, v]);
		}
		return map;
	}

	/**
	 * Returns a summary of violation counts for a specific file.
	 * Encapsulates the aggregation logic away from the template.
	 */
	getFileMetrics(fileId: string) {
		const vList = this.violations.get(fileId) ?? [];
		return {
			errors: vList.filter(v => v.severity === 'error' && !v.isFalsePositive).length,
			warnings: vList.filter(v => v.severity === 'warning' && !v.isFalsePositive).length,
			cleared: vList.filter(v => v.isFalsePositive).length
		};
	}

	/**
	 * Returns a subset of indexed files based on selection IDs.
	 * This encapsulates data filtering logic for the Route.
	 */
	getSelectedFiles(allFiles: StoredFile[], selectedIds: Set<string>): StoredFile[] {
		return allFiles.filter(f => selectedIds.has(f.id));
	}

	/**
	 * Groups violations by their ruleId for display.
	 * Returns an array of entries for easier Svelte 5 iteration.
	 */
	getGroupedViolations(violations: Violation[]) {
		const map = new SvelteMap<RuleId, Violation[]>();
		for (const v of violations) {
			const list = map.get(v.ruleId) ?? [];
			map.set(v.ruleId, [...list, v]);
		}
		return Array.from(map.entries()).map(([ruleId, items]) => ({ ruleId, items }));
	}

	/**
	 * Pre-processes Markdown lines into structured blocks for UI rendering.
	 * This moves the "Data Parsing" logic out of the View template.
	 */
	parseMarkdownToBlocks(md: string | null) {
		if (!md) return [];
		return md.split('\n').map(line => {
			if (line.startsWith('# ')) return { type: 'h2', text: line.replace('# ', '') };
			if (line.startsWith('## ')) return { type: 'h3', text: line.replace('## ', '') };
			if (line.startsWith('- ')) return { type: 'li', text: line.replace('- ', '') };
			return { type: 'p', text: line };
		});
	}

	/**
	 * Generates a Markdown report from current audit results.
	 */
	generateMarkdownReport(files: StoredFile[], onlyErrors = false): string {
		const summary = this.summary();
		let md = `# Architectural Audit Report — ${new Date().toLocaleDateString()}\n\n`;
		md += `Generated by ArchiScan (2026 Edition)\n\n`;
		
		md += `## Executive Summary\n`;
		md += `- **Average Score**: ${summary.avgScore}/100\n`;
		md += `- **Files Audited**: ${summary.auditedCount}\n`;
		md += `- **Critical Violations (Errors)**: ${summary.totalErrors}\n`;
		md += `- **Structural Debt (Warnings)**: ${summary.totalWarnings}\n\n`;

		for (const file of files.filter(f => this.scores.has(f.id))) {
			const vils = (this.violations.get(file.id) ?? []).filter(v => {
				if (v.isFalsePositive) return false;
				return !onlyErrors || v.severity === 'error';
			});
			if (onlyErrors && vils.length === 0) continue;

			md += `### ${file.path}\n`;
			md += `**Score**: ${this.scores.get(file.id)}/100\n\n`;

			if (vils.length === 0) {
				md += `✓ No ${onlyErrors ? 'errors' : 'violations'} found.\n\n`;
			} else {
				md += `| Sev | Line | Rule | Message | Reasoning |\n| --- | --- | --- | --- | --- |\n`;
				vils.forEach(v => {
					md += `| ${v.severity.toUpperCase()} | ${v.line ?? '—'} | ${v.ruleId} | ${v.message} | ${v.reasoning || '—'} |\n`;
				});
				md += `\n`;
			}
		}
		return md;
	}
}

export const auditorState = new AuditorState();

/**
 * Universal Batch Audit
 * - Pass 1: Local classification & Dependency check (instant)
 * - Pass 2: Local regex pattern match (instant)
 * - Pass 3: Context-Aware AI audit in focused chunks (approx 15 files/batch)
 */
export async function runBatchAudit(files: StoredFile[], dryRun: boolean = false) {
	if (files.length === 0) return;

	auditorState.status     = 'running';
	auditorState.batchDone  = 0;
	auditorState.batchTotal = files.length;

	const resultsMap = new SvelteMap<string, Violation[]>();
	const classifications = new SvelteMap<string, FileRole>();
	const aiAuditQueue: StoredFile[] = [];

	auditorState.framework = detectFramework(files);
	auditorState.protocol = detectProtocol(files, auditorState.framework);

	// Define which laws apply to which roles (Aliasing)
	const getInstructions = (role: string) => {
		const protocol = auditorState.protocol!;
		if (role === 'Component') return `Apply LAW: LOGIC_SEP, PORT_LAW, FRAMEWORK_INT, TYPE_SAF. ${protocol.instructions}`;
		if (role === 'Route') return `Apply LAW: LOGIC_SEP (relaxed), FRAMEWORK_INT, TYPE_SAF. ${protocol.instructions}`;
		if (role === 'Service' || role === 'Tool') return 'Apply LAW: DEP_DIR, TYPE_SAF. IGNORE LOGIC_SEP.';
		return 'Apply LAW: TYPE_SAF';
	};

	// 1. Local Pass (Classification, Regex & Firewall)
	for (const file of files) {
		const role = classifyFile(file, auditorState.framework);
		classifications.set(file.id, role);
		
		const localViolations = runRegex(file, auditorState.protocol!, auditorState.framework);

		// Local Dependency Firewall
		if (role === 'Service' || role === 'Tool') {
			const deps = getDependencies(file.content);
			
			// Check each dependency string to see if it imports from UI
			const uiImport = deps.find(d => d.endsWith('.svelte') || d.includes('/components/'));
			
			if (uiImport) {
				// Find what line this import was on for accuracy
				const lines = file.content.split('\n');
				const lineIdx = lines.findIndex(l => l.includes(uiImport));
				
				localViolations.push({
					id: crypto.randomUUID(),
					ruleId: 'DEP_DIR',
					severity: 'error',
					line: lineIdx >= 0 ? lineIdx + 1 : null,
					column: null,
					message: 'Pure Logic file imports a UI Component.',
					snippet: `import ... from '${uiImport}'`,
					reasoning: 'Caught by Local Dependency Firewall: Business logic must never depend directly on the view layer.',
					file: file.path
				});
			}
		}

		resultsMap.set(file.id, localViolations);

		// Hybrid Compiler Routing: Only send files to AI that need Semantic evaluation
		if (!dryRun && (role === 'Component' || role === 'Route' || role === 'Unknown')) {
			aiAuditQueue.push(file);
		}
	}

	// 2. Focused AI Audit Pass (Only processing the AI Queue)
	const CHUNK_SIZE = 15;
	const modelUsed = await getActiveProvider();

	try {
		for (let i = 0; i < aiAuditQueue.length; i += CHUNK_SIZE) {
			const batch = aiAuditQueue.slice(i, i + CHUNK_SIZE);
			const chunks = batch.map(f => {
				const role = classifications.get(f.id) || 'Unknown';
				return {
					path: f.path,
					role,
					instructions: getInstructions(role),
					content: pruneSourceForAI(f.content) // SLIMMED SOURCE
				};
			});
			
			auditorState.currentFile = `Auditing batch ${Math.floor(i / CHUNK_SIZE) + 1}...`;
			const aiViolations = await audit(chunks, auditorState.framework);

			for (const vi of aiViolations) {
				// Match explicitly by the file path returned by the AI
				const matchedFile = batch.find(f => 
					(vi.file && (f.path.includes(vi.file) || vi.file.includes(f.path))) ||
					(vi.snippet ?? '').includes(f.path) || 
					(vi.message ?? '').includes(f.path)
				) ?? batch[0];
				
				// Final check: Skip logic-leaks on non-auditable roles if AI gets confused
				const role = classifications.get(matchedFile.id);
				if (role === 'Generated') continue;

				const bucket = resultsMap.get(matchedFile.id) ?? [];
				// Ensure every violation from AI also gets a unique ID for Svelte keyed each blocks
				resultsMap.set(matchedFile.id, [...bucket, { ...vi, id: vi.id || crypto.randomUUID() }]);
			}
		}

		// 3. Deep Analysis Pass (Senior Judge - LEGO BATCHED)
		// We bundle all suspected violations for a file into ONE request to save tokens and RPM.
		auditorState.currentFile = "Performing Senior Judge Pass (Batched)...";
		for (const [fileId, violations] of resultsMap.entries()) {
			const file = files.find(f => f.id === fileId);
			if (!file) continue;

			const role = classifications.get(fileId) || 'Unknown';
			const verifiedViolations: Violation[] = [];
			const imports = getDependencies(file.content);
			const lines = file.content.split('\n');

			// Separate violations into those that need judging and those that don't
			const semanticViolations = violations.filter(v => v.ruleId === 'LOGIC_SEP' || v.ruleId === 'PORT_LAW');
			const structuralViolations = violations.filter(v => v.ruleId !== 'LOGIC_SEP' && v.ruleId !== 'PORT_LAW');

			if (semanticViolations.length > 0) {
				// Prepare Lego Bricks (Context snippets for each violation)
				const bundle = semanticViolations.map(v => {
					const start = Math.max(0, (v.line || 1) - 6);
					const end = Math.min(lines.length, (v.line || 1) + 5);
					const contextSnippet = lines.slice(start, end).map((l, idx) => `${start + idx + 1}: ${l}`).join('\n');
					return { ...v, contextSnippet };
				});

				try {
					const judgments = await judgeBatch({
						path: file.path,
						role,
						framework: auditorState.framework,
						imports,
						violations: bundle
					});

					// Map judgments back to violations
					for (const v of semanticViolations) {
						const j = judgments.find(res => res.id === v.id);
						if (j && !j.isFalsePositive) {
							verifiedViolations.push({ 
								...v, 
								reasoning: j.reasoning,
								judgeReasoning: j.reasoning,
								isFalsePositive: false 
							});
						} else {
							verifiedViolations.push({ 
								...v, 
								isFalsePositive: true,
								judgeReasoning: j?.reasoning || "Senior Judge cleared this as a false positive."
							});
						}
					}
				} catch (e) {
					console.error(`Batch judging failed for ${file.path}, falling back to original:`, e);
					verifiedViolations.push(...semanticViolations);
				}
			}

			verifiedViolations.push(...structuralViolations);
			resultsMap.set(fileId, verifiedViolations);
		}
	} catch (e) {
		console.error('Universal precision audit failed:', e);
	}

	// 4. Persist & Score
	try {
		const projectId = await getConfig('currentProjectId');
		if (!projectId) throw new Error('No project selected for audit persistence');

		let anyFailed = false;

		for (const file of files) {
			const rawViolations = resultsMap.get(file.id) ?? [];
			
			// ── DEDUPLICATION STEP ───────────────────────────────────────────────
			// Merges overlapping findings from Regex and AI passes.
			// If two violations are on the same line and have the same ruleId,
			// we prefer the AI's reasoning over the Regex's generic message.
			const deduped = rawViolations.reduce((acc: Violation[], curr) => {
				const existingIdx = acc.findIndex(v => 
					v.ruleId === curr.ruleId &&
					v.line !== null && curr.line !== null &&
					Math.abs(v.line - curr.line) <= 1
				);

				if (existingIdx === -1) {
					acc.push(curr);
				} else {
					// Found a duplicate. Prefer AI reasoning if current or existing is from AI.
					// AI violations usually have more detailed reasoning than "Regex Pass 1..."
					const existing = acc[existingIdx];
					const isExistingAI = !existing.reasoning?.includes('Regex Pass 1');
					const isCurrAI = !curr.reasoning?.includes('Regex Pass 1');

					if (isCurrAI && !isExistingAI) {
						acc[existingIdx] = curr;
					}
				}
				return acc;
			}, []);

			const violations = sanitizeViolations(deduped, auditorState.framework, auditorState.protocol!);
			const score = calculateScore(violations);
			
			auditorState.violations.set(file.id, violations);
			auditorState.scores.set(file.id, score);
			auditorState.batchDone++;
			if (score < 80) anyFailed = true;

			await saveReport({
				fileId: file.id,
				projectId: file.projectId,
				violations,
				score,
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				createdAt: new Date(), // Use standard Date for IndexedDB safety
				modelUsed
			});
		}

		auditorState.status = anyFailed ? 'failed' : 'passed';
	} catch (e) {
		console.error('Persistence phase failed:', e);
		auditorState.status = 'error';
	} finally {
		auditorState.currentFile = null;
	}
}

/**
 * ── Sanitization Pass (The Hard-Coded Guard) ──────────────────────────────────
 * 
 * This is the final firewall that removes 100% known False Positives before
 * reports are persisted. It overrides both the AI Judge and Regex patterns.
 */
function sanitizeViolations(violations: Violation[], framework: ProjectFramework, protocol: FrameworkProtocol): Violation[] {
	return violations.filter(v => {
		// 0. AI Conscience Guard: If the AI reasoning explicitly calls it a "False Positive", dismiss it.
		if (v.reasoning?.toLowerCase().includes('false positive') || v.reasoning?.toLowerCase().includes('ui projection') || v.reasoning?.toLowerCase().includes('display formatting')) {
			return false;
		}

		// 1. Mandatory Portability Exemption: @md, @sm, etc. are ALWAYS ALLOWED.
		if (v.ruleId === 'PORT_LAW' && v.snippet?.match(/@[\w\d-]+:/)) {
			return false;
		}

		// 2. Protocol-specific sanitization (the "Lego" helpers)
		if (!protocol.sanitize(v)) return false;

		// 3. Visual Math Rule (General fallback)
		if (v.ruleId === 'LOGIC_SEP' && v.snippet?.includes('Math.')) {
			const isPurelyVisual = v.message?.toLowerCase().includes('visual') || 
			                      v.reasoning?.toLowerCase().includes('visual') ||
			                      v.snippet?.match(/(width|height|top|left|right|bottom|offset|padding|margin|opacity|style:|class:|size|scale|radius|color|background|stroke|fill|transform|z-index|gap|grid|flex|border|shadow|clamping|percent|ratio|glow)/i);
			
			if (isPurelyVisual) {
				const reasoning = v.reasoning?.toLowerCase() ?? '';
				const explicitlyBusiness = /business logic|domain logic|workflow rule|decision rule|validation rule|persistence|data mutation|side effect|api orchestration/.test(reasoning);
				if (!explicitlyBusiness) return false;
			}
		}

		// 4. Mandatory HTML Attribute Exemption: webkitdirectory and directory are REQUIRED for folder picking.
		if (v.ruleId === 'FRAMEWORK_INT' && (v.snippet?.includes('webkitdirectory') || v.snippet?.includes('directory'))) {
			return false;
		}

		return true;
	});
}
