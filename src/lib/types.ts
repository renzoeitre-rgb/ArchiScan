export type RuleId = 'DEP_DIR' | 'LOGIC_SEP' | 'PORT_LAW' | 'FRAMEWORK_INT' | 'TYPE_SAF' | 'LAYER_BLD' | 'ONE_SRC';
export type Severity = 'error' | 'warning' | 'info';
export type ProjectFramework = 'svelte' | 'react' | 'vue' | 'unknown';

export interface Violation {
	id?: string;
	file?: string; // EXACT path of the file this violation applies to
	ruleId: RuleId;
	severity: Severity;
	line: number | null; // null if violation is file-level
	column: number | null;
	message: string;
	snippet: string | null; // the offending code fragment
	reasoning: string | null; // AI internal logic for flagging this
	isFalsePositive?: boolean; // Set by Senior AI Judge
	judgeReasoning?: string | null; // Reason Judge cleared this
}

export interface Project {
	id: string;
	name: string;
	createdAt: Date;
	framework: ProjectFramework;
}

export interface StoredFile {
	id: string;
	projectId: string;
	path: string;
	content: string;
	extension: string;
	size: number;
	lastAudited: Date | null;
}

export interface AuditReport {
	id: string;
	projectId: string;
	fileId: string;
	violations: Violation[];
	score: number;
	createdAt: Date;
	modelUsed: string;
}

export type AuditStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';
