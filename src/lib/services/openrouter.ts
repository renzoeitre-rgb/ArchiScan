/**
 * openrouter.ts — OpenRouter provider for the architectural auditor.
 *
 * OpenRouter exposes an OpenAI-compatible /chat/completions endpoint.
 *
 * Key features:
 * - Live model list fetched from https://openrouter.ai/api/v1/models (no auth needed)
 * - Models are filtered/searched by the UI layer
 * - All three passes supported: audit, judge, fix suggestions
 */

import { getConfig } from '../db';
import type { Violation } from '../types';
import { getSystemPrompt, JUDGE_PROMPT, FIX_PROMPT } from './gemini';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const APP_NAME = 'ArchitecturalAuditor2026';
const APP_URL = 'https://github.com/trae-ide/architectural-auditor';

// ---------------------------------------------------------------------------
// Model list types
// ---------------------------------------------------------------------------

export interface OpenRouterModel {
	id: string;
	name: string;
	description?: string;
	context_length: number;
	pricing: {
		prompt: string;
		completion: string;
	};
}

interface OpenRouterModelsResponse {
	data: OpenRouterModel[];
}

// ---------------------------------------------------------------------------
// Model list — fetched live, cached for the session
// ---------------------------------------------------------------------------

let _modelCache: OpenRouterModel[] | null = null;

export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
	if (_modelCache) return _modelCache;

	try {
		const res = await fetch(OPENROUTER_MODELS_URL, {
			headers: { 'Content-Type': 'application/json' }
		});

		if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);

		const data: OpenRouterModelsResponse = await res.json();

		// Sort: free models first, then alphabetically
		const sorted = data.data.sort((a, b) => {
			const aFree = parseFloat(a.pricing.prompt) === 0;
			const bFree = parseFloat(b.pricing.prompt) === 0;
			if (aFree && !bFree) return -1;
			if (!aFree && bFree) return 1;
			return a.name.localeCompare(b.name);
		});

		_modelCache = sorted;
		return sorted;
	} catch (e) {
		console.error('Failed to fetch OpenRouter model list:', e);
		return [];
	}
}

export function clearModelCache(): void {
	_modelCache = null;
}

export function isModelFree(model: OpenRouterModel): boolean {
	return parseFloat(model.pricing.prompt) === 0 && parseFloat(model.pricing.completion) === 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function callOpenRouter(
	apiKey: string,
	model: string,
	system: string,
	userContent: string,
	maxTokens = 4096
): Promise<string> {
	async function attempt(retries = 1): Promise<Response> {
		const res = await fetch(OPENROUTER_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
				'HTTP-Referer': APP_URL,
				'X-Title': APP_NAME
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: userContent }
				]
			})
		});

		if (res.status === 429 && retries > 0) {
			await new Promise((r) => setTimeout(r, 5000));
			return attempt(retries - 1);
		}

		return res;
	}

	const res = await attempt();

	if (!res.ok) {
		const error = await res.json();
		throw new Error(error.error?.message || `OpenRouter request failed (${res.status})`);
	}

	const data = await res.json();
	return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Strips markdown fences and parses JSON.
 * NOTE: OpenRouter models (especially smaller/free ones) vary in quality. 
 * If parsing fails, it's often because the model included a preamble.
 */
function parseJsonResponse<T>(raw: string): T {
	const cleaned = raw
		.replace(/```json/g, '')
		.replace(/```/g, '')
		.trim();
	return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function isAvailable(): Promise<boolean> {
	const apiKey = await getConfig('openRouterApiKey');
	return !!apiKey;
}

async function getSelectedModel(): Promise<string> {
	return (await getConfig('openRouterSelectedModel')) || 'qwen/qwen3-next-80b-a3b-instruct:free';
}

export async function auditWithOpenRouter(
	fileChunks: { path: string; role: string; instructions: string; content: string }[],
	framework: string
): Promise<Violation[]> {
	const apiKey = await getConfig('openRouterApiKey');
	if (!apiKey) throw new Error('OpenRouter API Key is not configured');

	const model = await getSelectedModel();
	const system = getSystemPrompt(framework);

	const userContent = `[AUDIT BATCH]\n\n${fileChunks
		.map(
			(f) =>
				`--- FILE: ${f.path} (Role: ${f.role}) ---\nINSTRUCTION: ${f.instructions}\n\n[Contents]\n${f.content
					.split('\n')
					.map((l, idx) => `${idx + 1}: ${l}`)
					.join('\n')}`
		)
		.join('\n\n')}

Return ONLY a valid JSON array of violation objects. No preamble, no markdown fences.`;

	const text = await callOpenRouter(apiKey, model, system, userContent, 4096);
	if (!text) return [];

	try {
		return parseJsonResponse<Violation[]>(text);
	} catch {
		console.error('Failed to parse OpenRouter audit response:', text);
		throw new Error('OpenRouter returned invalid JSON during audit pass');
	}
}

/**
 * Pass 2: Senior Judge Pass (Lego Batching)
 */
export async function auditJudgeBatchWithOpenRouter(
	context: {
		path: string;
		role: string;
		framework: string;
		imports: string[];
		violations: (Violation & { contextSnippet: string })[];
	}
): Promise<{ id: string; isFalsePositive: boolean; reasoning: string }[]> {
	const apiKey = await getConfig('openRouterApiKey');
	if (!apiKey) return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'No API key for judge pass' }));

	const model = await getSelectedModel();

	const userContent = `CONTEXT:
File: ${context.path}
Role: ${context.role}
Framework: ${context.framework}

IMPORT LIST:
${context.imports.map((i) => `- ${i}`).join('\n')}

SUSPECTED VIOLATIONS TO JUDGE:
${context.violations.map((v, idx) => `
[VIOLATION #${idx + 1}]
ID: ${v.id}
RULE: ${v.ruleId}
MESSAGE: ${v.message}
SNIPPET CONTEXT (+/- 5 lines):
${v.contextSnippet}
---`).join('\n')}

Respond ONLY with a JSON array of objects, one for each violation ID.
Format: { "id": string, "isFalsePositive": boolean, "reasoning": string }`;

	try {
		const text = await callOpenRouter(apiKey, model, JUDGE_PROMPT, userContent, 2048);
		if (!text) return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'No response from judge' }));
		return parseJsonResponse(text);
	} catch (e) {
		console.error('OpenRouter Batch Judge pass failed:', e);
		return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'Judge error: ' + (e instanceof Error ? e.message : String(e)) }));
	}
}

export async function getFixSuggestionsWithOpenRouter(
	fileChunks: { path: string; content: string }[],
	violations: Violation[]
): Promise<string> {
	const apiKey = await getConfig('openRouterApiKey');
	if (!apiKey) throw new Error('OpenRouter API Key is not configured');

	const model = await getSelectedModel();

	const userContent = `CONTEXT:
Files:
${fileChunks.map((f) => `Path: ${f.path}\nContent:\n${f.content}`).join('\n\n')}

Violations:
${JSON.stringify(violations, null, 2)}`;

	const text = await callOpenRouter(apiKey, model, FIX_PROMPT, userContent, 4096);
	return text || 'No suggestions generated.';
}
