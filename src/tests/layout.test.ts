// Red step for the layout engine: inference depths (Tarjan SCC, cycle-safe),
// the force set (imp half-distance springs, degree-scaled stiffness,
// cluster pull, depth anchoring with orphan rule), and the incremental
// settle — ported from learnharness src/core/layout.ts.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
	inferenceDepths,
	createGraphSimulation,
	incrementalLayout,
	LINK_DISTANCE,
	CHARGE_STRENGTH,
} from "../core/layout.js";

const node = (id: string) => ({ id });

test("inferenceDepths: longest directed chain from a base node", () => {
	const depths = inferenceDepths(
		[node("a"), node("b"), node("c"), node("d")],
		[
			{ from: "a", to: "b" },
			{ from: "b", to: "c" },
			{ from: "a", to: "c" },
		],
	);
	assert.equal(depths.get("a"), 0);
	assert.equal(depths.get("b"), 1);
	assert.equal(depths.get("c"), 2); // longest, not shortest
	assert.equal(depths.get("d"), 0); // orphan
});

test("inferenceDepths: cycles are safe (SCC members share a depth)", () => {
	const depths = inferenceDepths(
		[node("x"), node("y"), node("z")],
		[
			{ from: "x", to: "y" },
			{ from: "y", to: "x" },
			{ from: "y", to: "z" },
		],
	);
	assert.equal(depths.get("x"), depths.get("y")); // same component
	assert.equal(depths.get("z"), (depths.get("x") ?? 0) + 1);
});

test("inferenceDepths: self-loops and dangling endpoints ignored", () => {
	const depths = inferenceDepths(
		[node("a"), node("b")],
		[
			{ from: "a", to: "a" },
			{ from: "a", to: "ghost" },
		],
	);
	assert.equal(depths.get("a"), 0);
	assert.equal(depths.get("b"), 0);
});

test("createGraphSimulation returns a stopped simulation", () => {
	const nodes = [node("a"), node("b")];
	const sim = createGraphSimulation(nodes, [{ from: "a", to: "b" }]);
	assert.equal(typeof sim.tick, "function");
	assert.ok(sim.alpha() > 0);
	// constants exported for the live sim parity
	assert.equal(LINK_DISTANCE, 40);
	assert.equal(CHARGE_STRENGTH, -240);
});

test("incrementalLayout: bootstrap seeds a deterministic scatter", () => {
	const out1 = incrementalLayout([node("a"), node("b"), node("c")], [{ from: "a", to: "b" }], new Map());
	const out2 = incrementalLayout([node("a"), node("b"), node("c")], [{ from: "a", to: "b" }], new Map());
	assert.deepEqual([...out1.keys()].sort(), ["a", "b", "c"]);
	assert.deepEqual(out1.get("a"), out2.get("a")); // deterministic: same seeds, same ticks
	assert.deepEqual(out1.get("b"), out2.get("b"));
});

test("incrementalLayout: warm start keeps anchored nodes near their previous rest", () => {
	const previous = new Map([
		["a", { x: 100, y: 100 }],
		["b", { x: 120, y: 100 }],
	]);
	const out = incrementalLayout(
		[node("a"), node("b"), node("new")],
		[
			{ from: "a", to: "b" },
			{ from: "b", to: "new" },
		],
		previous,
	);
	// anchors hold (retention 0.85 keeps them close to their rest spots)
	assert.ok(Math.abs(out.get("a")!.x - 100) < 30);
	assert.ok(Math.abs(out.get("a")!.y - 100) < 30);
	// the new node seeded near its positioned neighbor b
	const nb = out.get("new")!;
	const nearB = Math.hypot(nb.x - 120, nb.y - 100);
	assert.ok(nearB < 80, `new node should seed near b, dist ${nearB}`);
});

test("incrementalLayout: orphan seeds on the rim outside the core", () => {
	const previous = new Map([
		["a", { x: 0, y: 0 }],
		["b", { x: 40, y: 0 }],
	]);
	const out = incrementalLayout([node("a"), node("b"), node("orphan")], [{ from: "a", to: "b" }], previous);
	const orphan = out.get("orphan")!;
	const distFromCore = Math.hypot(orphan.x - 20, orphan.y - 0);
	// rim radius derives from the connected core's mean (~34*1.7+4)
	assert.ok(distFromCore > 30, `orphan should sit outside the core, dist ${distFromCore}`);
});
