// Red step for the fs graph store: the append-only JSONL ledgers under a
// data root, strict shape guards (corrupt lines skipped), sources.json and
// positions.json maps, atomic rewrites — ported from learnharness
// src/store/graph.ts.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FsGraphStore } from "../store/graph.js";

function tempRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "dl-graph-store-"));
}

test("appends and reads round-trip through the ledgers", () => {
	const root = tempRoot();
	const store = new FsGraphStore(root);
	const node = {
		id: "n_1",
		name: "A",
		statement: "A is true.",
		aliases: ["a"],
		createdAt: "t1",
		provenance: [{ chatId: "c1", messageId: "m1" }],
	};
	store.appendNode(node);
	assert.deepEqual(store.readNodes(), [node]);
	const chain = {
		id: "arg_1",
		premises: ["n_1"],
		conclusion: "n_2",
		createdAt: "t1",
		provenance: [{ chatId: "c1", messageId: "" }],
	};
	store.appendChain(chain);
	assert.deepEqual(store.readChains(), [chain]);
	store.appendCoverage({ chatId: "c1", fp: "f", tokens: 4, foldedAt: "t" });
	assert.equal(store.readCoverage().length, 1);
	store.appendCheckpoint({ chatId: "c1", foldedAt: "t" });
	assert.equal(store.readCheckpoints().length, 1);
	// files exist where promised: plain inspectable JSONL
	assert.ok(fs.existsSync(path.join(root, "graph", "nodes.jsonl")));
	assert.ok(fs.existsSync(path.join(root, "graph", "chains.jsonl")));
	assert.ok(fs.existsSync(path.join(root, "graph", "coverage.jsonl")));
	assert.ok(fs.existsSync(path.join(root, "graph", "sessions.jsonl")));
});

test("corrupt lines are skipped, never guessed at", () => {
	const root = tempRoot();
	const store = new FsGraphStore(root);
	store.appendNode({
		id: "n_1",
		name: "A",
		statement: "A.",
		aliases: [],
		createdAt: "t",
		provenance: [],
	});
	// manually corrupt: a torn line and a garbage line
	const nodesFile = path.join(root, "graph", "nodes.jsonl");
	fs.appendFileSync(nodesFile, '{"id":"n_2","name":\n', "utf-8");
	fs.appendFileSync(nodesFile, "not json at all\n", "utf-8");
	fs.appendFileSync(nodesFile, '{"id": 42}\n', "utf-8"); // wrong shape
	const nodes = store.readNodes();
	assert.equal(nodes.length, 1);
	assert.equal(nodes[0]!.id, "n_1");
});

test("chain guard: premises >= 1, strings only", () => {
	const root = tempRoot();
	const store = new FsGraphStore(root);
	const chainsFile = path.join(root, "graph", "chains.jsonl");
	fs.mkdirSync(path.dirname(chainsFile), { recursive: true });
	fs.writeFileSync(
		chainsFile,
		[
			JSON.stringify({ id: "arg_1", premises: [], conclusion: "x", createdAt: "t", provenance: [] }), // rejected: no premises
			JSON.stringify({ id: "arg_2", premises: ["a"], conclusion: "x", createdAt: "t", provenance: [] }), // accepted
		].join("\n") + "\n",
		"utf-8",
	);
	const chains = store.readChains();
	assert.equal(chains.length, 1);
	assert.equal(chains[0]!.id, "arg_2");
});

test("rewriteLedgers atomically replaces content", () => {
	const root = tempRoot();
	const store = new FsGraphStore(root);
	store.appendNode({
		id: "n_1",
		name: "A",
		statement: "A.",
		aliases: [],
		createdAt: "t",
		provenance: [],
	});
	store.appendNode({
		id: "n_2",
		name: "B",
		statement: "B.",
		aliases: [],
		createdAt: "t",
		provenance: [],
	});
	store.rewriteLedgers({
		nodes: [
			{
				id: "n_2",
				name: "B",
				statement: "B.",
				aliases: [],
				createdAt: "t",
				provenance: [],
			},
		],
	});
	assert.deepEqual(store.readNodes().map((n) => n.id), ["n_2"]);
	// no .tmp leftovers
	const files = fs.readdirSync(path.join(root, "graph"));
	assert.ok(files.every((f) => !f.includes(".tmp-")), JSON.stringify(files));
});

test("sources.json upsert keeps prior usage; positions round-trip", () => {
	const root = tempRoot();
	const store = new FsGraphStore(root);
	store.upsertSource({ id: "src_1", filePath: "/notes/a.md", importedAt: "t1" });
	store.upsertSource({ id: "src_1", filePath: "/notes/a.md", importedAt: "t2" });
	const sources = store.readSources();
	assert.equal(sources.length, 1);
	assert.equal(sources[0]!.importedAt, "t2");

	store.writePositions({ n_1: { x: 1.5, y: -2 } });
	assert.deepEqual(store.readPositions(), { n_1: { x: 1.5, y: -2 } });
});

test("read of a missing dir is an empty list (never an error)", () => {
	const store = new FsGraphStore(tempRoot());
	assert.deepEqual(store.readNodes(), []);
	assert.deepEqual(store.readChains(), []);
	assert.deepEqual(store.readCoverage(), []);
	assert.deepEqual(store.readCheckpoints(), []);
	assert.deepEqual(store.readSources(), []);
	assert.deepEqual(store.readPositions(), {});
});
