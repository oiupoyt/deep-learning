/** Stable Cordis plugin name. */
export const name = "deep-learning";
/** Services the plugin waits for (optional ones resolved at call time). */
export const inject = ["llm", "systemPrompt", "tools", "webServer"];
/**
 * Apply the plugin over the harness context. The composition root: wires the
 * prompt composition, the teaching tools, the stores, the pipelines, and the
 * HTTP routes the client bundle consumes.
 */
export function apply(_ctx, _config) {
    // Wired incrementally by the build waves; the scaffold ships the surface.
}
export default apply;
//# sourceMappingURL=index.js.map