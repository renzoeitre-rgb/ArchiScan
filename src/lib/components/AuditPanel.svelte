<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { Violation, RuleId } from '$lib/types';

	import { auditorState } from '$lib/services/auditor.svelte';

	let { violations, score }: { violations: Violation[]; score: number } = $props();

	/** Groups violations by their ruleId for display (Using Service Selector) */
	let grouped = $derived(auditorState.getGroupedViolations(violations));

	const open = new SvelteSet<RuleId>();

	function toggle(ruleId: RuleId) {
		if (open.has(ruleId)) open.delete(ruleId);
		else open.add(ruleId);
	}

	function scoreClass(s: number): string {
		if (s >= 80) return 'score-pass';
		if (s >= 50) return 'score-warn';
		return 'score-fail';
	}

	const RULE_LABELS: Record<RuleId, string> = {
		DEP_DIR: 'Dependency Direction',
		LOGIC_SEP: 'Logic Separation',
		PORT_LAW: 'Portability Law',
		FRAMEWORK_INT: 'Framework Integrity',
		LAYER_BLD: 'Layer Boundary',
		TYPE_SAF: 'Type Safety',
		ONE_SRC: 'One Source of Truth'
	};
</script>

<div class="panel">
	<div class="panel-header">
		<h3 class="panel-title">Audit Results</h3>
		<div class="score-display {scoreClass(score)}">
			<span class="score-label">Score</span>
			<span class="score-value">{score}</span>
		</div>
	</div>

	<div class="panel-body">
		{#if violations.length === 0}
			<div class="all-clear">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>
				No violations — this file passes all governance rules.
			</div>
		{:else}
			<div class="rule-list">
				{#each grouped as { ruleId, items } (ruleId)}
					<div class="rule-group">
						<button class="rule-toggle" onclick={() => toggle(ruleId)}>
							<span class="rule-caret">{open.has(ruleId) ? '▾' : '▸'}</span>
							<span class="rule-id">{ruleId}</span>
							<span class="rule-name">{RULE_LABELS[ruleId] ?? ''}</span>
							<span class="rule-badge">{items.length}</span>
						</button>

						{#if open.has(ruleId)}
							<div class="violations-list">
								{#each items as v (v.id)}
									<div class="violation-row">
										<span class="sev-dot sev-{v.severity}"></span>
										<div class="violation-body">
											{#if v.line !== null}
												<span class="line-ref">L{v.line}</span>
											{/if}
											<span class="violation-msg">{v.message}</span>
											{#if v.snippet}
												<code class="snippet">{v.snippet}</code>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
.panel {
	display: flex;
	flex-direction: column;
	height: 280px;
	flex-shrink: 0;
	border-top: 1px solid var(--border);
	background: var(--surface);
	overflow: hidden;
}

.panel-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 14px 20px;
	border-bottom: 1px solid var(--border);
	flex-shrink: 0;
}

.panel-title {
	font-size: 13px;
	font-weight: 700;
	color: var(--text-muted);
	text-transform: uppercase;
	letter-spacing: 0.06em;
}

.score-display {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
}

.score-label {
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--text-faint);
}

.score-value {
	font-size: 28px;
	font-weight: 900;
	line-height: 1;
}

.score-pass .score-value { color: var(--pass); }
.score-warn .score-value { color: var(--warn); }
.score-fail .score-value { color: var(--error); }

.panel-body {
	flex: 1;
	overflow-y: auto;
	padding: 12px;
}

.all-clear {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 16px;
	color: var(--pass);
	font-size: 13px;
	font-weight: 600;
	background: rgba(52, 211, 153, 0.07);
	border-radius: var(--radius);
	border: 1px solid rgba(52, 211, 153, 0.2);
}

.rule-list { display: flex; flex-direction: column; gap: 6px; }

.rule-group {
	border: 1px solid var(--border);
	border-radius: var(--radius);
	overflow: hidden;
}

.rule-toggle {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 9px 12px;
	background: rgba(30, 41, 59, 0.4);
	text-align: left;
	font-size: 12px;
	transition: background 0.1s;
}
.rule-toggle:hover { background: var(--surface-2); }

.rule-caret { color: var(--text-faint); font-size: 10px; }
.rule-id { font-family: var(--font-code); font-weight: 700; color: var(--accent); }
.rule-name { flex: 1; color: var(--text-muted); }

.rule-badge {
	font-size: 10px;
	font-weight: 700;
	padding: 1px 7px;
	background: var(--surface-2);
	color: var(--text-muted);
	border-radius: 999px;
}

.violations-list {
	display: flex;
	flex-direction: column;
	gap: 0;
	border-top: 1px solid var(--border-2);
}

.violation-row {
	display: flex;
	gap: 10px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--border-2);
	align-items: flex-start;
}
.violation-row:last-child { border-bottom: none; }

.sev-dot {
	width: 8px; height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
	margin-top: 4px;
}
.sev-error   { background: var(--error); }
.sev-warning { background: var(--warn); }
.sev-info    { background: var(--accent); }

.violation-body {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 12px;
}

.line-ref {
	font-family: var(--font-code);
	font-size: 11px;
	color: var(--text-faint);
}

.violation-msg { color: var(--text); }

.snippet {
	font-family: var(--font-code);
	font-size: 11px;
	color: var(--error);
	background: rgba(244, 63, 94, 0.1);
	padding: 2px 6px;
	border-radius: 4px;
	max-width: 100%;
	overflow-x: auto;
	white-space: pre;
}
</style>
