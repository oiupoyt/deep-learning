/**
 * Prompt composition — ported from learnharness src/store/prompt-overrides.ts
 * + teacher-agent.ts's composeInstructions (AGPL-3.0,
 * amosblomqvist/learnharness).
 *
 * System prompts are COMPOSED per agent kind:
 *   1. `system-prompt.md` — the SHARED base (agent, voice, philosophy,
 *      accuracy).
 *   2. Every numeric-prefix `*.md` fragment in the agent's directory
 *      (`prompts/<kind>/`), in sorted filename order.
 *   3. The `shared/` fragments as a trailing appendix.
 *   Joined with `---` separators. ONLY numeric-prefix files load — other
 *   files (README, docs) never enter the model's prompt.
 *
 * Overrides: a segment whose switch is ON and whose override file exists
 * composes the override text instead of the source. The segment list is
 * ALWAYS derived from source at runtime — code updates adapt; an override
 * keyed to a vanished segment stops composing but stays on disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The agent kinds (the practice composition includes ONLY its own
 *  directory + base — its tools differ). */
export type AgentKind = "prober" | "teacher" | "practice";

/** The numeric-prefix convention a fragment file must match. */
const FRAGMENT_RE = /^\d+-.*\.md$/;

/** One composable segment of a system prompt. */
export interface PromptSegment {
	/** Stable path relative to the prompts root ("teacher/10-plan.md"). */
	path: string;
	/** The source text (the shipped fragment). */
	sourceText: string;
	/** The override text, when an override file exists. */
	overrideText?: string;
	/** The settings switch (absent key = off). */
	enabled?: boolean;
}

function readText(file: string): string {
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return "";
	}
}

function fragmentPaths(dir: string): string[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter((e) => e.isFile() && FRAGMENT_RE.test(e.name))
		.map((e) => e.name)
		.sort();
}

/**
 * List one agent kind's composable segments in composition order (base
 * excluded — it has no override seam; the base is the shared identity).
 */
export function listSourceSegments(
	promptsRoot: string,
	kind: AgentKind,
	overrideRoot?: string,
): PromptSegment[] {
	const segments: PromptSegment[] = [];
	const own = path.join(promptsRoot, kind);
	const shared = path.join(promptsRoot, "shared");
	const overrideOf = (rel: string): string | undefined => {
		if (!overrideRoot) return undefined;
		const file = path.join(overrideRoot, rel);
		return fs.existsSync(file) ? readText(file) : undefined;
	};
	for (const name of fragmentPaths(own)) {
		const rel = `${kind}/${name}`;
		segments.push({
			path: rel,
			sourceText: readText(path.join(own, name)),
			overrideText: overrideOf(rel),
		});
	}
	// Practice composes ONLY its own directory (its toolset differs from
	// the teaching pair's; the shared fragments assume teaching tools).
	if (kind !== "practice") {
		for (const name of fragmentPaths(shared)) {
			const rel = `shared/${name}`;
			segments.push({
				path: rel,
				sourceText: readText(path.join(shared, name)),
				overrideText: overrideOf(rel),
			});
		}
	}
	return segments;
}

/**
 * Compose the system prompt for one agent kind:
 *   base (system-prompt.md) + fragments (sorted, --- joined), honoring
 *   enabled overrides (switch on + file exists ⇒ override text).
 */
export function composeInstructions(
	promptsRoot: string,
	kind: AgentKind,
	options?: {
		/** The override root (mirrors the prompts layout). */
		overrideRoot?: string;
		/** The settings record's agent.prompts map (absent key = off). */
		switches?: Record<string, boolean>;
	},
): string {
	const base = readText(path.join(promptsRoot, "system-prompt.md"));
	const segments = listSourceSegments(promptsRoot, kind, options?.overrideRoot);
	const switches = options?.switches ?? {};
	const parts = [base.trim()];
	for (const segment of segments) {
		const useOverride = segment.enabled !== false && switches[segment.path] === true && segment.overrideText !== undefined;
		const text = (useOverride ? segment.overrideText! : segment.sourceText).trim();
		if (text.length > 0) parts.push(text);
	}
	return parts.filter(Boolean).join("\n\n---\n\n");
}
