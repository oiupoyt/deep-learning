/**
 * FsSessionsStore + FsSettingsStore — the plugin-owned plain-file records,
 * ported from learnharness's per-chat persistence (src/store/chats.ts's
 * tree/probe handling + src/store/settings.ts), reshaped for the DSH port:
 * the DSH session log already owns transcripts and usage; the plugin owns
 * the PROBE ASSESSMENT, the PLAN TREE, the SETTINGS delta, and the prompt
 * override files.
 *
 * Layout under one data root (production: $DSH_HOME/deep-learning/):
 *
 *   settings.json                 the UserSettings delta record
 *   prompts/<agent>/<file>.md     per-segment prompt overrides
 *   sessions/<sessionId>/
 *     probe.json                  the concluded probe assessment
 *     tree.json                   the session's plan tree
 *
 * All read-modify-write JSON with the atomic tmp+rename discipline from
 * the graph store; absent files read as null/empty — never an error.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { PlanTree } from "../core/contracts/plan.js";
import type { ProbeAssessment } from "../core/contracts/probe.js";
import type { UserSettings } from "../core/settings.js";

/** Atomic write: tmp + rename (POSIX-atomic; a crash mid-write leaves an
 *  orphan .tmp-*, never a torn file). */
function writeJsonAtomic(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${randomUUID().slice(0, 8)}`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(value, null, "\t") + "\n", "utf-8");
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

function readJson(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
	} catch {
		return undefined;
	}
}

// ─── the per-session records ──────────────────────────────────────────────────

/** The plugin-owned session records over one data root. */
export class FsSessionsStore {
	private readonly sessionsDir: string;

	constructor(root: string) {
		this.sessionsDir = path.join(root, "sessions");
	}

	private probeFile(sessionId: string): string {
		return path.join(this.sessionsDir, sessionId, "probe.json");
	}

	private treeFile(sessionId: string): string {
		return path.join(this.sessionsDir, sessionId, "tree.json");
	}

	/** The concluded probe assessment; null before the probe concludes. */
	readProbe(sessionId: string): ProbeAssessment | null {
		const raw = readJson(this.probeFile(sessionId));
		if (typeof raw !== "object" || raw === null) return null;
		const assessment = raw as ProbeAssessment;
		if (!Array.isArray(assessment.strands)) return null;
		return assessment;
	}

	saveProbe(sessionId: string, assessment: ProbeAssessment): void {
		writeJsonAtomic(this.probeFile(sessionId), assessment);
	}

	/** The session's plan tree (structure only; progress derives). */
	readTree(sessionId: string): PlanTree | null {
		const raw = readJson(this.treeFile(sessionId));
		if (typeof raw !== "object" || raw === null) return null;
		const tree = raw as PlanTree;
		if (!Array.isArray(tree.nodes) || !Array.isArray(tree.edges)) return null;
		return tree;
	}

	saveTree(sessionId: string, tree: PlanTree): void {
		writeJsonAtomic(this.treeFile(sessionId), tree);
	}

	/** Remove every record of one session. Returns whether anything was
	 *  removed (idempotent). The DSH session log's lifecycle is the
	 *  caller's choreography; this owns the plugin's records. */
	deleteSession(sessionId: string): boolean {
		const dir = path.join(this.sessionsDir, sessionId);
		if (!fs.existsSync(dir)) return false;
		fs.rmSync(dir, { recursive: true, force: true });
		return true;
	}
}

// ─── the settings delta record ────────────────────────────────────────────────

/** The settings.json delta record — explicit user choices only; absent
 *  keys resolve to factory defaults at read (core/settings.ts). */
export class FsSettingsStore {
	private readonly file: string;

	constructor(root: string) {
		this.file = path.join(root, "settings.json");
	}

	/** The stored delta record, or null when nothing was ever written. */
	read(): UserSettings | null {
		const raw = readJson(this.file);
		if (typeof raw !== "object" || raw === null) return null;
		return raw as UserSettings;
	}

	/** Shallow-merge per top-level section into the stored record and
	 *  atomically replace it. A section object merges key-by-key; other
	 *  top-level values replace. */
	update(patch: UserSettings): void {
		const current = this.read() ?? {};
		const next: UserSettings = { ...current };
		for (const [key, value] of Object.entries(patch) as [keyof UserSettings, unknown][]) {
			if (
				typeof value === "object" &&
				value !== null &&
				!Array.isArray(value) &&
				typeof next[key] === "object" &&
				next[key] !== null
			) {
				next[key] = { ...(next[key] as object), ...(value as object) } as never;
			} else {
				(next as Record<string, unknown>)[key as string] = value;
			}
		}
		writeJsonAtomic(this.file, next);
	}

	/** Wholesale replace (the settings UI's "reset" action). */
	replace(record: UserSettings): void {
		writeJsonAtomic(this.file, record);
	}
}
