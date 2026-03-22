import type { FrameworkProtocol } from './types';

export const Vue2Protocol: FrameworkProtocol = {
	id: 'vue2',
	name: 'Vue 2 (Legacy)',
	signatures: ['export default {', 'data()', 'methods:', 'computed:', 'watch:', 'this.$set', 'this.$emit'],
	regexRules: [
		{ ruleId: 'LOGIC_SEP', pattern: /\.filter\(/g,  message: 'Array .filter() in UI component',    severity: 'error' },
		{ ruleId: 'TYPE_SAF',  pattern: /:\s*any\b/g,       message: 'Explicit any type detected',         severity: 'warning' },
		{ ruleId: 'FRAMEWORK_INT', pattern: /Vue\.extend\(/g, message: 'Legacy Vue 2 extension pattern (Migration to Vue 3 recommended)', severity: 'warning' }
	],
	sanitize: () => {
		return true;
	},
	instructions: `VUE 2 MODE (Legacy Standards):
- CORRECT: Options API (data, methods, computed, watch) is idiomatic for Vue 2.
- STYLE (WARNING): Vue 2 is legacy; consider migrating to Vue 3.
- ALLOWED: 'this.$emit' and 'this.$set' usage.
- LOGIC_SEP Rule: Options API often encourages "Fat Components". Flag complex business workflows in 'methods' or 'computed'.`
};
