// Red step for the plan-tree parser: the deterministic mermaid-subset
// contract ported from learnharness src/core/plan-tree.ts (the parser lives
// in src/agent/tools/mermaid-plan.ts there; the pure canonicalize step is
// what we port under core).
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { canonicalizePlan, planToMermaid, createTree } from "../core/plan-tree.js";
import type { PlanTree } from "../core/contracts/plan.js";

test("canonicalize parses a valid graph TD block into the tree", () => {
	const tree = canonicalizePlan(
		["graph TD", "  basics --> chain-rule", '  chain-rule["Chain rule intuition"] --> goal["Derive the arc length"]'].join("\n"),
	);
	assert.equal(tree.ok, true);
	if (!tree.ok) return;
	assert.deepEqual(
		tree.tree.nodes.map((n) => n.id),
		["basics", "chain-rule", "goal"],
	);
	assert.deepEqual(
		tree.tree.edges,
		[
			{ from: "basics", to: "chain-rule" },
			{ from: "chain-rule", to: "goal" },
		],
	);
	// Titles from quoted bracket form; slugs bare
	assert.equal(tree.tree.nodes[1]?.title, "Chain rule intuition");
	assert.equal(tree.tree.nodes[0]?.title, "basics");
});

test("slug rules: lowercase a-z 0-9 hyphen underscore only", () => {
	const bad = canonicalizePlan(["graph TD", "Bad Slug! --> ok"].join("\n"));
	assert.equal(bad.ok, false);
	if (bad.ok) return;
	assert.ok(bad.error.includes("Bad Slug!"));
});

test("rejects a cycle (DAG validation)", () => {
	const bad = canonicalizePlan(["graph TD", "a --> b", "b --> a"].join("\n"));
	assert.equal(bad.ok, false);
	if (bad.ok) return;
	assert.ok(bad.error.toLowerCase().includes("cycle") || bad.error.toLowerCase().includes("acyclic"));
});

test("bare edge endpoints register as nodes (forward references are fine)", () => {
	const good = canonicalizePlan(["graph TD", "a --> ghost"].join("\n"));
	assert.equal(good.ok, true);
	if (!good.ok) return;
	assert.deepEqual(
		good.tree.nodes.map((n) => n.id),
		["a", "ghost"],
	);
	// createTree (the construction seam) still rejects unknown ids.
	assert.throws(() => createTree([{ id: "a", title: "A" }], [{ from: "a", to: "ghost" }]), /unknown node id/);
});

test("re-calling with a new structure bumps version and replaces content", () => {
	const v1 = canonicalizePlan(["graph TD", "a --> b"].join("\n"));
	assert.equal(v1.ok, true);
	if (!v1.ok) return;
	const v2 = canonicalizePlan(
		["graph TD", "x --> y", "y --> z"].join("\n"),
		1,
	);
	assert.equal(v2.ok, true);
	if (!v2.ok) return;
	assert.equal(v2.tree.version, 2);
	assert.deepEqual(
		v2.tree.nodes.map((n) => n.id),
		["x", "y", "z"],
	);
});

test("planToMermaid round-trips through canonicalizePlan", () => {
	const tree: PlanTree = {
		nodes: [
			{ id: "a", title: "A title" },
			{ id: "b", title: "B" },
		],
		edges: [{ from: "a", to: "b" }],
		version: 3,
	};
	const rendered = planToMermaid(tree);
	const back = canonicalizePlan(rendered, 3);
	assert.equal(back.ok, true);
	if (!back.ok) return;
	assert.deepEqual(back.tree.nodes, tree.nodes);
	assert.deepEqual(back.tree.edges, tree.edges);
});
