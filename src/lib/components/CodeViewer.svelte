<script lang="ts">
	import type { StoredFile, Violation } from '$lib/types';
	import { auditorState } from '$lib/services/auditor.svelte';

	let { file, violations }: { file: StoredFile | null; violations: Violation[] } = $props();

	/** Maps line numbers to the violations on that line (Using Service Selector) */
	let violationsByLine = $derived(auditorState.getViolationsByLine(violations));

	let lines = $derived(file?.content.split('\n') ?? []);
</script>

<div class="viewer">
	{#if file}
		<div class="viewer-header">
			<span class="file-path">{file.path}</span>
			{#if violations.length > 0}
				<span class="violation-count">{violations.length} violation{violations.length !== 1 ? 's' : ''}</span>
			{/if}
		</div>
		<div class="code-scroll">
			<div class="code-inner">
				{#each lines as content, i (i)}
					{@const lineNum = i + 1}
					{@const lineViolations = violationsByLine.get(lineNum)}
					<div class="line {lineViolations ? 'line-flagged' : ''}">
						<span class="line-num">{lineNum}</span>
						<span class="line-content">{content || ' '}</span>
						{#if lineViolations}
							<span class="badge-group">
								{#each lineViolations as v (v.id)}
									<span class="badge badge-{v.severity}" title={v.message}>{v.ruleId}</span>
								{/each}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="placeholder">
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
			</svg>
			<span>Select a file to view its source</span>
		</div>
	{/if}
</div>

<style>
.viewer {
	display: flex;
	flex-direction: column;
	flex: 1;
	overflow: hidden;
	background: #010b1a;
	border-bottom: 1px solid var(--border);
}

.viewer-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 16px;
	border-bottom: 1px solid var(--border);
	background: rgba(15, 23, 42, 0.6);
	flex-shrink: 0;
}

.file-path {
	font-family: var(--font-code);
	font-size: 12px;
	color: var(--text-muted);
}

.violation-count {
	font-size: 11px;
	font-weight: 700;
	padding: 2px 8px;
	background: rgba(244, 63, 94, 0.15);
	color: var(--error);
	border-radius: 999px;
}

.code-scroll {
	flex: 1;
	overflow: auto;
}

.code-inner {
	display: table;
	min-width: 100%;
	font-family: var(--font-code);
	font-size: 12.5px;
	line-height: 1.6;
}

.line {
	display: flex;
	align-items: center;
	min-height: 22px;
	padding-right: 16px;
	transition: background 0.1s;
}
.line:hover { background: rgba(255, 255, 255, 0.03); }
.line-flagged { background: rgba(244, 63, 94, 0.07); }

.line-num {
	display: inline-block;
	width: 48px;
	flex-shrink: 0;
	padding: 0 12px 0 0;
	text-align: right;
	color: var(--text-faint);
	user-select: none;
	border-right: 1px solid var(--border-2);
	margin-right: 16px;
}

.line-content {
	flex: 1;
	white-space: pre;
	color: var(--text);
}

.badge-group {
	display: flex;
	gap: 4px;
	flex-shrink: 0;
	margin-left: 8px;
}

.badge {
	font-size: 10px;
	font-weight: 700;
	padding: 1px 6px;
	border-radius: 4px;
	cursor: default;
}
.badge-error   { background: var(--error); color: white; }
.badge-warning { background: var(--warn); color: #020617; }
.badge-info    { background: var(--accent); color: #020617; }

.placeholder {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
	height: 100%;
	color: var(--text-faint);
	font-size: 13px;
	font-style: italic;
}
</style>
