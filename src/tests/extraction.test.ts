// Red step for the extraction pipeline: the extractor→auditor→merger
// orchestration over the role runner — ported from learnharness
// src/agent/subagents/extraction.ts (the pipeline, serialized per source).
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runExtraction, importNotes } from "../server/extraction.js";
import type { LlmLike } from "../server/roles.js";
import { newMemoryGraphStore } from "../core/graph.js";

/** Scripted role LLM: routes by the system prompt's identity marker. */
function pipelineLlm(script: { extractor?: string; auditor?: string }): LlmLike {
	return {
		stream(options) {
			const system = options.system ?? "";
			const isAuditor = system.includes("linking stage");
			const raw = isAuditor ? script.auditor : script.extractor;
			const args = raw ?? "{}";
			const self = this as unknown as { requests: unknown[] };
			if (!("requests" in self)) (self as unknown as { requests: unknown[] }).requests = [];
			return (async function* () {
				yield { type: "tool-call", id: "call_1", name: isAuditor ? "submit_review" : "submit_findings", arguments: args };
				yield { kind: "tool-calls" };
			})();
		},
	};
}

test("session extraction: extractor findings merge; coverage checkpoints the batch", async () => {
	const store = newMemoryGraphStore();
	const llm = pipelineLlm({
		extractor: JSON.stringify({
			propositions: [
				{ id: "p1", name: "Limit", statement: "A limit is the approached value.", aliases: [], messageId: "m1" },
			],
			chains: [],
		}),
		auditor: JSON.stringify({ links: [] }),
	});
	const transcript = [{ id: "m1", role: "assistant", content: [{ type: "text", text: "A limit is the approached value." }] }];
	const stats = await runExtraction({
		llm,
		extractor: { provider: "p", model: "m" },
		auditor: { provider: "p", model: "m" },
		sourceId: "chat_1",
		transcript,
		store,
		chunkTokens: 100,
	});
	assert.equal(stats.nodes, 1);
	// coverage checkpointed the batch: the message no longer re-opens
	const covered = store.readCoverage();
	assert.equal(covered.length, 1);
	assert.equal(covered[0]!.chatId, "chat_1");
	// re-running with the same transcript is a no-op (nothing uncovered)
	const again = await runExtraction({ llm, extractor: { provider: "p", model: "m" }, auditor: { provider: "p", model: "m" }, sourceId: "chat_1", transcript, store, chunkTokens: 100 });
	assert.equal(again.nodes, 0);
});

test("auditor links re-encounters to existing nodes (equivalence bias)", async () => {
	const store = newMemoryGraphStore();
	// First session creates the node.
	await runExtraction({
		llm: pipelineLlm({
			extractor: JSON.stringify({
				propositions: [{ id: "p1", name: "Entropy", statement: "Entropy grows.", aliases: [], messageId: "m1" }],
				chains: [],
			}),
			auditor: JSON.stringify({ links: [] }),
		}),
		extractor: { provider: "p", model: "m" },
		auditor: { provider: "p", model: "m" },
		sourceId: "chat_1",
		transcript: [{ id: "m1", role: "assistant", content: [{ type: "text", text: "Entropy grows." }] }],
		store,
		chunkTokens: 100,
	});
	// Second session's re-encounter links to it.
	const nodeId = store.readNodes()[0]!.id;
	const stats = await runExtraction({
		llm: pipelineLlm({
			extractor: JSON.stringify({
				propositions: [{ id: "q1", name: "Entropy again", statement: "Entropy increases.", aliases: [], messageId: "m9" }],
				chains: [],
			}),
			auditor: JSON.stringify({ links: [{ id: "q1", linkTo: nodeId }] }),
		}),
		extractor: { provider: "p", model: "m" },
		auditor: { provider: "p", model: "m" },
		sourceId: "chat_2",
		transcript: [{ id: "m9", role: "assistant", content: [{ type: "text", text: "Entropy increases." }] }],
		store,
		chunkTokens: 100,
	});
	assert.equal(stats.nodes, 0); // linked, not created
	// The read-merge carries both phrasings and both chats.
	const { getGraph } = await import("../core/graph.js");
	const merged = getGraph(store).nodes[0]!;
	assert.ok(merged.aliases.includes("Entropy increases."));
	assert.equal(merged.provenance.length, 2);
});

test("notes import: same pipeline, src_ identity, no message anchors", async () => {
	const store = newMemoryGraphStore();
	const stats = await importNotes({
		llm: pipelineLlm({
			extractor: JSON.stringify({
				propositions: [{ id: "p1", name: "Note idea", statement: "A note's idea.", aliases: [] }],
				chains: [], // a self-chain (premise==conclusion) is refused at the submit seam — never submitted
			}),
			auditor: JSON.stringify({ links: [] }),
		}),
		extractor: { provider: "p", model: "m" },
		auditor: { provider: "p", model: "m" },
		filePath: "/notes/a.md",
		text: "A note's idea.",
		store,
		chunkTokens: 100,
	});
	assert.equal(stats.nodes, 1);
	assert.equal(stats.chains, 0); // no argument submitted
	// the source bookkeeping exists
	const sources = store.readSources();
	assert.equal(sources.length, 1);
	assert.equal(sources[0]!.id.startsWith("src_"), true);
	// whole-file checkpoint
	assert.equal(store.readCheckpoints().length, 1);
});

test("a failing extractor stage checkpoints nothing (the next trigger re-runs)", async () => {
	const store = newMemoryGraphStore();
	// extractor never submits: exhausts
	const llm: LlmLike = {
		stream(options) {
			return (async function* () {
				if (!options.system?.includes("linking stage")) {
					yield { type: "text", text: "no submit" };
					yield { kind: "stop" };
				} else {
					yield { type: "tool-call", id: "c", name: "submit_review", arguments: "{}" };
					yield { kind: "tool-calls" };
				}
			})();
		},
	};
	const transcript = [{ id: "m1", role: "assistant", content: [{ type: "text", text: "Uncovered prose." }] }];
	await assert.rejects(
		runExtraction({ llm, extractor: { provider: "p", model: "m" }, auditor: { provider: "p", model: "m" }, sourceId: "chat_1", transcript, store, chunkTokens: 100 }),
		/never submitted/i,
	);
	assert.equal(store.readCoverage().length, 0); // honestly uncovered
});
