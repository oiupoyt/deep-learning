// Red step for stratum 1 (question-core): the grading contract. These fail
// until src/core/question-core.ts exists with the ported semantics.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
	quizInputProblems,
	coerceCorrectAnswer,
	resolveCorrect,
	isCorrect,
	shuffleOptions,
	seededRandom,
	normalizeOptions,
	buildAnswer,
	compactAnswerForModel,
	CONFIDENCE_STOPS,
} from "../core/question-core.js";

const opts = [
	{ label: "Mercury", value: "mercury" },
	{ label: "Venus", value: "venus" },
];

test("quiz authoring: valid single-select passes", () => {
	assert.deepEqual(
		quizInputProblems({
			options: opts,
			correctAnswer: "mercury",
			explanation: "Because closest.",
		} as unknown as { options: typeof opts; correctAnswer: string }),
		[],
	);
});

test("quiz authoring: multi-select without the flag fails", () => {
	const problems = quizInputProblems({
		options: opts,
		correctAnswer: ["mercury", "venus"],
		explanation: "x",
		multiSelect: false,
	} as unknown as { options: typeof opts; correctAnswer: string[] });
	assert.ok(problems.some((p) => p.includes("multiSelect")));
});

test("quiz authoring: empty label and duplicate values fail", () => {
	const problems = quizInputProblems({
		options: [
			{ label: "", value: "a" },
			{ label: "A", value: "a" },
			{ label: "B", value: "a" },
		],
		correctAnswer: "a",
		explanation: "x",
	} as unknown as { options: Array<{ label: string; value?: string }>; correctAnswer: string });
	assert.ok(problems.some((p) => p.includes("label is empty")));
	assert.ok(problems.some((p) => p.includes("distinct")));
});

test("coerceCorrectAnswer preserves an exact option key ending in a period", () => {
	const values = ["grav", "grav."];
	assert.deepEqual(coerceCorrectAnswer("grav.", values), ["grav."]);
});

test("coerceCorrectAnswer parses a JSON-encoded multi array", () => {
	const values = ["mercury", "venus"];
	assert.deepEqual(coerceCorrectAnswer('["mercury","venus"]', values), ["mercury", "venus"]);
});

test("resolveCorrect maps value to display index, after shuffle", () => {
	const shuffled = shuffleOptions(
		[
			{ label: "A", value: "a" },
			{ label: "B", value: "b" },
			{ label: "C", value: "c" },
		],
		seededRandom("call_test"),
	);
	const { indices, error } = resolveCorrect("b", shuffled);
	assert.equal(error, undefined);
	const bIdx = shuffled.findIndex((o) => o.value === "b") + 1;
	assert.deepEqual(indices, [bIdx]);
});

test("isCorrect is exact-set match", () => {
	assert.equal(isCorrect([2, 1], [1, 2]), true);
	assert.equal(isCorrect([1], [1, 2]), false);
	assert.equal(isCorrect([1, 1], [1, 2]), false);
});

test("normalizeOptions dedupes by value and defaults value to label", () => {
	const out = normalizeOptions([
		{ label: " A ", value: " " },
		{ label: "B" },
	]);
	assert.deepEqual(
		out.map((o) => o.label),
		["A", "B"],
	);
	assert.equal(out[0]?.value, "A");
	assert.equal(out[1]?.value, "B");
	// Duplicate RESOLVED values throw (the original's contract: the value
	// space must be injective for grading to key on it — case-sensitive,
	// exactly as the original).
	assert.throws(() => normalizeOptions([{ label: "B" }, { label: "C", value: "B" }]));
});

test("buildAnswer grades a quiz answer and clamps confidence", () => {
	const qd = {
		id: "q1",
		kind: "quiz" as const,
		question: "Which?",
		mode: "single-select" as const,
		options: normalizeOptions(opts),
		correctIndices: [1],
		explanation: "why",
		createdAt: new Date().toISOString(),
	};
	const answer = buildAnswer(qd, {
		values: ["mercury"],
		thinking: "  reasoning  ",
		confidence: 130,
	});
	assert.equal(answer.correct, true);
	assert.equal(answer.thinking, "reasoning");
	assert.equal(answer.confidence, 100);
	assert.equal(answer.answers[0]?.index, 1);
});

test("buildAnswer: dontKnow is incorrect and carries no confidence", () => {
	const qd = {
		id: "q1",
		kind: "quiz" as const,
		question: "Q",
		mode: "single-select" as const,
		options: normalizeOptions(opts),
		correctIndices: [1],
		explanation: "why",
		createdAt: new Date().toISOString(),
	};
	const answer = buildAnswer(qd, { dontKnow: true, confidence: 90 });
	assert.equal(answer.dontKnow, true);
	assert.equal(answer.correct, false);
	assert.equal(answer.confidence, undefined);
});

test("compactAnswerForModel returns the learner's signal only", () => {
	const compact = compactAnswerForModel({
		kind: "quiz",
		questionText: "Q",
		options: [],
		dontKnow: false,
		answers: [{ label: "Venus", value: "venus", index: 1 }],
		thinking: "chain of thought",
		readingThinking: "while reading",
		confidence: 70,
		correct: true,
		answeredAt: new Date().toISOString(),
	});
	assert.deepEqual(compact, {
		kind: "quiz",
		answers: [{ index: 1, label: "Venus" }],
		correct: true,
		confidence: 70,
		thinking: "chain of thought",
		thinkingWhileReading: "while reading",
	});
	assert.equal("explanation" in compact, false);
});

test("confidence stops are the uneven ladder", () => {
	assert.deepEqual(CONFIDENCE_STOPS, [0, 30, 50, 70, 90, 100]);
});
