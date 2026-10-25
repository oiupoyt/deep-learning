/**
 * The extraction pipeline — ported from learnharness src/agent/subagents/
 * extraction.ts (AGPL-3.0, amosblomqvist/learnharness), the sole graph
 * writer:
 *
 *   extractor (LLM)  sees ONLY the teacher prose (labeled TEACHER [id]) —
 *                    plus THE GRAPH SO FAR digest when the source already
 *                    yielded material; fully trusted; submits propositions
 *                    (session propositions carry their passage's
 *                    messageId, validated against the current batch) +
 *                    REASONING CHAINS (mixed namespace: local ids OR
 *                    existing n_ ids, verbatim).
 *   auditor (LLM)    never sees the source; identity verdicts ONLY —
 *                    links to existing nodes (equivalence bias).
 *   merger (core)    deterministic ledger appends + the simplification
 *                    pass + coverage checkpoints.
 *
 * Serialized per source (each batch's extractor continues the digest);
 * failure checkpoints nothing — the next trigger re-runs. NO hardcoded
 * models: the caller resolves the extractor/auditor routes from the
 * settings pins.
 */

import { runSubmitAgent, type LlmLike } from "./roles.js";
import {
	getGraph,
	mergeFindings,
	type GraphStorePort,
} from "../core/graph.js";
import {
	coverageOf,
	batchRuns,
	messageViewLines,
	type CoverageMessage,
} from "../core/coverage.js";
import { settleGraphLayout } from "../core/layout-settle.js";
import { createHash } from "node:crypto";
import type { SessionFindings, AuditVerdicts, EmissionStats, NotesSource } from "../core/contracts/graph.js";

// ─── the wire schemas (JSON Schema — plain, for the submit tools) ────────────

const endpoint = (role: string) => ({
	type: "string",
	description: `The id this ${role} — EITHER an existing graph idea id from THE GRAPH SO FAR in the prompt, verbatim ("n_…"), OR the local id of a proposition in this submission ("p1", …).`,
});

const findingsSchema = {
	type: "object",
	properties: {
		propositions: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string", description: 'Local id: "p1", "p2", … — referenced by chains in this call.' },
					name: { type: "string" },
					statement: { type: "string" },
					aliases: { type: "array", items: { type: "string" } },
					messageId: { type: "string", description: "The message id of the ONE passage this proposition came from — copy it exactly from that passage's TEACHER [id] label." },
				},
				required: ["id", "name", "statement"],
				additionalProperties: false,
			},
			description: "Only the NEW core ideas this stretch contributes.",
		},
		chains: {
			type: "array",
			items: {
				type: "object",
				properties: {
					premises: { type: "array", items: endpoint("premise uses"), minItems: 1 },
					conclusion: endpoint("conclusion is"),
				},
				required: ["premises", "conclusion"],
				additionalProperties: false,
			},
			description: "Every argument this stretch makes; pass [] when none — never omit the field.",
		},
	},
	required: ["propositions", "chains"],
	additionalProperties: false,
} as const;

const notesFindingsSchema = {
	type: "object",
	properties: {
		propositions: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					statement: { type: "string" },
					aliases: { type: "array", items: { type: "string" } },
				},
				required: ["id", "name", "statement"],
				additionalProperties: false,
			},
		},
		chains: {
			type: "array",
			items: {
				type: "object",
				properties: {
					premises: { type: "array", items: endpoint("premise uses"), minItems: 1 },
					conclusion: endpoint("conclusion is"),
				},
				required: ["premises", "conclusion"],
				additionalProperties: false,
			},
			description: "Pass [] when none — never omit the field.",
		},
	},
	required: ["propositions", "chains"],
	additionalProperties: false,
} as const;

const auditSchema = {
	type: "object",
	properties: {
		links: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string", description: 'The proposition id from the findings ("p1", …).' },
					linkTo: { type: "string", description: "The id of the EXISTING graph node this proposition IS — your identity verdict. EQUIVALENCE BIAS: paraphrases of the same claim MERGE." },
				},
				required: ["id", "linkTo"],
				additionalProperties: false,
			},
			description: "Identity verdicts — which findings propositions ARE existing graph nodes. Pass [] when none — never omit the field.",
		},
	},
	required: ["links"],
	additionalProperties: false,
} as const;

// ─── the prompts (ported doctrine, verbatim law) ──────────────────────────────

export const EXTRACTION_CORE = `THE GOAL: uncover the source's CORE IDEAS and show how everything derives from the foundations. The
source teaches by arguing — ideas worked out from other ideas, down to a foundation the rest stands on.
Your deliverable is twofold: the core ideas themselves, and the chains of reasoning that derive them.
Each chain is premises that JOINTLY entail a conclusion. Entailment is the only link that earns a
chain — where the real connection is historical or narrative (who argued what, how a debate or
exposition unfolds), there is no chain; keep the pieces as bare ideas or drop them. The direction of
the graph is upward: foundational ideas at the bottom, derived ideas above them, each chain showing
how its conclusion follows from what is more established — do not submit connections that carry no
derivation.

The graph holds TRUE ideas about the world, nothing else — never anything about the learner, the
teacher, or this reading: not "the learner understands X" but X. A misconception enters as its TRUE
correction. Each statement is one self-contained idea at full precision.

Extract the load-bearing ideas of the subject — what a reference on it would teach — not the full run
of the discourse. An idea earns its place only when the source's arguments run through it — examples,
notation glosses, and restatements that no argument needs are not core ideas. Every idea must stand
alone for a reader who never saw this source: names and statements may not lean on the source's own
scaffolding (claim numbering, axiom tags, arc labels); a claim that only matters as part of how this
document is organized is not knowledge — drop it.

When the prompt carries THE GRAPH SO FAR, you are continuing a source already partly extracted: build
on it. Reference an existing idea by its id ("n_…") instead of restating it, and prefer chains that
lean on established conclusions as premises — derive new material from what is already derived. Do
not re-derive a conclusion the graph already holds unless the route is genuinely different.

SUBMIT with one submit_findings call: every NEW core idea with a short name and a precise statement,
and every chain as premises + conclusion. A chain's premises and conclusion may be ids from this
submission OR existing ids from THE GRAPH SO FAR, verbatim. Premises within one chain are used
TOGETHER — independent arguments for the same conclusion are separate chains. A conclusion may
reappear, by id, as a premise of later chains. A bare idea that no argument uses rides the
propositions list alone. Include every field even when empty — "chains": [] when the source makes no
arguments. The tool's field descriptions carry the details.`;

export const SESSION_PREAMBLE =
	"You are the extraction stage of a learning application. You read one stretch of a source — a teaching " +
	"session, rendered as the teacher's prose in reading order — and report what it teaches as findings " +
	"for the learner's global knowledge graph, building on everything already extracted from this source.";

export const NOTES_PREAMBLE =
	"You are the extraction stage of a learning application. You read one stretch of a source — the " +
	"author's personal notes, rendered in reading order — and report what it teaches as findings for the " +
	"learner's global knowledge graph, building on everything already extracted from this source.";

export const SESSION_MESSAGE_ID_RULE =
	"For each new proposition, copy the message ID of the passage that most directly states or explains it into messageId.";

export const EXTRACTOR_INSTRUCTIONS = `${SESSION_PREAMBLE}\n\n${EXTRACTION_CORE}\n\n${SESSION_MESSAGE_ID_RULE}`;
export const NOTES_EXTRACTOR_INSTRUCTIONS = `${NOTES_PREAMBLE}\n\n${EXTRACTION_CORE}`;

export const AUDITOR_INSTRUCTIONS = `You are the linking stage of a learning application's extraction pipeline. An extractor
has read a source (a teaching session, or the author's personal notes) and reported findings: propositions and
their reasoning chains. You NEVER see the source itself — the extractor is fully trusted, and you do not re-check
its work. Your job is IDENTITY: connecting those findings to the CURRENT knowledge graph, preparing the merge.

The graph is SMALL and FINITE. The prompt names the node count; when it is large enough to matter you also
receive the propositions' names. Your deliverable is ONLY the identity verdicts: "links" — for each finding
proposition, the id of an existing node it IS, when one exists.

IDENTITY — links, per proposition:
- For each proposition: does an EXISTING node already state this same proposition?
- If yes: add { "id": <its proposition id>, "linkTo": <that node's id> } to "links". The session's phrasings join
  its aliases and its provenance; the node keeps its existing name.
- If no: add nothing — a new node is created with the extractor's name as its label.
- EQUIVALENCE BIAS: paraphrases, rewordings, and compressions of the same claim MERGE. When two statements are
  the same claim at different precision or from different angles, LINK them. Only genuinely distinct
  propositions — different claims about the world — stay apart. You are NOT guarding against wrong merges; you
  are hunting for right ones.

Include the "links" field even when empty — "links": [] when nothing links. NEVER omit it because it is empty.`;

// ─── the source view ──────────────────────────────────────────────────────────

/** The extraction view: the session as TEACHER PROSE ONLY, passages
 *  labeled with their actual message ids. */
function proseView(messages: ReadonlyArray<CoverageMessage>): string {
	const lines: string[] = [];
	for (const message of messages) {
		lines.push(...messageViewLines(message, message.id));
	}
	return lines.join("\n\n");
}

/** The same-source digest (the extractor continues its own source):
 *  everything this source already yielded, ids verbatim. */
export function sourceDigest(store: GraphStorePort, sourceId: string): string {
	const graph = getGraph(store);
	const ours = graph.nodes.filter((n) => n.provenance.some((pt) => pt.chatId === sourceId));
	const ourChains = graph.chains.filter((c) => c.provenance.some((pt) => pt.chatId === sourceId));
	if (ours.length === 0 && ourChains.length === 0) return "";
	const lines: string[] = [];
	lines.push("THE GRAPH SO FAR — everything already extracted from this source (reference these ids verbatim):");
	for (const n of ours) lines.push(`  ${n.id} | ${n.name} | ${n.statement.replace(/\s+/g, " ")}`);
	if (ourChains.length > 0) {
		lines.push("DERIVATIONS ALREADY RECORDED (build on these; do not re-derive them):");
		for (const c of ourChains) {
			lines.push(`  [${c.premises.join(" + ")} ⇒ ${c.conclusion}]`);
		}
	}
	return lines.join("\n");
}

// ─── the submit seams ─────────────────────────────────────────────────────────

/** The chain laws (mixed namespace): endpoints resolve when submitted OR
 *  existing; premises >= 1; no self-referencing conclusion. */
function validateFindingsChains(value: Record<string, unknown>, existingIds: ReadonlySet<string>): string | null {
	const propositions = value.propositions as Array<{ id: string }>;
	const chains = value.chains as Array<{ premises: string[]; conclusion: string }>;
	const ids = new Set(propositions.map((p) => p.id));
	for (const chain of chains) {
		if (chain.premises.length === 0) {
			return "chains: premises must name at least one proposition — a proposition with no argument stays in the propositions list alone.";
		}
		const unknown = [...chain.premises, chain.conclusion].find((id) => !ids.has(id) && !existingIds.has(id));
		if (unknown !== undefined) {
			return `chains: "${unknown}" is neither a submitted proposition id nor an existing idea id from THE GRAPH SO FAR — every premise and conclusion must resolve.`;
		}
		if (chain.premises.includes(chain.conclusion)) {
			return "chains: a conclusion cannot be its own premise.";
		}
	}
	return null;
}

/** The session anchor law: every proposition names a passage of the batch. */
function validateSessionAnchors(value: Record<string, unknown>, batchIds: ReadonlySet<string>): string | null {
	const propositions = value.propositions as Array<{ id: string; messageId?: string }>;
	for (const p of propositions) {
		const messageId = (p.messageId ?? "").trim();
		if (messageId.length === 0) {
			return `propositions: "${p.id}" is missing its messageId — copy the message id from the brackets of the passage (TEACHER [id]) that most directly states or explains it.`;
		}
		if (!batchIds.has(messageId)) {
			return `propositions: "${p.id}" names messageId "${messageId}", which is not a passage of THIS stretch — copy the id from the brackets of one of this stretch's own TEACHER [id] passages.`;
		}
	}
	return null;
}

// ─── the pipeline ─────────────────────────────────────────────────────────────

export interface ExtractionModels {
	llm: LlmLike;
	/** Resolved routes (never hardcoded): */
	extractor: { provider: string; model: string };
	auditor: { provider: string; model: string };
}

/** Deterministic notes source id: "src_" + sha256 of the path. */
function notesSourceId(filePath: string): string {
	return `src_${createHash("sha256").update(filePath).digest("hex").slice(0, 24)}`;
}

export interface RunExtractionOptions extends ExtractionModels {
	sourceId: string;
	transcript: ReadonlyArray<CoverageMessage>;
	store: GraphStorePort;
	chunkTokens: number;
	signal?: AbortSignal;
}

/** Extract + audit + merge ONE chat's uncovered teacher prose. Serialized
 *  batches (each continues the digest); failure checkpoints nothing. */
export async function runExtraction(options: RunExtractionOptions): Promise<EmissionStats> {
	const { store, sourceId } = options;
	const covered = coverageOf(options.transcript, store.readCoverage(), sourceId);
	if (covered.uncovered.length === 0) return { nodes: 0, chains: 0 };
	const batches = batchRuns(covered.slots, covered.uncovered, options.chunkTokens);
	const totals: EmissionStats = { nodes: 0, chains: 0 };
	for (const batch of batches) {
		const messages = batch.map((slot) => slot.message);
		const view = proseView(messages);
		const batchIds = new Set(messages.filter((m) => messageViewLines(m, m.id).length > 0).map((m) => m.id));
		const digest = sourceDigest(store, sourceId);
		const prompt = digest === "" ? view : `${digest}\n\n${view}`;

		const existingIds = new Set(getGraph(store).nodes.map((n) => n.id));
		const findings = (await runSubmitAgent({
			llm: options.llm,
			provider: options.extractor.provider,
			model: options.extractor.model,
			systemPrompt: EXTRACTOR_INSTRUCTIONS,
			prompt,
			toolName: "submit_findings",
			toolDescription: "Submit the session findings.",
			schema: findingsSchema as unknown as Record<string, unknown>,
			fill: (raw) => ({
				...raw,
				propositions: (raw.propositions as Array<{ aliases?: string[] }>).map((p) => ({ aliases: [], ...p })),
			}),
			validate: (value) =>
				validateSessionAnchors(value, batchIds) ?? validateFindingsChains(value, existingIds),
			signal: options.signal,
		})) as unknown as SessionFindings;

		// The auditor sees propositions ONLY (identity, never the source).
		const audit = (await runSubmitAgent({
			llm: options.llm,
			provider: options.auditor.provider,
			model: options.auditor.model,
			systemPrompt: AUDITOR_INSTRUCTIONS,
			prompt:
				`Proposed findings from the extractor (the source itself is not available to you — the extractor is fully trusted; the propositions only — the reasoning chains are the merger's business):\n\n` +
				`${JSON.stringify(
					{
						propositions: findings.propositions.map((p) => ({
							id: p.id,
							name: p.name,
							statement: p.statement,
							aliases: p.aliases,
						})),
					},
					null,
					2,
				)}\n\n` +
				`The current knowledge graph has ${existingIds.size} node(s). Link what links.`,
			toolName: "submit_review",
			toolDescription: "Submit the identity verdicts ONLY (links) — never the propositions themselves.",
			schema: auditSchema as unknown as Record<string, unknown>,
			fill: (raw) => ({ links: raw.links ?? [] }),
			signal: options.signal,
		})) as unknown as AuditVerdicts;

		const stats = mergeFindings(sourceId, findings, audit, { store }, {
			foldedAt: new Date().toISOString(),
			coverage: batch
				.filter((slot) => messageViewLines(slot.message, slot.message.id).length > 0)
				.map((slot) => ({ chatId: sourceId, fp: slot.fp, tokens: slot.tokens, foldedAt: new Date().toISOString() })),
		});
		settleGraphLayout(store);
		totals.nodes += stats.nodes;
		totals.chains = (totals.chains ?? 0) + (stats.chains ?? 0);
		if (stats.droppedChains) totals.droppedChains = (totals.droppedChains ?? 0) + stats.droppedChains;
	}
	return totals;
}

export interface ImportNotesOptions extends ExtractionModels {
	filePath: string;
	text: string;
	store: GraphStorePort;
	chunkTokens: number;
	signal?: AbortSignal;
}

/** The notes front door: the same pipeline over raw notes, chunked under
 *  the same budget, serial per source (the digest law), whole-file
 *  checkpoint. */
export async function importNotes(options: ImportNotesOptions): Promise<EmissionStats> {
	const { store } = options;
	const sourceId = notesSourceId(options.filePath);

	// Chunk by line under the budget (greedy; a single over-budget line
	// rides alone).
	const chunks: string[] = [];
	if (options.text.trim().length > 0) {
		let current = "";
		for (const line of options.text.split("\n")) {
			const candidate = current.length === 0 ? line : current + "\n" + line;
			if (current.length > 0 && Math.ceil(candidate.length / 4) > options.chunkTokens) {
				chunks.push(current);
				current = line;
			} else {
				current = candidate;
			}
		}
		if (current.trim().length > 0) chunks.push(current);
	}

	const importedAt = new Date().toISOString();
	const totals: EmissionStats = { nodes: 0, chains: 0 };
	for (const chunk of chunks) {
		const digest = sourceDigest(store, sourceId);
		const view = `SOURCE (the author's personal notes): ${options.filePath}${chunks.length > 1 ? ` (part ${chunks.indexOf(chunk) + 1}/${chunks.length})` : ""}\n\n${chunk}`;
		const prompt = digest === "" ? view : `${digest}\n\n${view}`;
		const existingIds = new Set(getGraph(store).nodes.map((n) => n.id));
		const findings = (await runSubmitAgent({
			llm: options.llm,
			provider: options.extractor.provider,
			model: options.extractor.model,
			systemPrompt: NOTES_EXTRACTOR_INSTRUCTIONS,
			prompt,
			toolName: "submit_findings",
			toolDescription: "Submit the notes findings.",
			schema: notesFindingsSchema as unknown as Record<string, unknown>,
			fill: (raw) => ({
				...raw,
				propositions: (raw.propositions as Array<{ aliases?: string[] }>).map((p) => {
					const stripped = { ...p, aliases: p.aliases ?? [] } as typeof p & { messageId?: unknown };
					delete stripped.messageId; // notes provenance is the file itself
					return stripped;
				}),
			}),
			validate: (value) => validateFindingsChains(value, existingIds),
			signal: options.signal,
		})) as unknown as SessionFindings;

		const audit = (await runSubmitAgent({
			llm: options.llm,
			provider: options.auditor.provider,
			model: options.auditor.model,
			systemPrompt: AUDITOR_INSTRUCTIONS,
			prompt:
				`Proposed findings from the extractor (the source itself is not available to you — the extractor is fully trusted; the propositions only):\n\n` +
				`${JSON.stringify(
					{
						propositions: findings.propositions.map((p) => ({
							id: p.id,
							name: p.name,
							statement: p.statement,
							aliases: p.aliases,
						})),
					},
					null,
					2,
				)}\n\n` +
				`The current knowledge graph has ${existingIds.size} node(s). Link what links.`,
			toolName: "submit_review",
			toolDescription: "Submit the identity verdicts ONLY (links).",
			schema: auditSchema as unknown as Record<string, unknown>,
			fill: (raw) => ({ links: raw.links ?? [] }),
			signal: options.signal,
		})) as unknown as AuditVerdicts;

		const stats = mergeFindings(sourceId, findings, audit, { store }, { foldedAt: importedAt });
		settleGraphLayout(store);
		totals.nodes += stats.nodes;
		totals.chains = (totals.chains ?? 0) + (stats.chains ?? 0);
		if (stats.droppedChains) totals.droppedChains = (totals.droppedChains ?? 0) + stats.droppedChains;
	}

	// The source bookkeeping (idempotent per path).
	store.upsertSource({ id: sourceId, filePath: options.filePath, importedAt });
	return totals;
}
