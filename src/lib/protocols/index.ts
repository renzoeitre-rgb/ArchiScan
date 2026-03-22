import { Svelte4Protocol } from './svelte4';
import { Svelte5Protocol } from './svelte5';
import { ReactProtocol } from './react';
import { Vue2Protocol } from './vue2';
import { Vue3Protocol } from './vue3';
import { NextPagesProtocol } from './next_pages';
import { NextAppProtocol } from './next_app';
import type { ProjectFramework, StoredFile } from '../types';
import type { FrameworkProtocol } from './types';

const ALL_PROTOCOLS: FrameworkProtocol[] = [
	Svelte4Protocol,
	Svelte5Protocol,
	ReactProtocol,
	Vue2Protocol,
	Vue3Protocol,
	NextPagesProtocol,
	NextAppProtocol
];

/**
 * Robustly determines the best protocol for a project based on file content.
 */
export function detectProtocol(files: StoredFile[], framework: ProjectFramework): FrameworkProtocol {
	// 1. Initial framework filtering
	let candidates = ALL_PROTOCOLS;
	if (framework === 'svelte') candidates = [Svelte4Protocol, Svelte5Protocol];
	if (framework === 'react') candidates = [ReactProtocol, NextPagesProtocol, NextAppProtocol];
	if (framework === 'vue') candidates = [Vue2Protocol, Vue3Protocol];

	// 2. Signature matching across all files
	const scores = new Map<string, number>();
	candidates.forEach(p => scores.set(p.id, 0));

	for (const file of files) {
		for (const protocol of candidates) {
			for (const signature of protocol.signatures) {
				if (file.content.includes(signature)) {
					scores.set(protocol.id, (scores.get(protocol.id) || 0) + 1);
				}
			}
		}
	}

	// 3. Pick the winner
	let winner = candidates[0] || ALL_PROTOCOLS[0];
	let maxScore = -1;

	scores.forEach((score, id) => {
		if (score > maxScore) {
			maxScore = score;
			winner = candidates.find(p => p.id === id)!;
		}
	});

	return winner;
}

/**
 * Legacy getter for individual protocol by ID if needed.
 */
export function getProtocol(framework: ProjectFramework, svelteVersion: number = 5): FrameworkProtocol {
	if (framework === 'svelte') {
		return svelteVersion === 4 ? Svelte4Protocol : Svelte5Protocol;
	}
	if (framework === 'react') return ReactProtocol;
	if (framework === 'vue') return Vue3Protocol;
	
	return ALL_PROTOCOLS.find(p => p.id === 'universal') || Svelte5Protocol;
}
