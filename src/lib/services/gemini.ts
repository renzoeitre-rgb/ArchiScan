import { getConfig } from '../db';
import type { Violation } from '../types';

export const AVAILABLE_MODELS = [
	{ id: 'gemini-3-flash-preview',        label: 'Gemini 3 Flash (Free — default)',        tier: 'free' },
	{ id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite (Free — fastest)', tier: 'free' },
	{ id: 'gemini-2.5-flash',              label: 'Gemini 2.5 Flash (Free — stable)',        tier: 'free' },
	{ id: 'gemini-3.1-pro-preview',        label: 'Gemini 3.1 Pro (Paid)',                   tier: 'paid' }
] as const;

export type GeminiModelId = (typeof AVAILABLE_MODELS)[number]['id'];

// The default model must match one of the IDs above.
const DEFAULT_MODEL: GeminiModelId = 'gemini-3-flash-preview';

/**
 * LAW BOOKS (Instruction Aliasing)
 * We define long-form rules once in the system prompt and reference them
 * by ID in the file chunks to save tokens.
 */
export const LAW_BOOKS = {
	DEP_DIR: `DEP_DIR (Dependency Direction - CRITICAL):
- FORBIDDEN: Any file classified as 'Service' or 'Tool' importing from a 'Component' file.
- Reasoning: Business logic must never depend on the UI framework.`,

	LOGIC_SEP: `LOGIC_SEP (Data/Logic Separation - CRITICAL):
- FOR COMPONENTS ONLY:
  - FORBIDDEN ("Data Leaks"): .filter(), .reduce(), .map() containing heavy business logic.
  - FORBIDDEN ("Domain Math"): Business-domain calculations that encode application rules, financial logic, eligibility/decision logic, or persistence workflows.
  - MANDATORY ALLOWED ("The Visual Math Rule"): NEVER FLAG Math usage for visual layout (percentages, clamping, layout scaling, CSS variables, offsets, opacity, etc.). IF THE RESULT IS CONSUMED DIRECTLY BY A "style:" OR "class:" ATTRIBUTE, IT IS 100% SAFE.
  - MANDATORY ALLOWED ("Formatting & Projection"): Simple display formatting and UI Data Projection (grouping/sorting for display) are ALLOWED.
- FOR ROUTES: ALLOWED ("Route Relaxation") for "Last Mile" formatting.
- FOR SERVICES/TOOLS: ALLOWED: All complex math and data transformations belong here.`,

	PORT_LAW: `PORT_LAW (Adaptive Layout in Components):
- FORBIDDEN: Raw viewport breakpoints (sm:, md:, lg:, xl:, 2xl:).
- MANDATORY ALLOWED ("The @ Prefix Rule"): ANY breakpoint prefixed with @ (e.g., @sm:, @md:, @lg:) is a VALID Container Query. DO NOT FLAG THESE.`,

	FRAMEWORK_INT: `FRAMEWORK_INT (Integrity):
- FOR COMPONENTS ONLY: Use modern framework features. Flag legacy syntax as specified in the FRAMEWORK CONTEXT.`,

	TYPE_SAF: `TYPE_SAF: No "any" or ambiguous "unknown" in any file.`
};

export function getSystemPrompt(framework: string): string {
	const frameworkLaw = framework === 'react'
		? `REACT MODE: React hooks are allowed. Flag class components and 'class=' instead of 'className=' (Severity: ERROR). Suggest arrow functions over standard functions (Severity: WARNING).`
		: framework === 'svelte'
		? `SVELTE MODE: Svelte 5 runes (onclick=, {#if}) are correct. Flag legacy on:click=, export let, and $: syntax (Severity: ERROR). Suggest arrow functions over standard functions and avoid 'svelte-ignore' (Severity: WARNING).`
		: framework === 'vue'
		? `VUE MODE: Vue 3 Composition API is correct. Flag Vue 2 Options API (Severity: WARNING). Suggest arrow functions over standard functions (Severity: WARNING).`
		: `UNKNOWN FRAMEWORK: Apply general clean architecture rules.`;

	return `You are a Universal Clean Architecture Engine in the year 2026.
Your goal is to enforce architectural boundaries and semantic precision across the provided source files.

SEVERITY GUIDELINES:
- ERROR: Direct architectural breaches (Logic in UI, wrong dependency direction, critical framework misuse).
- WARNING: Modernity, Style, and "Best Practice" nudges (Standard functions vs Arrows, legacy-but-working syntax, type safety issues).

FRAMEWORK CONTEXT: ${frameworkLaw}

UNIVERSAL LAW BOOKS:
${Object.entries(LAW_BOOKS)
	.map(([id, text]) => `[LAW: ${id}]\n${text}`)
	.join('\n\n')}

Analyze the files based on their precise Role and return ONLY a JSON array of violation objects.
Every violation MUST include a "reasoning" field explaining the architectural breach.
Treat every file as a fresh line count starting from 1.

Violation Shape:
{
  "file": string, // EXACT path of the file
  "ruleId": "DEP_DIR" | "LOGIC_SEP" | "PORT_LAW" | "FRAMEWORK_INT" | "TYPE_SAF",
  "severity": "error" | "warning" | "info",
  "line": number | null,
  "column": number | null,
  "message": string,
  "snippet": string | null,
  "reasoning": string
}`;
}

export const JUDGE_PROMPT = `You are a Senior Architectural Judge in the year 2026.
Your mission is to perform a 'Deep Pass' (Pass 2) on suspected architectural violations to eliminate False Positives.

You will be given:
1. A code snippet (with 5 lines of context above and below).
2. The Import List of the file.
3. The architectural violation flagged in Pass 1.
4. The file role and framework context.

Your task is to DECIDE if the violation is a 'True Positive' or a 'False Positive'.

MANDATORY DISMISSAL RULES (Return null if any of these apply):
1. THE "@" RULE: If the violation is PORT_LAW and the snippet contains the '@' prefix (e.g., @sm:, @md:), it is a VALID Container Query. DISMISS IMMEDIATELY.
2. THE VISUAL MATH RULE: If the violation is LOGIC_SEP and the math is used for CSS percentages, clamping, layout offsets, node scaling, or purely visual juice (like particles), it is NOT a violation. IF THE RESULT IS IN A "style:" OR "class:" ATTRIBUTE, IT IS 100% SAFE. DISMISS IMMEDIATELY.
3. THE TEST FILE RULE: If the file is a .spec.ts or .test.ts file, DEP_DIR rules for importing the component under test do NOT apply. DISMISS IMMEDIATELY.
4. THE FORMATTING RULE: Simple display formatting (e.g. Math.floor for percentages in a template tag) is NOT a violation.
5. THE SVELTE 5 PROP RULE: Attributes like 'checked={checked}' or 'value={value}' in Svelte 5 components are standard property bindings. NEVER flag them as legacy syntax unless they use Svelte 4 'on:change' or 'bind:checked' where not appropriate.
6. THE UI ORCHESTRATION RULE: Local UI orchestration (e.g. toggling a sidebar, handling a button click, or managing local component state) is NOT business logic. DISMISS IMMEDIATELY.
7. THE REACT COMPUTED RULE: useMemo/useCallback in React components wrapping derived display values are NOT LOGIC_SEP violations. DISMISS IMMEDIATELY.
8. THE VUE COMPUTED RULE: computed() and watch() in Vue components are framework primitives. DISMISS IMMEDIATELY.
9. THE SVELTE 5 LAYOUT RULE: Reactive layout patterns (e.g. using $isMobile or $viewport width to switch between components) are standard UI patterns, not LOGIC_SEP. DISMISS IMMEDIATELY.
10. THE TS/SVELTE 5 EVENT RULE: Standard TypeScript event handling (e.g. MouseEvent, KeyboardEvent) is correctly used in onclick handlers. DISMISS IMMEDIATELY.

- IMPORT ANALYSIS: Use the Import List to determine if variables come from a Service (Domain) or are local/UI.
- If it's a True Positive (e.g. business logic/domain math leaking into a Component from a Service), return the violation object with an updated 'reasoning' field.
- CRITICAL: If you determine the code is "Safe", "UI Projection", "Display Logic", or a "False Positive", you MUST return null. Do not return a violation object with reasoning that defends the code.

Respond ONLY with the JSON violation object or null. No other text.`;

export const FIX_PROMPT = `You are a senior Software Architect in the year 2026. 
You are given a list of files and their architectural violations.
Your task is to explain what is wrong with the selected files and provide SUGGESTIONS ONLY on how to fix them.
Do NOT provide full code implementations. Provide conceptual, strategic advice on how to refactor the code to comply with the rules.
Format your response as a professional report in Markdown.
Always start by acknowledging that it is the year 2026 and you are applying the most modern standards.`;

export async function isAvailable(): Promise<boolean> {
	const apiKey = await getConfig('geminiApiKey');
	return !!apiKey;
}

/**
 * Shared fetcher with exponential backoff for Gemini.
 * Free tier is very sensitive to 429s.
 */
async function callGemini(
	apiKey: string,
	model: string,
	prompt: unknown,
	retries = 3,
	delay = 2000
): Promise<string> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

	async function attempt(remaining: number, currentDelay: number): Promise<string> {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(prompt)
			});

			if (res.status === 429 && remaining > 0) {
				console.warn(`Gemini 429 (Rate Limit). Retrying in ${currentDelay}ms... (${remaining} left)`);
				await new Promise((resolve) => setTimeout(resolve, currentDelay));
				return attempt(remaining - 1, currentDelay * 2);
			}

			if (!res.ok) {
				const error = await res.json();
				throw new Error(error.error?.message || `Gemini API request failed (${res.status})`);
			}

			const data = await res.json();
			return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
		} catch (e) {
			if (remaining > 0) {
				console.warn(`Gemini Request failed. Retrying in ${currentDelay}ms...`, e);
				await new Promise((resolve) => setTimeout(resolve, currentDelay));
				return attempt(remaining - 1, currentDelay * 2);
			}
			throw e;
		}
	}

	return attempt(retries, delay);
}

export function buildGeminiPayload(
	fileChunks: { path: string; role: string; instructions: string; content: string }[],
	framework: string
) {
	return {
		contents: [
			{
				role: 'user',
				parts: [
					{ text: getSystemPrompt(framework) },
					{
						text: `[AUDIT BATCH]\n\n${fileChunks
							.map(
								(f) =>
									`--- FILE: ${f.path} (Role: ${f.role}) ---\nINSTRUCTION: ${f.instructions}\n\n[Contents]\n${f.content
										.split('\n')
										.map((l, idx) => `${idx + 1}: ${l}`)
										.join('\n')}`
							)
							.join('\n\n')}`
					}
				]
			}
		]
	};
}

export async function auditWithGemini(
	fileChunks: { path: string; role: string; instructions: string; content: string }[],
	framework: string
): Promise<Violation[]> {
	const apiKey = await getConfig('geminiApiKey');
	const model = (await getConfig('selectedModel')) || DEFAULT_MODEL;

	if (!apiKey) {
		throw new Error('Gemini API Key is not configured');
	}

	const prompt = buildGeminiPayload(fileChunks, framework);
	const text = await callGemini(apiKey, model, prompt);

	if (!text) return [];

	try {
		const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
		return JSON.parse(cleanedText);
	} catch {
		console.error('Failed to parse Gemini response:', text);
		throw new Error('Gemini returned invalid JSON');
	}
}

/**
 * Pass 2: Senior Judge Pass (Lego Batching)
 * Analyzes a list of violations with context to eliminate false positives in one request.
 */
export async function auditJudgeBatch(
	context: {
		path: string;
		role: string;
		framework: string;
		imports: string[];
		violations: (Violation & { contextSnippet: string })[];
	}
): Promise<{ id: string; isFalsePositive: boolean; reasoning: string }[]> {
	const apiKey = await getConfig('geminiApiKey');
	const model = (await getConfig('selectedModel')) || DEFAULT_MODEL;

	if (!apiKey) return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'No API key for judge pass' }));

	const prompt = {
		contents: [
			{
				role: 'user',
				parts: [
					{ text: JUDGE_PROMPT },
					{
						text: `CONTEXT:
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
Format: { "id": string, "isFalsePositive": boolean, "reasoning": string }`
					}
				]
			}
		]
	};

	try {
		const text = await callGemini(apiKey, model, prompt, 5, 3000);
		if (!text) return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'No response from judge' }));

		const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
		return JSON.parse(cleanedText);
	} catch (e) {
		console.error('Batch Judge pass failed:', e);
		return context.violations.map(v => ({ id: v.id!, isFalsePositive: false, reasoning: 'Judge error: ' + (e instanceof Error ? e.message : String(e)) }));
	}
}

export async function getFixSuggestions(
	fileChunks: { path: string; content: string }[],
	violations: Violation[]
): Promise<string> {
	const apiKey = await getConfig('geminiApiKey');
	const model = (await getConfig('selectedModel')) || DEFAULT_MODEL;

	if (!apiKey) {
		throw new Error('Gemini API Key is not configured');
	}

	const prompt = {
		contents: [
			{
				role: 'user',
				parts: [
					{ text: FIX_PROMPT },
					{
						text: `CONTEXT:
Files:
${fileChunks.map((f) => `Path: ${f.path}\nContent:\n${f.content}`).join('\n\n')}

Violations:
${JSON.stringify(violations, null, 2)}`
					}
				]
			}
		]
	};

	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(prompt)
	});

	if (!res.ok) {
		const error = await res.json();
		throw new Error(error.error?.message || 'Gemini API request failed');
	}

	const data = await res.json();
	return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No suggestions generated.';
}
