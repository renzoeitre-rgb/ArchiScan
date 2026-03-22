import type { FrameworkProtocol } from './types';

export const ReactProtocol: FrameworkProtocol = {
	id: 'react',
	name: 'React (Modern)',
	signatures: ['useEffect', 'useState', 'useMemo', 'useCallback', 'useContext', 'className='],
	regexRules: [
		{ ruleId: 'LOGIC_SEP', pattern: /\.filter\(/g,  message: 'Array .filter() in UI component',    severity: 'error' },
		{ ruleId: 'TYPE_SAF',  pattern: /:\s*any\b/g,       message: 'Explicit any type detected',         severity: 'warning' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /\bclass\s+\w+\s+extends\s+(React\.)?Component/g, message: 'Legacy Class Component detected (Functional components preferred)', severity: 'warning' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /^\s*(async\s+)?function\s+\w+\s*\(/gm, message: 'Standard function declaration in UI (Arrow functions preferred for modern React style)', severity: 'warning' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /\bclass=/g, message: 'Use className instead of class in JSX', severity: 'error' }
	],
	sanitize: (v) => {
		// 1. Allow .map() inside JSX blocks for rendering
		if (v.ruleId === 'LOGIC_SEP' && v.snippet?.includes('.map(') && v.snippet?.includes('<')) return false;
		
		// 2. Allow useMemo/useCallback for display values
		if (v.ruleId === 'LOGIC_SEP' && v.snippet?.match(/use(Memo|Callback)/)) {
			const isPurelyDisplay = !v.snippet.includes('dispatch') && !v.snippet.includes('fetch');
			if (isPurelyDisplay) return false;
		}

		return true;
	},
	instructions: `REACT MODE (Modern Standards):
- CORRECT: React hooks (useState, useEffect, useMemo) are idiomatic.
- STYLE (WARNING): Standard 'function' declarations in components are discouraged in favor of arrow functions (const x = () => {}).
- STYLE (WARNING): Legacy Class Components are discouraged.
- FORBIDDEN: 'class=' in JSX (use 'className').
- ALLOWED: useMemo/useCallback wrapping derived display values (these are React's computed properties).
- ALLOWED: Inline JSX .map() expressions used solely for rendering elements.
- LOGIC_SEP Rule: Flag complex business logic or mutations inside hooks. Display transformations are fine.`
};
