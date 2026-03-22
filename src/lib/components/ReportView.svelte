<script lang="ts">
	import type { StoredFile, Violation, RuleId } from '$lib/types';
	import { getFixSuggestions } from '$lib/services/aiProvider';
	import { auditorState } from '$lib/services/auditor.svelte';
	import { downloadFile } from '$lib/services/exporter';

	let {
		files,
		violations,
		scores,
		onviewfile
	}: {
		files: StoredFile[];
		violations: Map<string, Violation[]>;
		scores: Map<string, number>;
		onviewfile: (file: StoredFile) => void;
	} = $props();

	let filter = $state<'all' | 'errors' | 'warnings' | 'false-positives'>('all');
	let fixReport = $state<string | null>(null);
	let isGeneratingFix = $state(false);
	let isCopying = $state(false);

	/** Only show audited files that match the filter (Using Service Selectors) */
	let auditedFiles = $derived(auditorState.getAuditedFiles(files, filter));

	/** Structured blocks for AI Fix Report (Using Service Adapter) */
	let fixBlocks = $derived(auditorState.parseMarkdownToBlocks(fixReport));

	/** Total violation counts (globally derived, immune to active view filters) */
	let summary = $derived(auditorState.summary());
	let totalErrors   = $derived(summary.totalErrors);
	let totalWarnings = $derived(summary.totalWarnings);
	let totalCleared  = $derived(summary.totalCleared);
	let avgScore      = $derived(summary.avgScore);

	const RULE_LABELS: Record<RuleId, string> = {
		DEP_DIR:   'Dependency Dir.',
		LOGIC_SEP: 'Logic Separation',
		PORT_LAW:  'Portability Law',
		FRAMEWORK_INT: 'Framework Integrity',
		LAYER_BLD: 'Layer Boundary',
		TYPE_SAF:  'Type Safety',
		ONE_SRC:   'One Source of Truth'
	};

	function scoreColor(s: number) {
		if (s >= 80) return '#34d399';
		if (s >= 50) return '#fbbf24';
		return '#f43f5e';
	}

	function exportMarkdown(onlyErrors = false) {
		const md = auditorState.generateMarkdownReport(files, onlyErrors);
		const fileName = `audit-report-${onlyErrors ? 'errors' : 'full'}.md`;
		downloadFile(md, fileName);
	}

	async function copyToClipboard() {
		if (!fixReport) return;
		isCopying = true;
		try {
			await navigator.clipboard.writeText(fixReport);
			setTimeout(() => (isCopying = false), 2000);
		} catch (e) {
			console.error('Failed to copy report:', e);
			isCopying = false;
		}
	}

	async function generateFixReport() {
		isGeneratingFix = true;
		try {
			// Flatten violations for the AI pass (Data Shaping moved to Service)
			const allVils = auditedFiles.flatMap(f => violations.get(f.id) ?? []);
			fixReport = await getFixSuggestions(auditedFiles, allVils);
		} catch (e) {
			alert('Failed to generate fix report: ' + (e instanceof Error ? e.message : String(e)));
		} finally {
			isGeneratingFix = false;
		}
	}
</script>

<div class="report">
	<!-- Summary ribbon -->
	<div class="summary-bar">
		<div class="summary-stat">
			<span class="stat-value" style="color: {scoreColor(avgScore)}">{avgScore}</span>
			<span class="stat-label">Avg Score</span>
		</div>
		<div class="summary-divider"></div>
		<div class="summary-stat">
			<span class="stat-value">{auditedFiles.length}</span>
			<span class="stat-label">Files Audited</span>
		</div>
		<div class="summary-divider"></div>
		<div class="summary-stat">
			<span class="stat-value error-col">{totalErrors}</span>
			<span class="stat-label">Errors</span>
		</div>
		<div class="summary-divider"></div>
		<div class="summary-stat">
			<span class="stat-value warn-col">{totalWarnings}</span>
			<span class="stat-label">Warnings</span>
		</div>
		<div class="summary-divider"></div>
		<div class="summary-stat">
			<span class="stat-value cleared-col">{totalCleared}</span>
			<span class="stat-label">AI Cleared</span>
		</div>
	</div>

	<!-- Filter & Actions Bar -->
	<div class="actions-bar">
		<div class="filter-group">
			<button class="filter-btn {filter === 'all' ? 'active' : ''}" onclick={() => (filter = 'all')}>All Files</button>
			<button class="filter-btn {filter === 'errors' ? 'active' : ''}" onclick={() => (filter = 'errors')}>Errors Only</button>
			<button class="filter-btn {filter === 'warnings' ? 'active' : ''}" onclick={() => (filter = 'warnings')}>Warnings Only</button>
			<button class="filter-btn {filter === 'false-positives' ? 'active' : ''}" onclick={() => (filter = 'false-positives')}>AI False Positives</button>
		</div>

		<div class="action-group">
			<button class="btn-action" onclick={() => exportMarkdown(false)}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
				Export MD (Full)
			</button>
			<button class="btn-action" onclick={() => exportMarkdown(true)}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
				Export MD (Errors)
			</button>
			<button class="btn-fix" onclick={generateFixReport} disabled={isGeneratingFix}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
				{isGeneratingFix ? 'Generating AI Fixes...' : 'AI Fix Suggestions'}
			</button>
		</div>
	</div>

	<!-- Per-file results -->
	<div class="file-reports">
		{#each auditedFiles as file (file.id)}
			{@const fileViolations = auditorState.getFileViolations(file.id, filter)}
			{@const fileScore = scores.get(file.id) ?? 0}
			{@const { errors, warnings, cleared } = auditorState.getFileMetrics(file.id)}

			<div class="file-block {fileScore >= 80 ? 'block-pass' : fileScore >= 50 ? 'block-warn' : 'block-fail'}">
				<!-- File header -->
				<div class="file-header">
					<button class="file-title-btn" onclick={() => onviewfile(file)}>
						<span class="file-score" style="color:{scoreColor(fileScore)}">{fileScore}</span>
						<span class="file-path">{file.path}</span>
					</button>
					<div class="file-chips">
						{#if errors > 0}
							<span class="chip chip-error">{errors} error{errors !== 1 ? 's' : ''}</span>
						{/if}
						{#if warnings > 0}
							<span class="chip chip-warn">{warnings} warning{warnings !== 1 ? 's' : ''}</span>
						{/if}
						{#if cleared > 0}
							<span class="chip chip-cleared">{cleared} cleared</span>
						{/if}
						{#if fileViolations.length === 0 && cleared === 0}
							<span class="chip chip-pass">✓ Clean</span>
						{/if}
					</div>
				</div>

				<!-- Violation rows -->
				{#if fileViolations.length > 0}
					<div class="violation-table">
						<!-- Header -->
						<div class="vrow vrow-head">
							<span class="vcol vcol-sev">SEV</span>
							<span class="vcol vcol-line">LINE</span>
							<span class="vcol vcol-rule">RULE</span>
							<span class="vcol vcol-msg">MESSAGE</span>
							<span class="vcol vcol-snip">SNIPPET</span>
						</div>
						{#each fileViolations as v (v.id)}
							<div class="vrow vrow-{v.severity} {v.isFalsePositive ? 'vrow-cleared' : ''}">
								<span class="vcol vcol-sev">
									<span class="sev-dot sev-{v.severity}"></span>
									{v.severity}
									{#if !v.isFalsePositive && (v.ruleId === 'LOGIC_SEP' || v.ruleId === 'PORT_LAW')}
										<span class="verified-badge" title="Verified by Senior AI Judge">
											<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>
										</span>
									{/if}
								</span>
								<span class="vcol vcol-line mono">{v.line ?? '—'}</span>
								<span class="vcol vcol-rule">
									<span class="rule-tag">{v.ruleId}</span>
									<span class="rule-name">{RULE_LABELS[v.ruleId] ?? ''}</span>
								</span>
								<span class="vcol vcol-msg">
									<div class="msg-text">{v.message}</div>
									{#if v.reasoning}
										<div class="msg-reasoning">
											<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
											{v.reasoning}
										</div>
									{/if}
								</span>
								<span class="vcol vcol-snip">
									{#if v.snippet}
										<code class="snip">{v.snippet}</code>
									{/if}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- AI Fix Report Modal -->
	{#if fixReport}
		<div 
			class="fix-overlay" 
			role="button" 
			tabindex="0"
			onclick={() => (fixReport = null)}
			onkeydown={(e) => e.key === 'Escape' && (fixReport = null)}
		>
			<div class="fix-content" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
				<div class="fix-header">
					<h3>AI Refactoring Suggestions (2026 Standards)</h3>
					<button class="btn-close" onclick={() => (fixReport = null)}>✕</button>
				</div>
				<div class="fix-body prose">
					{#each fixBlocks as block, i (i)}
						{#if block.type === 'h2'}
							<h2>{block.text}</h2>
						{:else if block.type === 'h3'}
							<h3>{block.text}</h3>
						{:else if block.type === 'li'}
							<li>{block.text}</li>
						{:else}
							<p>{block.text}</p>
						{/if}
					{/each}
				</div>
				<div class="fix-footer">
					<button class="btn-copy" onclick={copyToClipboard}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
						</svg>
						{isCopying ? 'Copied!' : 'Copy Report'}
					</button>
					<button class="btn-confirm" onclick={() => (fixReport = null)}>Close Report</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
.report {
	display: flex;
	flex-direction: column;
	height: 100%;
	overflow: hidden;
}

/* ── Summary bar ── */
.summary-bar {
	display: flex;
	align-items: center;
	gap: 0;
	padding: 16px 24px;
	background: var(--surface);
	border-bottom: 1px solid var(--border);
	flex-shrink: 0;
	z-index: 10;
}

/* ── Actions bar ── */
.actions-bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 16px;
	background: rgba(15, 23, 42, 0.3);
	border-bottom: 1px solid var(--border);
	flex-shrink: 0;
}

.filter-group, .action-group { display: flex; gap: 8px; }

.filter-btn {
	padding: 5px 12px;
	font-size: 11px;
	font-weight: 700;
	color: var(--text-faint);
	background: none;
	border: 1px solid transparent;
	border-radius: 6px;
	cursor: pointer;
	transition: all 0.1s;
}
.filter-btn:hover { color: var(--text); }
.filter-btn.active {
	background: var(--surface-2);
	border-color: var(--border);
	color: var(--accent);
}

.btn-action {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 5px 12px;
	font-size: 11px;
	font-weight: 700;
	color: var(--text-muted);
	background: var(--surface-2);
	border: 1px solid var(--border);
	border-radius: 6px;
	cursor: pointer;
}
.btn-action:hover { border-color: var(--accent); color: var(--text); }

.btn-fix {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 5px 14px;
	font-size: 11px;
	font-weight: 700;
	background: linear-gradient(135deg, #0e7490, #0891b2);
	color: white;
	border: none;
	border-radius: 6px;
	cursor: pointer;
	box-shadow: 0 0 15px rgba(14, 116, 144, 0.4);
}
.btn-fix:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(14, 116, 144, 0.6); }
.btn-fix:disabled { opacity: 0.5; cursor: not-allowed; }

/* AI Fix Modal */
.fix-overlay {
	position: fixed;
	inset: 0;
	z-index: 100;
	background: rgba(2, 6, 23, 0.85);
	backdrop-filter: blur(10px);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 40px;
}

.fix-content {
	width: 100%;
	max-width: 800px;
	max-height: 80vh;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: var(--radius-lg);
	display: flex;
	flex-direction: column;
	animation: modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalIn {
	from { opacity: 0; transform: translateY(20px); }
	to { opacity: 1; transform: translateY(0); }
}

.fix-header {
	padding: 20px 24px;
	border-bottom: 1px solid var(--border);
	display: flex;
	align-items: center;
	justify-content: space-between;
}
.fix-header h3 { margin: 0; font-size: 18px; font-weight: 800; color: var(--accent); }
.btn-close { background: none; border: none; font-size: 20px; color: var(--text-faint); cursor: pointer; }

.fix-body {
	padding: 32px;
	overflow-y: auto;
	flex: 1;
	min-height: 0;
	color: var(--text-muted);
	line-height: 1.7;
}

.fix-body h2 { color: white; margin-top: 0; font-size: 22px; }
.fix-body h3 { color: var(--accent); margin-top: 24px; font-size: 18px; }
.fix-body p { margin-bottom: 16px; }
.fix-body li { margin-bottom: 8px; list-style-type: disc; margin-left: 20px; }

.fix-footer {
	padding: 20px 24px;
	border-top: 1px solid var(--border);
	display: flex;
	justify-content: flex-end;
	gap: 12px;
}

.btn-copy {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 16px;
	background: var(--surface-2);
	color: var(--text);
	font-size: 13px;
	font-weight: 700;
	border-radius: 8px;
	border: 1px solid var(--border);
	cursor: pointer;
	transition: all 0.2s;
}
.btn-copy:hover { border-color: var(--accent); color: var(--accent); }

.btn-confirm {
	padding: 10px 24px;
	background: var(--accent);
	color: #020617;
	font-size: 13px;
	font-weight: 700;
	border-radius: 8px;
	border: none;
	cursor: pointer;
}

.summary-stat {
	display: flex;
	flex-direction: column;
	align-items: center;
	padding: 0 24px;
}

.stat-value {
	font-size: 28px;
	font-weight: 900;
	line-height: 1;
	color: var(--text);
}

.stat-label {
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--text-faint);
	margin-top: 3px;
}

.error-col { color: #f43f5e; }
.warn-col  { color: #fbbf24; }
.cleared-col { color: #10b981; }

.summary-divider {
	width: 1px;
	height: 32px;
	background: var(--border);
	margin: 0 24px;
}

/* ── File list ── */
.file-reports {
	flex: 1;
	overflow-y: auto;
	padding: 16px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.file-block {
	border: 1px solid var(--border);
	border-radius: var(--radius-lg);
	overflow: hidden;
	background: rgba(15, 23, 42, 0.5);
	flex-shrink: 0;
}

.file-block.block-pass { border-left: 3px solid var(--pass); }
.file-block.block-warn { border-left: 3px solid var(--warn); }
.file-block.block-fail { border-left: 3px solid var(--error); }

/* File header */
.file-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 14px;
	background: rgba(30, 41, 59, 0.4);
	gap: 12px;
}

.file-title-btn {
	display: flex;
	align-items: center;
	gap: 10px;
	background: none;
	border: none;
	cursor: pointer;
	text-align: left;
	min-width: 0;
}
.file-title-btn:hover .file-path { color: var(--accent); }

.file-score {
	font-size: 20px;
	font-weight: 900;
	flex-shrink: 0;
	line-height: 1;
}

.file-path {
	font-family: var(--font-code);
	font-size: 12px;
	color: var(--text);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	transition: color 0.15s;
}

.file-chips {
	display: flex;
	gap: 6px;
	flex-shrink: 0;
}

.chip {
	font-size: 11px;
	font-weight: 700;
	padding: 2px 8px;
	border-radius: 999px;
}
.chip-error { background: rgba(244, 63, 94, 0.15); color: var(--error); }
.chip-warn  { background: rgba(251, 191, 36, 0.15);  color: var(--warn);  }
.chip-pass { background: rgba(16, 185, 129, 0.15); color: #10b981; }
.chip-cleared { background: rgba(34, 211, 238, 0.15); color: var(--accent); }

/* ── Violation table ── */
.violation-table {
	display: flex;
	flex-direction: column;
}

.vrow {
	display: grid;
	grid-template-columns: 80px 50px 200px 1fr auto;
	gap: 0;
	align-items: baseline;
	padding: 7px 14px;
	border-top: 1px solid rgba(30, 41, 59, 0.8);
	font-size: 12px;
}

.vrow-head {
	background: rgba(15, 23, 42, 0.6);
	padding-top: 5px;
	padding-bottom: 5px;
}

.vrow-error   { background: rgba(244, 63, 94, 0.04); }
.vrow-warning { background: rgba(251, 191, 36, 0.03); }

.vrow-cleared {
	opacity: 0.6;
	background: rgba(15, 23, 42, 0.2) !important;
}

.verified-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 14px;
	height: 14px;
	background: #10b981;
	color: white;
	border-radius: 50%;
	margin-left: 6px;
}

.vcol { padding: 0 6px; overflow: hidden; }

.vcol-sev  { display: flex; align-items: center; gap: 5px; }
.vcol-line { text-align: right; }
.vcol-rule { display: flex; flex-direction: column; gap: 1px; }
.vcol-msg  { color: var(--text-muted); line-height: 1.4; display: flex; flex-direction: column; gap: 4px; }
.msg-reasoning {
	font-size: 10px;
	color: var(--text-faint);
	font-style: italic;
	display: flex;
	align-items: flex-start;
	gap: 4px;
	background: rgba(255, 255, 255, 0.03);
	padding: 4px 8px;
	border-radius: 4px;
}
.msg-reasoning svg { margin-top: 2px; flex-shrink: 0; opacity: 0.6; }
.vcol-snip { text-align: right; }

.vrow-head .vcol {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--text-faint);
}

.mono { font-family: var(--font-code); color: var(--text-muted); }

.sev-dot {
	width: 7px; height: 7px;
	border-radius: 50%;
	flex-shrink: 0;
}
.sev-error   { background: var(--error); }
.sev-warning { background: var(--warn);  }
.sev-info    { background: var(--accent); }

.vrow-error   .vcol-sev { color: var(--error); }
.vrow-warning .vcol-sev { color: var(--warn);  }

.rule-tag {
	font-family: var(--font-code);
	font-size: 9px;
	font-weight: 800;
	padding: 2px 5px;
	background: var(--surface-2);
	border-radius: 4px;
	color: var(--text-muted);
}
.rule-name { font-size: 10px; color: var(--text-faint); }

.snip {
	font-family: var(--font-code);
	font-size: 11px;
	color: var(--error);
	background: rgba(244, 63, 94, 0.1);
	padding: 1px 6px;
	border-radius: 4px;
	white-space: pre;
	max-width: 200px;
	overflow: hidden;
	text-overflow: ellipsis;
	display: block;
}
</style>
