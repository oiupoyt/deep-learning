/**
 * The merge-time settle — ported from learnharness src/core/layout-settle.ts
 * (AGPL-3.0). Recompute the resting layout from the CURRENT graph + the
 * positions ledger, and replace the ledger. Server-side only (needs the
 * cluster partition; never ships in the client bundle).
 */

import type { GraphChain, GraphNode, Position } from "./contracts/graph.js";
import { incrementalLayout } from "./layout.js";
import {
	attachImpToCommunities,
	birthSessionPartition,
	deriveView,
	getGraph,
} from "./graph.js";

export function settleGraphLayout(graphStore: {
	readNodes(): GraphNode[];
	readChains(): GraphChain[];
	readPositions(): Record<string, Position>;
	writePositions(positions: Record<string, Position>): void;
}): void {
	const graph = getGraph(graphStore);
	if (graph.nodes.length === 0) return;
	const view = deriveView(graph);
	const previous = new Map(Object.entries(graphStore.readPositions()));
	const communities = birthSessionPartition(graph.nodes);
	// The same imp-node assignment the snapshot renders.
	attachImpToCommunities(communities, graph.nodes, graph.chains);
	const next = incrementalLayout(view.nodes, view.edges, previous, {
		clusters: communities,
		logicalEdges: view.logicalEdges,
		impLinks: view.impLinks,
	});
	graphStore.writePositions(Object.fromEntries(next));
}
