/**
 * plan-tree — the mermaid-subset plan authoring format + tree construction,
 * ported from learnharness (AGPL-3.0, amosblomqvist/learnharness:
 * src/agent/tools/mermaid-plan.ts + src/core/plan-tree.ts).
 *
 * The teacher writes the session map as a mermaid block; plan_init
 * canonicalizes it into the structured PlanTree. Hand-parsed subset:
 * deterministic, dependency-free, precise line-numbered errors the teacher
 * can act on. Not the mermaid runtime — the server never renders, it only
 * needs the graph.
 *
 * THE ONE STRICT RULE: node ids are permanent slugs the teacher references
 * via quiz nodeId — lowercase words (a-z, 0-9) joined by hyphens OR
 * underscores. Everything else is as free-form as mermaid allows.
 */

import type { PlanEdge, PlanNode, PlanTree } from "./contracts/plan.js";

export type { PlanEdge, PlanNode, PlanTree, PlanNodeStatus, DerivedPlanStatuses } from "./contracts/plan.js";
export {
	derivedNodeStatus,
	derivePlanStatuses,
} from "./contracts/plan.js";

// ─── structural errors (written for the model) ───────────────────────────────

/** A structural problem with a plan tree, written for the model to fix. */
export class PlanTreeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlanTreeError";
	}
}

// ─── the mermaid subset parser ────────────────────────────────────────────────

export interface ParsedPlan {
	nodes: PlanNode[];
	edges: PlanEdge[];
}

export interface PlanParseResult {
	ok: boolean;
	/** All problems, each prefixed with its 1-based line number. */
	problems: string[];
	plan?: ParsedPlan;
}

const HEADER_RE = /^(graph|flowchart)\s+(td|tb|lr|rl|bt)\s*$/i;
const SLUG_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
/** Any arrow spelling counts as a requires-edge; chains split on it. */
const ARROW_RE = /-->|==>|-\.->/;
/** One edge endpoint: `id`, `id[title]`, or `id("title")`. The id CANDIDATE
 *  class is deliberately broad so every bad id reaches register()'s specific
 *  slug message instead of a generic parse error. */
const ENDPOINT_RE = /^([^\s()[\]]+)\s*(?:\[([^\[\]]*)\]|\(\s*"([^"]*)"\s*\)|\(([^()]*)\))?$/;

interface Endpoint {
	id: string;
	label?: string;
}

function parseEndpoint(text: string): Endpoint | null {
	const m = text.trim().match(ENDPOINT_RE);
	if (!m || !m[1]) return null;
	let label = (m[2] ?? m[3] ?? m[4] ?? "").trim();
	// `id["title"]` is idiomatic mermaid — don't keep the quote pair.
	if (
		label.length >= 2 &&
		((label.startsWith('"') && label.endsWith('"')) || (label.startsWith("'") && label.endsWith("'")))
	) {
		label = label.slice(1, -1).trim();
	}
	return { id: m[1], label };
}

/** Parse the mermaid subset. Collects ALL problems (never just the first). */
export function parseMermaidPlan(mermaid: string): PlanParseResult {
	const problems: string[] = [];
	const lines = mermaid.split(/\r?\n/);

	// Header: required, first non-empty non-comment line.
	const first = lines.findIndex((l) => l.trim().length > 0 && !l.trim().startsWith("%%"));
	if (first === -1) {
		return {
			ok: false,
			problems: ["The plan is empty — expected a `graph TD` block with nodes and `-->` requires-edges."],
		};
	}
	const header = lines[first]?.trim() ?? "";
	if (!HEADER_RE.test(header)) {
		problems.push(
			`line ${first + 1}: expected the header \`graph TD\` (or flowchart TD/TB) first, got \`${header}\`.`,
		);
	}

	const nodes = new Map<string, string>(); // id → title (first label wins)
	const edges: PlanEdge[] = [];
	const seenEdges = new Set<string>();

	const register = ({ id, label }: Endpoint, lineNo: number): void => {
		if (!SLUG_RE.test(id)) {
			problems.push(
				`line ${lineNo}: node id \`${id}\` must be a lowercase slug (a-z, 0-9, joined by hyphens or underscores — e.g. \`chain-rule-intuition\`); ids are permanent and checks reference them.`,
			);
			return;
		}
		if (!nodes.has(id)) nodes.set(id, label && label.length > 0 ? label : id);
		else if (label && label.length > 0 && nodes.get(id) === id) nodes.set(id, label);
	};

	for (let i = first + 1; i < lines.length; i++) {
		const line = lines[i]?.trim() ?? "";
		const no = i + 1;
		if (line.length === 0 || line.startsWith("%%")) continue;

		// Edges (incl. chains): split on any arrow spelling; every segment is
		// an endpoint, consecutive pairs become requires-edges.
		const segments = line.split(ARROW_RE);
		if (segments.length >= 2) {
			const endpoints: Endpoint[] = [];
			let unreadable = false;
			for (const seg of segments) {
				const ep = parseEndpoint(seg);
				if (!ep) {
					problems.push(
						`line ${no}: can't read the edge \`${line}\` — expected \`a[title] --> b[title]\` (chains like \`a --> b --> c\` are fine).`,
					);
					unreadable = true;
					break;
				}
				endpoints.push(ep);
			}
			if (!unreadable) {
				for (const ep of endpoints) register(ep, no);
				for (let k = 0; k + 1 < endpoints.length; k++) {
					const from = endpoints[k]!;
					const to = endpoints[k + 1]!;
					if (from.id === to.id) {
						problems.push(`line ${no}: self-loop \`${from.id} --> ${to.id}\` — a node can't require itself.`);
						continue;
					}
					const key = `${from.id}->${to.id}`;
					if (!seenEdges.has(key)) {
						seenEdges.add(key);
						edges.push({ from: from.id, to: to.id });
					}
				}
			}
		} else {
			const node = parseEndpoint(line);
			if (!node) {
				problems.push(
					`line ${no}: can't parse \`${line}\` — ids are the strict part (lowercase slugs: a-z, 0-9, hyphens, underscores); node lines (\`slug[title]\`) and requires-edges (\`a --> b\`) are the accepted forms; subgraphs, styles, and classes are not part of the subset.`,
				);
				continue;
			}
			register(node, no);
		}
	}

	const plan: ParsedPlan = {
		nodes: [...nodes.entries()].map(([id, title]) => ({ id, title })),
		edges,
	};
	if (problems.length > 0) return { ok: false, problems };
	if (plan.nodes.length === 0) return { ok: false, problems: ["No nodes found — the plan needs at least one."] };
	return { ok: true, problems: [], plan };
}

// ─── tree construction (createTree) ───────────────────────────────────────────

function nodeMap(nodes: PlanNode[]): Map<string, PlanNode> {
	if (nodes.length === 0) throw new PlanTreeError("The plan needs at least one node.");
	const map = new Map<string, PlanNode>();
	for (const node of nodes) {
		if (typeof node.id !== "string" || node.id.trim().length === 0) {
			throw new PlanTreeError("Every node needs a non-empty `id` (a stable slug like 'chain-rule-intuition').");
		}
		if (typeof node.title !== "string" || node.title.trim().length === 0) {
			throw new PlanTreeError(`Node "${node.id}" needs a non-empty \`title\`.`);
		}
		if (map.has(node.id)) {
			throw new PlanTreeError(`Duplicate node id "${node.id}" — node ids must be unique.`);
		}
		map.set(node.id, { ...node });
	}
	return map;
}

function requireNode(map: Map<string, PlanNode>, id: string, what: string): void {
	if (!map.has(id)) {
		throw new PlanTreeError(`${what} references unknown node id "${id}" — it is not in the tree.`);
	}
}

function edgeKey(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

/** Would adding edge from→to create a cycle? Walk forward from `to` along
 *  existing edges; if we can reach `from`, the new edge closes a loop. */
function createsCycle(edges: PlanEdge[], from: string, to: string): boolean {
	const adjacency = new Map<string, string[]>();
	for (const e of edges) {
		const list = adjacency.get(e.from);
		if (list) list.push(e.to);
		else adjacency.set(e.from, [e.to]);
	}
	const stack = [to];
	const seen = new Set<string>();
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (current === from) return true;
		if (seen.has(current)) continue;
		seen.add(current);
		for (const next of adjacency.get(current) ?? []) stack.push(next);
	}
	return false;
}

/** Full edge validation against existing nodes/edges: endpoints exist, no
 *  self-loop, no duplicate, acyclic. */
function assertValidEdge(from: string, to: string, nodes: PlanNode[], existingEdges: PlanEdge[]): void {
	const map = nodeMap(nodes); // also re-validates nodes on createTree
	requireNode(map, from, "Edge `from`");
	requireNode(map, to, "Edge `to`");
	if (from === to) {
		throw new PlanTreeError(`Self-loop: "${from}" --> "${to}" — a node can't require itself.`);
	}
	for (const e of existingEdges) {
		if (e.from === from && e.to === to) {
			throw new PlanTreeError(`Duplicate edge ${from} --> ${to}.`);
		}
	}
	if (createsCycle(existingEdges, from, to)) {
		throw new PlanTreeError(`Adding ${from} --> ${to} would create a cycle — the map must stay a DAG.`);
	}
}

/** Build a validated tree (v1). Structure only — no progress fields exist. */
export function createTree(nodes: PlanNode[], edges: PlanEdge[]): PlanTree {
	const map = nodeMap(nodes);
	for (const e of edges) {
		requireNode(map, e.from, "Edge `from`");
		requireNode(map, e.to, "Edge `to`");
	}
	const accepted: PlanEdge[] = [];
	for (const e of edges) {
		// Each edge is checked against the ones already accepted, so any
		// violation names the culprit edge.
		assertValidEdge(e.from, e.to, nodes, accepted);
		accepted.push({ from: e.from, to: e.to });
	}
	return { nodes: nodes.map((n) => ({ ...n })), edges: accepted, version: 1 };
}

// ─── the plan seam: parse + construct in one step ─────────────────────────────

export type PlanResult =
	| { ok: true; tree: PlanTree }
	| { ok: false; error: string };

/**
 * Canonicalize a mermaid plan block into a validated PlanTree: parse (every
 * problem collected, line-numbered), then createTree (duplicate ids, missing
 * endpoints, self-loops, duplicates, cycles). `previousVersion` seeds the
 * new tree's version (a rewrite increments; first authoring passes 0).
 */
export function canonicalizePlan(mermaid: string, previousVersion = 0): PlanResult {
	const parsed = parseMermaidPlan(mermaid);
	if (!parsed.ok || !parsed.plan) {
		return { ok: false, error: parsed.problems.join("\n") };
	}
	try {
		const tree = createTree(parsed.plan.nodes, parsed.plan.edges);
		return { ok: true, tree: { ...tree, version: previousVersion + 1 } };
	} catch (err) {
		if (err instanceof PlanTreeError) return { ok: false, error: err.message };
		throw err;
	}
}

/** Render a tree back to the mermaid subset (round-trip-safe; used by the
 *  plan panel and the compact model-facing re-injection). Titles quote
 *  safely; slugs are already slug-validated by construction. */
export function planToMermaid(tree: PlanTree): string {
	const lines = ["graph TD"];
	for (const node of tree.nodes) {
		lines.push(`  ${node.id}["${node.title.replace(/"/g, "'")}"]`);
	}
	for (const edge of tree.edges) {
		lines.push(`  ${edge.from} --> ${edge.to}`);
	}
	return lines.join("\n");
}
