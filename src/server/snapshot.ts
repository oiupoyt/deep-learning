/**
 * The graph snapshot — the read payload for the Learning panel, ported
 * from learnharness's graphSnapshot (src/core/graph.ts). Pure derivation
 * over the ledgers: nodes + derived view + birth-session clusters +
 * session labels. The extraction pipeline owns every write.
 */

import type { FsGraphStore } from "../store/graph.js";
import type { FsSessionsStore } from "../store/sessions.js";
import {
	getGraph,
	deriveView,
	birthSessionPartition,
	attachImpToCommunities,
	MIN_CLUSTER_SIZE,
} from "../core/graph.js";
import type { GraphSnapshot } from "../core/contracts/graph.js";

export function graphSnapshot(
	graphStore: FsGraphStore,
	_sessionsStore: FsSessionsStore,
	_ctx: unknown,
): GraphSnapshot {
	const graph = getGraph(graphStore);
	const view = deriveView(graph);
	const nodes = view.nodes;

	// Session labels: every provenance anchor the graph can name — DSH
	// session titles are resolved by the client through the harness's own
	// session API; here we return ids only, plus notes file paths.
	const nodeSessions: Record<string, string[]> = {};
	const sessionIds = new Set<string>();
	for (const node of graph.nodes) {
		const ids = [...new Set(node.provenance.map((pt) => pt.chatId))];
		if (ids.length > 0) nodeSessions[node.id] = ids;
		for (const id of ids) sessionIds.add(id);
	}
	const fileSources: Record<string, string> = {};
	for (const source of graphStore.readSources()) {
		if (sessionIds.has(source.id)) fileSources[source.id] = source.filePath;
	}

	const communities = birthSessionPartition(graph.nodes);
	const clusters = communities
		.filter((community) => community.members.length >= MIN_CLUSTER_SIZE)
		.map((community) => ({
			id: community.id,
			label: fileSources[community.id] ?? null,
			members: community.members,
		}));
	attachImpToCommunities(clusters, graph.nodes, graph.chains);

	const positions = graphStore.readPositions();

	return {
		nodes,
		propositions: graph.nodes,
		edges: view.edges,
		logicalEdges: view.logicalEdges,
		impLinks: view.impLinks,
		chains: graph.chains,
		sessions: {}, // titles resolve client-side via the harness session API
		fileSources,
		nodeSessions,
		clusters,
		...(Object.keys(positions).length > 0 ? { positions } : {}),
	};
}
