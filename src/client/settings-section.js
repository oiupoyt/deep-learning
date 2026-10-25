/**
 * The settings section — "Deep Learning" in the harness settings: the
 * background role model pins (researcher/demoBuilder/visualMaker/pdfReader/
 * extractor/auditor + the strong/cheap/vision slots), the prompt segment
 * switches, the quizzing mechanic, and the chunk budget. The Models page
 * owns provider credentials; this page only names which model each role
 * uses (BYOK law: nothing is hardcoded; absent pins read as unset).
 */
import * as React from "react";
import { ensureStyle } from "./styles.js";
const ROLE_PINS = [
    { key: "strong", label: "strong slot (conversation default)" },
    { key: "cheap", label: "cheap slot (research, demo, extraction)" },
    { key: "vision", label: "vision slot (figures, PDFs)" },
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
        locale: "deepLearning",
        inject: () => ({ apiRoot: api }),
    }, SettingsSection));
}
function SettingsSection(props) {
    const api = props.apiRoot ?? "/api/deep-learning";
    const [record, setRecord] = React.useState(null);
    const [status, setStatus] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const load = React.useCallback(() => {
        fetch(`${api}/settings`)
            .then((r) => r.json())
            .then((data) => setRecord(data.settings))
            .catch(() => setStatus("settings unavailable"));
    }, [api]);
    React.useEffect(() => {
        load();
    }, [load]);
    const save = React.useCallback(async (next) => {
        setBusy(true);
        setStatus("saving…");
        try {
            const r = await fetch(`${api}/settings`, {
                method: "PUT",
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
    const setPin = (key, field, value) => {
        const next = {
            ...record,
            models: {
                ...models,
                [key]: { provider: models[key]?.provider ?? "", id: models[key]?.id ?? "", [field]: value },
            },
        };
        setRecord(next);
    };
    const setPromptSwitch = (path, on) => {
        setRecord({
            ...record,
            agent: { ...record?.agent, prompts: { ...prompts, [path]: on } },
        });
    };
    const setMechanic = (free) => {
        setRecord({
            ...record,
            agent: { ...record?.agent, tools: { ...agentTools, explain: free } },
        });
    };
    return React.createElement("div", { className: "dl-settings" }, React.createElement("h3", null, "model slots + role pins"), React.createElement("div", null, ROLE_PINS.map((pin) => React.createElement("div", { key: pin.key, className: "dl-pin-row" }, React.createElement("span", { className: "dl-pin-label" }, pin.label), React.createElement("div", { style: { display: "flex", gap: 6 } }, React.createElement("input", {
        className: "dl-input",
        style: { flex: 1 },
        value: models[pin.key]?.provider ?? "",
        onChange: (e) => setPin(pin.key, "provider", e.target.value),
        placeholder: "provider",
    }), React.createElement("input", {
        className: "dl-input",
        style: { flex: 2 },
        value: models[pin.key]?.id ?? "",
        onChange: (e) => setPin(pin.key, "id", e.target.value),
        placeholder: "model id (e.g. deepseek-chat)",
    }))))), React.createElement("h3", null, "quizzing mechanic"), React.createElement("div", { className: "dl-mode-row", style: { maxWidth: 360 } }, React.createElement("button", {
        className: "dl-mode",
        "data-on": agentTools.explain !== true ? "true" : "false",
        onClick: () => setMechanic(false),
    }, "multiple choice"), React.createElement("button", {
        className: "dl-mode",
        "data-on": agentTools.explain === true ? "true" : "false",
        onClick: () => setMechanic(true),
    }, "free recall")), React.createElement("h3", null, "extraction"), React.createElement("div", { className: "dl-pin-row" }, React.createElement("span", { className: "dl-pin-label" }, "chunk budget (tokens per extraction batch, floor 500)"), React.createElement("input", {
        className: "dl-input",
        type: "number",
        value: graph.extractionChunkTokens ?? 4096,
        onChange: (e) => setRecord({
            ...record,
            graph: { ...graph, extractionChunkTokens: Number(e.target.value) },
        }),
    })), React.createElement("h3", null, "prompt overrides"), React.createElement("div", null, Object.keys(prompts).length === 0
        ? React.createElement("div", { style: { color: "#888888", fontSize: 12 } }, "no override switches yet — edit a segment file under ~/.dsh/deep-learning/prompts/ and add its switch here")
        : Object.entries(prompts).map(([path, on]) => React.createElement("div", { key: path, className: "dl-seg-row" }, React.createElement("span", { className: "dl-seg-name" }, path), React.createElement("button", {
            className: "dl-btn",
            "data-on": on ? "true" : "false",
            onClick: () => setPromptSwitch(path, !on),
        }, on ? "override on" : "override off")))), React.createElement("div", null, React.createElement("button", {
        className: "dl-btn",
        disabled: busy,
        onClick: () => record !== null && void save(record),
    }, busy ? "saving…" : "save settings"), React.createElement("span", { className: "dl-status", "data-err": status?.includes("fail") ? "true" : "false", style: { marginLeft: 12 } }, status)));
}
