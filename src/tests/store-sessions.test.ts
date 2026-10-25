// Red step for the sessions + settings stores: the plugin-owned plain-file
// records under the data root (sessions/<id>/{probe,tree}.json,
// settings.json, prompts/ overrides) — the ported shape of learnharness's
// per-chat plan/assessment persistence, minus what the DSH session log
// already owns (transcripts, usage).
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FsSessionsStore, FsSettingsStore } from "../store/sessions.js";

function tempRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "dl-sessions-store-"));
}

const tree = {
	nodes: [
		{ id: "a", title: "A" },
		{ id: "b", title: "B" },
	],
	edges: [{ from: "a", to: "b" }],
	version: 1,
};

test("probe assessment save/read round-trip, absent reads null", () => {
	const root = tempRoot();
	const sessions = new FsSessionsStore(root);
	assert.equal(sessions.readProbe("s1"), null);
	sessions.saveProbe("s1", { strands: [{ strand: "derivatives", assessment: "floor: limits" }], summary: "s" });
	const probe = sessions.readProbe("s1");
	assert.equal(probe?.strands[0]?.strand, "derivatives");
	// the file is where promised: inspectable plain JSON
	assert.ok(fs.existsSync(path.join(root, "sessions", "s1", "probe.json")));
});

test("plan tree save bumps nothing (caller owns versioning), read round-trips", () => {
	const root = tempRoot();
	const sessions = new FsSessionsStore(root);
	assert.equal(sessions.readTree("s1"), null);
	sessions.saveTree("s1", tree);
	assert.deepEqual(sessions.readTree("s1"), tree);
	// a session with no tree dir doesn't error on any op
	assert.equal(sessions.readTree("nope"), null);
	assert.equal(sessions.readProbe("nope"), null);
});

test("session dir cleanup removes exactly that session's records", () => {
	const root = tempRoot();
	const sessions = new FsSessionsStore(root);
	sessions.saveProbe("s1", { strands: [] });
	sessions.saveTree("s1", tree);
	sessions.saveTree("s2", tree);
	assert.equal(sessions.deleteSession("s1"), true);
	assert.equal(sessions.readProbe("s1"), null);
	assert.equal(sessions.readTree("s1"), null);
	assert.ok(sessions.readTree("s2")); // untouched
	assert.equal(sessions.deleteSession("s1"), false); // idempotent
});

test("settings store: read-modify-write with atomic replace", () => {
	const root = tempRoot();
	const settings = new FsSettingsStore(root);
	assert.deepEqual(settings.read(), null); // absent = factory defaults
	settings.update({ graph: { extractionChunkTokens: 900 } });
	const record = settings.read();
	assert.equal(record?.graph?.extractionChunkTokens, 900);
	assert.equal(record?.agent, undefined); // delta-shaped: absent keys stay absent
	settings.update({ graph: { enabled: false } });
	const merged = settings.read();
	assert.equal(merged?.graph?.extractionChunkTokens, 900); // shallow-merge per top-level section
	assert.equal(merged?.graph?.enabled, false);
	assert.ok(fs.existsSync(path.join(root, "settings.json")));
});

test("prompt overrides: file presence + the settings switch are both required", () => {
	const root = tempRoot();
	const settings = new FsSettingsStore(root);
	const overridePath = path.join(root, "prompts", "teacher", "05-method.md");
	fs.mkdirSync(path.dirname(overridePath), { recursive: true });
	fs.writeFileSync(overridePath, "# Custom method\n", "utf-8");
	settings.update({ agent: { prompts: { "teacher/05-method.md": true } } });
	assert.equal(settings.read()?.agent?.prompts?.["teacher/05-method.md"], true);
});
