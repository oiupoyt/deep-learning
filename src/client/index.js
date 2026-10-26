/**
 * deep-learning client entry — the browser half (dual-face plugin).
 *
 * Registrations are SYNCHRONOUS (the plugin lifecycle contract: apply()
 * must register its effects before returning; async imports would land
 * after the host snapshotted its slots):
 *   1. The Learning main panel — slots.inject("main", key:"deep-learning")
 *      + the sidebar.panellist entry ("Learn Mode") that opens it.
 *   2. Toolview cards for the teaching/practice tools
 *      + the question answer UI that posts to /api/deep-learning.
 *   3. The composer-dock question companion.
 *   4. The settings section "Deep Learning".
 */
import { LearningPanel } from "./panel.js";
import { registerQuestionCards } from "./question-cards.js";
import { registerSettingsSection } from "./settings-section.js";
import { ensureStyle } from "./styles.js";
export const name = "deep-learning-client";
/** Dual-face plugins declare the services they consume on the client. */
export const inject = ["slots"];
/** The API root the panel talks to (the plugin's /api prefix). */
const API = "/api/deep-learning";
/** Apply the client plugin over the browser cordis context. */
export function apply(ctx) {
    // The client-runner contract: services arrive via ctx.get(name) (the
    // property-access guard withholds undeclared seats; every working
    // plugin — all-usage, dshmarket, plugin-manager — resolves slots
    // through get()).
    const c = ctx;
    // eslint-disable-next-line no-console -- activation trace
    console.log("[dl] apply called; fiber.inject:", Object.keys(c.fiber?.inject ?? {}), "get:", typeof c.get);
    // Diagnostic beacon: report activation to the plugin's server route.
    try {
        fetch("/api/deep-learning/diag", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ at: Date.now(), kind: "apply", injectKeys: Object.keys(c.fiber?.inject ?? {}), hasGet: typeof c.get }),
        }).catch(() => { });
    }
    catch {
        /* beacon is best-effort */
    }
    ensureStyle();
    // Try BOTH access forms (property per the browser-cordis guard, get()
    // per the runner docs) — whichever the platform provides.
    const slots = (c.get?.("slots") ?? c.slots);
    // eslint-disable-next-line no-console -- activation trace
    console.log("[dl] slots resolved:", typeof slots, "inject:", typeof slots?.inject);
    try {
        fetch("/api/deep-learning/diag", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ at: Date.now(), kind: "slots", slotsType: typeof slots, injectType: typeof slots?.inject }),
        }).catch(() => { });
    }
    catch {
        /* beacon is best-effort */
    }
    if (!slots)
        return;
    try {
        slots.inject("main", function* () {
            void fetch("/api/deep-learning/diag", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ at: Date.now(), kind: "main-callback" }),
            }).catch(() => { });
            yield slots.register({
                name: "main",
                key: "deep-learning",
                inject: () => ({ apiRoot: API }),
            }, LearningPanel);
            void fetch("/api/deep-learning/diag", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ at: Date.now(), kind: "main-registered" }),
            }).catch(() => { });
        });
        slots.inject("sidebar.panellist", () => {
            // Diagnostic: did the parent ever invoke this registration callback?
            void fetch("/api/deep-learning/diag", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ at: Date.now(), kind: "panellist-callback" }),
            }).catch(() => { });
            const dispose = slots.register({
                name: "sidebar.panellist",
                id: "deep-learning",
                order: 30,
                label: () => "Learn Mode",
            }, PanelIcon);
            void fetch("/api/deep-learning/diag", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ at: Date.now(), kind: "panellist-registered" }),
            }).catch(() => { });
            return dispose;
        });
        registerQuestionCards(slots, API);
        registerSettingsSection(slots, API);
    }
    catch (err) {
        // eslint-disable-next-line no-console -- activation trace
        console.error("[dl] registration FAILED:", err);
        try {
            fetch("/api/deep-learning/diag", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ at: Date.now(), kind: "error", message: err instanceof Error ? err.message : String(err) }),
            }).catch(() => { });
        }
        catch {
            /* beacon is best-effort */
        }
    }
}
// No `export default`: the browser loader resolve prefers `exports.default`,
// and the bare `apply` function carries no inject. Named exports only.
/** The sidebar's panel icon: a quiet muted glyph (no icon library). */
function PanelIcon(_props) {
    return { className: "dl-panel-icon", children: "\u25C6" };
}
