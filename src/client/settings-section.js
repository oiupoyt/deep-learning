/**
 * The settings section — "Deep Learning" in the harness settings.
 *
 * Two model groups (the LearnHarness role law, kept):
 *   - Model slots (strong / cheap / vision): the default tiers roles
 *     fall back to.
 *   - OPTIONAL OVERRIDES (researcher / demo builder / visual maker /
 *     pdf reader / extractor / auditor): a specific model for one role;
 *     unset falls back to its slot.
 *
 * Every pin is a provider + model DROPDOWN pair fed by the harness's
 * live catalog (GET /api/deep-learning/models). BYOK law: nothing is
 * hardcoded; absent pins read as unset. Renders with dl-root so the
 * LH token skin applies (also hoisted at :root for standalone mounts).
 */
import * as React from "react";
import { ensureStyle } from "./styles.js";
const SLOTS = [
    { key: "strong", label: "strong slot" },
    { key: "cheap", label: "cheap slot" },
    { key: "vision", label: "vision slot" },
];
const OVERRIDES = [
    { key: "researcher", label: "researcher override" },
    { key: "demoBuilder", label: "demo builder override" },
    { key: "visualMaker", label: "visual maker override" },
    { key: "pdfReader", label: "pdf reader override" },
    { key: "extractor", label: "extractor override" },
    { key: "auditor", label: "auditor override" },
];
export function registerSettingsSection(slots, api) {
    ensureStyle();
    slots.inject("settings.section", () => slots.register({
        name: "settings.section",
        id: "deep-learning",
        order: 45,
        label: () => "Deep Learning",
        icon: "book",
    }, SettingsSection));
}
function SettingsSection(props) {
    const api = props.apiRoot ?? "/api/deep-learning";
    const [record, setRecord] = React.useState(null);
    const [catalog, setCatalog] = React.useState(null);
    const [status, setStatus] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    React.useEffect(() => {
        fetch(`${api}/settings`)
            .then((r) => r.json())
            .then((data) => setRecord(data.settings))
            .catch(() => setStatus("settings unavailable"));
        fetch(`${api}/models`)
            .then((r) => r.json())
            .then((data) => setCatalog(data))
            .catch(() => setCatalog(null));
    }, [api]);
    const save = React.useCallback(async (next) => {
        setBusy(true);
        setStatus("saving…");
        try {
            const r = await fetch(`${api}/settings`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(next),
            });
            const data = (await r.json());
            setBusy(false);
            setStatus(data.ok === true ? "saved" : "save failed");
        }
        catch {
            setBusy(false);
            setStatus("save failed");
        }
    }, [api]);
    const models = record?.models ?? {};
    const agentTools = record?.agent?.tools ?? {};
    const prompts = record?.agent?.prompts ?? {};
    const graph = record?.graph ?? {};
    const groups = catalog?.groups ?? [];
    /** One functional update over the live state (never a stale snapshot). */
    const updateModels = (key, patch) => {
        setRecord((prev) => {
            const base = prev ?? {};
            const prevModels = base.models ?? {};
            return {
                ...base,
                models: {
                    ...prevModels,
                    [key]: {
                        provider: patch.provider !== undefined ? patch.provider : prevModels[key]?.provider ?? "",
                        id: patch.id !== undefined ? patch.id : prevModels[key]?.id ?? "",
                    },
                },
            };
        });
    };
    /** One pin row: label + provider dropdown + model dropdown. */
    const pinRow = (pin) => {
        const pinnedProvider = models[pin.key]?.provider ?? "";
        const pinnedModel = models[pin.key]?.id ?? "";
        const providerGroup = groups.find((g) => g.id === pinnedProvider);
        const modelChoices = providerGroup?.models ?? [];
        return React.createElement("div", { key: pin.key, className: "dl-pin-row" }, React.createElement("span", { className: "dl-pin-label" }, pin.label), React.createElement("select", {
            className: "dl-select",
            value: pinnedProvider,
            onChange: (e) => 
            // Provider changes AND the model pin resets — one update.
            updateModels(pin.key, { provider: e.target.value, id: "" }),
        }, React.createElement("option", { value: "" }, "(unset)"), groups.map((g) => React.createElement("option", { key: g.id, value: g.id }, g.name))), React.createElement("select", {
            className: "dl-select",
            value: pinnedModel,
            disabled: pinnedProvider === "",
            onChange: (e) => updateModels(pin.key, { id: e.target.value }),
        }, React.createElement("option", { value: "" }, "(follows slot)"), modelChoices.map((m) => React.createElement("option", { key: m.id, value: m.id }, m.name))));
    };
    /** One settings group: heading + note + body in a hairline card. */
    const section = (heading, body, note) => React.createElement("div", {
        style: {
            border: "1px solid var(--dl-border, #434343)",
            borderRadius: "12px",
            background: "var(--dl-card, #1c1c1c)",
            padding: "14px 16px",
        },
    }, React.createElement("h3", { style: { color: "var(--dl-muted, #8d8d8d)", fontSize: "12.5px", fontWeight: 500, marginBottom: note ? 4 : 10 } }, heading), note !== undefined &&
        React.createElement("div", { style: { color: "var(--dl-muted, #8d8d8d)", fontSize: "12px", marginBottom: 10 } }, note), body);
    const button = (text, onClick, active, key) => React.createElement("button", {
        key,
        className: "dl-mode",
        "data-on": active ? "true" : "false",
        onClick,
        style: {
            flex: 1,
            padding: "9px 0",
            textAlign: "center",
            cursor: "pointer",
            border: "1px solid var(--dl-border, #434343)",
            borderRadius: "var(--dl-radius-md, 8px)",
            background: "var(--dl-card, #1c1c1c)",
            color: active ? "var(--dl-foreground, #e6e6e6)" : "var(--dl-muted, #8d8d8d)",
            fontFamily: "inherit",
            fontSize: 13,
        },
    }, text);
    return React.createElement("div", { className: "dl-settings dl-root" }, section("model slots", React.createElement("div", null, groups.length === 0
        ? React.createElement("div", { className: "dl-pin-note" }, "model catalog unavailable — configure a provider on the Models page first")
        : SLOTS.map(pinRow)), "the default tiers roles fall back to: strong = conversation default, cheap = research/demo/extraction, vision = figures/PDFs"), section("optional overrides", React.createElement("div", null, OVERRIDES.map(pinRow)), "unset roles follow their slot; an override names the exact model for one role"), section("quizzing mechanic", React.createElement("div", { style: { display: "flex", gap: 8, maxWidth: 360 } }, button("multiple choice", () => setRecord((prev) => ({ ...(prev ?? {}), agent: { ...(prev ?? {}).agent, tools: { ...(prev ?? {})?.agent?.tools, explain: false } } })), agentTools.explain !== true), button("free recall", () => setRecord((prev) => ({ ...(prev ?? {}), agent: { ...(prev ?? {}).agent, tools: { ...(prev ?? {})?.agent?.tools, explain: true } } })), agentTools.explain === true))), section("extraction", React.createElement("div", { style: { display: "grid", gridTemplateColumns: "240px 1fr", gap: 8, alignItems: "center" } }, React.createElement("span", { className: "dl-pin-label" }, "chunk budget (tokens per batch, floor 500)"), React.createElement("input", {
        className: "dl-input",
        type: "number",
        value: graph.extractionChunkTokens ?? 4096,
        onChange: (e) => setRecord((prev) => ({
            ...(prev ?? {}),
            graph: { ...(prev ?? {})?.graph, extractionChunkTokens: Number(e.target.value) },
        })),
    }))), section("prompt overrides", Object.keys(prompts).length === 0
        ? React.createElement("div", { className: "dl-pin-note" }, "no override switches yet — edit a segment file under ~/.dsh/deep-learning/prompts/ and add its switch here")
        : React.createElement("div", null, Object.entries(prompts).map(([path, on]) => React.createElement("div", { key: path, className: "dl-seg-row" }, React.createElement("span", { className: "dl-seg-name" }, path), React.createElement("button", {
            className: "dl-btn",
            "data-on": on ? "true" : "false",
            onClick: () => setRecord((prev) => ({
                ...(prev ?? {}),
                agent: {
                    ...(prev ?? {}).agent,
                    prompts: { ...(prev ?? {})?.agent?.prompts, [path]: !on },
                },
            })),
        }, on ? "override on" : "override off"))))), React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 4 } }, React.createElement("button", {
        className: "dl-btn",
        disabled: busy,
        onClick: () => record !== null && void save(record),
        style: {
            padding: "8px 20px",
            fontSize: 13,
            border: "1px solid var(--dl-border, #434343)",
            borderRadius: "var(--dl-radius-md, 8px)",
            background: "var(--dl-card, #1c1c1c)",
            color: "var(--dl-foreground, #e6e6e6)",
            cursor: "pointer",
            fontFamily: "inherit",
        },
    }, busy ? "saving…" : "save settings"), React.createElement("span", {
        className: "dl-status",
        "data-err": status !== null && status.includes("fail") ? "true" : "false",
        style: { color: status !== null && status.includes("fail") ? "#ef4444" : "var(--dl-muted, #8d8d8d)", fontSize: "12.5px" },
    }, status)));
}
