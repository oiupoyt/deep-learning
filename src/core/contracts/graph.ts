/**
 * Knowledge-graph contracts — ported from learnharness
 * src/core/contracts/graph.ts (AGPL-3.0, amosblomqvist/learnharness).
 *
 * Chains-primary (the ported law): the stored truth is propositions
 * (nodes.jsonl) + reasoning chains (chains.jsonl); the canvas renders a
 * LOSSY DERIVED IMAGE. Edges are never stored.
 */

// ─── the stored shapes ───────────────────────────────────────────────────────

/** One relation of the DERIVED view — rebuilt from chains, never stored. */
export interface GraphEdge {
	from: string;
	to: string;
}

/** One stored REASONING CHAIN — an argument: premises that JOINTLY entail
 *  the conclusion. Independent arguments for the same conclusion are
 *  separate chains; a chain referencing a dead node dies with it. */
export interface GraphChain {
	/** "arg_" + random (store-assigned). */
	id: string;
	/** Node ids of the argument's premises — at least one, jointly
	 *  sufficient. Extractor-local at the wire; node ids after resolution. */
	premises: string[];
	/** The node id the premises jointly imply. */
	conclusion: string;
	/** Every (chat, message) point where this argument was asserted —
	 *  unioned across assertion lines at read time. */
	provenance: ProvenancePoint[];
	createdAt: string;
}

/** What one extraction run merged into the graph ledgers. */
export interface EmissionStats {
	/** New graph nodes appended. */
	nodes: number;
	/** New reasoning chains appended. */
	chains?: number;
	/** Chains the simplification pass removed in this merge. */
	droppedChains?: number;
}

/** One provenance point — message-granular. */
export interface ProvenancePoint {
	/** The chat this point anchors to — or a notes source id ("src_…"). */
	chatId: string;
	messageId: string;
}

/** One imported notes file — the front door's bookkeeping. Ids are
 *  "src_" + hash of the file path (deterministic). */
export interface NotesSource {
	id: string;
	filePath: string;
	/** ISO — when this file was imported. */
	importedAt: string;
}

/** One stored proposition node. */
export interface GraphNode {
	/** Opaque stable id, store-assigned: "n_" + random. */
	id: string;
	/** A very short label — a compact handle like a glossary headword.
	 *  Presentational only — the statement carries the precision. */
	name: string;
	/** The minimal proposition — one true, self-contained statement, at
	 *  full precision. The IDENTITY ANCHOR. */
	statement: string;
	/** Verbatim phrasings sessions used for this proposition. */
	aliases: string[];
	createdAt: string;
	/** Every (chat, message) point where this proposition came up. */
	provenance: ProvenancePoint[];
}

/** sessions.jsonl line — the emission checkpoint for one chat. */
export interface SessionCheckpoint {
	chatId: string;
	foldedAt: string;
}

/** coverage.jsonl line — ONE MESSAGE of one chat has been extracted, by
 *  content fingerprint over exactly what the extraction view sees. */
export interface CoverageEntry {
	chatId: string;
	/** sha256 of the message's view lines. */
	fp: string;
	/** chars/4 estimate of the message's view. */
	tokens: number;
	/** ISO — when this message's last extraction run merged. */
	foldedAt: string;
}

// ─── extraction findings (extractor output → audit → merger input) ───────────

/** One proposed proposition — a node candidate (or a re-encounter). */
export interface ExtractedProposition {
	/** Extractor-local id ("p1", …) referenced by chains. */
	id: string;
	name: string;
	statement: string;
	/** Verbatim phrasings the session used. */
	aliases: string[];
	/** SESSION PATH ONLY: the message id of the ONE teacher passage this
	 *  proposition came from — validated against the current batch. */
	messageId?: string;
}

/** One proposed argument. Endpoints are extractor-local proposition ids
 *  OR existing graph node ids (digest-aware, mixed namespace). */
export interface ExtractedChain {
	premises: string[];
	conclusion: string;
}

/** The extractor's output shape. */
export interface SessionFindings {
	propositions: ExtractedProposition[];
	chains: ExtractedChain[];
}

/** One identity verdict: the extractor's local proposition id → the
 *  EXISTING graph node that proposition IS. EQUIVALENCE BIAS: paraphrases,
 *  rewordings, and compressions of the same claim MERGE. */
export interface IdentityLink {
	id: string;
	linkTo: string;
}

/** The auditor's output — VERDICTS ONLY: links are its entire deliverable. */
export interface AuditVerdicts {
	links: IdentityLink[];
}

// ─── the snapshot payload ────────────────────────────────────────────────────

/** One rendered cluster in the snapshot payload. */
export interface Cluster {
	id: string;
	/** null when the naming record is gone — honest, never guessed. */
	label: string | null;
	members: string[];
}

/** A node's resting position in layout space. */
export interface Position {
	x: number;
	y: number;
}

/** The read payload — everything the Learning panel needs. */
export interface GraphSnapshot {
	/** Proposition nodes + the DERIVED implication nodes. */
	nodes: GraphNode[];
	/** The STORED proposition nodes alone (the stored truth). */
	propositions: GraphNode[];
	/** DERIVED untyped arrows: premise → imp → conclusion. */
	edges: GraphEdge[];
	/** DERIVED LOGICAL arrows: chains contracted to premise → conclusion. */
	logicalEdges: GraphEdge[];
	/** DERIVED imp linkage (one per MULTI-premise live chain). */
	impLinks: Array<{ id: string; premises: string[]; conclusion: string }>;
	/** The STORED reasoning chains (merged at read). */
	chains: GraphChain[];
	/** chatId → title, for every chat that touched the graph. */
	sessions: Record<string, string>;
	/** srcId → file path, for every imported notes file. */
	fileSources: Record<string, string>;
	/** nodeId → chatIds that touched the node. */
	nodeSessions: Record<string, string[]>;
	/** Birth-session communities (propositions only, >= MIN_CLUSTER_SIZE). */
	clusters: Cluster[];
	/** Resting layout positions, when the settle has ever run. */
	positions?: Record<string, Position>;
}

/** The graph-family format version (the format.json sidecar). */
export const CURRENT_GRAPH_FORMAT_VERSION = 1;
