/**
 * deep-learning client entry — the browser half (dual-face plugin).
 *
 * Composition order (each later phase adds its own registrations; this
 * scaffold ships the surface only):
 *   1. The Learning main panel (graph canvas, chain table, notes import,
 *      new teach/practice drafts) — slots.inject("main", key:"deep-learning")
 *      plus the sidebar.panellist entry that opens it.
 *   2. Toolview cards for the teaching/practice tools (tool.call.toolview).
 *   3. The composer-dock question companion.
 *   4. The settings section (role model pins, prompt segment switches,
 *      quizzing mechanic, chunk budget).
 */

export const name = "deep-learning-client";

/** Dual-face plugins declare the services they consume on the client. */
export const inject = ["slots"];

/** Apply the client plugin over the browser cordis context. */
export function apply(_ctx: unknown): void {
	// Wired by the client build wave.
}

export default apply;
