// Red step for prompt composition: the fragment loader + override seams —
// ported from learnharness src/store/prompt-overrides.ts +
// src/agent/teacher-agent.ts's composeInstructions.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { composeInstructions, listSourceSegments } from "../server/prompts.js";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dl-prompts-"));

// Ship-shaped fixture: the plugin's prompts/ layout.
const promptsDir = path.join(fixtureRoot, "prompts");
fs.mkdirSync(path.join(promptsDir, "prober"), { recursive: true });
fs.mkdirSync(path.join(promptsDir, "teacher"), { recursive: true });
fs.mkdirSync(path.join(promptsDir, "practice"), { recursive: true });
fs.mkdirSync(path.join(promptsDir, "shared"), { recursive: true });
fs.writeFileSync(path.join(promptsDir, "system-prompt.md"), "# Shared base");
fs.writeFileSync(path.join(promptsDir, "prober", "10-probe.md"), "Probe doctrine.");
fs.writeFileSync(path.join(promptsDir, "prober", "README.md"), "never loads");
fs.writeFileSync(path.join(promptsDir, "teacher", "10-plan.md"), "Plan doctrine.");
fs.writeFileSync(path.join(promptsDir, "teacher", "20-teach.md"), "Teach doctrine.");
fs.writeFileSync(path.join(promptsDir, "practice", "10-doctrine.md"), "Practice doctrine.");
fs.writeFileSync(path.join(promptsDir, "shared", "10-voice.md"), "Voice.");

test("composition: base + agent fragments + shared appendix, sorted, --- joined", () => {
	const prober = composeInstructions(promptsDir, "prober");
	assert.ok(prober.startsWith("# Shared base"));
	assert.ok(prober.includes("Probe doctrine."));
	assert.ok(!prober.includes("never loads")); // non-numeric files never load
	assert.ok(prober.includes("Voice.")); // shared trails
	assert.ok(prober.indexOf("Probe doctrine.") < prober.indexOf("Voice."));
	assert.ok(prober.includes("---")); // fragments joined with the separator
});

test("composition: teacher order is filename-sorted", () => {
	const teacher = composeInstructions(promptsDir, "teacher");
	assert.ok(teacher.indexOf("Plan doctrine.") < teacher.indexOf("Teach doctrine."));
});

test("listSourceSegments mirrors the loader (same files, same order)", () => {
	const segments = listSourceSegments(promptsDir, "teacher");
	assert.deepEqual(
		segments.map((s) => s.path),
		["teacher/10-plan.md", "teacher/20-teach.md", "shared/10-voice.md"],
	);
});

test("overrides: switch ON + override file replaces that segment only", () => {
	// The override root mirrors the source layout (the settings law).
	const overrideDir = path.join(fixtureRoot, "prompt-overrides");
	fs.mkdirSync(path.join(overrideDir, "teacher"), { recursive: true });
	fs.writeFileSync(path.join(overrideDir, "teacher", "10-plan.md"), "CUSTOM PLAN.");
	const composed = composeInstructions(promptsDir, "teacher", {
		overrideRoot: overrideDir,
		switches: { "teacher/10-plan.md": true },
	});
	assert.ok(composed.includes("CUSTOM PLAN."));
	assert.ok(!composed.includes("Plan doctrine."));
	assert.ok(composed.includes("Teach doctrine.")); // untouched segment
	// switch OFF: the override file exists but the source composes
	const off = composeInstructions(promptsDir, "teacher", {
		overrideRoot: overrideDir,
		switches: { "teacher/10-plan.md": false },
	});
	assert.ok(off.includes("Plan doctrine."));
	assert.ok(!off.includes("CUSTOM PLAN."));
	// no override file but switch on: source composes (honest fallback)
	const missing = composeInstructions(promptsDir, "teacher", {
		overrideRoot: overrideDir,
		switches: { "teacher/20-teach.md": true },
	});
	assert.ok(missing.includes("Teach doctrine."));
});

test("switches-less call is byte-identical to the pure source composition", () => {
	const a = composeInstructions(promptsDir, "teacher");
	const b = composeInstructions(promptsDir, "teacher", { switches: {} });
	assert.equal(a, b);
});
