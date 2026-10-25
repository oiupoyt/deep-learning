// Red step for the graph core: the deterministic merger, simplification
// pass, read-time derivation, and deletion cascades — ported from
// learnharness src/core/graph.ts + graph-deletion.ts + session-clusters.ts.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
	mergeFindings,
	simplifyChains,
	getGraph,
	deriveView,
	formatChainLine,
	chainsForSelection,
	resolveTargetId,
	birthSessionOf,
	birthSessionPartition,
	impClusterKey,
	deleteNodeTraces,
	type MemoryGraphStore,
	newMemoryGraphStore,
} from "../core/graph.js";
import type { SessionFindings, AuditVerdicts } from "../core/contracts/graph.js";

function findings(
	propositions: Array<{ id: string; name: string; statement: string; aliases?: string[]; messageId?: string }>,
	chains: Array<{ premises: string[]; conclusion: string }>,
): SessionFindings {
	return {
		propositions: propositions.map((p) => ({ aliases: [], ...p })),
		chains,
	};
}

const verdicts = (links: Array<{ id: string; linkTo: string }>): AuditVerdicts => ({ links });

test("merge: create appends nodes and chains; stats count appends", () => {
	const store = newMemoryGraphStore();
	const stats = mergeFindings(
		"chat_a",
		findings(
			[
				{ id: "p1", name: "Gravity", statement: "Gravity pulls.", messageId: "m1" },
				{ id: "p2", name: "Mass", statement: "Mass resists.", messageId: "m2" },
				{ id: "p3", name: "Orbit", statement: "Orbits follow.", messageId: "m3" },
			],
			[{ premises: ["p1", "p2"], conclusion: "p3" }],
		),
		verdicts([]),
		{ store },
		{ foldedAt: "2026-01-01T00:00:00Z" },
	);
	assert.equal(stats.nodes, 3);
	assert.equal(stats.chains, 1);
});

test("merge: identity links append phrasings and union provenance", () => {
	const store = newMemoryGraphStore();
	// First session creates node n_x
	mergeFindings(
		"chat_a",
		findings([{ id: "p1", name: "Entropy", statement: "Entropy grows.", messageId: "m1" }], []),
		verdicts([]),
		{ store },
		{ foldedAt: "t1" },
	);
	const first = getGraph(store).nodes[0]!;
	// Second session re-encounters the same proposition; auditor links it
	const stats = mergeFindings(
		"chat_b",
		findings([{ id: "q1", name: "Entropy grows", statement: "Entropy increases over time.", aliases: ["disorder"], messageId: "m9" }], []),
		verdicts([{ id: "q1", linkTo: first.id }]),
		{ store },
		{ foldedAt: "t2" },
	);
	assert.equal(stats.nodes, 0); // linked, not created
	const merged = getGraph(store).nodes;
	assert.equal(merged.length, 1);
	assert.equal(merged[0]!.name, "Entropy"); // first name stands
	assert.ok(merged[0]!.aliases.includes("Entropy increases over time."));
	assert.ok(merged[0]!.aliases.includes("disorder"));
	assert.equal(merged[0]!.provenance.length, 2); // both chats
});

test("merge: chain re-asserted by another chat appends under the same arg_ id, provenance unions at read", () => {
	const store = newMemoryGraphStore();
	mergeFindings(
		"chat_a",
		findings(
			[
				{ id: "a", name: "A", statement: "A.", messageId: "m1" },
				{ id: "b", name: "B", statement: "B.", messageId: "m2" },
				{ id: "c", name: "C", statement: "C.", messageId: "m3" },
			],
			[{ premises: ["a", "b"], conclusion: "c" }],
		),
		verdicts([]),
		{ store },
		{ foldedAt: "t1" },
	);
	const firstChainId = getGraph(store).chains[0]!.id;
	// chat_b re-asserts the same argument (its propositions link to the
	// same nodes): a new assertion LINE appends under the SAME arg_ id —
	// link-style; read-time merges by key, provenance unions.
	const stats = mergeFindings(
		"chat_b",
		findings(
			[
				{ id: "x", name: "A2", statement: "A.", messageId: "m1" },
				{ id: "y", name: "B2", statement: "B.", messageId: "m2" },
				{ id: "z", name: "C2", statement: "C.", messageId: "m3" },
			],
			[{ premises: ["x", "y"], conclusion: "z" }],
		),
		verdicts([
			{ id: "x", linkTo: getGraph(store).nodes.find((n) => n.name === "A")!.id },
			{ id: "y", linkTo: getGraph(store).nodes.find((n) => n.name === "B")!.id },
			{ id: "z", linkTo: getGraph(store).nodes.find((n) => n.name === "C")!.id },
		]),
		{ store },
		{ foldedAt: "t2" },
	);
	assert.equal(stats.chains, 1); // the assertion line appended (dedupe is per-chat)
	const chains = getGraph(store).chains;
	assert.equal(chains.length, 1); // read-time merge by (premises, conclusion)
	assert.equal(chains[0]!.id, firstChainId); // same arg_ identity
	assert.equal(chains[0]!.provenance.length, 2); // unioned across chats
	// A SAME-chat re-assertion is a no-op (nothing new)
	const again = mergeFindings(
		"chat_b",
		findings(
			[
				{ id: "x", name: "A3", statement: "A.", messageId: "m1" },
				{ id: "y", name: "B3", statement: "B.", messageId: "m2" },
				{ id: "z", name: "C3", statement: "C.", messageId: "m3" },
			],
			[{ premises: ["x", "y"], conclusion: "z" }],
		),
		verdicts([
			{ id: "x", linkTo: getGraph(store).nodes.find((n) => n.name === "A")!.id },
			{ id: "y", linkTo: getGraph(store).nodes.find((n) => n.name === "B")!.id },
			{ id: "z", linkTo: getGraph(store).nodes.find((n) => n.name === "C")!.id },
		]),
		{ store },
		{ foldedAt: "t3" },
	);
	assert.equal(again.chains, 0); // this chat already asserted it
	assert.equal(getGraph(store).chains.length, 1);
});

test("simplify: prefer-fewest-premises drops strict supersets", () => {
	// [A,B]=>X and [A,B,C]=>X: the second is redundant
	const kept = simplifyChains([
		{ id: "arg_1", premises: ["a", "b"], conclusion: "x", createdAt: "t1", provenance: [] },
		{ id: "arg_2", premises: ["a", "b", "c"], conclusion: "x", createdAt: "t2", provenance: [] },
	]);
	assert.deepEqual(kept.map((k) => k.id), ["arg_1"]);
});

test("simplify: ancestry-cover drops transitively covered chains", () => {
	// [A,B]=>X, [X,C]=>Y makes [A,B,C]=>Y redundant
	const kept = simplifyChains([
		{ id: "arg_1", premises: ["a", "b"], conclusion: "x", createdAt: "t1", provenance: [] },
		{ id: "arg_2", premises: ["x", "c"], conclusion: "y", createdAt: "t2", provenance: [] },
		{ id: "arg_3", premises: ["a", "b", "c"], conclusion: "y", createdAt: "t3", provenance: [] },
	]);
	assert.deepEqual(kept.map((k) => k.id), ["arg_1", "arg_2"]);
});

test("simplify: independent arguments for one conclusion both stay", () => {
	const kept = simplifyChains([
		{ id: "arg_1", premises: ["a", "b"], conclusion: "e", createdAt: "t1", provenance: [] },
		{ id: "arg_2", premises: ["c", "d"], conclusion: "e", createdAt: "t2", provenance: [] },
	]);
	assert.equal(kept.length, 2);
});

test("deriveView: single-premise chains collapse to direct arrows", () => {
	const graph = {
		nodes: [
			{ id: "n_a", name: "A", statement: "A", aliases: [], createdAt: "t", provenance: [] },
			{ id: "n_b", name: "B", statement: "B", aliases: [], createdAt: "t", provenance: [] },
		],
		chains: [{ id: "arg_1", premises: ["n_a"], conclusion: "n_b", createdAt: "t", provenance: [] }],
	};
	const view = deriveView(graph);
	assert.equal(view.nodes.length, 2); // no imp node
	assert.deepEqual(view.edges, [{ from: "n_a", to: "n_b" }]);
	assert.deepEqual(view.logicalEdges, [{ from: "n_a", to: "n_b" }]);
});

test("deriveView: multi-premise chains mint one implication node per argument", () => {
	const graph = {
		nodes: [
			{ id: "n_a", name: "A", statement: "A", aliases: [], createdAt: "t", provenance: [] },
			{ id: "n_b", name: "B", statement: "B", aliases: [], createdAt: "t", provenance: [] },
			{ id: "n_e", name: "E", statement: "E", aliases: [], createdAt: "t", provenance: [] },
			{ id: "n_c", name: "C", statement: "C", aliases: [], createdAt: "t", provenance: [] },
			{ id: "n_d", name: "D", statement: "D", aliases: [], createdAt: "t", provenance: [] },
		],
		chains: [
			{ id: "arg_1", premises: ["n_a", "n_b"], conclusion: "n_e", createdAt: "t", provenance: [] },
			{ id: "arg_2", premises: ["n_c", "n_d"], conclusion: "n_e", createdAt: "t", provenance: [] },
		],
	};
	const view = deriveView(graph);
	assert.equal(view.nodes.length, 7); // 5 propositions + 2 imp nodes
	const impCount = view.nodes.filter((n) => n.name === "⟹").length;
	assert.equal(impCount, 2); // TWO diamonds, not one fan-in
	assert.ok(view.edges.some((e) => e.from === "n_a" && e.to === "arg_1"));
	assert.ok(view.edges.some((e) => e.from === "arg_1" && e.to === "n_e"));
	assert.ok(view.edges.some((e) => e.from === "n_c" && e.to === "arg_2"));
	assert.equal(view.impLinks.length, 2);
});

test("chainsForSelection includes a chain iff every member is selected", () => {
	const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
	const chains = [
		{ id: "arg_1", premises: ["a", "b"], conclusion: "c" },
		{ id: "arg_2", premises: ["a", "c"], conclusion: "b" },
	];
	// Selecting a,b: arg_1 missing premise... wait arg_1 needs a,b,c
	const sel = chainsForSelection(nodes.slice(0, 2), chains);
	assert.equal(sel.length, 2); // both nodes are singletons
	const full = chainsForSelection(nodes, chains);
	assert.equal(full.length, 2); // both chains ride
	assert.ok(full.some((c) => c.id === "arg_1" && c.conclusion === "c"));
});

test("resolveTargetId: id first, then name, null when unknown", () => {
	const nodes = [
		{ id: "n_1", name: "Chain rule" },
		{ id: "n_2", name: "Entropy" },
	];
	assert.equal(resolveTargetId("n_1", nodes), "n_1");
	assert.equal(resolveTargetId("chain rule", nodes), "n_1");
	assert.equal(resolveTargetId('"chain rule"', nodes), "n_1");
	assert.equal(resolveTargetId("nope", nodes), null);
});

test("formatChainLine renders premises → conclusion by name", () => {
	const line = formatChainLine(
		{ premises: ["n_a", "n_b"], conclusion: "n_c" },
		{ n_a: { name: "A" }, n_b: { name: "B" }, n_c: { name: "C" } },
	);
	assert.equal(line, "A, B → C");
});

test("birth-session partition derives from provenance", () => {
	const nodes = [
		{ id: "n_1", name: "A", statement: "", aliases: [], createdAt: "t", provenance: [{ chatId: "chat_x", messageId: "" }] },
		{ id: "n_2", name: "B", statement: "", aliases: [], createdAt: "t", provenance: [{ chatId: "chat_x", messageId: "" }, { chatId: "chat_y", messageId: "" }] },
		{ id: "n_3", name: "C", statement: "", aliases: [], createdAt: "t", provenance: [{ chatId: "chat_y", messageId: "" }] },
	];
	assert.equal(birthSessionOf(nodes[1]!), "chat_x"); // first point
	const partition = birthSessionPartition(nodes);
	assert.deepEqual(partition, [
		{ id: "chat_x", members: ["n_1", "n_2"] },
		{ id: "chat_y", members: ["n_3"] },
	]);
});

test("impClusterKey: majority among premises' births, tie to chain's own", () => {
	const birthOf = (id: string) => (id === "a" || id === "b" ? "chat_1" : "chat_2");
	assert.equal(
		impClusterKey({ premises: ["a", "b", "c"], provenance: [{ chatId: "chat_z", messageId: "" }] }, birthOf),
		"chat_1",
	);
	assert.equal(
		impClusterKey({ premises: ["a", "c"], provenance: [{ chatId: "chat_z", messageId: "" }] }, birthOf),
		"chat_z", // tie -> chain's own birth
	);
});

test("deleteNodeTraces: full death cascades to referencing chains", () => {
	const store = newMemoryGraphStore();
	mergeFindings(
		"chat_a",
		findings(
			[
				{ id: "p1", name: "A", statement: "A.", messageId: "m1" },
				{ id: "p2", name: "B", statement: "B.", messageId: "m2" },
				{ id: "p3", name: "C", statement: "C.", messageId: "m3" },
			],
			[{ premises: ["p1", "p2"], conclusion: "p3" }],
		),
		verdicts([]),
		{ store },
		{ foldedAt: "t1" },
	);
	const nodeA = getGraph(store).nodes.find((n) => n.name === "A")!;
	const stats = deleteNodeTraces(store, nodeA.id);
	assert.ok(stats);
	assert.equal(stats!.chainsRemoved, 1); // the chain dies with its premise
	assert.equal(getGraph(store).nodes.length, 2);
	assert.equal(getGraph(store).chains.length, 0);
	// idempotent
	assert.equal(deleteNodeTraces(store, nodeA.id), null);
});

test("deleteNodeTraces: arg_ id deletes exactly one argument", () => {
	const store = newMemoryGraphStore();
	mergeFindings(
		"chat_a",
		findings(
			[
				{ id: "p1", name: "A", statement: "A.", messageId: "m1" },
				{ id: "p2", name: "B", statement: "B.", messageId: "m2" },
				{ id: "p3", name: "C", statement: "C.", messageId: "m3" },
			],
			[
				{ premises: ["p1", "p2"], conclusion: "p3" },
				{ premises: ["p1"], conclusion: "p2" },
			],
		),
		verdicts([]),
		{ store },
		{ foldedAt: "t1" },
	);
	const graph = getGraph(store);
	const chainId = graph.chains.find((c) => c.premises.length === 2)!.id;
	const stats = deleteNodeTraces(store, chainId);
	assert.ok(stats);
	assert.equal(stats!.chainsRemoved, 1);
	// members survive; the other argument survives
	assert.equal(getGraph(store).nodes.length, 3);
	assert.equal(getGraph(store).chains.length, 1);
});
