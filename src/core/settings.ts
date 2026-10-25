/**
 * Settings resolution — ported from learnharness src/core/settings.ts +
 * src/core/settings-resolution.ts (AGPL-3.0, amosblomqvist/learnharness).
 *
 * BYOK ALL THE WAY DOWN (the ported law): there are NO factory default
 * models. Every engine resolves from the user's model slots over per-role
 * overrides; a chain that ends empty resolves to null/undefined and whatever
 * needs it refuses honestly. Nothing in this plugin ever hardcodes a model.
 *
 * Deltas from the original: ThinkingLevel becomes a plain string (the
 * harness owns the effort scale per adapter); the record persists under
 * $DSH_HOME/deep-learning/settings.json (a plugin-owned delta document).
 */

// ─── roles and slots ─────────────────────────────────────────────────────────

/** Every agent role in the plugin. The conversation pair resolves the
 *  session's own model (the harness per-session picker); background roles
 *  resolve their override → tier slot. */
export type ModelRole =
	| "prober"
	| "teacher"
	| "researcher"
	| "demoBuilder"
	| "visualMaker"
	| "pdfReader"
	| "extractor"
	| "auditor";

export const BACKGROUND_MODEL_ROLES = [
	"researcher",
	"demoBuilder",
	"visualMaker",
	"pdfReader",
	"extractor",
	"auditor",
] as const;

export type BackgroundModelRole = (typeof BACKGROUND_MODEL_ROLES)[number];

export const MODEL_SLOTS = ["strong", "cheap", "vision"] as const;
export type ModelSlotName = (typeof MODEL_SLOTS)[number];

/** Slot tier per role. The conversation pair (prober/teacher) rides the
 *  session's own model — the strong slot is the fallback tier for sessions
 *  without an explicit pick (the harness stamps new sessions with its
 *  default model; the strong slot exists for parity in role resolution). */
export const ROLE_SLOT: Readonly<Record<ModelRole, ModelSlotName>> = {
	prober: "strong",
	teacher: "strong",
	researcher: "cheap",
	demoBuilder: "cheap",
	extractor: "cheap",
	auditor: "cheap",
	visualMaker: "vision",
	pdfReader: "vision",
};

// ─── the delta record (persisted under $DSH_HOME/deep-learning/) ─────────────

/** A configured model slot: the tier's concrete model, with its optional
 *  thinking level. A slot is CONFIGURED iff its model is present. */
export interface ModelSlot {
	provider: string;
	id: string;
	thinkingLevel?: string;
}

/** A per-role model/thinking override — every field independent. */
export interface RoleModelOverride {
	provider: string;
	id: string;
	thinkingLevel?: string;
}

/** Tool toggles keyed by tool id (absent key = enabled). */
export type ToolToggles = Record<string, boolean>;

export interface GraphSettingsDelta {
	enabled?: boolean;
	/** Teacher graph tools gate (composes with graph.enabled). */
	graphTools?: { enabled?: boolean };
	rendering?: boolean;
	/** The chunk budget: batches of uncovered tokens per extraction call.
	 *  Validated floor 500. */
	extractionChunkTokens?: number;
}

export interface AgentSettingsDelta {
	/** Per-role model overrides. */
	models?: Partial<Record<BackgroundModelRole, ModelSlot>>;
	/** Tool toggles (absent = enabled). `explain: true` arms free-recall
	 *  mechanics — the quizzing-mechanic switch (managed, not a toggle). */
	tools?: ToolToggles;
	/** Per-segment prompt override switches (absent = off). */
	prompts?: Record<string, boolean>;
}

/** The whole delta record — explicit user choices only; absent keys resolve
 *  to the compiled factory defaults below. */
export interface UserSettings {
	models?: Partial<Record<ModelSlotName, ModelSlot>>;
	agent?: AgentSettingsDelta;
	graph?: GraphSettingsDelta;
}

// ─── factory defaults ────────────────────────────────────────────────────────

export interface FactoryGraphSettings {
	enabled: boolean;
	rendering: boolean;
	extractionChunkTokens: number;
}

export const FACTORY_SETTINGS = {
	graph: {
		enabled: true,
		rendering: true,
		extractionChunkTokens: 4096,
	} satisfies FactoryGraphSettings,
} as const;

/** The chunk budget's validated floor. */
export const EXTRACTION_CHUNK_TOKENS_FLOOR = 500;

// ─── the resolution layer (pure projection: delta → concrete) ───────────────

/** A configured model slot resolved concrete. */
export interface EffectiveSlot {
	provider: string;
	id: string;
	thinkingLevel?: string;
}

/** A fully-resolved model pin for one role; undefined means the role's whole
 *  chain came up empty and whatever needs it refuses honestly. */
export interface EffectiveModelSpec {
	provider: string;
	id: string;
	thinkingLevel?: string;
}

/** The concrete view: every knob resolved, no absent fields. */
export interface EffectiveSettings {
	/** The resolved strong/cheap/vision slots (null = unset — BYOK). */
	models: Record<ModelSlotName, EffectiveSlot | null>;
	agent: {
		/** Per-background-role resolved model (undefined = unset). */
		models: Record<BackgroundModelRole, EffectiveModelSpec | undefined>;
		/** Delta map as stored — consumers resolve absent key → enabled;
		 *  `explain === true` is the free-recall mechanics switch. */
		tools: ToolToggles;
		/** Delta map as stored — absent key = override off. */
		prompts: Record<string, boolean>;
	};
	graph: FactoryGraphSettings & { graphTools: boolean };
}

function resolveSlot(slot: ModelSlot | undefined): EffectiveSlot | null {
	if (!slot || typeof slot.provider !== "string" || slot.provider.length === 0) return null;
	if (typeof slot.id !== "string" || slot.id.length === 0) return null;
	return { provider: slot.provider, id: slot.id, ...(slot.thinkingLevel ? { thinkingLevel: slot.thinkingLevel } : {}) };
}

/** Resolve the whole delta record into the concrete view. Pure. */
export function resolveSettings(record: UserSettings | null | undefined): EffectiveSettings {
	const modelsSection = record?.models ?? {};
	const agentSection = record?.agent ?? {};
	const graphSection = record?.graph ?? {};

	const models: Record<ModelSlotName, EffectiveSlot | null> = {
		strong: resolveSlot(modelsSection.strong),
		cheap: resolveSlot(modelsSection.cheap),
		vision: resolveSlot(modelsSection.vision),
	};

	const agentModels = {} as Record<BackgroundModelRole, EffectiveModelSpec | undefined>;
	for (const role of BACKGROUND_MODEL_ROLES) {
		const override = agentSection.models?.[role];
		if (override) {
			const resolved = resolveSlot(override);
			if (resolved) {
				agentModels[role] = resolved;
				continue;
			}
		}
		// absent/invalid override falls to the role's slot tier
		const slotName = ROLE_SLOT[role];
		const slot = models[slotName];
		if (slot) agentModels[role] = { ...slot };
	}

	const rawTokens = graphSection.extractionChunkTokens;
	const chunkTokens =
		typeof rawTokens === "number" && Number.isFinite(rawTokens)
			? Math.max(EXTRACTION_CHUNK_TOKENS_FLOOR, Math.floor(rawTokens))
			: FACTORY_SETTINGS.graph.extractionChunkTokens;

	return {
		models,
		agent: {
			models: agentModels,
			tools: agentSection.tools ?? {},
			prompts: agentSection.prompts ?? {},
		},
		graph: {
			enabled: graphSection.enabled ?? FACTORY_SETTINGS.graph.enabled,
			rendering: graphSection.rendering ?? FACTORY_SETTINGS.graph.rendering,
			graphTools: graphSection.graphTools?.enabled ?? true,
			extractionChunkTokens: chunkTokens,
		},
	};
}

/** Whether every slot tier carries a concrete model (the setup gate's
 *  truth — the conversation defaults to the session model, so this gates
 *  only the role-dependent features honestly). */
export function slotsConfigured(models: UserSettings["models"] | undefined): boolean {
	return MODEL_SLOTS.every((slotName) => resolveSlot(models?.[slotName]) !== null);
}

/** The quizzing mechanics: `tools.explain === true` arms free-recall
 *  (explain/recall); anything else is multiple choice (quiz/probe). */
export function quizMechanics(tools: ToolToggles | undefined): "choice" | "free" {
	return tools?.explain === true ? "free" : "choice";
}
