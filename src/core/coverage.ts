/**
 * Extraction coverage — ported from learnharness src/core/coverage.ts
 * (AGPL-3.0, amosblomqvist/learnharness).
 *
 * THE TEACHER'S PROSE IS THE UNIT: the extractor sees ONLY the teacher
 * agent's text blocks — no learner messages, no thinking, no tool calls or
 * results, no question blocks. Everything else is INVISIBLE to coverage:
 * answering a question or editing a learner message triggers nothing.
 * "Covered" is by construction exactly "what the extractor saw".
 *
 * A per-chat append-only ledger records which messages have been extracted
 * by CONTENT FINGERPRINT; "uncovered" is DERIVED at read time (fingerprint
 * the current transcript, diff against the ledger) — never dual-tracked.
 * Runs are token-budgeted batches of the oldest uncovered teacher-prose
 * messages: greedy consecutive fill, a message is never split, a single
 * over-budget message rides alone.
 */

import { createHash } from "node:crypto";
import type { CoverageEntry } from "./contracts/graph.js";

/** The minimal transcript-message shape the coverage fold needs (the DSH
 *  session-log projection carries the same content-block vocabulary). */
export interface CoverageMessage {
	id: string;
	role?: string;
	content: unknown;
}

/** The user-facing text of a native message (string or text blocks). */
function textOf(content: unknown): string[] {
	if (typeof content === "string") return content.trim() ? [content] : [];
	if (!Array.isArray(content)) return [];
	return content
		.filter((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text")
		.map((c) => c.text)
		.filter((t) => t.trim().length > 0);
}

/**
 * The extraction-relevant lines of ONE native message — the shared seam
 * between the extractor's prompt and messageFingerprint. TEACHER PROSE
 * ONLY: an assistant message yields one line per text block, labeled with
 * its ACTUAL message id (the anchor the extractor copies into messageId);
 * everything else yields NOTHING.
 */
export function messageViewLines(message: CoverageMessage, mid: string): string[] {
	const lines: string[] = [];
	if (message.role !== "assistant") return lines;
	for (const text of textOf(message.content)) {
		lines.push(`TEACHER [${mid}] ${text.trim()}`);
	}
	return lines;
}

/** Tokens of a message's view — chars/4, ceil. */
export function viewTokens(lines: string[]): number {
	return Math.ceil(lines.join("\n").length / 4);
}

/**
 * A message's coverage fingerprint: sha256 of role + its view lines.
 * Changes exactly when the teacher prose of the message changes.
 */
export function messageFingerprint(message: CoverageMessage): string {
	const h = createHash("sha256");
	h.update(JSON.stringify([message.role ?? "", messageViewLines(message, message.id)]));
	return h.digest("hex");
}

/** One message's coverage-relevant projection. */
export interface CoverageSlot {
	message: CoverageMessage;
	fp: string;
	tokens: number;
}

/** Fingerprint a whole transcript, in order. */
export function coverageSlots(messages: ReadonlyArray<CoverageMessage>): CoverageSlot[] {
	return messages.map((message) => ({
		message,
		fp: messageFingerprint(message),
		tokens: viewTokens(messageViewLines(message, message.id)),
	}));
}

/** The covered-fingerprint set for one chat, from the ledger. */
export function coveredSet(entries: ReadonlyArray<CoverageEntry>, chatId: string): Set<string> {
	const out = new Set<string>();
	for (const e of entries) if (e.chatId === chatId) out.add(e.fp);
	return out;
}

/** The derived state: which slots are uncovered, plus token totals.
 *  `uncovered` is INDEXES into `slots` (the batcher batches by position).
 *  Messages with NO view lines are invisible to coverage entirely: the
 *  extractor can never see them, so they are neither covered nor
 *  uncovered. */
export function coverageOf(
	messages: ReadonlyArray<CoverageMessage>,
	entries: ReadonlyArray<CoverageEntry>,
	chatId: string,
): {
	slots: CoverageSlot[];
	uncovered: number[];
	uncoveredTokens: number;
	uncoveredCount: number;
} {
	const slots = coverageSlots(messages);
	const covered = coveredSet(entries, chatId);
	const uncovered: number[] = [];
	let uncoveredTokens = 0;
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i]!;
		if (slot.tokens === 0) continue; // no view lines — invisible
		if (!covered.has(slot.fp)) {
			uncovered.push(i);
			uncoveredTokens += slot.tokens;
		}
	}
	return { slots, uncovered, uncoveredTokens, uncoveredCount: uncovered.length };
}

/**
 * Token-budgeted batches of the oldest uncovered slots: greedy consecutive
 * fill to the budget; a message is never split; a single over-budget
 * message rides alone.
 */
export function batchRuns(
	slots: ReadonlyArray<CoverageSlot>,
	uncovered: ReadonlyArray<number>,
	budget: number,
): CoverageSlot[][] {
	const batches: CoverageSlot[][] = [];
	let current: CoverageSlot[] = [];
	let used = 0;
	for (const index of uncovered) {
		const slot = slots[index]!;
		if (current.length > 0 && used + slot.tokens > budget) {
			batches.push(current);
			current = [];
			used = 0;
		}
		current.push(slot);
		used += slot.tokens;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}
