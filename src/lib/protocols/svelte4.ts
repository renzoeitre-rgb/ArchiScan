import type { FrameworkProtocol } from './types';

export const Svelte4Protocol: FrameworkProtocol = {
	id: 'svelte4',
	name: 'Svelte 4 (Legacy)',
	signatures: ['export let ', '$:', 'on:click', 'createEventDispatcher'],
	regexRules: [
		{ ruleId: 'LOGIC_SEP', pattern: /Math\.(?!(min|max|abs|round|floor|ceil|random)\()/g, message: 'Non-UI Math usage in UI file', severity: 'error' },
		{ ruleId: 'LOGIC_SEP', pattern: /\.filter\(/g,  message: 'Array .filter() in UI file',    severity: 'error' },
		{ ruleId: 'LOGIC_SEP', pattern: /\.reduce\(/g,  message: 'Array .reduce() in UI file',    severity: 'error' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /createEventDispatcher\(/g, message: 'Legacy Event Dispatcher (Svelte 5 recommends passing callbacks as props)', severity: 'warning' },
		{ ruleId: 'TYPE_SAF',  pattern: /:\s*any\b/g,       message: 'Explicit any type detected',         severity: 'warning' },
		{ ruleId: 'PORT_LAW',  pattern: /(?<![@\w\d-])(sm|md|lg|xl|2xl):/g, message: 'Viewport breakpoint in component (use @container queries)', severity: 'warning' }
	],
	sanitize: (v) => {
		// 1. Svelte 4 Specific: Allow snap, rect, canvas logic in UI
		if (v.ruleId === 'LOGIC_SEP') {
			const isLegacyUI = v.snippet?.match(/(snap|rect|canvas|coord|ctx\.|render|draw)/i);
			if (isLegacyUI) return false;
		}
		
		// 2. Allow legacy patterns that would normally be flagged in Svelte 5
		if (v.ruleId === 'FRAMEWORK_INT') {
			const isSvelte4Pattern = v.snippet?.match(/(export let |\$: |on:)/);
			if (isSvelte4Pattern) return false;
		}

		return true;
	},
	instructions: `SVELTE 4 MODE (Legacy Standards):
- ALLOWED: 'export let' for props, '$:' for reactive statements, 'on:click' for events. 
- STYLE (WARNING): Use of 'createEventDispatcher' is discouraged in favor of passing callback props (Svelte 5 style).
- DO NOT FLAG legacy syntax ($:, export let) as errors in this mode.
- LOGIC_SEP Rule: Flag complex business math or data transformations. ALLOW simple display math and UI projections.`
};
