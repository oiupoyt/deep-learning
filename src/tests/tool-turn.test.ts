import { test } from "node:test";
import * as assert from "node:assert/strict";
import { concludesLearningToolTurn } from "../core/tool-turn.js";

test("learning question and phase tools end the host turn", () => {
	for (const name of ["probe", "quiz", "recall", "explain", "probe_done", "problem"]) {
		assert.equal(concludesLearningToolTurn(name), true, name);
	}
});

test("background and planning tools keep the host turn open", () => {
	for (const name of ["plan_init", "research", "demo", "visual", "pdf", "list_sessions", "list_propositions", "conclude"]) {
		assert.equal(concludesLearningToolTurn(name), false, name);
	}
});
