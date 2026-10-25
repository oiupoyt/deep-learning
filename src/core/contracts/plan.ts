/**
 * Plan-tree contracts — ported from learnharness src/core/contracts/plan.ts
 * (AGPL-3.0, amosblomqvist/learnharness). A session-scoped dependency tree
 * authored by the teacher via plan_init; progress is DERIVED, never stored.
 */

export interface PlanNode {
	/** Opaque, agent-chosen slug, stable across edits: "chain-rule-intuition". */
	id: string;
	/** Short label for the tree panel. */
	title: string;
	/** 1-2 sentences: what this node covers. */
	summary?: string;
}

export interface PlanEdge {
	/** Prerequisite node id. */
	from: string;
	/** Node that depends on `from`. */
	to: string;
}

export interface PlanTree {
	nodes: PlanNode[];
	edges: PlanEdge[];
	/** Increments on every mutation — lets the UI animate/react to changes. */
	version: number;
}

/** Derived, never stored: status of a node for the panel. */
export type PlanNodeStatus = "current" | "visited" | "upcoming";

export interface DerivedPlanStatuses {
	/** The node the most recent tagged quiz call is about; null before any. */
	current: string | null;
	/** Nodes referenced by earlier tagged calls — been there, monotonic. */
	visited: ReadonlySet<string>;
}

/** Statuses of a node: the derived view the plan panel should render. */
export function derivedNodeStatus(statuses: DerivedPlanStatuses, nodeId: string): PlanNodeStatus {
	if (statuses.current === nodeId) return "current";
	if (statuses.visited.has(nodeId)) return "visited";
	return "upcoming";
}

/**
 * Derive the lesson's position from CALLS only: tagged quiz/explain calls in
 * the transcript, collapsed into consecutive runs.
 *
 *   current — the node of the most RECENT tagged call (any state)
 *   visited — every node referenced by an EARLIER tagged call
 *
 * A quiz call's input carries `nodeId` iff it is tagged. `nodeId` means
 * "this question is ABOUT this node" — a position signal, never a
 * completion signal. NodeIds missing from the current tree are ignored
 * (a rewrite may have dropped the node).
 */
export function derivePlanStatuses(
	tree: PlanTree,
	messages: ReadonlyArray<{
		role?: string;
		toolName?: string;
		arguments?: unknown;
		toolCalls?: ReadonlyArray<{ name: string; arguments: unknown }>;
	}>,
): DerivedPlanStatuses {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const runs: string[] = [];
	const nodeIdOf = (input: unknown): string | null => {
		const nodeId = (input as { nodeId?: unknown } | null)?.nodeId;
		return typeof nodeId === "string" && ids.has(nodeId) ? nodeId : null;
	};
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		// Native DSH shape: the message carries toolCalls; the fold also
		// accepts a flat single-call shape (tests).
		const calls = message.toolCalls ?? (message.toolName ? [{ name: message.toolName, arguments: message.arguments }] : []);
		for (const call of calls) {
			if (call.name !== "quiz" && call.name !== "explain") continue;
			const nodeId = nodeIdOf(call.arguments);
			if (nodeId === null) continue;
			if (runs.at(-1) !== nodeId) runs.push(nodeId);
		}
	}
	const current = runs.at(-1) ?? null;
	const visited = new Set(runs.slice(0, -1));
	return { current, visited };
}
