/**
 * FsGraphStore — ported from learnharness src/store/graph.ts (AGPL-3.0,
 * amosblomqvist/learnharness). The append-only JSONL ledgers plus the
 * sources/positions maps under one data root (production: a directory the
 * plugin composes under $DSH_HOME/deep-learning/; tests: a temp root).
 *
 *   graph/nodes.jsonl     GraphNode         — first line per id defines;
 *                                             later repeats are link-appends
 *   graph/chains.jsonl    GraphChain        — one line per assertion
 *   graph/sessions.jsonl  SessionCheckpoint — notes import checkpoints
 *   graph/coverage.jsonl  CoverageEntry     — per-message extraction coverage
 *   graph/sources.json    NotesSource map   — imported-notes bookkeeping
 *   graph/positions.json  Position map      — resting layout (rebuildable)
 *
 * CHAINS-PRIMARY: there is NO edges ledger — the edge view is derived on
 * every read and never persisted. Sync fs, strict shape guards: corrupt
 * lines are skipped, never guessed at. rewriteLedgers writes a temp file
 * beside the ledger, then renames over it (POSIX-atomic).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type {
	CoverageEntry,
	GraphChain,
	GraphNode,
	NotesSource,
	Position,
	SessionCheckpoint,
} from "../core/contracts/graph.js";

// ─── JSONL primitives ────────────────────────────────────────────────────────

function appendLine<T>(file: string, record: T): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf-8");
}

function readRawLines(file: string): unknown[] {
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf-8");
	} catch {
		return []; // no ledger yet — nothing has ever been emitted
	}
	const out: unknown[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			out.push(JSON.parse(trimmed));
		} catch {
			// Corrupt line: skip rather than fail the whole read — a torn
			// append must never take the graph down with it.
		}
	}
	return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

const isString = (v: unknown): v is string => typeof v === "string";

/** Strict shape guards — anything not matching the ledger shape is skipped. */
function readValid<T>(file: string, isValid: (v: unknown) => v is T): T[] {
	return readRawLines(file).filter(isValid);
}

const isProvenancePoint = (v: unknown): v is { chatId: string; messageId: string } =>
	isRecord(v) && isString(v.chatId) && isString(v.messageId);

const isGraphNode = (v: unknown): v is GraphNode =>
	isRecord(v) &&
	isString(v.id) &&
	isString(v.name) &&
	isString(v.statement) &&
	Array.isArray(v.aliases) &&
	v.aliases.every(isString) &&
	isString(v.createdAt) &&
	Array.isArray(v.provenance) &&
	v.provenance.every(isProvenancePoint);

/** A chain line: premises >= 1, every member a string, conclusion a string.
 *  Endpoint EXISTENCE is the derivation's concern; the store only shapes. */
const isGraphChain = (v: unknown): v is GraphChain =>
	isRecord(v) &&
	isString(v.id) &&
	Array.isArray(v.premises) &&
	v.premises.length > 0 &&
	v.premises.every(isString) &&
	isString(v.conclusion) &&
	Array.isArray(v.provenance) &&
	v.provenance.every(isProvenancePoint) &&
	isString(v.createdAt);

const isCheckpoint = (v: unknown): v is SessionCheckpoint =>
	isRecord(v) && isString(v.chatId) && isString(v.foldedAt);

const isCoverageEntry = (v: unknown): v is CoverageEntry =>
	isRecord(v) && isString(v.chatId) && isString(v.fp) && typeof v.tokens === "number" && isString(v.foldedAt);

const isPosition = (v: unknown): v is Position =>
	isRecord(v) && typeof v.x === "number" && typeof v.y === "number";

// ─── the store ───────────────────────────────────────────────────────────────

/** The graph-family store over one data root. All paths derive from
 *  `root`; nothing global. */
export class FsGraphStore {
	private readonly dir: string;
	private readonly files: {
		nodes: string;
		chains: string;
		sessions: string;
		coverage: string;
		sources: string;
		positions: string;
	};

	constructor(root: string) {
		this.dir = path.join(root, "graph");
		this.files = {
			nodes: path.join(this.dir, "nodes.jsonl"),
			chains: path.join(this.dir, "chains.jsonl"),
			sessions: path.join(this.dir, "sessions.jsonl"),
			coverage: path.join(this.dir, "coverage.jsonl"),
			sources: path.join(this.dir, "sources.json"),
			positions: path.join(this.dir, "positions.json"),
		};
	}

	// ── nodes ──

	appendNode(node: GraphNode): void {
		appendLine(this.files.nodes, node);
	}
	/** Raw node lines in append order (readers merge by id). */
	readNodes(): GraphNode[] {
		return readValid(this.files.nodes, isGraphNode);
	}

	// ── chains ──

	/** Append one chain ASSERTION; readers merge by (premises, conclusion). */
	appendChain(assertion: GraphChain): void {
		appendLine(this.files.chains, assertion);
	}
	readChains(): GraphChain[] {
		return readValid(this.files.chains, isGraphChain);
	}

	// ── checkpoints ──

	appendCheckpoint(checkpoint: SessionCheckpoint): void {
		appendLine(this.files.sessions, checkpoint);
	}
	readCheckpoints(): SessionCheckpoint[] {
		return readValid(this.files.sessions, isCheckpoint);
	}

	// ── coverage ──

	appendCoverage(entry: CoverageEntry): void {
		appendLine(this.files.coverage, entry);
	}
	readCoverage(): CoverageEntry[] {
		return readValid(this.files.coverage, isCoverageEntry);
	}

	// ── imported-notes bookkeeping (sources.json — a JSON map) ──

	private readSourceMap(): Record<string, NotesSource> {
		try {
			const raw = JSON.parse(fs.readFileSync(this.files.sources, "utf-8")) as unknown;
			if (!isRecord(raw)) return {};
			const out: Record<string, NotesSource> = {};
			for (const [id, value] of Object.entries(raw)) {
				if (isRecord(value) && isString(value.filePath) && isString(value.importedAt)) {
					out[id] = { id, filePath: value.filePath, importedAt: value.importedAt };
				}
			}
			return out;
		} catch {
			return {};
		}
	}

	private writeSourceMap(all: Record<string, NotesSource>): void {
		fs.mkdirSync(this.dir, { recursive: true });
		const tmp = `${this.files.sources}.tmp-${randomUUID().slice(0, 8)}`;
		try {
			fs.writeFileSync(tmp, JSON.stringify(all, null, "\t") + "\n", "utf-8");
			fs.renameSync(tmp, this.files.sources);
		} catch (err) {
			try {
				fs.unlinkSync(tmp);
			} catch {
				/* the rename either already happened or the tmp never existed */
			}
			throw err;
		}
	}

	/** Upsert: keeps the existing record's identity when re-importing. */
	upsertSource(source: NotesSource): void {
		const all = this.readSourceMap();
		all[source.id] = source;
		this.writeSourceMap(all);
	}
	readSources(): NotesSource[] {
		return Object.values(this.readSourceMap());
	}

	// ── the layout ledger (positions.json — a JSON map) ──

	readPositions(): Record<string, Position> {
		try {
			const raw = JSON.parse(fs.readFileSync(this.files.positions, "utf-8")) as unknown;
			if (!isRecord(raw)) return {};
			const out: Record<string, Position> = {};
			for (const [id, value] of Object.entries(raw)) {
				if (isPosition(value)) out[id] = { x: value.x, y: value.y };
			}
			return out;
		} catch {
			return {};
		}
	}

	writePositions(positions: Record<string, Position>): void {
		fs.mkdirSync(this.dir, { recursive: true });
		const tmp = `${this.files.positions}.tmp-${randomUUID().slice(0, 8)}`;
		try {
			fs.writeFileSync(tmp, JSON.stringify(positions, null, "\t") + "\n", "utf-8");
			fs.renameSync(tmp, this.files.positions);
		} catch (err) {
			try {
				fs.unlinkSync(tmp);
			} catch {
				/* same doctrine */
			}
			throw err;
		}
	}

	// ── the destructive seam ──

	/** Atomic full-content replacement per provided ledger — write a
	 *  uniquely-named temp file beside the ledger, then rename over it
	 *  (POSIX-atomic: a crash mid-write leaves the original ledger and an
	 *  orphan .tmp-*, never a torn ledger). */
	rewriteLedgers(next: {
		nodes?: GraphNode[];
		chains?: GraphChain[];
		coverage?: CoverageEntry[];
		checkpoints?: SessionCheckpoint[];
	}): void {
		const files = {
			nodes: this.files.nodes,
			chains: this.files.chains,
			coverage: this.files.coverage,
			checkpoints: this.files.sessions,
		} as const;
		for (const [key, records] of Object.entries(next) as [keyof typeof files, unknown[]][]) {
			const file = files[key];
			fs.mkdirSync(path.dirname(file), { recursive: true });
			const tmp = `${file}.tmp-${randomUUID().slice(0, 8)}`;
			try {
				// JSONL: one record per line, trailing newline — a reader
				// must see exactly what appendLine would have written.
				const body = records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
				fs.writeFileSync(tmp, body, "utf-8");
				fs.renameSync(tmp, file);
			} catch (err) {
				try {
					fs.unlinkSync(tmp);
				} catch {
					/* the rename either already happened or the tmp never existed */
				}
				throw err;
			}
		}
	}
}
