/**
 * deep-learning client entry — the browser half (dual-face plugin).
 *
 * Registrations (KAT Square Minimalist throughout — see DESIGN.md):
 *   1. The Learning main panel — slots.inject("main", key:"deep-learning")
 *      + the sidebar.panellist entry that opens it: the knowledge graph
 *      canvas, the chain table, notes import, new teach/practice drafts.
 *   2. Toolview cards for the teaching/practice tools (tool.call.toolview)
 *      + the question answer UI that posts to /api/deep-learning.
 *   3. The composer-dock question companion (conversation.composer.dock).
 *   4. The settings section "Deep Learning" (role model pins, prompt
 *      segment switches, quizzing mechanic, chunk budget).
 */
export const name = "deep-learning-client";
/** Dual-face plugins declare the services they consume on the client. */
export const inject = ["slots"];
/** The API root the panel talks to (the plugin's webServer prefix). */
const API = "/api/deep-learning";
/** Apply the client plugin over the browser cordis context. */
export function apply(ctx) {
    const slots = ctx.slots;
    if (!slots)
        return;
    void import("./panel.js").then(({ LearningPanel }) => {
        slots.inject("main", function* () {
            yield slots.register({
                name: "main",
                key: "deep-learning",
                locale: "deepLearning",
                inject: () => ({ apiRoot: API }),
            }, LearningPanel);
        });
        slots.inject("sidebar.panellist", () => slots.register({
            name: "sidebar.panellist",
            id: "deep-learning",
            order: 30,
            label: () => "Learn Mode",
            locale: "deepLearning",
        }, PanelIcon));
    });
    void import("./question-cards.js").then(({ registerQuestionCards }) => {
        registerQuestionCards(slots, API);
    });
    void import("./settings-section.js").then(({ registerSettingsSection }) => {
        registerSettingsSection(slots, API);
    });
}
/** The sidebar's panel icon: a square minimal glyph (no icon library). */
function PanelIcon(_props) {
    return { className: "dl-panel-icon", children: "◆" };
}
