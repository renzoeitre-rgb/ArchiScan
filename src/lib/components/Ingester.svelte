<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { 
		discoverProject,
		getEligibleFiles,
		processIngestion
	} from '$lib/services/ingestion';
	import { createProject, getConfig } from '$lib/db';

	let inputEl: HTMLInputElement;
	let isProcessing = $state(false);
	let isDone = $state(false);
	let processed = $state(0);
	let total = $state(0);
	
	let detectedExtensions = $state<string[]>([]);
	let selectedExtensions = new SvelteSet<string>();
	let detectedFramework = $state<'svelte' | 'react' | 'vue' | 'unknown'>('unknown');
	
	let previewCount = $state(0);    // files that will be indexed after picking folder
	let previewFolder = $state('');  // root folder name
	let lastError = $state<string | null>(null);

	let { oncomplete, showModal = $bindable(false) }: { oncomplete: () => void, showModal?: boolean } = $props();

	/** Called when the user picks a folder — opens the extension selection modal. */
	async function handleChange() {
		const files = inputEl?.files;
		if (!files || files.length === 0) return;

		const discovery = await discoverProject(files);
		
		detectedFramework = discovery.framework;
		detectedExtensions = discovery.extensions;
		previewCount = discovery.eligibleCount;
		previewFolder = discovery.rootFolder;

		selectedExtensions.clear();
		detectedExtensions.forEach(ext => selectedExtensions.add(ext));
		
		showModal = true;
		isDone = false;
		lastError = null;
	}

	function toggleExt(ext: string) {
		if (selectedExtensions.has(ext)) selectedExtensions.delete(ext);
		else selectedExtensions.add(ext);
	}

	function selectAll() { detectedExtensions.forEach(ext => selectedExtensions.add(ext)); }
	function selectNone() { selectedExtensions.clear(); }

	async function handleUpload() {
		const files = inputEl?.files;
		if (!files || files.length === 0) return;

		showModal = false;
		isProcessing = true;
		isDone = false;
		lastError = null;
		processed = 0;

		const filtered = getEligibleFiles(files, selectedExtensions);
		total = filtered.length;

		try {
			// Create a new project for this upload if it's the first time
			let projectId = await getConfig('currentProjectId');
			if (!projectId) {
				projectId = await createProject(previewFolder || 'Unnamed Project', detectedFramework);
			}

			processed = await processIngestion(projectId, filtered, (done) => {
				processed = done;
			});
			isDone = true;
			oncomplete?.();
		} catch (e) {
			lastError = e instanceof Error ? e.message : 'Unknown ingestion error';
		} finally {
			isProcessing = false;
		}
	}
</script>

<div class="ingester">
	<!-- Folder picker -->
	<label class="upload-label {previewCount > 0 ? 'has-selection' : ''}">
		<span class="upload-label-text">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
			</svg>
			{previewCount > 0 ? previewFolder || 'Folder selected' : 'Choose Folder'}
		</span>
		{#if previewCount > 0}
			<span class="pick-badge">{previewCount} files to index</span>
		{/if}
		<input
			bind:this={inputEl}
			type="file"
			webkitdirectory
			directory
			multiple
			class="hidden-input"
			onchange={handleChange}
		/>
	</label>

	<!-- Preview banner — shown after picking, before indexing -->
	{#if previewCount > 0 && !isProcessing && !isDone}
		<div class="preview-banner">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
			</svg>
			<span><strong>{previewCount}</strong> eligible files found in <strong>/{previewFolder}</strong> — click below to index them.</span>
		</div>
	{/if}

	<!-- Index button -->
	<button
		class="upload-btn"
		onclick={handleUpload}
		disabled={isProcessing || previewCount === 0}
	>
		{isProcessing ? `Indexing… ${processed} / ${total}` : `Index ${previewCount > 0 ? previewCount + ' Files' : 'Folder'} into IndexedDB`}
	</button>

	<!-- Progress bar during upload -->
	{#if isProcessing && total > 0}
		<div class="progress-bar-track">
			<div class="progress-bar-fill" style:width="{(processed / total) * 100}%"></div>
		</div>
		<p class="progress-text">{processed} / {total} files indexed</p>
	{/if}

	<!-- Success banner -->
	{#if isDone}
		<div class="success-banner">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>
			<span><strong>{processed}</strong> files indexed successfully.</span>
		</div>
	{/if}

	<!-- Error -->
	{#if lastError}
		<p class="error-msg">⚠ {lastError}</p>
	{/if}

	<!-- Extension Selection Modal -->
	{#if showModal}
		<div 
			class="modal-overlay" 
			role="button"
			tabindex="0"
			onclick={() => (showModal = false)}
			onkeydown={(e) => e.key === 'Escape' && (showModal = false)}
		>
			<div 
				class="modal-content" 
				role="dialog" 
				aria-modal="true" 
				tabindex="-1" 
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.key === 'Escape' && (showModal = false)}
			>
				<div class="modal-header">
					<h3 class="modal-title">ArchiScan Project Discovery</h3>
					<p class="modal-subtitle">Detected <strong>{detectedFramework === 'unknown' ? 'UNKNOWN' : detectedFramework.toUpperCase()}</strong> project in <strong>/{previewFolder}</strong></p>
				</div>

				<div class="framework-banner {detectedFramework}">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
					</svg>
					<span>Using <strong>{detectedFramework === 'unknown' ? 'General' : detectedFramework.charAt(0).toUpperCase() + detectedFramework.slice(1)}</strong> Law Book for auditing.</span>
				</div>

				<div class="ext-grid">
					{#each detectedExtensions as ext (ext)}
						<label class="ext-item {selectedExtensions.has(ext) ? 'active' : ''}">
							<input 
								type="checkbox" 
								checked={selectedExtensions.has(ext)} 
								onchange={() => toggleExt(ext)} 
							/>
							<span class="ext-name">.{ext}</span>
						</label>
					{/each}
				</div>

				<div class="modal-utils">
					<button class="util-btn" onclick={selectAll}>Select All</button>
					<button class="util-btn" onclick={selectNone}>Select None</button>
				</div>

				<div class="modal-footer">
					<button class="btn-cancel" onclick={() => (showModal = false)}>Cancel</button>
					<button 
						class="btn-confirm" 
						onclick={handleUpload}
						disabled={selectedExtensions.size === 0}
					>
						Audit Selected Files
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
.ingester {
	display: flex;
	flex-direction: column;
	gap: 10px;
	width: 100%;
}

.upload-label {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding: 12px 16px;
	background: var(--surface);
	border: 2px dashed var(--border);
	border-radius: var(--radius-lg);
	cursor: pointer;
	transition: border-color 0.15s, background 0.15s;
}
.upload-label:hover       { border-color: var(--accent); background: rgba(34, 211, 238, 0.04); }
.upload-label.has-selection {
	border-color: var(--accent);
	border-style: solid;
	background: rgba(34, 211, 238, 0.06);
}

.upload-label-text {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
	font-weight: 600;
	color: var(--text-muted);
}

.pick-badge {
	font-size: 11px;
	font-weight: 700;
	padding: 3px 9px;
	background: rgba(34, 211, 238, 0.15);
	color: var(--accent);
	border-radius: 999px;
	white-space: nowrap;
}

.hidden-input { display: none; }

/* Preview info banner */
.preview-banner {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 10px 14px;
	background: rgba(34, 211, 238, 0.07);
	border: 1px solid rgba(34, 211, 238, 0.25);
	border-radius: var(--radius);
	font-size: 12.5px;
	color: var(--text-muted);
	line-height: 1.5;
}
.preview-banner svg { flex-shrink: 0; margin-top: 2px; color: var(--accent); }
.preview-banner strong { color: var(--text); }

/* Index button */
.upload-btn {
	width: 100%;
	padding: 12px;
	background: #059669;
	color: white;
	font-size: 14px;
	font-weight: 700;
	border-radius: var(--radius);
	transition: background 0.15s, opacity 0.15s;
	cursor: pointer;
	border: none;
}
.upload-btn:hover:not(:disabled) { background: #10b981; }
.upload-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Progress */
.progress-bar-track {
	height: 6px;
	background: var(--surface-2);
	border-radius: 999px;
	overflow: hidden;
}
.progress-bar-fill {
	height: 100%;
	background: var(--accent);
	border-radius: 999px;
	transition: width 0.15s;
}
.progress-text {
	font-size: 11px;
	color: var(--text-faint);
	font-family: var(--font-code);
	text-align: center;
}

/* Success banner */
.success-banner {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	background: rgba(52, 211, 153, 0.08);
	border: 1px solid rgba(52, 211, 153, 0.3);
	border-radius: var(--radius);
	font-size: 12.5px;
	color: var(--pass);
}
.success-banner strong { color: white; }

.error-msg {
	font-size: 12px;
	color: var(--error);
	font-family: var(--font-code);
	background: rgba(244, 63, 94, 0.1);
	padding: 8px 12px;
	border-radius: var(--radius);
}

/* Modal Styles */
.modal-overlay {
	position: fixed;
	inset: 0;
	z-index: 100;
	background: rgba(2, 6, 23, 0.85);
	backdrop-filter: blur(8px);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 20px;
	border: none;
	width: 100%;
}

.modal-content {
	width: 100%;
	max-width: 440px;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: var(--radius-lg);
	box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
	display: flex;
	flex-direction: column;
	animation: modalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalIn {
	from { opacity: 0; transform: scale(0.95) translateY(10px); }
	to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-header { padding: 24px; border-bottom: 1px solid var(--border); }
.modal-title { font-size: 18px; font-weight: 800; color: white; margin: 0; }
.modal-subtitle { font-size: 13px; color: var(--text-faint); margin: 6px 0 0; }
.modal-subtitle strong { color: var(--accent); }

.framework-banner {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px;
	background: rgba(255, 255, 255, 0.03);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	margin-bottom: 20px;
	font-size: 13px;
	color: var(--text-muted);
}
.framework-banner svg { color: #10b981; }
.framework-banner.svelte { border-color: #ff3e00; background: rgba(255, 62, 0, 0.05); }
.framework-banner.react { border-color: #61dafb; background: rgba(97, 218, 251, 0.05); }
.framework-banner.vue { border-color: #42b883; background: rgba(66, 184, 131, 0.05); }

.ext-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
	gap: 8px;
	padding: 24px;
	max-height: 300px;
	overflow-y: auto;
}

.ext-item {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 10px;
	background: var(--bg);
	border: 1px solid var(--border);
	border-radius: 8px;
	cursor: pointer;
	transition: all 0.15s;
}
.ext-item:hover { border-color: var(--accent); background: rgba(34, 211, 238, 0.05); }
.ext-item.active { border-color: var(--accent); background: rgba(34, 211, 238, 0.1); }
.ext-item input { display: none; }
.ext-name { font-family: var(--font-code); font-size: 13px; font-weight: 700; color: var(--text-muted); }
.ext-item.active .ext-name { color: var(--accent); }

.modal-utils {
	display: flex;
	gap: 12px;
	padding: 0 24px 20px;
}
.util-btn {
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--text-faint);
	background: none;
	border: none;
	cursor: pointer;
	padding: 0;
}
.util-btn:hover { color: var(--accent); }

.modal-footer {
	padding: 20px 24px;
	background: rgba(30, 41, 59, 0.4);
	border-top: 1px solid var(--border);
	display: flex;
	justify-content: flex-end;
	gap: 12px;
	border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.btn-cancel {
	padding: 10px 18px;
	font-size: 13px;
	font-weight: 600;
	color: var(--text-muted);
	background: none;
	border: none;
	cursor: pointer;
}
.btn-cancel:hover { color: var(--text); }

.btn-confirm {
	padding: 10px 24px;
	background: var(--accent);
	color: #020617;
	font-size: 13px;
	font-weight: 700;
	border-radius: 8px;
	border: none;
	cursor: pointer;
	box-shadow: 0 0 15px rgba(34, 211, 238, 0.3);
}
.btn-confirm:hover { background: #67e8f9; }
.btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
</style>
