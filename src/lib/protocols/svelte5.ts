import type { FrameworkProtocol } from './types';

export const Svelte5Protocol: FrameworkProtocol = {
	id: 'svelte5',
	name: 'Svelte 5 (Modern)',
	signatures: ['$state(', '$derived(', '$effect(', '$props(', 'onclick=', '{#snippet', '{@render'],
	regexRules: [
		{ ruleId: 'LOGIC_SEP', pattern: /Math\.(?!(min|max|abs|round|floor|ceil|random)\()/g, message: 'Non-UI Math usage in UI file', severity: 'error' },
		{ ruleId: 'LOGIC_SEP', pattern: /\.filter\(/g,  message: 'Array .filter() in UI file',    severity: 'error' },
		{ ruleId: 'LOGIC_SEP', pattern: /\.reduce\(/g,  message: 'Array .reduce() in UI file',    severity: 'error' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /export let /g, message: 'Legacy Svelte 4 export let detected',       severity: 'error' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /\$:/g,         message: 'Legacy Svelte 4 reactive statement ($:)',   severity: 'error' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /on:(click|change|input|submit|keydown|keyup|pointerdown|pointerup|dragstart|dragover|drop|dragleave)=/g,   message: 'Legacy on: directive syntax (use modern event attributes)', severity: 'error' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /^\s*(async\s+)?function\s+\w+\s*\(/gm, message: 'Standard function declaration in UI (Arrow functions preferred for Svelte 5 style)', severity: 'warning' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /svelte-ignore\s+/g, message: 'Found svelte-ignore suppression (Modern Svelte 5 development encourages fixing issues rather than ignoring them)', severity: 'warning' },
		{ ruleId: 'TYPE_SAF',  pattern: /:\s*any\b/g,       message: 'Explicit any type detected',         severity: 'warning' },
		{ ruleId: 'PORT_LAW',  pattern: /(?<![@\w\d-])(sm|md|lg|xl|2xl):/g, message: 'Viewport breakpoint in component (use @container queries)', severity: 'warning' }
	],
	sanitize: (v) => {
		// 1. Svelte 5 Patterns Exemption: $isMobile, MouseEvent, onclick
		if (v.ruleId === 'LOGIC_SEP' && v.snippet?.match(/(\$isMobile|\$viewport|MouseEvent|onclick)/)) {
			return false;
		}
		return true;
	},
	instructions: `SVELTE 5 MODE (Modern Standards):
- CORRECT: Use runes ($state, $derived, $props, $effect) and modern event attributes (onclick, oninput).
- STYLE (WARNING): Standard 'function' declarations in components are discouraged in favor of arrow functions (const x = () => {}).
- FORBIDDEN: Legacy 'on:click', 'export let', and '$:' syntax. 
- ALLOWED: Simple visual math, $isMobile/$viewport usage for layout.
- LOGIC_SEP Rule: Enforce strict separation. Complex math and data orchestration belong in .ts services.`
};
