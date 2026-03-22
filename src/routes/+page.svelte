<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { getAllFiles, getConfig, setConfig, detachProject, deleteFile, getAllProjects, deleteProject, getProject } from '$lib/db';
	import type { StoredFile, Project } from '$lib/types';
	import { auditorState, runBatchAudit } from '$lib/services/auditor.svelte';
	import Ingester from '$lib/components/Ingester.svelte';
	import FileSidebar from '$lib/components/FileSidebar.svelte';
	import CodeViewer from '$lib/components/CodeViewer.svelte';
	import AuditPanel from '$lib/components/AuditPanel.svelte';
	import ReportView from '$lib/components/ReportView.svelte';
	import { 
		GEMINI_MODELS, 
		CLAUDE_MODELS,
		fetchOpenRouterModels, 
		isModelFree, 
		type OpenRouterModel,
		type AIProvider
	} from '$lib/services/aiProvider';

	// ── State ──────────────────────────────────────────────────────────────────

	let indexedFiles     = $state<StoredFile[]>([]);
	let viewedFile       = $state<StoredFile | null>(null);   // file open in code viewer
	let selectedIds      = new SvelteSet<string>();          // IDs checked for audit
	let showSettings     = $state(false);
	let showHistory      = $state(false);
	
	// Projects State
	let projects         = $state<Project[]>([]);
	let currentProject   = $state<Project | null>(null);
	
	// API Configuration State
	let activeProvider   = $state<AIProvider>('gemini');
	let geminiApiKey     = $state('');
	let claudeApiKey     = $state('');
	let openRouterApiKey = $state('');
	
	let geminiModel      = $state('gemini-3-flash-preview');
	let claudeModel      = $state('claude-sonnet-4-6');
	let orModel          = $state('qwen/qwen3-next-80b-a3b-instruct:free');
	
	let orModels         = $state<OpenRouterModel[]>([]);
	let isLoadingOR      = $state(false);

	// ── Derived ────────────────────────────────────────────────────────────────

	let selectedCount = $derived(selectedIds.size);
	let isRunning     = $derived(auditorState.status === 'running');
	let auditProgressText = $derived(`Auditing… ${auditorState.batchDone}/${auditorState.batchTotal}`);
	/** True once audit has finished at least once */
	let hasReport     = $derived(auditorState.hasResults && auditorState.status !== 'running' && auditorState.status !== 'pending');

	// ── Init ───────────────────────────────────────────────────────────────────

	// Initial load
	$effect(() => {
		refreshFiles(); 
		loadConfig(); 
		refreshProjects();
	});

	async function refreshFiles() {
		// Safety: Don't refresh files while an audit is running to avoid UI flickering or state desync
		if (auditorState.status === 'running') return;

		indexedFiles = await getAllFiles();
		const projectId = await getConfig('currentProjectId');
		if (projectId) {
			currentProject = (await getProject(projectId)) ?? null;
			await auditorState.loadProjectResults(projectId);
		} else {
			currentProject = null;
		}
	}

	async function refreshProjects() {
		projects = await getAllProjects();
	}

	async function loadProject(id: string) {
		await setConfig('currentProjectId', id);
		showHistory = false;
		viewedFile = null;
		selectedIds.clear();
		await refreshFiles();
	}

	async function handleDeleteProject(id: string) {
		if (confirm('Permanently delete this project history and all associated reports?')) {
			await deleteProject(id);
			await refreshProjects();
			
			// If we deleted the current project, clear the UI
			const currentId = await getConfig('currentProjectId');
			if (!currentId || currentId === '') {
				auditorState.clearResults();
				await refreshFiles();
			}
		}
	}

	async function loadConfig() {
		activeProvider   = (await getConfig('activeProvider')) as AIProvider || 'gemini';
		geminiApiKey     = (await getConfig('geminiApiKey')) || '';
		claudeApiKey     = (await getConfig('claudeApiKey')) || '';
		openRouterApiKey = (await getConfig('openRouterApiKey')) || '';
		geminiModel      = (await getConfig('selectedModel')) || 'gemini-3-flash-preview';
		claudeModel      = (await getConfig('claudeSelectedModel')) || 'claude-sonnet-4-6';
		orModel          = (await getConfig('openRouterSelectedModel')) || 'qwen/qwen3-next-80b-a3b-instruct:free';
		
		if (showSettings) loadORModels();
	}

	async function loadORModels() {
		isLoadingOR = true;
		orModels = await fetchOpenRouterModels();
		isLoadingOR = false;
	}

	async function saveProvider()  { await setConfig('activeProvider', activeProvider); }
	async function saveGeminiKey() { await setConfig('geminiApiKey',   geminiApiKey); }
	async function saveClaudeKey() { await setConfig('claudeApiKey',   claudeApiKey); }
	async function saveORKey()     { await setConfig('openRouterApiKey', openRouterApiKey); }
	async function saveGeminiModel() { await setConfig('selectedModel', geminiModel); }
	async function saveClaudeModel() { await setConfig('claudeSelectedModel', claudeModel); }
	async function saveORModel()     { await setConfig('openRouterSelectedModel', orModel); }

	/**
	 * Starts a new analysis session by detaching the current project.
	 * The current analysis is saved in History.
	 */
	async function handleNewAudit() {
		if (confirm('Start a new audit? Current analysis will be saved in History.')) {
			await detachProject();
			auditorState.clearResults();
			await refreshFiles();
			viewedFile  = null;
			selectedIds.clear();
		}
	}

	async function removeSelectedFiles() {
		if (selectedIds.size === 0) return;
		const count = selectedIds.size;
		if (confirm(`Remove ${count} selected file${count !== 1 ? 's' : ''} from project?`)) {
			for (const id of selectedIds) {
				await deleteFile(id);
			}
			selectedIds.clear();
			await refreshFiles();
			viewedFile = null;
		}
	}

	// ── Selection ──────────────────────────────────────────────────────────────

	function toggleSelect(id: string) {
		if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
	}

	function selectAll()    { indexedFiles.forEach(f => selectedIds.add(f.id)); }
	function deselectAll()  { selectedIds.clear(); }
	let allSelected = $derived(indexedFiles.length > 0 && selectedIds.size === indexedFiles.length);

	// ── Audit ──────────────────────────────────────────────────────────────────

	async function auditSelected() {
		const files = auditorState.getSelectedFiles(indexedFiles, selectedIds);
		if (files.length === 0) return;
		await runBatchAudit(files);
	}

	async function auditAll() {
		await runBatchAudit(indexedFiles);
	}

	let showIngesterModal = $state(false);
	function openReindex() {
		showIngesterModal = true;
	}
</script>

<div class="app-shell">

	<!-- ── Top Bar ── -->
	<header class="topbar">
		<div class="topbar-left">
			<div class="topbar-brand">
				<div class="brand-icon">AS</div>
				<h1 class="brand-title">ArchiScan</h1>
			</div>
		</div>

		<div class="topbar-center">
			{#if indexedFiles.length > 0}
				<div class="topbar-actions">
					<!-- Select all toggle -->
					<button class="btn btn-ghost" onclick={() => allSelected ? deselectAll() : selectAll()}>
						{allSelected ? 'Deselect All' : `Select All (${indexedFiles.length})`}
					</button>

					<button class="btn btn-ghost" onclick={openReindex} disabled={isRunning} title="Add more files or update existing">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
						Reindex
					</button>

					<button class="btn btn-new-audit" onclick={handleNewAudit} disabled={isRunning} title="Start a new analysis (saves current to history)">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/></svg>
						New Audit
					</button>

					<!-- Audit Selected — only if something is checked -->
					{#if selectedCount > 0}
						<button class="btn btn-run-sel" onclick={auditSelected} disabled={isRunning}>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
							{isRunning ? auditProgressText : `Audit Selected (${selectedCount})`}
						</button>
					{/if}

					<!-- Audit All -->
					<button class="btn btn-run-all" onclick={auditAll} disabled={isRunning}>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
						{isRunning ? auditProgressText : `Audit All (${indexedFiles.length})`}
					</button>
				</div>
			{/if}
		</div>

		<div class="topbar-right">
			<button class="btn btn-icon" onclick={() => { showHistory = !showHistory; if(showHistory) refreshProjects(); }} title="History of Analysis" aria-label="History">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
				</svg>
			</button>

			<button class="btn btn-icon" onclick={() => (showSettings = !showSettings)} title="Settings" aria-label="Settings">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
				</svg>
			</button>
		</div>
	</header>

	<!-- ── Main Layout ── -->
	<main class="main-layout">

		<!-- Sidebar with per-file checkboxes -->
		<FileSidebar
			files={indexedFiles}
			scores={auditorState.scores}
			selectedIds={selectedIds}
			onselect={toggleSelect}
			onviewfile={(f) => (viewedFile = f)}
			onremove={removeSelectedFiles}
		/>

		<!-- Content area -->
		<div class="content-area">
			{#if indexedFiles.length === 0}
				<!-- Step 1: no files yet -->
				<div class="empty-state">
					<div class="empty-card">
						<div class="empty-icon">
							<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
							</svg>
						</div>
						<h2 class="empty-title">Welcome, Architect.</h2>
						<p class="empty-desc">Upload your project folder to begin the architectural governance audit.</p>
						<Ingester oncomplete={refreshFiles} bind:showModal={showIngesterModal} />
					</div>
				</div>

			{:else if viewedFile}
				<!-- File code view — click a file name in sidebar or report to open it -->
				<div class="editor-layout">
					<div class="viewer-back">
						<button class="btn btn-ghost" onclick={() => (viewedFile = null)}>
							← Back to Report
						</button>
					</div>
					<CodeViewer
						file={viewedFile}
						violations={auditorState.violations.get(viewedFile.id) ?? []}
					/>
					{#if auditorState.violations.has(viewedFile.id)}
						<AuditPanel
							violations={auditorState.violations.get(viewedFile.id) ?? []}
							score={auditorState.scores.get(viewedFile.id) ?? 0}
						/>
					{/if}
				</div>

			{:else if hasReport}
				<!-- Consolidated report — shown after audit, before clicking a file -->
				<ReportView
					files={indexedFiles}
					violations={auditorState.violations}
					scores={auditorState.scores}
					onviewfile={(f) => (viewedFile = f)}
				/>

			{:else}
				<!-- Step 2: files indexed, nothing previewed yet -->
				<div class="empty-state">
					<div class="guide-card">
						<div class="guide-steps">
							<div class="guide-step">
								<span class="step-num done">✓</span>
								<div>
									<strong>{indexedFiles.length} files indexed</strong>
									<p>Your project is ready for analysis.</p>
								</div>
							</div>
							<div class="guide-step">
								<span class="step-num">2</span>
								<div>
									<strong>Select files to audit</strong>
									<p>Check individual files in the sidebar, or use <em>Select All</em> in the top bar.</p>
								</div>
							</div>
							<div class="guide-step">
								<span class="step-num">3</span>
								<div>
									<strong>Run the audit</strong>
									<p>Hit <em>Audit Selected</em> or <em>Audit All</em> in the top bar. Make sure your Gemini API key is set in ⚙ Settings.</p>
								</div>
							</div>
						</div>

						<!-- Shortcut buttons directly here too -->
						<div class="guide-actions">
							<button class="btn btn-ghost" onclick={openReindex} disabled={isRunning} title="Add more files or update existing">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
								Reindex Project
							</button>
							<button class="btn btn-run-all" onclick={auditAll} disabled={isRunning}>
								<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
								Audit Entire Project
							</button>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- ── History Drawer ── -->
		{#if showHistory}
			<div
				class="overlay"
				role="button"
				tabindex="0"
				onclick={() => (showHistory = false)}
				onkeydown={(e) => e.key === 'Escape' && (showHistory = false)}
			>
				<div
					class="drawer"
					role="dialog"
					aria-modal="true"
					aria-label="History"
					tabindex="-1"
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => e.stopPropagation()}
				>
					<div class="drawer-header">
						<h2 class="drawer-title">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent)">
								<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
							</svg>
							Analysis History
						</h2>
						<button class="btn btn-icon" aria-label="Close history" onclick={() => (showHistory = false)}>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
						</button>
					</div>

					<div class="drawer-body history-list">
						{#if projects.length === 0}
							<div class="history-empty">
								<p>No past analysis sessions found.</p>
							</div>
						{:else}
							{#each projects.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) as p (p.id)}
								<div class="history-item {currentProject?.id === p.id ? 'active' : ''}">
									<button class="history-item-main" onclick={() => loadProject(p.id)}>
										<div class="history-item-info">
											<span class="history-name">{p.name}</span>
											<span class="history-meta">
												{p.framework.toUpperCase()} • {p.createdAt.toLocaleDateString()}
											</span>
										</div>
									</button>
									<button 
										class="btn-remove-history" 
										onclick={() => handleDeleteProject(p.id)}
										title="Delete history"
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
									</button>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- ── Settings Drawer ── -->
		{#if showSettings}
			<div
				class="overlay"
				role="button"
				tabindex="0"
				onclick={() => (showSettings = false)}
				onkeydown={(e) => e.key === 'Escape' && (showSettings = false)}
			>
				<div
					class="drawer"
					role="dialog"
					aria-modal="true"
					aria-label="Settings"
					tabindex="-1"
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => e.stopPropagation()}
				>
					<div class="drawer-header">
						<h2 class="drawer-title">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent)">
								<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
							</svg>
							Settings
						</h2>
						<button class="btn btn-icon" aria-label="Close settings" onclick={() => (showSettings = false)}>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
						</button>
					</div>

					<div class="drawer-body">
						<!-- Provider Selector -->
						<div class="field">
							<span class="field-label">Active Provider</span>
							<div class="provider-toggle">
								<button 
									class="provider-btn {activeProvider === 'gemini' ? 'active' : ''}" 
									onclick={() => { activeProvider = 'gemini'; saveProvider(); }}
								>Gemini</button>
								<button 
									class="provider-btn {activeProvider === 'claude' ? 'active' : ''}" 
									onclick={() => { activeProvider = 'claude'; saveProvider(); }}
								>Claude</button>
								<button 
									class="provider-btn {activeProvider === 'openrouter' ? 'active' : ''}" 
									onclick={() => { activeProvider = 'openrouter'; saveProvider(); loadORModels(); }}
								>OpenRouter</button>
							</div>
						</div>

						<div class="settings-divider"></div>

						{#if activeProvider === 'gemini'}
							<div class="field">
								<label for="gemini-key" class="field-label">Gemini API Key</label>
								<input
									id="gemini-key"
									type="password"
									class="field-input"
									placeholder="Paste your Gemini key…"
									bind:value={geminiApiKey}
									onblur={saveGeminiKey}
								/>
							</div>
							<div class="field">
								<label for="gemini-model" class="field-label">Gemini Model</label>
								<select id="gemini-model" class="field-select" bind:value={geminiModel} onchange={saveGeminiModel}>
									{#each GEMINI_MODELS as model (model.id)}
										<option value={model.id}>{model.label}</option>
									{/each}
								</select>
							</div>
						{:else if activeProvider === 'claude'}
							<div class="field">
								<label for="claude-key" class="field-label">Claude API Key</label>
								<input
									id="claude-key"
									type="password"
									class="field-input"
									placeholder="Paste your Claude key…"
									bind:value={claudeApiKey}
									onblur={saveClaudeKey}
								/>
								<p class="field-hint">Direct Anthropic API access.</p>
							</div>
							<div class="field">
								<label for="claude-model" class="field-label">Claude Model</label>
								<select id="claude-model" class="field-select" bind:value={claudeModel} onchange={saveClaudeModel}>
									{#each CLAUDE_MODELS as model (model.id)}
										<option value={model.id}>{model.label}</option>
									{/each}
								</select>
								<p class="field-hint cost-warning">⚠️ Note: All Claude models are paid (pay-per-token).</p>
							</div>
						{:else if activeProvider === 'openrouter'}
							<div class="field">
								<label for="or-key" class="field-label">OpenRouter API Key</label>
								<input
									id="or-key"
									type="password"
									class="field-input"
									placeholder="Paste your OpenRouter key…"
									bind:value={openRouterApiKey}
									onblur={saveORKey}
								/>
							</div>
							<div class="field">
								<label for="or-model" class="field-label">OpenRouter Model</label>
								<select id="or-model" class="field-select" bind:value={orModel} onchange={saveORModel} disabled={isLoadingOR}>
									{#if isLoadingOR}
										<option>Loading models...</option>
									{:else}
										{#each orModels as model (model.id)}
											<option value={model.id}>
												{isModelFree(model) ? '🎁 ' : ''}{model.name}
											</option>
										{/each}
									{/if}
								</select>
								<p class="field-hint">Models with strong JSON output (Flash, GPT-4o-mini, Haiku) are recommended for audits.</p>
							</div>
						{/if}

						<div class="settings-divider"></div>

						<button class="btn btn-new-audit full-width" onclick={handleNewAudit}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/>
							</svg>
							New Audit (Safe)
						</button>
					</div>
				</div>
			</div>
		{/if}

	</main>
</div>

<style>
.app-shell {
	display: flex;
	flex-direction: column;
	height: 100vh;
	overflow: hidden;
}

/* ── Top Bar ── */
.topbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: 56px;
	padding: 0 20px;
	border-bottom: 1px solid var(--border);
	background: rgba(15, 23, 42, 0.6);
	backdrop-filter: blur(8px);
	flex-shrink: 0;
}

.topbar-left { flex: 1; display: flex; align-items: center; }
.topbar-center { flex: 2; display: flex; align-items: center; justify-content: center; }
.topbar-right { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }

.topbar-brand { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }

.brand-icon {
	width: 30px; height: 30px;
	display: flex; align-items: center; justify-content: center;
	background: #0e7490;
	border-radius: 8px;
	font-weight: 900; font-size: 14px; color: white;
	box-shadow: 0 0 16px rgba(14, 116, 144, 0.5);
}
.brand-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; white-space: nowrap; }
.accent { color: var(--accent); }

.topbar-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	overflow: hidden;
}

/* ── Buttons ── */
.btn { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; border-radius: 8px; transition: all 0.15s; white-space: nowrap; }

.btn-ghost {
	padding: 5px 12px;
	font-size: 12px;
	color: var(--text-muted);
	border: 1px solid var(--border);
}
.btn-new-audit {
	padding: 6px 14px;
	background: rgba(234, 179, 8, 0.15);
	border: 1px solid var(--warn);
	color: var(--warn);
	font-size: 12px;
}
.btn-new-audit:hover:not(:disabled) { background: rgba(234, 179, 8, 0.25); }
.btn-new-audit.full-width { width: 100%; justify-content: center; }

.btn-run-sel {
	padding: 6px 14px;
	background: rgba(14, 116, 144, 0.3);
	border: 1px solid var(--accent);
	color: var(--accent);
	border-radius: 999px;
	font-size: 12px;
}
.btn-run-sel:hover:not(:disabled) { background: rgba(14, 116, 144, 0.5); }
.btn-run-sel:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-run-all {
	padding: 6px 16px;
	background: #059669;
	color: white;
	border-radius: 999px;
	font-size: 12px;
	box-shadow: 0 0 16px rgba(5, 150, 105, 0.3);
}
.btn-run-all:hover:not(:disabled) { background: #10b981; }
.btn-run-all:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-icon {
	padding: 7px;
	color: var(--text-muted);
	border-radius: 8px;
	flex-shrink: 0;
}
.btn-icon:hover { background: var(--surface-2); color: var(--text); }

/* ── Main layout ── */
.main-layout {
	display: flex;
	flex: 1;
	overflow: hidden;
	position: relative;
}

.content-area {
	display: flex;
	flex-direction: column;
	flex: 1;
	overflow: hidden;
}

.editor-layout {
	display: flex;
	flex-direction: column;
	height: 100%;
	overflow: hidden;
}

.viewer-back {
	display: flex;
	align-items: center;
	padding: 6px 12px;
	border-bottom: 1px solid var(--border);
	background: var(--surface);
	flex-shrink: 0;
}

/* ── Empty / Guide states ── */
.empty-state {
	display: flex;
	align-items: center;
	justify-content: center;
	flex: 1;
	padding: 48px;
}

.empty-card {
	width: 100%;
	max-width: 480px;
	text-align: center;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;
}

.empty-icon {
	width: 72px; height: 72px;
	border-radius: 20px;
	background: var(--surface);
	border: 1px solid var(--border);
	display: flex; align-items: center; justify-content: center;
	color: var(--text-muted);
}

.empty-title { font-size: 24px; font-weight: 800; color: white; }
.empty-desc  { color: var(--text-muted); font-size: 14px; line-height: 1.6; }

/* Guide card shown when files are indexed but none previewed */
.guide-card {
	width: 100%;
	max-width: 520px;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: var(--radius-lg);
	padding: 32px;
	display: flex;
	flex-direction: column;
	gap: 28px;
}

.guide-steps { display: flex; flex-direction: column; gap: 20px; }

.guide-step {
	display: flex;
	align-items: flex-start;
	gap: 16px;
}

.step-num {
	width: 28px; height: 28px;
	border-radius: 50%;
	background: var(--surface-2);
	border: 1.5px solid var(--border);
	display: flex; align-items: center; justify-content: center;
	font-size: 12px; font-weight: 700;
	color: var(--text-muted);
	flex-shrink: 0;
}
.step-num.done {
	background: rgba(52, 211, 153, 0.15);
	border-color: var(--pass);
	color: var(--pass);
}

.guide-step strong { display: block; font-size: 14px; color: var(--text); margin-bottom: 3px; }
.guide-step p      { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: 0; }
.guide-step em     { color: var(--accent); font-style: normal; font-weight: 600; }

.guide-actions {
	display: flex;
	gap: 10px;
	padding-top: 4px;
	border-top: 1px solid var(--border);
}
.guide-actions .btn { flex: 1; justify-content: center; }

/* ── Settings Overlay ── */
.overlay {
	position: absolute;
	inset: 0;
	z-index: 50;
	background: rgba(2, 6, 23, 0.75);
	backdrop-filter: blur(4px);
	display: flex;
	justify-content: flex-end;
}

.drawer {
		width: 380px;
		height: 100%;
		background: var(--surface);
		border-left: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		box-shadow: -20px 0 60px rgba(0, 0, 0, 0.4);
		animation: slideIn 0.2s ease;
	}

	@keyframes slideIn {
		from { transform: translateX(100%); opacity: 0; }
		to   { transform: translateX(0);    opacity: 1; }
	}

	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 24px;
		border-bottom: 1px solid var(--border);
	}

	.drawer-title { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; }

	.drawer-body {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 24px;
		overflow-y: auto;
	}

	.history-list {
		padding: 12px;
		gap: 8px;
	}

	.history-item {
		display: flex;
		align-items: stretch;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
		transition: all 0.15s;
		margin-bottom: 8px;
	}
	.history-item:hover { border-color: var(--accent); }
	.history-item.active { border-color: var(--accent); background: rgba(34, 211, 238, 0.05); }

	.history-item-main {
		flex: 1;
		display: flex;
		text-align: left;
		padding: 12px 16px;
		background: none;
		border: none;
		cursor: pointer;
	}

	.history-item-info { display: flex; flex-direction: column; gap: 4px; }
	.history-name { font-size: 14px; font-weight: 700; color: white; }
	.history-meta { font-size: 11px; color: var(--text-faint); font-family: var(--font-code); }

	.btn-remove-history {
		padding: 0 16px;
		background: none;
		border: none;
		border-left: 1px solid var(--border);
		color: var(--text-faint);
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-remove-history:hover { color: var(--error); background: rgba(244, 63, 94, 0.1); }

	.history-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 200px;
		color: var(--text-faint);
		font-size: 13px;
	}

.settings-divider { border-top: 1px solid var(--border-2); }

.provider-toggle {
	display: flex;
	background: var(--surface-2);
	padding: 4px;
	border-radius: 10px;
	border: 1px solid var(--border);
}

.provider-btn {
	flex: 1;
	padding: 6px 12px;
	font-size: 11px;
	font-weight: 700;
	color: var(--text-muted);
	border: none;
	background: none;
	border-radius: 6px;
	cursor: pointer;
	transition: all 0.15s;
}

.provider-btn.active {
	background: var(--accent);
	color: #020617;
	box-shadow: 0 2px 8px rgba(34, 211, 238, 0.3);
}

.cost-warning {
	color: var(--warn) !important;
	font-weight: 600;
}

/* ── Form Fields ── */
.field { display: flex; flex-direction: column; gap: 8px; }

.field-label {
	font-size: 11px; font-weight: 700;
	letter-spacing: 0.08em; text-transform: uppercase;
	color: var(--text-faint);
}

.field-input, .field-select {
	width: 100%;
	padding: 10px 14px;
	background: var(--bg);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	color: var(--text);
	font-size: 13px;
	outline: none;
	transition: border-color 0.15s;
	appearance: none;
}
.field-input:focus, .field-select:focus { border-color: var(--accent); }
.field-hint { font-size: 11px; color: var(--text-faint); font-style: italic; }
</style>
