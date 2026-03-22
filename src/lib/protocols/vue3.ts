import type { FrameworkProtocol } from './types';

export const Vue3Protocol: FrameworkProtocol = {
	id: 'vue3',
	name: 'Vue 3 (Modern)',
	signatures: ['<script setup>', 'ref(', 'reactive(', 'defineProps', 'defineEmits', 'defineOptions', 'onMounted'],
	regexRules: [
		{ ruleId: 'LOGIC_SEP', pattern: /\.filter\(/g,  message: 'Array .filter() in UI component',    severity: 'error' },
		{ ruleId: 'TYPE_SAF',  pattern: /:\s*any\b/g,       message: 'Explicit any type detected',         severity: 'warning' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /export default \{/g, message: 'Options API detected (Composition API <script setup> preferred for Vue 3)', severity: 'warning' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /^\s*(async\s+)?function\s+\w+\s*\(/gm, message: 'Standard function declaration in UI (Arrow functions preferred for modern Vue style)', severity: 'warning' }
	],
	sanitize: (v) => {
		// Allow computed() for display transformations
		if (v.ruleId === 'LOGIC_SEP' && v.snippet?.includes('computed(')) {
			const isPurelyDisplay = !v.snippet.includes('api') && !v.snippet.includes('mutate');
			if (isPurelyDisplay) return false;
		}
		return true;
	},
	instructions: `VUE 3 MODE (Modern Standards):
- CORRECT: Composition API (<script setup>, ref, reactive) is idiomatic.
- STYLE (WARNING): Standard 'function' declarations in components are discouraged in favor of arrow functions (const x = () => {}).
- STYLE (WARNING): Use of Options API (export default { ... }) is discouraged when Composition API is the standard.
- ALLOWED: 'computed()' properties performing display-level transformations.
- FORBIDDEN: Vue 2 Options API exports if <script setup> is present.
- LOGIC_SEP Rule: Complex state orchestration belongs in composables (.ts files), not directly in components.`
};
