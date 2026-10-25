/**
 * Regenerate the golden graph fixture: run REAL merges through the
 * production store adapters + merger into a fresh temp root, then copy
 * the resulting data dir to tests/fixtures/golden-graph/. Never
 * hand-edited — the whole point is pinning real output.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FsGraphStore } from "../src/store/graph.js";
import { mergeFindings } from "../src/core/graph.js";
import { settleGraphLayout } from "../src/core/layout-settle.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dl-golden-"));
const store = new FsGraphStore(root);

// Session 1: a calculus lesson's first batch.
mergeFindings(
	"chat_calculus",
	{
		propositions: [
			{ id: "p1", name: "Limit", statement: "A limit describes the value a function approaches.", aliases: [], messageId: "m1" },
			{ id: "p2", name: "Derivative", statement: "The derivative is the limit of the difference quotient.", aliases: ["slope"], messageId: "m2" },
			{ id: "p3", name: "Continuity", statement: "A function is continuous where its limit equals its value.", aliases: [], messageId: "m3" },
		],
		chains: [
			{ premises: ["p1"], conclusion: "p2" },
			{ premises: ["p1", "p3"], conclusion: "p2" },
		],
	},
	{ links: [] },
	{ store },
	{
		foldedAt: "2026-10-01T10:00:00.000Z",
		coverage: [
			{ chatId: "chat_calculus", fp: "fp1", tokens: 12, foldedAt: "2026-10-01T10:00:00.000Z" },
			{ chatId: "chat_calculus", fp: "fp2", tokens: 30, foldedAt: "2026-10-01T10:00:00.000Z" },
		],
	},
);

// Session 2: re-encounters the limit (auditor links it) and adds a chain.
const first = store.readNodes();
const limitNode = first.find((n) => n.name === "Limit")!;
mergeFindings(
	"chat_physics",
	{
		propositions: [
			{ id: "q1", name: "Velocity", statement: "Instantaneous velocity is the derivative of position.", aliases: [], messageId: "m9" },
		],
		chains: [{ premises: [limitNode.id], conclusion: "q1" }],
	},
	{ links: [] },
	{ store },
	{ foldedAt: "2026-10-02T11:00:00.000Z" },
);

// A notes import: its own source id + a redundant chain the
// simplification pass will drop ([p1,p3]=>p2 restated).
mergeFindings(
	"src_notes",
	{
		propositions: [
			{ id: "r1", name: "Integral", statement: "The integral is the limit of Riemann sums.", aliases: ["area under curve"] },
		],
		chains: [{ premises: ["p1", "r1"], conclusion: "p1" }], // premise==conclusion member p1 dropped -> no chain
	},
	{ links: [] },
	{ store },
	{ foldedAt: "2026-10-03T12:00:00.000Z" },
);
store.upsertSource({ id: "src_notes", filePath: "/notes/calculus-basics.md", importedAt: "2026-10-03T12:00:00.000Z" });

// Layout settle over the merged graph.
settleGraphLayout(store);

// Copy to the fixture dir.
const dest = path.resolve(import.meta.dirname, "../tests/fixtures/golden-data/graph");
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(path.join(root, "graph"), dest, { recursive: true });
console.log(`Golden graph fixture regenerated at ${dest}`);
