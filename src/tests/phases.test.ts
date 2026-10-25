// Red step for the phase machine: probe → plan → teach derivation from
// transcript events, ported from learnharness src/core/phases.ts.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { phaseAt, PHASES, type PhaseEvent } from "../core/phases.js";

const probeDoneResult: PhaseEvent = {
	role: "toolResult",
	toolName: "probe_done",
	isError: false,
};
const probeDoneError: PhaseEvent = {
	role: "toolResult",
	toolName: "probe_done",
	isError: true,
};
const teachQuiz: PhaseEvent = {
	role: "assistant",
	toolCalls: [{ name: "quiz", arguments: { nodeId: "chain-rule", type: "check" } }],
};
const probeQuiz: PhaseEvent = {
	role: "assistant",
	toolCalls: [{ name: "quiz", arguments: { question: "q" } }],
};
const offMapQuiz: PhaseEvent = {
	role: "assistant",
	toolCalls: [{ name: "quiz", arguments: { nodeId: "not-in-tree", type: "check" } }],
};

test("probe until probe_done concludes cleanly", () => {
	assert.equal(phaseAt([]), "probe");
	assert.equal(phaseAt([probeQuiz]), "probe");
	// errored probe_done does NOT advance (the model retries in-turn)
	assert.equal(phaseAt([probeDoneError]), "probe");
	assert.equal(phaseAt([probeDoneResult]), "plan");
});

test("plan until the first nodeId-tagged quiz CALL", () => {
	assert.equal(phaseAt([probeDoneResult, probeQuiz]), "plan");
	assert.equal(phaseAt([probeDoneResult, teachQuiz]), "teach");
	// The phase fold checks non-empty nodeId only (tree membership is the
	// call boundary's job — an off-map call cannot occur in practice).
	assert.equal(phaseAt([probeDoneResult, offMapQuiz]), "teach");
});

test("strictly sequential: no skipping, no regression", () => {
	assert.equal(phaseAt([teachQuiz]), "probe"); // quiz before probe_done does nothing
	assert.equal(phaseAt([probeDoneResult, probeQuiz, teachQuiz, probeQuiz]), "teach");
});

test("PHASES constant lists the three phases", () => {
	assert.deepEqual(PHASES, ["probe", "plan", "teach"]);
});
