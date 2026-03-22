import type { FrameworkProtocol } from './types';

export const NextAppProtocol: FrameworkProtocol = {
	id: 'next_app',
	name: 'Next.js (App Router)',
	signatures: ['"use client"', '"use server"', 'export default async function', 'params:', 'searchParams:'],
	regexRules: [
		{ ruleId: 'LOGIC_SEP', pattern: /\.filter\(/g,  message: 'Array .filter() in App component',    severity: 'error' },
		{ ruleId: 'TYPE_SAF',  pattern: /:\s*any\b/g,       message: 'Explicit any type detected',         severity: 'warning' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /"use client"/g, message: 'Client Component detected (Keep client components small and leaf-focused)', severity: 'warning' }
	],
	sanitize: (v) => {
		// Server Components (async functions) are ALLOWED to have data fetching logic
		if (v.snippet?.includes('async function') && !v.snippet?.includes('"use client"')) {
			const isDataFetch = v.snippet.includes('fetch(') || v.snippet.includes('db.');
			if (isDataFetch) return false;
		}
		return true;
	},
	instructions: `NEXT.JS APP ROUTER MODE:
- CORRECT: Server Components (default) can be async and perform data fetching.
- STYLE (WARNING): "use client" components should be kept minimal and leaf-focused.
- ALLOWED: Data fetching logic directly in async Page/Layout components.
- FORBIDDEN: Heavy domain logic in "use client" components.
- LOGIC_SEP Rule: Relaxed for Server Components (orchestrators), strict for Client Components.`
};
