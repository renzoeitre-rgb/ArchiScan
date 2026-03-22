import type { RuleId, Severity, Violation } from '../types';

export interface ProtocolRule {
	ruleId: RuleId;
	pattern: RegExp;
	message: string;
	severity: Severity;
}

export interface FrameworkProtocol {
	id: string;
	name: string;
	/** Patterns that identify this framework/version in a project */
	signatures: string[];
	/** Pass 1: Local Regex Rules */
	regexRules: ProtocolRule[];
	/** Pass 3: Sanitization logic (Returns true if violation should be KEPT) */
	sanitize: (v: Violation) => boolean;
	/** AI Law Book instructions for this framework */
	instructions: string;
}
