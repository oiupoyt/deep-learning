// Red step for settings resolution: role -> model spec resolution with
// NO hardcoded models (BYOK law), ported from learnharness
// src/core/settings-resolution.ts.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { resolveSettings, slotsConfigured, ROLE_SLOT, MODEL_SLOTS, BACKGROUND_MODEL_ROLES, quizMechanics } from "../core/settings.js";

test("role slots map every role onto a slot tier", () => {
	assert.deepEqual(ROLE_SLOT, {
		prober: "strong",
		teacher: "strong",
		researcher: "cheap",
		demoBuilder: "cheap",
		extractor: "cheap",
		auditor: "cheap",
		visualMaker: "vision",
		pdfReader: "vision",
	});
	assert.deepEqual(MODEL_SLOTS, ["strong", "cheap", "vision"]);
	// every background role is in the background list and vice versa
	for (const role of ["researcher", "demoBuilder", "visualMaker", "extractor", "auditor"] as const) {
		assert.ok(BACKGROUND_MODEL_ROLES.includes(role), role);
	}
});

test("empty settings resolve to unset slots and undefined background models", () => {
	const effective = resolveSettings(null);
	// BYOK all the way down: no factory pins, so an unset chain is null
	assert.equal(effective.models.strong, null);
	assert.equal(effective.models.cheap, null);
	assert.equal(effective.models.vision, null);
	assert.equal(effective.agent.models.researcher, undefined);
	assert.equal(slotsConfigured(undefined), false);
});

test("configured slots resolve; role overrides win; absent falls to slot", () => {
	const effective = resolveSettings({
		models: {
			strong: { provider: "deepseek-official", id: "deepseek-chat", thinkingLevel: "medium" },
			cheap: { provider: "deepseek-official", id: "deepseek-flash" },
			vision: { provider: "deepseek-official", id: "deepseek-vl" },
		},
		agent: {
			models: {
				extractor: { provider: "openrouter", id: "other-model" },
			},
		},
	});
	assert.deepEqual(effective.models.strong, { provider: "deepseek-official", id: "deepseek-chat", thinkingLevel: "medium" });
	assert.equal(effective.agent.models.extractor?.id, "other-model"); // override wins
	assert.equal(effective.agent.models.researcher?.id, "deepseek-flash"); // falls to slot
	assert.equal(effective.agent.models.visualMaker?.id, "deepseek-vl");
	assert.equal(slotsConfigured({ strong: { provider: "p", id: "m" }, cheap: { provider: "p", id: "m" }, vision: { provider: "p", id: "m" } }), true);
});

test("quizzing mechanic: absent = choice, explain=true = free recall", () => {
	assert.equal(resolveSettings(null).agent.tools.explain, undefined);
	assert.equal(quizMechanics(resolveSettings(null).agent.tools), "choice");
	assert.equal(quizMechanics(resolveSettings({ agent: { tools: { explain: true } } }).agent.tools), "free");
});

test("graph settings resolve with factory defaults and validated chunk floor", () => {
	const defaults = resolveSettings(null).graph;
	assert.equal(defaults.enabled, true);
	assert.equal(defaults.extractionChunkTokens, 4096);
	const custom = resolveSettings({ graph: { enabled: false, extractionChunkTokens: 100 } }).graph;
	assert.equal(custom.enabled, false);
	assert.equal(custom.extractionChunkTokens, 500); // floor 500
	const over = resolveSettings({ graph: { extractionChunkTokens: 90000 } }).graph;
	assert.equal(over.extractionChunkTokens, 90000);
});
