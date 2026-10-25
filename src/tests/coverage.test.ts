// Red step for coverage: teacher-prose-only fingerprints, token-budgeted
// batches — ported from learnharness src/core/coverage.ts.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
	messageViewLines,
	messageFingerprint,
	coverageSlots,
	coveredSet,
	coverageOf,
	batchRuns,
	viewTokens,
} from "../core/coverage.js";

const assistant = (id: string, text: string) => ({
	id,
	role: "assistant" as const,
	content: [{ type: "text" as const, text }],
});
const user = (id: string, text: string) => ({ id, role: "user" as const, content: text });

test("messageViewLines: assistant prose only, labeled TEACHER [id]", () => {
	assert.deepEqual(messageViewLines(assistant("m1", "Hello there."), "m1"), ["TEACHER [m1] Hello there."]);
	// learner messages are invisible
	assert.deepEqual(messageViewLines(user("m2", "I think..."), "m2"), []);
	// tool calls / reasoning blocks invisible (non-text content)
	const toolCall = {
		id: "m3",
		role: "assistant" as const,
		content: [{ type: "tool-call" as const, name: "quiz", arguments: "{}" }],
	};
	assert.deepEqual(messageViewLines(toolCall, "m3"), []);
	// empty text invisible
	assert.deepEqual(messageViewLines(assistant("m4", "   "), "m4"), []);
});

test("fingerprint changes only when teacher prose changes", () => {
	const a = messageFingerprint(assistant("m1", "Same text."));
	const b = messageFingerprint(assistant("m1", "Same text."));
	assert.equal(a, b); // stable
	const c = messageFingerprint(assistant("m1", "Different text."));
	assert.notEqual(a, c);
	// same prose, different message id -> different slot (per-message coverage)
	const d = messageFingerprint(assistant("m2", "Same text."));
	assert.notEqual(a, d);
});

test("coverageOf derives uncovered from the fingerprint diff", () => {
	const messages = [assistant("m1", "one"), user("m2", "learner"), assistant("m3", "three")];
	const slots = coverageSlots(messages);
	// the learner message has no view lines -> invisible entirely (never
	// covered or uncovered — the extractor can never see it)
	const covered = coverageOf(messages, [{ chatId: "c", fp: slots[0]!.fp, tokens: 1, foldedAt: "t" }], "c");
	assert.deepEqual(covered.uncovered, [2]); // m1 covered; m3 uncovered; m2 invisible
	assert.ok(covered.uncoveredTokens > 0);
	// a different chat's coverage rows never cover ours
	const other = coverageOf(messages, [{ chatId: "other", fp: slots[0]!.fp, tokens: 1, foldedAt: "t" }], "c");
	assert.deepEqual(other.uncovered, [0, 2]);
});

test("coveredSet keys by chatId", () => {
	const set = coveredSet(
		[
			{ chatId: "a", fp: "1", tokens: 1, foldedAt: "t" },
			{ chatId: "b", fp: "1", tokens: 1, foldedAt: "t" },
			{ chatId: "a", fp: "2", tokens: 1, foldedAt: "t" },
		],
		"a",
	);
	assert.deepEqual([...set], ["1", "2"]);
});

test("batchRuns: greedy consecutive fill to the budget, never splits a message", () => {
	const slots = [
		{ message: assistant("m1", "a".repeat(40)), fp: "f1", tokens: 10 },
		{ message: assistant("m2", "b".repeat(80)), fp: "f2", tokens: 20 },
		{ message: assistant("m3", "c".repeat(8000)), fp: "f3", tokens: 2000 },
		{ message: assistant("m4", "d".repeat(40)), fp: "f4", tokens: 10 },
	];
	const batches = batchRuns(slots, [0, 1, 2, 3], 30);
	assert.equal(batches.length, 3); // [m1,m2]=30, [m3] alone (over budget rides alone), [m4]
	assert.deepEqual(batches[0]!.map((s) => s.fp), ["f1", "f2"]);
	assert.deepEqual(batches[1]!.map((s) => s.fp), ["f3"]);
	assert.deepEqual(batches[2]!.map((s) => s.fp), ["f4"]);
});

test("viewTokens estimates chars/4 ceil over the newline join", () => {
	assert.equal(viewTokens(["abcd"]), 1);
	assert.equal(viewTokens(["abc"]), 1);
	assert.equal(viewTokens(["ab", "cd"]), 2); // "ab\ncd" = 5 chars -> 2
});
