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
 * Every pin is a provider + model DROPDOWN pair, fed by the harness's
 * own live model catalog (GET /api/deep-learning/models — the same
 * buildModelCatalog the Models page uses). BYOK law: nothing is
 * hardcoded; absent pins read as unset.
 *
 * Also: the quizzing mechanic, the extraction chunk budget, and the
 * prompt override switches.
 */

import * as React from "react";
import { ensureStyle } from "./styles.js";
import type { SlotsLike } from "./slots-types.js";



const SLOTS: Array<{ key: string; label: string; note: string }> = [
	{ key: "strong", label: "strong slot", note: "the conversation default tier" },
	{ key: "cheap", label: "cheap slot", note: "research, demo building, extraction" },
	{ key: "vision", label: "vision slot", note: "figures and PDF reading" },
];

const OVERRIDES: Array<{ key: string; label: string; note: string }> = [
	{ key: "researcher", label: "researcher override", note: "web research briefs" },
	{ key: "demoBuilder", label: "demo builder override", note: "interactive teaching instruments" },
	{ key: "visualMaker", label: "visual maker override", note: "precise SVG figures" },
	{ key: "pdfReader", label: "pdf reader override", note: "cited PDF briefs" },
	{ key: "extractor", label: "extractor override", note: "graph extraction from teaching" },
	{ key: "auditor", label: "auditor override", note: "identity verdicts for the merge" },
];

export function registerSettingsSection(slots: SlotsLike, api: string): void {
	ensureStyle();
	slots.inject("settings.section", () =>
		slots.register(
			{
				name: "settings.section",
				id: "deep-learning",
				order: 45,
				label: () => "Deep Learning",
				icon: "book",
				locale: "deepLearning",
				inject: () => ({ apiRoot: api }),
			},
			SettingsSection,
		),
	);
}

interface SettingsRecord {
	models?: Record<string, { provider?: string; id?: string }>;
	agent?: { tools?: Record<string, boolean>; prompts?: Record<string, boolean> };
	graph?: { enabled?: boolean; extractionChunkTokens?: number };
}

interface CatalogGroup {
	id: string;
	name: string;
	models: Array<{ id: string; name: string; description?: string }>;
}

interface ModelCatalog {
	default?: { provider?: string; model?: string };
	groups?: CatalogGroup[];
	failures?: Array<{ id: string; name: string; message: string }>;
}

function SettingsSection(props: { apiRoot?: string } & Record<string, unknown>): React.ReactElement {
	const api = props.apiRoot ?? "/api/deep-learning";
	const [record, setRecord] = React.useState<SettingsRecord | null>(null);
	const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null);
	const [status, setStatus] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState(false);

	const load = React.useCallback(() => {
		fetch(`${api}/settings`)
			.then((r) => r.json())
			.then((data: { settings: SettingsRecord | null }) => setRecord(data.settings))
			.catch(() => setStatus("settings unavailable"));
		fetch(`${api}/models`)
			.then((r) => r.json())
			.then((data: ModelCatalog) => setCatalog(data))
			.catch(() => setCatalog(null));
	}, [api]);

	React.useEffect(() => {
		load();
	}, [load]);

	const save = React.useCallback(
		async (next: SettingsRecord) => {
			setBusy(true);
			setStatus("saving…");
			try {
				const r = await fetch(`${api}/settings`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(next),
				});
				const data = (await r.json()) as { ok?: boolean };
				setBusy(false);
				setStatus(data.ok === true ? "saved" : "save failed");
			} catch {
				setBusy(false);
				setStatus("save failed");
			}
		},
		[api],
	);

	const models = record?.models ?? {};
	const agentTools = record?.agent?.tools ?? {};
	const prompts = record?.agent?.prompts ?? {};
	const graph = record?.graph ?? {};
	const groups = catalog?.groups ?? [];

	const setPin = (key: string, field: "provider" | "id", value: string) => {
		setRecord((prev) => {
			const prevModels = (prev ?? record)?.models ?? models;
			return {
				...(prev ?? record),
				models: {
					...prevModels,
					[key]: { provider: prevModels[key]?.provider ?? "", id: prevModels[key]?.id ?? "", [field]: value },
				},
			};
		});
	};
	const setPromptSwitch = (path: string, on: boolean) => {
		setRecord({
			...record,
			agent: { ...record?.agent, prompts: { ...prompts, [path]: on } },
		});
	};
	const setMechanic = (free: boolean) => {
		setRecord({
			...record,
			agent: { ...record?.agent, tools: { ...agentTools, explain: free } },
		});
	};

	/** One pin row: label + provider dropdown + model dropdown. */
	const pinRow = (pin: { key: string; label: string; note: string }): React.ReactElement => {
		const pinnedProvider = models[pin.key]?.provider ?? "";
		const pinnedModel = models[pin.key]?.id ?? "";
		const providerGroup = groups.find((g) => g.id === pinnedProvider);
		const modelChoices = providerGroup?.models ?? [];
		return React.createElement(
			"div",
			{ key: pin.key, className: "dl-pin-row" },
			React.createElement("span", { className: "dl-pin-label" }, pin.label),
			React.createElement(
				"select",
				{
					className: "dl-select",
					value: pinnedProvider,
					onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
						// One functional update: the provider changes AND the model
						// pin resets (a stale snapshot must never win the batch).
						const provider = e.target.value;
						setRecord((prev) => {
							const prevRecord = prev ?? record;
							const prevModels = prevRecord?.models ?? models;
							return {
								...prevRecord,
								models: {
									...prevModels,
									[pin.key]: { provider, id: "" },
								},
							};
						});
					},
				},
				React.createElement("option", { value: "" }, "(unset)"),
				groups.map((g) => React.createElement("option", { key: g.id, value: g.id }, g.name)),
			),
			React.createElement(
				"select",
				{
					className: "dl-select",
					value: pinnedModel,
					disabled: pinnedProvider === "",
					onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setPin(pin.key, "id", e.target.value),
				},
				React.createElement("option", { value: "" }, "(follows slot)"),
				modelChoices.map((m) => React.createElement("option", { key: m.id, value: m.id }, m.name)),
			),
		);
	};

	return React.createElement(
		"div",
		{ className: "dl-settings" },
		React.createElement("h3", null, "model slots"),
		groups.length === 0 &&
			React.createElement("div", { className: "dl-pin-note" }, "model catalog unavailable — configure a provider on the Models page first"),
		SLOTS.map(pinRow),
		React.createElement("h3", null, "optional overrides"),
		React.createElement(
			"div",
			{ className: "dl-pin-note" },
			"An override names the model for one role; unset roles follow their slot (research/demo/extraction follow cheap, figures/PDFs follow vision).",
		),
		OVERRIDES.map(pinRow),
		React.createElement("h3", null, "quizzing mechanic"),
		React.createElement(
			"div",
			{ className: "dl-mode-row", style: { maxWidth: 360 } },
			React.createElement(
				"button",
				{
					className: "dl-mode",
					"data-on": agentTools.explain !== true ? "true" : "false",
					onClick: () => setMechanic(false),
				},
				"multiple choice",
			),
			React.createElement(
				"button",
				{
					className: "dl-mode",
					"data-on": agentTools.explain === true ? "true" : "false",
					onClick: () => setMechanic(true),
				},
				"free recall",
			),
		),
		React.createElement("h3", null, "extraction"),
		React.createElement(
			"div",
			{ className: "dl-pin-row", style: { gridTemplateColumns: "190px 1fr" } },
			React.createElement("span", { className: "dl-pin-label" }, "chunk budget (tokens per batch, floor 500)"),
			React.createElement("input", {
				className: "dl-input",
				type: "number",
				value: graph.extractionChunkTokens ?? 4096,
				onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
					setRecord({
						...record,
						graph: { ...graph, extractionChunkTokens: Number(e.target.value) },
					}),
			}),
		),
		React.createElement("h3", null, "prompt overrides"),
		React.createElement(
			"div",
			null,
			Object.keys(prompts).length === 0
				? React.createElement(
						"div",
						{ className: "dl-pin-note" },
						"no override switches yet — edit a segment file under ~/.dsh/deep-learning/prompts/ and add its switch here",
					)
				: Object.entries(prompts).map(([path, on]) =>
						React.createElement(
							"div",
							{ key: path, className: "dl-seg-row" },
							React.createElement("span", { className: "dl-seg-name" }, path),
							React.createElement(
								"button",
								{
									className: "dl-btn",
									"data-on": on ? "true" : "false",
									onClick: () => setPromptSwitch(path, !on),
								},
								on ? "override on" : "override off",
							),
						),
					),
		),
		React.createElement(
			"div",
			null,
			React.createElement(
				"button",
				{
					className: "dl-btn",
					disabled: busy,
					onClick: () => record !== null && void save(record),
				},
				busy ? "saving…" : "save settings",
			),
			React.createElement(
				"span",
				{ className: "dl-status", "data-err": status?.includes("fail") ? "true" : "false", style: { marginLeft: 12 } },
				status,
			),
		),
	);
}
