/**
 * deep-learning — LearnHarness teaching, practice, and knowledge graph as a
 * native DeepSeek Harness plugin (AGPL-3.0, ported from
 * amosblomqvist/learnharness; see NOTICE).
 *
 * The server entry: one Cordis plugin applying over the harness composition.
 * The bundle patch registers the row; this module owns everything else.
 */
import type { Context } from "@deepseek-ai/cordis";

/** Stable Cordis plugin name. */
export const name = "deep-learning";

/** Services the plugin waits for (optional ones resolved at call time). */
export const inject = ["llm", "systemPrompt", "tools", "webServer"];

/** Plugin configuration (validated by schemastery at load; none yet). */
export interface Config {}

/**
 * Apply the plugin over the harness context. The composition root: wires the
 * prompt composition, the teaching tools, the stores, the pipelines, and the
 * HTTP routes the client bundle consumes.
 */
export function apply(_ctx: Context, _config: Config): void {
	// Wired incrementally by the build waves; the scaffold ships the surface.
}

export default apply;
