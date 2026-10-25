/**
 * The layout engine — ported from learnharness src/core/layout.ts
 * (AGPL-3.0, amosblomqvist/learnharness). d3-force everywhere: one engine
 * owns the equilibrium (the merge-time incremental settle AND the live
 * drag physics run the same force set), layout EVOLVES instead of
 * reshuffling (warm-start from the positions ledger, per-node anchor
 * springs), new nodes seed near positioned neighbors, orphans seed on the
 * rim OUTSIDE the core.
 *
 * Depth anchoring (vertical/radial rows over inference rank), the orphan
 * rule, the imp midpoint anchor, and cluster centroid pull are ported
 * verbatim. Deterministic: seeds derive from node id.
 */

import {
	forceSimulation,
	forceLink,
	forceManyBody,
	forceX,
	forceY,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from "d3-force";
import type { Position } from "./contracts/graph.js";
import { seededRandom } from "./question-core.js";

/** A node the d3 simulation mutates (x/y/vx/vy; fx/fy = pinned). */
export interface LayoutNode extends SimulationNodeDatum {
	id: string;
}

/** A link as d3 sees it (id strings resolve to node refs on init). */
type SimLink = SimulationLinkDatum<LayoutNode>;

/** Link input: edges are undirected for layout purposes. */
export interface LayoutEdge {
	from: string;
	to: string;
}

/** A derived implication node's chain linkage. */
export interface ImpLink {
	id: string;
	premises: ReadonlyArray<string>;
	conclusion: string;
}

/** How the inference rank is expressed spatially. */
export type DepthAnchorMode = "off" | "vertical" | "radial";

export interface DepthAnchor {
	mode: DepthAnchorMode;
	/** Anchor pull toward the level. */
	strength: number;
	/** Distance between consecutive inference levels. */
	spacing: number;
	/** Baseline point. */
	center?: { x: number; y: number };
	/** Inner ring radius (radial only). */
	baseRadius?: number;
}

export const LINK_DISTANCE = 40;
/** Implication-node id prefix: links TOUCHING an imp node get HALF the
 *  base rest length — the argument's geometry sits tight. */
const IMP_ID_PREFIX = "arg_";
const impLinkId = (v: string | number | { id: string }): string =>
	typeof v === "object" ? v.id : String(v);
export const CHARGE_STRENGTH = -240;
/** Per-tick anchor re-blend: fraction of displacement that SURVIVES each
 *  tick. Position-space (alpha-independent). */
const ANCHOR_RETENTION = 0.85;
const BOOTSTRAP_GRAVITY = 0.2;
/** The live sim reuses this so its rest state matches the settle's. */
export const INCREMENTAL_GRAVITY = 0.12;
export const CLUSTER_PULL_STRENGTH = 0.15;

/**
 * Inference depth per node: the longest chain of directed edges from a
 * base node. CYCLE-SAFE: Tarjan SCC condensation collapses each strongly
 * connected component, ranks the (always acyclic) condensation, and every
 * cycle member shares its component's depth. Iterative, O(V+E),
 * deterministic.
 */
export function inferenceDepths(
	nodes: ReadonlyArray<Pick<{ id: string }, "id">>,
	edges: ReadonlyArray<LayoutEdge>,
): Map<string, number> {
	const valid = new Set(nodes.map((n) => n.id));
	const adj = new Map<string, string[]>();
	for (const e of edges) {
		if (e.from === e.to || !valid.has(e.from) || !valid.has(e.to)) continue;
		let list = adj.get(e.from);
		if (!list) adj.set(e.from, (list = []));
		list.push(e.to);
	}

	// Iterative Tarjan SCC.
	const num = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const comp = new Map<string, number>();
	let counter = 0;
	let compCount = 0;
	for (const start of valid) {
		if (num.has(start)) continue;
		num.set(start, counter);
		low.set(start, counter);
		counter++;
		stack.push(start);
		onStack.add(start);
		const work: [string, number][] = [[start, 0]];
		while (work.length > 0) {
			const frame = work[work.length - 1]!;
			const v = frame[0];
			const outs = adj.get(v) ?? [];
			if (frame[1] < outs.length) {
				const i = frame[1];
				frame[1] = i + 1;
				const w = outs[i]!;
				if (!num.has(w)) {
					num.set(w, counter);
					low.set(w, counter);
					counter++;
					stack.push(w);
					onStack.add(w);
					work.push([w, 0]);
				} else if (onStack.has(w)) {
					low.set(v, Math.min(low.get(v)!, num.get(w)!));
				}
			} else {
				work.pop();
				if (low.get(v) === num.get(v)) {
					let w: string;
					do {
						w = stack.pop()!;
						onStack.delete(w);
						comp.set(w, compCount);
					} while (w !== v);
					compCount++;
				}
				if (work.length > 0) {
					const parent = work[work.length - 1]![0];
					low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
				}
			}
		}
	}

	// Condensation predecessors, then longest path (Tarjan emits sinks
	// first, so descending comp index = topological order).
	const preds: Set<number>[] = Array.from({ length: compCount }, () => new Set<number>());
	for (const e of edges) {
		const a = comp.get(e.from);
		const b = comp.get(e.to);
		if (a == null || b == null || a === b) continue;
		preds[b]!.add(a);
	}
	const depth = new Array<number>(compCount).fill(0);
	for (let c = compCount - 1; c >= 0; c--) {
		let d = 0;
		for (const p of preds[c]!) d = Math.max(d, depth[p]! + 1);
		depth[c] = d;
	}
	const out = new Map<string, number>();
	for (const n of nodes) out.set(n.id, depth[comp.get(n.id)!] ?? 0);
	return out;
}

export interface SimOptions {
	linkDistance?: number;
	linkStrength?: number;
	chargeStrength?: number;
	gravity?: { x: number; y: number; strength: number };
	alphaDecay?: number;
	velocityDecay?: number;
	depthAnchor?: DepthAnchor;
	logicalEdges?: ReadonlyArray<LayoutEdge>;
	impLinks?: ReadonlyArray<ImpLink>;
	clusterPull?: {
		clusters: ReadonlyArray<{ members: ReadonlyArray<string> }>;
		strength: number;
	};
}

/**
 * The one force set. Returns a STOPPED simulation — callers drive it
 * manually. Deterministic; mutates `nodes` in place (d3 semantics).
 */
export function createGraphSimulation(
	nodes: LayoutNode[],
	edges: ReadonlyArray<LayoutEdge>,
	options: SimOptions = {},
): Simulation<LayoutNode, SimLink> {
	// Link stiffness: d3's default is 1/min(deg) (degree-scaled springs).
	const degree = new Map<string, number>();
	for (const e of edges) {
		degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
		degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
	}
	const linkStrength = options.linkStrength ?? 1;
	const linkDistance = options.linkDistance ?? LINK_DISTANCE;

	const sim = forceSimulation<LayoutNode, SimLink>(nodes)
		.force(
			"link",
			forceLink<LayoutNode, SimLink>(
				edges.map((e) => ({ source: e.from, target: e.to })),
			)
				.id((d) => d.id)
				// Per-link rest length: a link touching an implication node
				// (arg_-prefixed) gets HALF the base distance.
				.distance(
					(l) =>
						impLinkId(l.source).startsWith(IMP_ID_PREFIX) || impLinkId(l.target).startsWith(IMP_ID_PREFIX)
							? linkDistance / 2
							: linkDistance,
				)
				.strength(
					(l) =>
						(linkStrength * 1) /
						Math.min(
							degree.get((l.source as LayoutNode).id) ?? 1,
							degree.get((l.target as LayoutNode).id) ?? 1,
						),
				),
		)
		.force("charge", forceManyBody<LayoutNode>().strength(options.chargeStrength ?? CHARGE_STRENGTH))
		.alphaDecay(options.alphaDecay ?? 0.0228)
		.velocityDecay(options.velocityDecay ?? 0.4)
		.stop();

	// Gravity, mode-projected: vertical owns y (gravity goes x-only);
	// radial drops the center pull for structured nodes (rings own the
	// radius). ORPHAN RULE: a node with no edges is exempt from the depth
	// force and keeps the regular view's forces.
	const mode = options.depthAnchor?.mode ?? "off";
	const depthEdges = options.logicalEdges ?? edges;
	let orphan: Uint8Array | null = null;
	let depthsComputed: Map<string, number> | null = null;
	if (mode !== "off") {
		const connected = new Set<string>();
		const valid = new Set(nodes.map((n) => n.id));
		for (const e of depthEdges) {
			if (e.from === e.to || !valid.has(e.from) || !valid.has(e.to)) continue;
			connected.add(e.from);
			connected.add(e.to);
		}
		// Proposition ranks first; then the IMP MIDPOINT ANCHOR: an imp
		// node's depth = (highest premise row + conclusion row) / 2.
		depthsComputed = inferenceDepths(
			nodes.filter((n) => !n.id.startsWith(IMP_ID_PREFIX)),
			depthEdges,
		);
		const anchored = new Set<string>();
		if (options.impLinks) {
			for (const link of options.impLinks) {
				const conclusionDepth = depthsComputed.get(link.conclusion);
				if (conclusionDepth === undefined || link.premises.length === 0) continue;
				let highest = -Infinity;
				let complete = true;
				for (const premise of link.premises) {
					const d = depthsComputed.get(premise);
					if (d === undefined) {
						complete = false;
						break;
					}
					if (d > highest) highest = d;
				}
				if (!complete) continue;
				depthsComputed.set(link.id, (highest + conclusionDepth) / 2);
				anchored.add(link.id);
			}
		}
		orphan = new Uint8Array(nodes.length);
		nodes.forEach((n, i) => {
			if (!connected.has(n.id) && !(n.id.startsWith(IMP_ID_PREFIX) && anchored.has(n.id))) orphan![i] = 1;
		});
	}
	const g = options.gravity;
	if (g && mode === "off") {
		sim.force("x", forceX<LayoutNode>(g.x).strength(g.strength));
		sim.force("y", forceY<LayoutNode>(g.y).strength(g.strength));
	} else if (g) {
		const orphanMask = orphan!;
		sim.force("gravity", (alpha: number) => {
			for (let i = 0; i < nodes.length; i++) {
				const n = nodes[i]!;
				if (mode === "vertical") {
					n.vx = (n.vx ?? 0) + (g.x - (n.x ?? 0)) * g.strength * alpha;
				} else if (orphanMask[i]) {
					n.vx = (n.vx ?? 0) + (g.x - (n.x ?? 0)) * g.strength * alpha;
					n.vy = (n.vy ?? 0) + (g.y - (n.y ?? 0)) * g.strength * alpha;
				}
				// radial + structured: nothing — the rings own the radius.
			}
		});
	}

	// Cluster centroid pull: membership resolved ONCE; two allocation-free
	// O(n) passes per tick. Singletons skip themselves. Mode-projected
	// (vertical: x-only; radial: tangential only).
	const cp = options.clusterPull;
	if (cp && cp.strength > 0 && cp.clusters.length > 0) {
		const clusterIdx = new Map<string, number>();
		cp.clusters.forEach((c, i) => {
			for (const id of c.members) clusterIdx.set(id, i);
		});
		const nodeCluster = nodes.map((n) => clusterIdx.get(n.id) ?? -1);
		const k = cp.clusters.length;
		const sumX = new Float64Array(k);
		const sumY = new Float64Array(k);
		const cnt = new Float64Array(k);
		const strength = cp.strength;
		const ringCx = options.depthAnchor?.center?.x ?? 0;
		const ringCy = options.depthAnchor?.center?.y ?? 0;
		sim.force("clusterPull", (alpha: number) => {
			sumX.fill(0);
			sumY.fill(0);
			cnt.fill(0);
			for (let i = 0; i < nodes.length; i++) {
				const ci = nodeCluster[i]!;
				if (ci < 0) continue;
				const n = nodes[i]!;
				sumX[ci] = sumX[ci]! + (n.x ?? 0);
				sumY[ci] = sumY[ci]! + (n.y ?? 0);
				cnt[ci] = cnt[ci]! + 1;
			}
			for (let i = 0; i < nodes.length; i++) {
				const ci = nodeCluster[i]!;
				if (ci < 0 || (cnt[ci] ?? 0) < 2) continue;
				const n = nodes[i]!;
				const px = n.x ?? 0;
				const py = n.y ?? 0;
				const ux = sumX[ci]! / cnt[ci]! - px;
				const uy = sumY[ci]! / cnt[ci]! - py;
				if (orphan && orphan[i]) {
					n.vx = (n.vx ?? 0) + ux * strength * alpha;
					n.vy = (n.vy ?? 0) + uy * strength * alpha;
				} else if (mode === "vertical") {
					n.vx = (n.vx ?? 0) + ux * strength * alpha;
				} else if (mode === "radial") {
					const rx = px - ringCx;
					const ry = py - ringCy;
					const r = Math.hypot(rx, ry);
					if (r > 1e-9) {
						const dot = (ux * rx + uy * ry) / (r * r);
						n.vx = (n.vx ?? 0) + (ux - dot * rx) * strength * alpha;
						n.vy = (n.vy ?? 0) + (uy - dot * ry) * strength * alpha;
					}
				} else {
					n.vx = (n.vx ?? 0) + ux * strength * alpha;
					n.vy = (n.vy ?? 0) + uy * strength * alpha;
				}
			}
		});
	}

	// Inference-depth anchoring: per-node target scalar, one O(n) pull
	// pass per tick.
	const da = options.depthAnchor;
	if (da && da.mode !== "off" && da.strength > 0) {
		const depths = depthsComputed!;
		const strength = da.strength;
		const spacing = da.spacing;
		const c = da.center ?? { x: 0, y: 0 };
		const orphanMask = orphan;
		if (da.mode === "vertical") {
			const baseY = c.y;
			sim.force("depth", (alpha: number) => {
				for (let i = 0; i < nodes.length; i++) {
					if (orphanMask?.[i]) continue;
					const n = nodes[i]!;
					const targetY = baseY - (depths.get(n.id) ?? 0) * spacing;
					n.vy = (n.vy ?? 0) + (targetY - (n.y ?? 0)) * strength * alpha;
				}
			});
		} else {
			const baseR = da.baseRadius ?? 0;
			const cx0 = c.x;
			const cy0 = c.y;
			sim.force("depth", (alpha: number) => {
				for (let i = 0; i < nodes.length; i++) {
					if (orphanMask?.[i]) continue;
					const n = nodes[i]!;
					const dx = (n.x ?? 0) - cx0;
					const dy = (n.y ?? 0) - cy0;
					const r = Math.hypot(dx, dy);
					const ux = r > 1e-9 ? dx / r : 1;
					const uy = r > 1e-9 ? dy / r : 0;
					const target = baseR + (depths.get(n.id) ?? 0) * spacing;
					const mag = (target - r) * strength * alpha;
					n.vx = (n.vx ?? 0) + ux * mag;
					n.vy = (n.vy ?? 0) + uy * mag;
				}
			});
		}
	}
	return sim;
}

export interface IncrementalLayoutOptions {
	ticks?: number;
	anchorRetention?: number;
	gravityStrength?: number;
	clusters?: ReadonlyArray<{ members: ReadonlyArray<string> }>;
	clusterPullStrength?: number;
	depthAnchor?: DepthAnchor;
	logicalEdges?: ReadonlyArray<LayoutEdge>;
	impLinks?: ReadonlyArray<ImpLink>;
}

/**
 * One incremental settle. `nodes`/`edges` describe the CURRENT graph;
 * `previous` is the positions ledger (empty on the very first settle —
 * then this degrades to a seeded-scatter bootstrap). Returns positions
 * for EVERY node in `nodes`.
 */
export function incrementalLayout(
	nodes: ReadonlyArray<Pick<{ id: string }, "id">>,
	edges: ReadonlyArray<LayoutEdge>,
	previous: ReadonlyMap<string, Position>,
	options: IncrementalLayoutOptions = {},
): Map<string, Position> {
	const ticks = options.ticks ?? 300;
	const retention = options.anchorRetention ?? ANCHOR_RETENTION;

	// Anchors: the warm-start set (the previous rest state).
	const anchors = new Map<string, Position>();
	for (const node of nodes) {
		const prev = previous.get(node.id);
		if (prev) anchors.set(node.id, { x: prev.x, y: prev.y });
	}

	// The anchored core's bounding box + centroid, for rim seeds.
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let cx = 0;
	let cy = 0;
	for (const a of anchors.values()) {
		minX = Math.min(minX, a.x);
		maxX = Math.max(maxX, a.x);
		minY = Math.min(minY, a.y);
		maxY = Math.max(maxY, a.y);
		cx += a.x;
		cy += a.y;
	}
	const hasCore = anchors.size > 0;
	if (hasCore) {
		cx /= anchors.size;
		cy /= anchors.size;
	}
	const coreRadius = hasCore ? Math.max(maxX - minX, maxY - minY) / 2 : 1;

	// Adjacency for neighbor seeding (undirected).
	const adjacency = new Map<string, string[]>();
	const linkTo = (a: string, b: string): void => {
		if (a === b) return;
		let list = adjacency.get(a);
		if (!list) adjacency.set(a, (list = []));
		list.push(b);
	};
	for (const e of edges) {
		linkTo(e.from, e.to);
		linkTo(e.to, e.from);
	}

	// The rim radius derives from the CONNECTED core's mean radius —
	// orphans never inflate it. 1.7x matches the FA2-era density.
	let rimRadius = 0;
	let connectedAnchored = 0;
	for (const [id, a] of anchors) {
		if ((adjacency.get(id)?.length ?? 0) === 0) continue;
		connectedAnchored++;
		rimRadius += Math.hypot(a.x - cx, a.y - cy);
	}
	if (connectedAnchored > 0) rimRadius = (rimRadius / connectedAnchored) * 1.7;
	else if (hasCore) rimRadius = coreRadius * 1.15;
	rimRadius += 4;

	// Seed every node.
	const simNodes: LayoutNode[] = nodes.map((node) => {
		const rand = seededRandom(node.id);
		const anchor = anchors.get(node.id);
		let x: number;
		let y: number;
		if (anchor) {
			x = anchor.x;
			y = anchor.y;
		} else {
			// New node: seed near positioned neighbors, else on the rim
			// outside the core, else scatter.
			let sx = 0;
			let sy = 0;
			let found = 0;
			for (const nbr of adjacency.get(node.id) ?? []) {
				const na = anchors.get(nbr);
				if (na) {
					sx += na.x;
					sy += na.y;
					found++;
				}
			}
			if (found > 0) {
				x = sx / found + (rand() - 0.5) * 8;
				y = sy / found + (rand() - 0.5) * 8;
			} else if (hasCore) {
				const angle = rand() * Math.PI * 2;
				const radius = rimRadius + rand() * 8;
				x = cx + Math.cos(angle) * radius;
				y = cy + Math.sin(angle) * radius;
				// An orphan's intended rest spot IS the rim seed: anchor it
				// there so gravity cannot sink it into the core.
				anchors.set(node.id, { x, y });
			} else {
				x = (rand() - 0.5) * 100;
				y = (rand() - 0.5) * 100;
			}
		}
		if (x === 0 && y === 0) x = 0.5;
		return { id: node.id, x, y };
	});

	const sim = createGraphSimulation(simNodes, edges, {
		gravity: {
			x: cx,
			y: cy,
			strength: options.gravityStrength ?? (hasCore ? INCREMENTAL_GRAVITY : BOOTSTRAP_GRAVITY),
		},
		clusterPull: options.clusters
			? { clusters: options.clusters, strength: options.clusterPullStrength ?? CLUSTER_PULL_STRENGTH }
			: undefined,
		depthAnchor:
			options.depthAnchor && options.depthAnchor.mode !== "off"
				? { ...options.depthAnchor, center: options.depthAnchor.center ?? { x: cx, y: cy } }
				: options.depthAnchor,
		logicalEdges: options.logicalEdges,
		impLinks: options.impLinks,
	});
	const dMode = options.depthAnchor?.mode ?? "off";
	const dCenter = options.depthAnchor?.center ?? { x: cx, y: cy };
	const byId = new Map(simNodes.map((n) => [n.id, n]));
	for (let i = 0; i < ticks; i++) {
		sim.tick();
		// Anchor re-blend (position space, alpha-independent). Depth-mode
		// projection: preserve the FREE dimension only.
		if (hasCore && retention < 1) {
			for (const [id, a] of anchors) {
				const n = byId.get(id);
				if (!n || n.fx != null || n.fy != null) continue;
				const x = n.x ?? 0;
				const y = n.y ?? 0;
				if (dMode === "vertical") {
					n.x = a.x + (x - a.x) * retention;
				} else if (dMode === "radial") {
					const rx = x - dCenter.x;
					const ry = y - dCenter.y;
					const r = Math.hypot(rx, ry);
					const ax = a.x - dCenter.x;
					const ay = a.y - dCenter.y;
					const ar = Math.hypot(ax, ay);
					if (r > 1e-9 && ar > 1e-9) {
						const theta = Math.atan2(ry, rx);
						const thetaA = Math.atan2(ay, ax);
						const blended = thetaA + Math.atan2(Math.sin(theta - thetaA), Math.cos(theta - thetaA)) * retention;
						n.x = dCenter.x + r * Math.cos(blended);
						n.y = dCenter.y + r * Math.sin(blended);
					}
				} else {
					n.x = a.x + (x - a.x) * retention;
					n.y = a.y + (y - a.y) * retention;
				}
			}
		}
	}

	const out = new Map<string, Position>();
	for (const n of simNodes) out.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
	return out;
}
