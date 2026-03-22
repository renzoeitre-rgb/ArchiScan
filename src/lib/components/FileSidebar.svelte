<script lang="ts">
	import type { StoredFile } from '$lib/types';

	let {
		files,
		scores,
		selectedIds,
		onselect,
		onviewfile,
		onremove
	}: {
		files: StoredFile[];
		scores: Map<string, number>;
		/** IDs of files checked for audit */
		selectedIds: Set<string>;
		/** Toggle a file in/out of the audit selection */
		onselect: (id: string) => void;
		/** Click a file to open it in the code viewer */
		onviewfile: (file: StoredFile) => void;
		/** Remove selected files */
		onremove: () => void;
	} = $props();

	function dotClass(score: number | undefined): string {
		if (score === undefined) return 'dot-neutral';
		if (score >= 80) return 'dot-pass';
		if (score >= 50) return 'dot-warn';
		return 'dot-fail';
	}
</script>

<aside class="sidebar">
	<div class="sidebar-header">
		<div class="header-left">
			<span class="sidebar-label">Project Files</span>
			{#if files.length > 0}
				<span class="file-count">{files.length}</span>
			{/if}
		</div>
		
		{#if selectedIds.size > 0}
			<button 
				class="btn-remove" 
				onclick={onremove} 
				title="Remove selected files"
				aria-label="Remove selected files"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
			</button>
		{/if}
	</div>

	<div class="file-list">
		{#each files as file (file.id)}
			{@const checked = selectedIds.has(file.id)}
			<div class="file-row {checked ? 'row-checked' : ''}">
				<!-- Checkbox for audit selection -->
				<label class="check-wrap" title="Select for audit">
					<input
						type="checkbox"
						class="check-input"
						checked={checked}
						onchange={() => onselect(file.id)}
					/>
					<span class="check-box {checked ? 'check-on' : ''}">
						{#if checked}
							<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>
						{/if}
					</span>
				</label>

				<!-- File info — click to view -->
				<button class="file-info" onclick={() => onviewfile(file)}>
					<span class="file-name">{file.path.split('/').pop()}</span>
					<span class="file-path">{file.path}</span>
				</button>

				<!-- Score dot -->
				<div class="file-meta">
					{#if scores.has(file.id)}
						<span class="score">{scores.get(file.id)}</span>
					{/if}
					<span class="dot {dotClass(scores.get(file.id))}"></span>
				</div>
			</div>
		{:else}
			<div class="empty-msg">No files indexed yet.</div>
		{/each}
	</div>
</aside>

<style>
.sidebar {
	display: flex;
	flex-direction: column;
	width: 280px;
	flex-shrink: 0;
	border-right: 1px solid var(--border);
	background: rgba(15, 23, 42, 0.4);
	overflow: hidden;
}

.sidebar-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 12px 10px 16px;
	border-bottom: 1px solid var(--border);
	flex-shrink: 0;
	min-height: 44px;
}

.header-left {
	display: flex;
	align-items: center;
	gap: 10px;
}

.btn-remove {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 6px;
	color: var(--text-faint);
	background: none;
	border: none;
	border-radius: 6px;
	cursor: pointer;
	transition: all 0.15s;
}
.btn-remove:hover {
	background: rgba(244, 63, 94, 0.15);
	color: var(--error);
}

.sidebar-label {
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--text-faint);
}

.file-count {
	font-size: 11px;
	font-weight: 700;
	padding: 2px 7px;
	background: var(--surface-2);
	border-radius: 999px;
	color: var(--text-muted);
}

.file-list { flex: 1; overflow-y: auto; }

.file-row {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 7px 10px 7px 14px;
	border-bottom: 1px solid rgba(30, 41, 59, 0.6);
	transition: background 0.1s;
}
.file-row:hover   { background: var(--surface-2); }
.file-row.row-checked { background: rgba(14, 116, 144, 0.1); }

/* Checkbox */
.check-wrap { display: flex; align-items: center; flex-shrink: 0; cursor: pointer; }
.check-input { display: none; }

.check-box {
	width: 16px; height: 16px;
	border: 1.5px solid var(--border);
	border-radius: 4px;
	display: flex; align-items: center; justify-content: center;
	transition: border-color 0.12s, background 0.12s;
	background: transparent;
	flex-shrink: 0;
}
.check-box.check-on {
	background: var(--accent);
	border-color: var(--accent);
	color: #020617;
}

/* File button */
.file-info {
	display: flex;
	flex-direction: column;
	gap: 1px;
	min-width: 0;
	flex: 1;
	text-align: left;
	background: none;
	border: none;
	cursor: pointer;
	padding: 0;
}
.file-info:hover .file-name { color: var(--accent); }

.file-name {
	font-family: var(--font-code);
	font-size: 12px;
	color: var(--text);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	transition: color 0.1s;
}

.file-path {
	font-size: 10px;
	color: var(--text-faint);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.file-meta { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }

.score { font-size: 10px; font-weight: 700; color: var(--text-muted); }

.dot { width: 7px; height: 7px; border-radius: 50%; }
.dot-neutral { background: var(--text-faint); }
.dot-pass    { background: var(--pass);  box-shadow: 0 0 5px var(--pass); }
.dot-warn    { background: var(--warn);  box-shadow: 0 0 5px var(--warn); }
.dot-fail    { background: var(--error); box-shadow: 0 0 5px var(--error); }

.empty-msg {
	padding: 40px 16px;
	text-align: center;
	font-size: 13px;
	color: var(--text-faint);
	font-style: italic;
}
</style>
