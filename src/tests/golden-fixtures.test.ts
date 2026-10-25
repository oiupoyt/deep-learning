// Golden fixtures: the real-data law — the shipped fixture dir must parse
// through the production store adapters and derive end-to-end. An
// intentional on-disk format change updates the fixture in the same commit.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { FsGraphStore } from "../store/graph.js";
import { getGraph, deriveView, birthSessionPartition } from "../core/graph.js";
import { settleGraphLayout } from "../core/layout-settle.js";

const fixtureDir = path.resolve(import.meta.dirname, "../../../tests/fixtures/golden-graph");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dl-golden-read-"));

test("golden fixture: real data parses and derives end-to-end", { skip: !fs.existsSync(fixtureDir) }, () => {
	// Copy the fixture into a temp root so reads never write the fixture.
	fs.cpSync(fixtureDir, path.join(root, "graph"), { recursive: true });
	const store = new FsGraphStore(root);
	const graph = getGraph(store);
	assert.ok(graph.nodes.length >= 4, "expected the fixture's propositions");
	assert.ok(graph.chains.length >= 2, "expected the fixture's chains");
	// derivation over the real shape
	const view = deriveView(graph);
	assert.ok(view.edges.length > 0);
	assert.ok(view.logicalEdges.length > 0);
	// birth-session clustering derives over provenance
	const communities = birthSessionPartition(graph.nodes);
	assert.ok(communities.length >= 2, "expected at least two birth sessions");
	// sources + positions parse
	assert.ok(store.readSources().length >= 1);
	assert.ok(Object.keys(store.readPositions()).length >= graph.nodes.length);
});

test("golden fixture: reads never write (mtimes unchanged)", { skip: !fs.existsSync(fixtureDir) }, () => {
	fs.cpSync(fixtureDir, path.join(root, "graph"), { recursive: true });
	const before = dirMtimes(fixtureDir);
	const store = new FsGraphStore(root);
	getGraph(store);
	deriveView(getGraph(store));
	settleGraphLayout(store); // writes only the TEMP copy's positions ledger
	const after = dirMtimes(fixtureDir);
	assert.deepEqual(before, after);
});

function dirMtimes(dir: string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const name of fs.readdirSync(dir).sort()) {
		out[name] = fs.statSync(path.join(dir, name)).mtimeMs;
	}
	return out;
}
