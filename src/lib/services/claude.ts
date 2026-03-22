/**
 * claude.ts — Anthropic Claude provider for the architectural auditor.
 * Mirrors the public API surface of gemini.ts so both can be used interchangeably
 * via the aiProvider router.
 *
 * All three passes are supported: audit, judge, fix suggestions.
 */

import { getConfig } from '../db';
import type { Violation } from '../types';
import { getSystemPrompt, JUDGE_PROMPT, FIX_PROMPT } from './gemini'; // Prompts are framework-agnostic — reuse them

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AVAILABLE_CLAUDE_MODELS = [
	{ id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6 (Latest)',    tier: 'paid' },
	{ id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 (Fastest)',    tier: 'paid' },
	{ id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (Stable)',     tier: 'paid' },
	{ id: 'claude-opus-4-6',            label: 'Claude Opus 4.6 (Most capable)', tier: 'paid' },
] as const;

export type ClaudeModelId = (typeof AVAILABLE_CLAUDE_MODELS)[number]['id'];

const DEFAULT_CLAUDE_MODEL: ClaudeModelId = 'claude-sonnet-4-6';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getSelectedModel(): Promise<string> {
	return (await getConfig('claudeSelectedModel')) || DEFAULT_CLAUDE_MODEL;
}

/**
 * Shared fetch wrapper for all Claude API calls.
 * Handles auth headers, retries on 429, and error surfacing.
 */
async function callClaude(
	apiKey: string,
	system: string,
	userContent: string,
	maxTokens = 4096
): Promise<string> {
	const model = await getSelectedModel();

	async function attempt(retries = 1): Promise<Response> {
		const res = await fetch(CLAUDE_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
				// Required to call the API from a browser context.
				// Note: exposing API keys in the browser is only appropriate for
				// local/personal tooling. Do not ship this in a public hosted app.
				'anthropic-dangerous-direct-browser-access': 'true'
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				system,
				messages: [{ role: 'user', content: userContent }]
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
		throw new Error(
			error.error?.message || `Claude API request failed (${res.status})`
		);
	}

	const data = await res.json();
	// Claude returns content as an array of blocks; text responses are type "text"
	const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
	return textBlock?.text ?? '';
}

/**
 * Strips markdown fences and parses JSON.
 * Claude is generally well-behaved about this, but defensive parsing never hurts.
 */
function parseJsonResponse<T>(raw: string): T {
	const cleaned = raw
		.replace(/```json/g, '')
		.replace(/```/g, '')
		.trim();
	return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// Public API — mirrors gemini.ts exports
// ---------------------------------------------------------------------------

export async function isAvailable(): Promise<boolean> {
	const apiKey = await getConfig('claudeApiKey');
	return !!apiKey;
}

/**
 * Pass 1 — Audit pass.
 * Sends batched file chunks to Claude and returns a flat array of violations.
 */
export async function auditWithClaude(
	fileChunks: { path: string; role: string; instructions: string; content: string }[],
	framework: string
): Promise<Violation[]> {
	const apiKey = await getConfig('claudeApiKey');
	if (!apiKey) throw new Error('Claude API Key is not configured');

	const system = getSystemPrompt(framework);

	const userContent = `[AUDIT BATCH]
Framework: ${framework}

${fileChunks
	.map(
		(f) =>
			`--- FILE: ${f.path} (Role: ${f.role}) ---\nINSTRUCTION: ${f.instructions}\n\n[Contents]\n${f.content
				.split('\n')
				.map((l, idx) => `${idx + 1}: ${l}`)
				.join('\n')}`
	)
	.join('\n\n')}

Return ONLY a valid JSON array of violation objects. No preamble, no markdown fences.`;

	const text = await callClaude(apiKey, system, userContent, 4096);

	if (!text) return [];

	try {
		return parseJsonResponse<Violation[]>(text);
	} catch {
		console.error('Failed to parse Claude audit response:', text);
		throw new Error('Claude returned invalid JSON during audit pass');
	}
}

/**
 * Pass 2: Senior Judge Pass (Lego Batching)
 */
export async function auditJudgeBatchWithClaude(
	context: {
		path: string;
		role: string;
		framework: string;
		imports: string[];
		violations: (Violation & { contextSnippet: string })[];
	}
): Promise<{ id: string; isFalsePositive: boolean; reasoning: string }[]> {
	const apiKey = await getConfig('claudeApiKey');
	if (!apiKey) return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'No API key for judge pass' }));

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
		const text = await callClaude(apiKey, JUDGE_PROMPT, userContent, 2048);
		if (!text) return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'No response from judge' }));
		return parseJsonResponse(text);
	} catch (e) {
		console.error('Claude Batch Judge pass failed:', e);
		return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'Judge error: ' + (e instanceof Error ? e.message : String(e)) }));
	}
}

/**
 * Pass 3 — Fix suggestions pass.
 * Returns a Markdown-formatted architectural advisory for the provided files
 * and their associated violations.
 */
export async function getFixSuggestionsWithClaude(
	fileChunks: { path: string; content: string }[],
	violations: Violation[]
): Promise<string> {
	const apiKey = await getConfig('claudeApiKey');
	if (!apiKey) throw new Error('Claude API Key is not configured');

	const userContent = `CONTEXT:
Files:
${fileChunks.map((f) => `Path: ${f.path}\nContent:\n${f.content}`).join('\n\n')}

Violations:
${JSON.stringify(violations, null, 2)}`;

	const text = await callClaude(apiKey, FIX_PROMPT, userContent, 4096);
	return text || 'No suggestions generated.';
}
