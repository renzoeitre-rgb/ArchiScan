import type { FrameworkProtocol } from './types';

export const NextPagesProtocol: FrameworkProtocol = {
	id: 'next_pages',
	name: 'Next.js (Pages Router)',
	signatures: ['getStaticProps', 'getServerSideProps', 'getStaticPaths', 'import Link from "next/link"'],
	regexRules: [
		{ ruleId: 'LOGIC_SEP', pattern: /\.filter\(/g,  message: 'Array .filter() in Page component',    severity: 'error' },
		{ ruleId: 'TYPE_SAF',  pattern: /:\s*any\b/g,       message: 'Explicit any type detected',         severity: 'warning' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /get(Static|ServerSide)Props/g, message: 'Legacy Pages Router data fetching (Next.js App Router preferred for new projects)', severity: 'warning' }
	],
	sanitize: (v) => {
		// Data fetching functions in Pages router ARE logic-heavy by design
		if (v.snippet?.match(/get(Static|ServerSide)Props/)) return false;
		return true;
	},
	instructions: `NEXT.JS PAGES MODE:
- ALLOWED: 'getStaticProps' and 'getServerSideProps' for data fetching.
- STYLE (WARNING): The Pages router is considered legacy; consider migrating to the App router for new projects.
- LOGIC_SEP Rule: Relaxed for data-fetching functions, but strict for the component render function.`
};
