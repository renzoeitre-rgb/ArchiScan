/**
 * aiProvider.ts — Unified AI provider router.
 *
 * All callers in the app should import from HERE, never directly from
 * gemini.ts, claude.ts, or openrouter.ts. This file picks the active provider
 * based on which provider is selected in the Settings UI.
 *
 * Usage:
 *   import { audit, judgeViolation, getFixSuggestions, getActiveProvider } from './aiProvider';
 */

import { getConfig } from '../db';
import type { Violation } from '../types';

import {
	auditWithGemini,
	auditJudgeBatch as auditJudgeBatchWithGemini,
	getFixSuggestions as getFixSuggestionsWithGemini,
	isAvailable as geminiAvailable
} from './gemini';

import {
	auditWithClaude,
	auditJudgeBatchWithClaude,
	getFixSuggestionsWithClaude,
	isAvailable as claudeAvailable
} from './claude';

import {
	auditWithOpenRouter,
	auditJudgeBatchWithOpenRouter,
	getFixSuggestionsWithOpenRouter,
	isAvailable as openRouterAvailable
} from './openrouter';

// Re-export model utilities
export { fetchOpenRouterModels, clearModelCache, isModelFree } from './openrouter';
export type { OpenRouterModel } from './openrouter';
export { AVAILABLE_MODELS as GEMINI_MODELS } from './gemini';
export { AVAILABLE_CLAUDE_MODELS as CLAUDE_MODELS } from './claude';

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

export type AIProvider = 'claude' | 'gemini' | 'openrouter' | 'none';

/**
 * Returns which provider is currently active based on user choice.
 * If choice is missing/invalid, falls back to first available.
 */
export async function getActiveProvider(): Promise<AIProvider> {
	const choice = (await getConfig('activeProvider')) as AIProvider;
	if (choice === 'claude' && (await claudeAvailable())) return 'claude';
	if (choice === 'gemini' && (await geminiAvailable())) return 'gemini';
	if (choice === 'openrouter' && (await openRouterAvailable())) return 'openrouter';

	// Fallback logic
	if (await claudeAvailable()) return 'claude';
	if (await geminiAvailable()) return 'gemini';
	if (await openRouterAvailable()) return 'openrouter';
	return 'none';
}

/**
 * Returns all providers that currently have a key configured.
 */
export async function getConfiguredProviders(): Promise<AIProvider[]> {
	const configured: AIProvider[] = [];
	if (await claudeAvailable()) configured.push('claude');
	if (await geminiAvailable()) configured.push('gemini');
	if (await openRouterAvailable()) configured.push('openrouter');
	return configured;
}

// ---------------------------------------------------------------------------
// Unified public API
// ---------------------------------------------------------------------------

/**
 * Pass 1 — Audit.
 */
export async function audit(
	fileChunks: { path: string; role: string; instructions: string; content: string }[],
	framework: string
): Promise<Violation[]> {
	const provider = await getActiveProvider();

	if (provider === 'claude') return auditWithClaude(fileChunks, framework);
	if (provider === 'gemini') return auditWithGemini(fileChunks, framework);
	if (provider === 'openrouter') return auditWithOpenRouter(fileChunks, framework);

	throw new Error(
		'No AI provider configured. Please add a Gemini, Claude, or OpenRouter API key in Settings.'
	);
}

/**
 * Pass 2 — Judge (Lego Batching).
 */
export async function judgeBatch(
	context: {
		path: string;
		role: string;
		framework: string;
		imports: string[];
		violations: (Violation & { contextSnippet: string })[];
	}
): Promise<{ id: string; isFalsePositive: boolean; reasoning: string }[]> {
	const provider = await getActiveProvider();

	if (provider === 'claude') return auditJudgeBatchWithClaude(context);
	if (provider === 'gemini') return auditJudgeBatchWithGemini(context);
	if (provider === 'openrouter') return auditJudgeBatchWithOpenRouter(context);

	return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'No provider available' }));
}

/**
 * Pass 3 — Fix suggestions.
 */
export async function getFixSuggestions(
	fileChunks: { path: string; content: string }[],
	violations: Violation[]
): Promise<string> {
	const provider = await getActiveProvider();

	if (provider === 'claude') return getFixSuggestionsWithClaude(fileChunks, violations);
	if (provider === 'gemini') return getFixSuggestionsWithGemini(fileChunks, violations);
	if (provider === 'openrouter') return getFixSuggestionsWithOpenRouter(fileChunks, violations);

	throw new Error(
		'No AI provider configured. Please add a Gemini, Claude, or OpenRouter API key in Settings.'
	);
}
