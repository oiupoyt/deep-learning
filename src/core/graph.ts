/**
 * The knowledge graph: merger + derivation + deletion — ported from
 * learnharness src/core/graph.ts + graph-deletion.ts + session-clusters.ts
 * + chains.ts (AGPL-3.0, amosblomqvist/learnharness).
 *
 * The extraction pipeline is the SOLE graph writer; the merger is its
 * deterministic apply stage. Everything mechanical stays code: identity
 * inside the job is the auditor's link-or-create verdict; timestamps and
 * provenance are rebuilt deterministically; chain dedupe by (premises,
 * conclusion); the simplification pass strips provably redundant
 * derivations. Reads are pure derivation — store events, derive state.
 *
 * Port delta: the storage port is the minimal append/rewrite surface the
 * merger needs (see GraphStorePort); tests use the in-memory
 * implementation here, production uses the fs adapter over
 * $DSH_HOME/deep-learning/graph/.
 */

import { randomBytes } from "node:crypto";
import type {
	AuditVerdicts,
	Cluster,
	CoverageEntry,
	EmissionStats,
	ExtractedChain,
	GraphChain,
	GraphEdge,
	GraphNode,
	NotesSource,
	Position,
	SessionCheckpoint,
	SessionFindings,
} from "./contracts/graph.js";

export type {
	AuditVerdicts,
	Cluster,
	CoverageEntry,
	EmissionStats,
	ExtractedChain,
	ExtractedProposition,
	GraphChain,
	GraphEdge,
	GraphNode,
	IdentityLink,
	NotesSource,
	Position,
	ProvenancePoint,
	SessionCheckpoint,
	SessionFindings,
} from "./contracts/graph.js";

// ─── the storage port (the minimal merger surface) ───────────────────────────

/** The ledger operations the merger and deletions need. The fs adapter
 *  implements this over $DSH_HOME/deep-learning/graph/. */
export interface GraphStorePort {
	readNodes(): GraphNode[];
	appendNode(node: GraphNode): void;
	readChains(): GraphChain[];
	appendChain(chain: GraphChain): void;
	readCoverage(): CoverageEntry[];
	appendCoverage(entry: CoverageEntry): void;
	readCheckpoints(): SessionCheckpoint[];
	appendCheckpoint(checkpoint: SessionCheckpoint): void;
	readSources(): NotesSource[];
	readPositions(): Record<string, Position>;
	writePositions(positions: Record<string, Position>): void;
	/** Atomic rewrite of the named ledgers (simplified/deleted state). */
	rewriteLedgers(ledgers: {
		nodes?: GraphNode[];
		chains?: GraphChain[];
		coverage?: CoverageEntry[];
		checkpoints?: SessionCheckpoint[];
	}): void;
}

/** An in-memory GraphStorePort — tests and the seed fixtures. */
export class MemoryGraphStore implements GraphStorePort {
	private nodes: GraphNode[] = [];
	private chains: GraphChain[] = [];
	private coverage: CoverageEntry[] = [];
	private checkpoints: SessionCheckpoint[] = [];
	private sources: NotesSource[] = [];
	private positions: Record<string, Position> = {};

	readNodes(): GraphNode[] {
		return this.nodes.map((n) => ({ ...n, provenance: [...n.provenance], aliases: [...n.aliases] }));
	}
	appendNode(node: GraphNode): void {
		this.nodes.push(node);
	}
	readChains(): GraphChain[] {
		return this.chains.map((c) => ({ ...c, premises: [...c.premises], provenance: [...c.provenance] }));
	}
	appendChain(chain: GraphChain): void {
		this.chains.push(chain);
	}
	readCoverage(): CoverageEntry[] {
		return [...this.coverage];
	}
	appendCoverage(entry: CoverageEntry): void {
		this.coverage.push(entry);
	}
	readCheckpoints(): SessionCheckpoint[] {
		return [...this.checkpoints];
	}
	appendCheckpoint(checkpoint: SessionCheckpoint): void {
		this.checkpoints.push(checkpoint);
	}
	readSources(): NotesSource[] {
		return [...this.sources];
	}
	readPositions(): Record<string, Position> {
		return { ...this.positions };
	}
	writePositions(positions: Record<string, Position>): void {
		this.positions = { ...positions };
	}
	rewriteLedgers(ledgers: {
		nodes?: GraphNode[];
		chains?: GraphChain[];
		coverage?: CoverageEntry[];
		checkpoints?: SessionCheckpoint[];
	}): void {
		if (ledgers.nodes !== undefined) this.nodes = ledgers.nodes;
		if (ledgers.chains !== undefined) this.chains = ledgers.chains;
		if (ledgers.coverage !== undefined) this.coverage = ledgers.coverage;
		if (ledgers.checkpoints !== undefined) this.checkpoints = ledgers.checkpoints;
	}
}

export function newMemoryGraphStore(): MemoryGraphStore {
	return new MemoryGraphStore();
}

// ─── ids and keys ─────────────────────────────────────────────────────────────

/** "n_" + 12 hex chars (store-assigned). */
function newGraphNodeId(): string {
	return `n_${randomBytes(6).toString("hex")}`;
}

/** "arg_" + 12 hex chars — the implication-node namespace. */
function newGraphChainId(): string {
	return `arg_${randomBytes(6).toString("hex")}`;
}

/** A chain's merge key: sorted premises + conclusion. */
function chainKey(premises: ReadonlyArray<string>, conclusion: string): string {
	return `${[...premises].sort().join("+")}>${conclusion}`;
}

function pointOf(chatId: string, messageId?: string) {
	return [{ chatId, messageId: messageId ?? "" }];
}

const samePoint = (a: { chatId: string; messageId: string }, b: { chatId: string; messageId: string }) =>
	a.chatId === b.chatId && a.messageId === b.messageId;

// ─── the merger (extraction pipeline stage 3 — deterministic) ─────────────────

/** What one merge run merges FROM (the caller supplies it — the merger
 *  never reads the chat store). */
export interface MergeSource {
	foldedAt: string;
	/** The batch being merged (chat path): one entry per message. Absent
	 *  (notes path) → the whole-file checkpoint is written instead. */
	coverage?: CoverageEntry[];
}

/**
 * Merge one job's audited findings into the graph ledgers. Deterministic.
 * Resolution is a job-local in-memory map — nothing persists between jobs.
 * Identity inside the job is the auditor's link-or-create verdict.
 */
export function mergeFindings(
	chatId: string,
	findings: SessionFindings,
	verdicts: AuditVerdicts,
	deps: { store: GraphStorePort },
	source: MergeSource,
): EmissionStats {
	const ledgers = deps.store;
	const stats: EmissionStats = { nodes: 0, chains: 0 };

	// 1. Resolution: THIS job's propositions → graph node ids.
	const existingIds = new Set(ledgers.readNodes().map((n) => n.id));
	const mapping = new Map<string, string>();
	const now = new Date().toISOString();
	const linkOf = new Map(verdicts.links.map((l) => [l.id, l.linkTo]));

	for (const p of findings.propositions) {
		if (mapping.has(p.id)) continue; // duplicate id WITHIN this submit — first resolution stands
		const points = pointOf(chatId, p.messageId);
		const linkTo = linkOf.get(p.id);
		let graphNodeId: string;
		if (linkTo !== undefined && existingIds.has(linkTo)) {
			// Identity verdict: this proposition IS that node. Append a link
			// line — phrasings + provenance join at read time; the first
			// line's name/statement/createdAt stand.
			graphNodeId = linkTo;
			ledgers.appendNode({
				id: graphNodeId,
				name: p.name,
				statement: p.statement,
				aliases: [...p.aliases],
				createdAt: now,
				provenance: points,
			});
		} else {
			const node: GraphNode = {
				id: newGraphNodeId(),
				name: p.name,
				statement: p.statement,
				aliases: [...p.aliases],
				createdAt: now,
				provenance: points,
			};
			ledgers.appendNode(node);
			stats.nodes++;
			graphNodeId = node.id;
			existingIds.add(graphNodeId);
		}
		mapping.set(p.id, graphNodeId);
	}

	// 2. Chains. Endpoints resolve through the job-local map OR pass
	//    through verbatim when they name an existing node (digest
	//    references); chains dedupe by (premises, conclusion) already
	//    asserted by THIS chat — a re-stated argument appends under the
	//    SAME arg_ id (link-style; provenance unions at read time).
	const assertedByChat = new Set<string>();
	const idOfKey = new Map<string, string>();
	for (const line of ledgers.readChains()) {
		const key = chainKey(line.premises, line.conclusion);
		if (!idOfKey.has(key)) idOfKey.set(key, line.id);
		if (line.provenance.some((pt) => pt.chatId === chatId)) assertedByChat.add(key);
	}
	const emitChain = (chain: ExtractedChain): void => {
		const resolve = (endpoint: string): string | undefined =>
			mapping.get(endpoint) ?? (existingIds.has(endpoint) ? endpoint : undefined);
		const conclusion = resolve(chain.conclusion);
		if (conclusion === undefined) return; // unresolvable endpoint — skip
		const premises = [...new Set(chain.premises.map(resolve))].filter(
			(p): p is string => p !== undefined && p !== conclusion,
		);
		if (premises.length === 0) return; // a chain IS an argument
		const key = chainKey(premises, conclusion);
		if (assertedByChat.has(key)) return; // this chat already asserted this argument
		const id = idOfKey.get(key) ?? newGraphChainId();
		ledgers.appendChain({ id, premises, conclusion, createdAt: now, provenance: pointOf(chatId) });
		idOfKey.set(key, id);
		assertedByChat.add(key);
		stats.chains!++;
	};
	for (const chain of findings.chains) emitChain(chain);

	// 2b. Simplification — the deterministic dedupe pass over the WHOLE
	//     chain ledger (the merge runs inside the serialized audit
	//     section, so the rewrite is race-free).
	const allChains = ledgers.readChains();
	const keptChains = simplifyChains(allChains);
	if (keptChains.length !== allChains.length) {
		ledgers.rewriteLedgers({ chains: keptChains });
		stats.droppedChains = allChains.length - keptChains.length;
	}

	// 3. Checkpoint — only now, after every append succeeded, is the batch
	//    covered (per-batch atomic; failure checkpoints nothing).
	if (source.coverage !== undefined) {
		for (const entry of source.coverage) ledgers.appendCoverage(entry);
	} else {
		ledgers.appendCheckpoint({ chatId, foldedAt: source.foldedAt });
	}
	return stats;
}

// ─── chain simplification (the maintenance pass) ──────────────────────────────

/**
 * The deterministic chain-simplification pass: strips redundant
 * derivations — same-conclusion chains whose premises add nothing a
 * leaner kept chain doesn't already derive. Pure over the input list.
 *
 * Same (premises, conclusion) lines are ONE logical chain — a key is kept
 * or dropped as a whole, every provenance line with it.
 */
export function simplifyChains(lines: GraphChain[]): GraphChain[] {
	if (lines.length < 2) return lines;

	// Group lines by chain key (logical chains).
	const groups = new Map<string, GraphChain[]>();
	for (const line of lines) {
		const key = chainKey(line.premises, line.conclusion);
		const bucket = groups.get(key);
		if (bucket === undefined) groups.set(key, [line]);
		else bucket.push(line);
	}

	// Ancestry over the FULL chain set: every node id reachable as a
	// premise behind an id. Memoized walk, cycle-guarded.
	const premisesOf = new Map<string, string[][]>();
	for (const line of lines) {
		const bucket = premisesOf.get(line.conclusion);
		if (bucket === undefined) premisesOf.set(line.conclusion, [line.premises]);
		else bucket.push(line.premises);
	}
	const ancestryMemo = new Map<string, Set<string>>();
	const ancestry = (id: string, visiting: Set<string>): Set<string> => {
		const memo = ancestryMemo.get(id);
		if (memo !== undefined) return memo;
		const out = new Set<string>();
		if (visiting.has(id)) return out;
		visiting.add(id);
		for (const premises of premisesOf.get(id) ?? []) {
			for (const premise of premises) {
				out.add(premise);
				for (const ancestor of ancestry(premise, visiting)) out.add(ancestor);
			}
		}
		visiting.delete(id);
		ancestryMemo.set(id, out);
		return out;
	};

	// Per conclusion: greedy in (premiseCount, createdAt, key).
	const byConclusion = new Map<string, Array<{ key: string; premises: string[]; createdAt: string }>>();
	for (const [key, bucket] of groups) {
		const head = bucket[0]!; // the representative — its premises stand
		const entry = { key, premises: head.premises, createdAt: head.createdAt };
		const list = byConclusion.get(head.conclusion);
		if (list === undefined) byConclusion.set(head.conclusion, [entry]);
		else list.push(entry);
	}
	const droppedKeys = new Set<string>();
	for (const candidates of byConclusion.values()) {
		candidates.sort(
			(a, b) =>
				a.premises.length - b.premises.length ||
				a.createdAt.localeCompare(b.createdAt) ||
				a.key.localeCompare(b.key),
		);
		const kept: typeof candidates = [];
		for (const candidate of candidates) {
			const candidateSet = new Set(candidate.premises);
			const redundant = kept.some((k) => {
				// Rule 1 — prefer-fewest-premises: strict subset.
				if (k.premises.every((p) => candidateSet.has(p))) return true;
				// Rule 2 — ancestry-cover: every candidate premise is a kept
				// premise, or reachable behind one.
				const covered = new Set(k.premises);
				for (const p of k.premises) {
					for (const ancestor of ancestry(p, new Set())) covered.add(ancestor);
				}
				return candidate.premises.every((p) => covered.has(p));
			});
			if (redundant) droppedKeys.add(candidate.key);
			else kept.push(candidate);
		}
	}
	if (droppedKeys.size === 0) return lines;
	return lines.filter((line) => !droppedKeys.has(chainKey(line.premises, line.conclusion)));
}

// ─── derivation (reads only) ──────────────────────────────────────────────────

/** The merged STORED truth: propositions + chains. */
export interface DerivedGraph {
	nodes: GraphNode[];
	chains: GraphChain[];
}

/**
 * The whole graph from the ledgers. Node LINES may repeat an id
 * (link-appends): the FIRST line defines name/statement/createdAt; later
 * lines' statements and aliases join `aliases`, provenance unions. Chain
 * LINES merge by (premises, conclusion), provenance unioned.
 */
export function getGraph(store: Pick<GraphStorePort, "readNodes" | "readChains">): DerivedGraph {
	const byId = new Map<string, GraphNode>();
	for (const line of store.readNodes()) {
		const existing = byId.get(line.id);
		if (!existing) {
			byId.set(line.id, { ...line, aliases: [...line.aliases], provenance: [...line.provenance] });
			continue;
		}
		for (const phrasing of [line.statement, ...line.aliases]) {
			if (phrasing.length > 0 && !existing.aliases.includes(phrasing)) existing.aliases.push(phrasing);
		}
		for (const pt of line.provenance) {
			if (!existing.provenance.some((q) => samePoint(q, pt))) existing.provenance.push(pt);
		}
	}

	const chains: GraphChain[] = [];
	const byKey = new Map<string, GraphChain>();
	for (const line of store.readChains()) {
		const key = chainKey(line.premises, line.conclusion);
		const existing = byKey.get(key);
		if (existing) {
			for (const pt of line.provenance) {
				if (!existing.provenance.some((q) => samePoint(q, pt))) existing.provenance.push(pt);
			}
		} else {
			const chain: GraphChain = { ...line, premises: [...line.premises], provenance: [...line.provenance] };
			byKey.set(key, chain);
			chains.push(chain);
		}
	}
	return { nodes: [...byId.values()], chains };
}

/**
 * The DERIVED view — what the canvas renders. A SINGLE-premise chain
 * collapses to ONE direct arrow. A MULTI-premise chain mints an
 * implication NODE (id = the chain's arg_ id; name "⟹"; statement = the
 * chain line) plus arrows: premises → imp → conclusion. Dangling chains
 * drop (the deletion cascades should prevent them; this is the belt).
 */
export function deriveView(graph: DerivedGraph): {
	nodes: GraphNode[];
	edges: GraphEdge[];
	logicalEdges: GraphEdge[];
	impLinks: Array<{ id: string; premises: string[]; conclusion: string }>;
} {
	const names: Record<string, { name: string }> = {};
	for (const node of graph.nodes) names[node.id] = { name: node.name };
	const live = new Set(graph.nodes.map((node) => node.id));
	const impNodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const impLinks: Array<{ id: string; premises: string[]; conclusion: string }> = [];
	const logicalEdges: GraphEdge[] = [];
	const logicalSeen = new Set<string>();
	const emitLogical = (from: string, to: string): void => {
		const key = from + "\u0000" + to;
		if (logicalSeen.has(key)) return;
		logicalSeen.add(key);
		logicalEdges.push({ from, to });
	};
	for (const chain of graph.chains) {
		if (!live.has(chain.conclusion) || !chain.premises.every((premise) => live.has(premise))) continue;
		for (const premise of chain.premises) emitLogical(premise, chain.conclusion);
		if (chain.premises.length === 1) {
			edges.push({ from: chain.premises[0]!, to: chain.conclusion });
			continue;
		}
		impNodes.push({
			id: chain.id,
			name: "⟹",
			statement: formatChainLine(
				{ premises: chain.premises, conclusion: chain.conclusion },
				Object.fromEntries(graph.nodes.map((n) => [n.id, { name: n.name }])),
			),
			aliases: [],
			createdAt: chain.createdAt,
			provenance: [...chain.provenance],
		});
		impLinks.push({ id: chain.id, premises: [...chain.premises], conclusion: chain.conclusion });
		for (const premise of chain.premises) edges.push({ from: premise, to: chain.id });
		edges.push({ from: chain.id, to: chain.conclusion });
	}
	return { nodes: [...graph.nodes, ...impNodes], edges, logicalEdges, impLinks };
}

// ─── selection-facing chain views ────────────────────────────────────────────

/** One reasoning chain — a selection-facing VIEW: all edges into one
 *  conclusion. Singleton chains carry edge-less nodes. */
export interface ReasoningChain {
	id: string;
	premises: string[];
	conclusion: string;
}

/** The stored chains filtered to a selection: a chain rides along iff its
 *  conclusion AND every premise are selected; a node in no surviving chain
 *  is a singleton chain. Every stored chain keeps its OWN id. */
export function chainsForSelection(
	nodes: ReadonlyArray<Pick<{ id: string }, "id">>,
	chains: ReadonlyArray<{ id: string; premises: string[]; conclusion: string }>,
): ReasoningChain[] {
	const selected = new Set(nodes.map((n) => n.id));
	const chained = new Set<string>();
	const included: ReasoningChain[] = [];
	for (const chain of chains) {
		if (!selected.has(chain.conclusion)) continue;
		if (!chain.premises.every((premise) => selected.has(premise))) continue;
		included.push({ id: chain.id, premises: [...chain.premises].sort(), conclusion: chain.conclusion });
		chained.add(chain.conclusion);
		for (const premise of chain.premises) chained.add(premise);
	}
	for (const node of nodes) {
		if (!chained.has(node.id)) {
			included.push({ id: node.id, premises: [], conclusion: node.id });
		}
	}
	return included.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Strip a value's copy-syntax debris (quotes, leading colons) before
 *  membership matching — targets are membership values like correctAnswer. */
function stripDebris(value: string): string {
	let v = value.trim();
	if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
	if (v.startsWith(":")) v = v.slice(1);
	return v.trim();
}

/** Resolve ONE target string to a canonical proposition id: id first
 *  (exact), then name (case-insensitive, trimmed; ambiguous name resolves
 *  to the FIRST node in store order). Null when nothing matches. */
export function resolveTargetId(
	target: string,
	nodes: ReadonlyArray<Pick<GraphNode, "id" | "name">>,
): string | null {
	const t = stripDebris(target);
	if (t.length === 0) return null;
	if (nodes.some((n) => n.id === t)) return t;
	const lower = t.toLowerCase();
	for (const n of nodes) {
		if (stripDebris(n.name).toLowerCase() === lower) return n.id;
	}
	return null;
}

/** A chain as one world-facing line: "Premise one, Premise two →
 *  Conclusion"; a singleton shows its "(no premises)" marker. Unknown ids
 *  fall back to the raw id. Premises sort deterministically. */
export function formatChainLine(
	chain: Pick<ReasoningChain, "premises" | "conclusion">,
	propositions: Readonly<Record<string, { name: string }>>,
): string {
	const nameOf = (id: string) => propositions[id]?.name ?? id;
	const premises = [...chain.premises].sort().map(nameOf).join(", ");
	return premises !== ""
		? `${premises} → ${nameOf(chain.conclusion)}`
		: `${nameOf(chain.conclusion)} (no premises)`;
}

// ─── birth-session clustering ─────────────────────────────────────────────────

/** A proposition's cluster is the SESSION THAT CREATED IT: its first
 *  surviving provenance point's chatId. Null when no provenance. */
export function birthSessionOf(node: Pick<GraphNode, "provenance">): string | null {
	return node.provenance[0]?.chatId ?? null;
}

/** One birth-session cluster: the session id + sorted member node ids. */
export interface BirthSessionCluster {
	id: string;
	members: string[];
}

/** The birth-session partition over the given node LINES: dedupes by id
 *  (first line defines), groups by birth session, size-desc with members
 *  sorted (ties by session id ascending). */
export function birthSessionPartition(nodes: readonly GraphNode[]): BirthSessionCluster[] {
	const members = new Map<string, string[]>();
	const seen = new Set<string>();
	for (const node of nodes) {
		if (seen.has(node.id)) continue;
		seen.add(node.id);
		const birth = birthSessionOf(node);
		if (birth === null) continue;
		const bucket = members.get(birth);
		if (bucket) bucket.push(node.id);
		else members.set(birth, [node.id]);
	}
	return [...members.entries()]
		.map(([id, list]) => ({ id, members: [...list].sort() }))
		.sort((a, b) => b.members.length - a.members.length || (a.id < b.id ? -1 : 1));
}

/** The cluster key a derived implication node takes: MAJORITY among its
 *  PREMISES' birth sessions, ties to the chain's OWN birth. */
export function impClusterKey(
	chain: Pick<GraphChain, "premises" | "provenance">,
	birthOf: (nodeId: string) => string | null,
): string | null {
	const counts = new Map<string, number>();
	for (const premise of chain.premises) {
		const birth = birthOf(premise);
		if (birth !== null) counts.set(birth, (counts.get(birth) ?? 0) + 1);
	}
	const own = chain.provenance[0]?.chatId ?? null;
	if (counts.size === 0) return own;
	let max = 0;
	for (const n of counts.values()) if (n > max) max = n;
	const winners: string[] = [];
	for (const [key, n] of counts) if (n === max) winners.push(key);
	if (winners.length === 1) return winners[0]!;
	return own ?? winners.sort()[0]!;
}

/** Attach derived imp nodes to communities IN PLACE (only MULTI-premise
 *  fully-live chains mint imp nodes). */
export function attachImpToCommunities(
	communities: Array<{ id: string; members: string[] }>,
	propositions: ReadonlyArray<Pick<GraphNode, "id" | "provenance">>,
	chains: ReadonlyArray<Pick<GraphChain, "id" | "premises" | "conclusion" | "provenance">>,
): void {
	const birthById = new Map(propositions.map((node) => [node.id, birthSessionOf(node)]));
	const live = new Set(propositions.map((node) => node.id));
	for (const chain of chains) {
		if (chain.premises.length < 2) continue;
		if (!live.has(chain.conclusion) || !chain.premises.every((p) => live.has(p))) continue;
		const key = impClusterKey(chain, (id) => birthById.get(id) ?? null);
		const community = key === null ? undefined : communities.find((c) => c.id === key);
		if (!community) continue;
		community.members.push(chain.id);
	}
	for (const community of communities) community.members.sort();
}

/** The hull presentation rule: a region needs >= 3 propositions. */
export const MIN_CLUSTER_SIZE = 3;

// ─── deletion (the destructive operations — pure, deterministic) ──────────────

export interface NodeDeletionStats {
	/** Chain assertion LINES removed (every chain referencing the node). */
	chainsRemoved: number;
}

/**
 * FULL DEATH for one node, by id: the user pointing at the node IS the
 * intent — references from other sessions do NOT preserve it.
 *
 *   - every line of the node (create + link lines)
 *   - every CHAIN referencing it (as premise or conclusion)
 *   - its resting position (and every dead chain's)
 *
 * An ARGUMENT deletion is the same call with an arg_-prefixed id: exactly
 * that ONE stored argument dies and nothing else. Synchronous, one
 * rewriteLedgers call; idempotent (null when no such node/chain exists).
 */
export function deleteNodeTraces(store: GraphStorePort, nodeId: string): NodeDeletionStats | null {
	const chainLines = store.readChains();

	// The argument branch: an arg_ id names a CHAIN, not a proposition.
	if (nodeId.startsWith("arg_")) {
		const outChains = chainLines.filter((line) => line.id !== nodeId);
		if (outChains.length === chainLines.length) return null; // unknown argument
		store.rewriteLedgers({ chains: outChains });
		const positions = store.readPositions();
		if (positions[nodeId] !== undefined) {
			const { [nodeId]: _dead, ...rest } = positions;
			store.writePositions(rest);
		}
		return { chainsRemoved: chainLines.length - outChains.length };
	}

	const nodeLines = store.readNodes().filter((line) => line.id === nodeId);
	if (nodeLines.length === 0) return null;

	const outChains = chainLines.filter(
		(line) => line.conclusion !== nodeId && !line.premises.includes(nodeId),
	);

	const outNodes = store.readNodes().filter((line) => line.id !== nodeId);
	store.rewriteLedgers({
		nodes: outNodes,
		...(outChains.length !== chainLines.length ? { chains: outChains } : {}),
	});

	const deadChainIds = new Set(chainLines.filter((line) => !outChains.includes(line)).map((line) => line.id));
	const positions = store.readPositions();
	const prunedPositions = Object.fromEntries(
		Object.entries(positions).filter(([id]) => id !== nodeId && !deadChainIds.has(id)),
	);
	if (Object.keys(prunedPositions).length !== Object.keys(positions).length) {
		store.writePositions(prunedPositions);
	}
	return { chainsRemoved: chainLines.length - outChains.length };
}
