/**
 * The host wiring — the plugin's apply() over the DSH composition.
 * Ported from learnharness's server band (chat-handler, turn-service,
 * chats/graph routes), reshaped for the harness:
 *
 *   - The DSH session log is the transcript of record. The plugin folds
 *     `session/event` streams to derive phases, coverage, and plan
 *     statuses — the same derived-never-stored laws, over a different log.
 *   - A dynamic systemPrompt SECTION carries the teaching composition:
 *     its provider reads the session's current phase at assembly time
 *     (probe fragments until probe_done concludes; teacher fragments
 *     after; practice gets its own composition). The swap happens between
 *     turns, exactly like the original's per-turn agent rebuild.
 *   - The session KIND (teach vs practice) rides a `session/deep-learning`
 *     user-role marker the client injects on session start (the marker's
 *     text is context, not learner speech — the preamble law). Practice
 *     sessions may also carry picked propositions as a session-context
 *     marker.
 *   - webServer routes under /api/deep-learning serve the client bundle:
 *     pending question, answer submission, graph snapshot, notes import,
 *     settings, activity.
 *
 * The plugin must never take the host down: every registration is
 * effect-scoped, and every route answers JSON on every path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
// Side-effect imports load the services' module augmentations (the
// `session/event`, `agent/created`, `ctx.systemPrompt`, `ctx.tools`,
// `ctx.webServer` extensions to cordis's interfaces).
import "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-session";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import "@deepseek-ai/dsh-agent";
import type { Agent } from "@deepseek-ai/dsh-agent";
import "@deepseek-ai/dsh-tools";
import "@deepseek-ai/dsh-system-prompt";
import "@deepseek-ai/dsh-host-webserver";
import "@deepseek-ai/dsh-client-connection";
import "@deepseek-ai/dsh-web";
import { FsGraphStore } from "./store/graph.js";
import { FsArtifactStore, artifactInputFromRoleResult } from "./store/artifacts.js";
import { FsSessionsStore, FsSettingsStore } from "./store/sessions.js";
import { createTeachingRuntime, type TeachingRuntime, type HarnessSeam } from "./server/tools.js";
import { composeInstructions } from "./server/prompts.js";
import { phaseAt, type PhaseEvent } from "./core/phases.js";
import { derivePlanStatuses } from "./core/plan-tree.js";
import { coverageOf, messageViewLines, type CoverageMessage } from "./core/coverage.js";
import { resolveSettings } from "./core/settings.js";
import {
	appendLearningModeRecord,
	readLearningModeState,
	resolveLearningModeMutation,
	INITIAL_LEARNING_MODE_STATE,
	learningModeProjection,
	reduceLearningMode,
	type LearningModeState,
} from "./core/learning-mode.js";
import type { UserSettings } from "./core/settings.js";
import type { PlanTree } from "./core/contracts/plan.js";
import { concludesLearningToolTurn } from "./core/tool-turn.js";
import { foldLearningSessionEvent, replayLearningSession, type ReplayFoldEvent } from "./core/session-replay.js";

/** The plugin's data root: $DSH_HOME/deep-learning (plain inspectable files). */
function dataRootOf(ctx: Context): string {
	const home = process.env.DSH_HOME ?? path.join(os().homedir(), ".dsh");
	return path.join(home, "deep-learning");
}

function os(): { homedir(): string } {
	return await0();
}
function await0(): { homedir(): string } {
	// avoid a static import cycle in types: node:os is ambient in practice
	return { homedir: () => process.env.HOME ?? "/home" };
}

/** The DSH session-event shapes the folds need. */
type FoldEvent = ReplayFoldEvent;

/** A per-session fold state maintained over the event stream. */
interface SessionState {
	sessionId: string;
	kind: "teach" | "practice" | null;
	learningMode: LearningModeState;
	phase: "probe" | "plan" | "teach" | "practice";
	/** Assistant messages in order, for phase/plan folds. */
	events: FoldEvent[];
	agent?: Agent;
	toolDisposers?: Array<() => void>;
	/** The live teaching runtime (tools + pending question). */
	runtime?: TeachingRuntime;
	runtimeKind?: "teach" | "practice";
	runtimeSettings?: string; // JSON of the settings snapshot it was built under
	pendingQuestionSeen: boolean;
}

export const name = "deep-learning";

/** Services the plugin waits for. */
export const inject = ["llm", "systemPrompt", "tools", "webServer", "connection", "web", "sessions", "agents", "sessionProjections"];

/** Plugin configuration (none yet — the settings delta is the record). */
export interface Config {}

/** The plugin's host application. */
export function apply(ctx: Context, _config: Config): void {
	const dataRoot = dataRootOf(ctx);
	fs.mkdirSync(dataRoot, { recursive: true });
	const graphStore = new FsGraphStore(dataRoot);
	const artifactsStore = new FsArtifactStore(dataRoot);
	const sessionsStore = new FsSessionsStore(dataRoot);
	const settingsStore = new FsSettingsStore(dataRoot);

	// The prompts ship inside the package; overrides live under the data root.
	const promptsRoot = promptsRootOf();
	const overrideRoot = path.join(dataRoot, "prompts");

	/** Per-session plugin state (the fold + runtime cache). */
	const states = new Map<string, SessionState>();

	const stateOf = (sessionId: string): SessionState => {
		let state = states.get(sessionId);
		if (!state) {
			state = {
				sessionId,
				kind: null,
				learningMode: INITIAL_LEARNING_MODE_STATE,
				phase: "probe",
				events: [],
				pendingQuestionSeen: false,
			};
			states.set(sessionId, state);
		}
		return state;
	};

	/**
	 * Restore the durable session fold before an agent receives input. Seed events
	 * do not re-emit through session/event during resume, so this is the only
	 * reliable place to reconstruct the process-local runtime state.
	 */
	const hydrateSession = (sessionId: string, events: readonly SessionEvent[]): SessionState => {
		const state = stateOf(sessionId);
		const replay = replayLearningSession(events);
		state.kind = replay.kind;
		state.learningMode = replay.learningMode;
		state.phase = replay.phase;
		state.events = replay.events;
		state.runtime = undefined;
		state.runtimeKind = undefined;
		state.runtimeSettings = undefined;
		state.pendingQuestionSeen = false;
		return state;
	};

	/** Read the settings snapshot + build the session's runtime when the	 *  kind is known. Rebuilt when the settings record changed (the
	 *  original's fresh-per-turn law, lazified to settings-revision). */
	const runtimeOf = (sessionId: string, kind: "teach" | "practice"): TeachingRuntime => {
		const state = stateOf(sessionId);
		const raw = settingsStore.read();
		const snapshot = JSON.stringify(raw);
		if (state.runtime && state.runtimeKind === kind && state.runtimeSettings === snapshot) {
			return state.runtime;
		}
		const seam: HarnessSeam = {
			sessionId,
			kind,
			concludeTurn: () => {
				// The agent's turn ends when the tool result carries
				// terminate semantics (the registered tools declare it);
				// nothing to force host-side beyond that.
			},
			queueMessage: async (text: string) => {
				const controller = ctx.get("sessionController");
				if (!controller) return;
				await (controller as unknown as {
					prompt(request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
				}).prompt(
					{
						sessionId: sessionId as never,
						mode: "queue",
						content: [{ type: "text", text }],
						requestId: `dl-${sessionId}-${Date.now()}` as never,
					},
					new AbortController().signal,
				);
			},
			listModelPins: () => settingsStore.read()?.models ?? ({} as never),
			runRole: async (role, input, signal) => {
				return runRoleJob(role, input, signal, sessionId);
			},
		};
		const runtime = createTeachingRuntime({ dataRoot, seam, settings: raw });
		state.runtime = runtime;
		state.runtimeKind = kind;
		state.runtimeSettings = snapshot;
		return runtime;
	};

	const syncSessionTools = (state: SessionState): void => {
		for (const dispose of state.toolDisposers ?? []) dispose();
		state.toolDisposers = undefined;
		const agent = state.agent;
		if (!agent || state.kind === null) return;
		const runtime = runtimeOf(state.sessionId, state.kind);
		state.toolDisposers = Object.values(runtime.tools()).map((tool) =>
			agent.ctx.tools.register(toHostTool(tool, () => runtime)),
		);
	};

	/** The extraction trigger: fire-and-forget, single-flight per session.
		 *  Failure checkpoints nothing — the next trigger re-runs (the ported law). */
	const extractionInFlight = new Set<string>();
	async function triggerExtraction(state: SessionState): Promise<void> {
		if (extractionInFlight.has(state.sessionId)) return;
		const effective = resolveSettings(settingsStore.read());
		const extractorRoute = effective.agent.models.extractor;
		const auditorRoute = effective.agent.models.auditor;
		if (!extractorRoute || !auditorRoute) {
			ctx.logger?.warn?.("deep-learning: extraction skipped — extractor/auditor role not configured");
			return; // honest refusal; uncovered accumulates until the pins exist
		}
		extractionInFlight.add(state.sessionId);
		try {
			const messages: Array<{ id: string; role: string; content: unknown }> = state.events
				.filter((e) => e.type === "assistant/message")
				.map((e) => ({
					id: (e as unknown as { message?: { id?: string } }).message?.id ?? `${e.type}-${state.events.indexOf(e)}`,
					role: "assistant",
					content: e.message?.content,
				}));
			const { runExtraction } = await import("./server/extraction.js");
			const stats = await runExtraction({
				llm: ctx.llm as never as import("./server/roles.js").LlmLike,
				extractor: { provider: extractorRoute.provider, model: extractorRoute.id },
				auditor: { provider: auditorRoute.provider, model: auditorRoute.id },
				sourceId: state.sessionId,
				transcript: messages,
				store: graphStore,
				chunkTokens: effective.graph.extractionChunkTokens,
			});
			ctx.logger?.info?.(`deep-learning: extraction merged ${stats.nodes} nodes, ${stats.chains ?? 0} chains from ${state.sessionId}`);
		} catch (err) {
			ctx.logger?.warn?.(`deep-learning: extraction failed for ${state.sessionId}: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			extractionInFlight.delete(state.sessionId);
		}
	}

	/** Run one background role to completion. Route resolution: the
		 *  settings pins (researcher/demoBuilder/visualMaker/pdfReader/
		 *  extractor/auditor) — BYOK law, never hardcoded; an unset pin
		 *  refuses honestly. */
	async function runRoleJob(role: string, input: Record<string, unknown>, signal: AbortSignal, sessionId: string): Promise<unknown> {
		const effective = resolveSettings(settingsStore.read());
		const route = effective.agent.models[role as keyof typeof effective.agent.models];
		if (!route) {
			throw new Error(
				`no model configured for the "${role}" role — set it in Settings > Deep Learning`,
			);
		}
		const llm = ctx.llm as never as import("./server/roles.js").LlmLike;
		const { runResearch, runDemoArtifact, runVisualArtifact, runPdfBrief } = await import("./server/jobs.js");
		if (role === "research") {
			const web = {
				search: async (request: { queries: string[] }, signal?: AbortSignal) => {
					const results = [] as Array<{ title: string; url: string; snippet?: string }>;
					for (const query of request.queries) {
							const out = await ctx.web.search({ query }, signal);
						results.push(
							...out.sources.map((src) => ({
								title: src.title ?? src.url,
								url: src.url,
								snippet: src.snippet,
							})),
						);
					}
					return { results };
				},
				fetch: async (request: { url: string }, signal?: AbortSignal) => {
					const result = await ctx.web.fetch({ url: request.url }, signal);
					const body = result.body as { kind?: string; text?: string } | undefined;
					return {
						url: result.url,
						text:
							typeof body?.text === "string"
								? body.text
								: JSON.stringify(body ?? ""),
						};
				},
			} as never as import("./server/jobs.js").WebSeam;
			return runResearch({
				llm,
				web,
				route: { provider: route.provider, model: route.id },
				question: String(input.question ?? ""),
				context: input.context !== undefined ? String(input.context) : undefined,
				signal,
			});
		}
		if (role === "demo" || role === "visual") {
			const options = {
				llm,
				route: { provider: route.provider, model: route.id },
				brief: String(input.brief ?? ""),
				title: input.title !== undefined ? String(input.title) : undefined,
				signal,
			};
			const result = role === "demo" ? await runDemoArtifact(options) : await runVisualArtifact(options);
			const inputArtifact = artifactInputFromRoleResult(sessionId, role, result);
			if (!inputArtifact) throw new Error(`the ${role} role returned an invalid artifact`);
			const artifact = artifactsStore.save(inputArtifact);
			return { persisted: true, artifactId: artifact.id, kind: artifact.kind, title: artifact.title };
		}
		if (role === "pdf") {
			const filePath = String(input.path ?? "");
			let text = "";
			try {
				text = fs.readFileSync(filePath, "latin1"); // v0.1 raw bytes; the pdfjs seam upgrades this
			} catch {
				throw new Error(`cannot read the PDF at ${filePath}`);
			}
			return runPdfBrief({
				llm,
				route: { provider: route.provider, model: route.id },
				signal,
				pdfText: text,
				brief: String(input.question ?? ""),
			});
		}
		if (role === "extractor" || role === "auditor") {
			// Extraction routes are resolved by the pipeline caller, not here.
			throw new Error("extraction roles run through the extraction pipeline");
		}
		throw new Error(`unknown role: ${role}`);
	}

	// Every registration resolves through ctx.inject: the plugin's apply
	// owns nothing synchronously — the services arrive when the composition
	// provides them (the harness's dependency semantics).
	ctx.inject(["llm", "systemPrompt", "tools", "webServer", "connection", "web", "sessions", "agents", "sessionProjections"], (scoped) => {
		registerLearningModeProjection(scoped.sessionProjections);
			// ── the session event fold (phases, kinds, coverage triggers) ─────────

		scoped.effect(function* () {
			yield scoped.on("session/event", (session, event: SessionEvent) => {
				const state = stateOf(session.id);
				const previousKind = state.kind;
				const next = foldLearningSessionEvent(state, event);
				state.kind = next.kind;
				state.learningMode = next.learningMode;
				state.phase = next.phase;
				state.events = next.events;
				if (state.kind !== previousKind) {
					state.runtime = undefined;
					state.runtimeKind = undefined;
					state.runtimeSettings = undefined;
					syncSessionTools(state);
				}
				if (event.type === "assistant/message" && state.kind === "teach") maybeTriggerExtraction(state);
			});
		}, "deep-learning: session fold");

		function maybeTriggerExtraction(state: SessionState): void {
			if (state.kind !== "teach") return;
			const effective = resolveSettings(settingsStore.read());
			if (!effective.graph.enabled) return;
			const messages: CoverageMessage[] = state.events
				.filter((e) => e.type === "assistant/message")
				.map((e) => ({
					id: e.message?.id ?? e.type + "-" + state.events.indexOf(e),
					role: "assistant",
					content: e.message?.content,
				}));
			const covered = coverageOf(messages, graphStore.readCoverage(), state.sessionId);
			if (covered.uncoveredTokens >= effective.graph.extractionChunkTokens) void triggerExtraction(state);
		}

		// ── the dynamic system prompt section ─────────────────────────────────

		scoped.effect(function* () {
			yield scoped.systemPrompt.section({
				name: "deep-learning",
				order: 50,
				text: (assembly) => {
					const agent = (assembly as { agent?: { id?: string } }).agent;
					const sessionId = agent?.id;
					if (!sessionId) return "";
					const state = states.get(sessionId);
					if (!state || state.kind === null) return ""; // not our session
					const switches = resolveSettings(settingsStore.read()).agent.prompts;
					if (state.kind === "practice") {
						return composeInstructions(promptsRoot, "practice", { overrideRoot, switches });
					}
					const kind = state.phase === "probe" ? "prober" : "teacher";
					return composeInstructions(promptsRoot, kind, { overrideRoot, switches });
				},
			});
		}, "deep-learning: prompt section");

		// ── the tools registration (per-session scope, phase-gated) ───────────

		scoped.effect(function* () {
			yield scoped.on("agent/created", async ({ agent }) => {
				const state = hydrateSession(agent.id, agent.session.snapshotEvents());
				state.agent = agent;
				syncSessionTools(state);
			});
			yield scoped.on("agent/disposed", ({ agent }) => {
				const state = states.get(agent.id);
				for (const dispose of state?.toolDisposers ?? []) dispose();
				states.delete(agent.id);
			});
		}, "deep-learning: tools");

		// ── the web routes (the client bundle's API, over the connection's
		//    /api fetch-route registry — the browser-authenticated surface) ────

		const json = (body: unknown, status = 200): Response =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
			});

		scoped.effect(function* () {
			yield scoped.connection.fetch.register({
				path: "/api/deep-learning/graph",
				methods: ["GET"],
				requestBody: "buffered",
				fetch: async (_request: Request) => {
					const { graphSnapshot } = await import("./server/snapshot.js");
					return json(graphSnapshot(graphStore, sessionsStore, ctx));
				},
			});
			yield scoped.connection.fetch.register({
				path: "/api/deep-learning/artifacts",
				methods: ["GET"],
				requestBody: "buffered",
				fetch: async (request: Request) => {
					const sessionId = new URL(request.url).searchParams.get("session");
					if (!sessionId) return json({ error: "missing session" }, 400);
					if (!scoped.sessions.get(sessionId as never)) return json({ error: "session unavailable" }, 404);
					return json(artifactsStore.list(sessionId));
				},
			});
			yield scoped.connection.fetch.register({
				path: "/api/deep-learning/settings",
				methods: ["GET", "POST"],
				requestBody: "buffered",
				fetch: async (request: Request) => {
					if (request.method === "GET") return json({ settings: settingsStore.read() });
					const body = (await request.json().catch(() => ({}))) as UserSettings;
					settingsStore.update(body);
					for (const state of states.values()) state.runtimeSettings = ""; // invalidate cached runtimes
					return json({ ok: true });
				},
			});
			yield scoped.connection.fetch.register({
				path: "/api/deep-learning/question",
				methods: ["GET", "POST"],
				requestBody: "buffered",
				fetch: async (request: Request) => {
					const url = new URL(request.url);
					if (request.method === "GET") {
						const sessionId = url.searchParams.get("session");
						if (!sessionId) return json({ error: "missing session" }, 400);
						const state = states.get(sessionId);
						return json({ question: state?.runtime ? state.runtime.pendingQuestion(sessionId) : null });
					}
					// POST: submit an answer { session, ...AnswerRequest }
					const body = (await request.json().catch(() => null)) as (Record<string, unknown> & { session?: string }) | null;
					if (!body?.session) return json({ error: "missing session" }, 400);
					const state = states.get(body.session);
					if (!state?.runtime) return json({ error: "no question pending" }, 409);
					const ok = state.runtime.answerQuestion(body.session, body as never);
					return ok ? json({ ok: true }) : json({ error: "no question pending" }, 409);
				},
			});
			yield scoped.connection.fetch.register({
				path: "/api/deep-learning/mode",
				methods: ["GET", "POST"],
				requestBody: "buffered",
				fetch: async (request: Request) => {
					const url = new URL(request.url);
					const incoming = request.method === "POST" ? await request.json().catch(() => null) : null;
					const sessionId =
						typeof incoming === "object" && incoming !== null && typeof (incoming as { session?: unknown }).session === "string"
							? (incoming as { session: string }).session
							: url.searchParams.get("session");
					if (!sessionId) return json({ error: "missing session" }, 400);
					const session = scoped.sessions.get(sessionId as never);
					if (!session) return json({ error: "session unavailable" }, 404);
					const current = readLearningModeState(scoped.sessionProjections, session);
					if (request.method === "GET") return json({ state: current });
					const next = resolveLearningModeMutation(current, incoming);
					if (next === null) return json({ error: "provide enabled:boolean or toggle:true" }, 400);
					if (next !== current) appendLearningModeRecord(session, next);
					return json({ state: next });
				},
			});

			yield scoped.connection.fetch.register({
				path: "/api/deep-learning/session/start",
				methods: ["POST"],
				requestBody: "buffered",
				fetch: async (request: Request) => {
					const body = (await request.json().catch(() => ({}))) as {
						mode?: string;
						goal?: string;
					};
					const mode = body.mode === "practice" ? "practice" : "teach";
					const goal = typeof body.goal === "string" ? body.goal : "";
					if (goal.trim().length === 0) return json({ error: "say what you want to learn first" }, 400);
					const controller = scoped.get("sessionController");
					if (!controller) return json({ error: "session controller unavailable" }, 503);
					try {
						const created = await (controller as {
							create(request: Record<string, unknown>): Promise<{ sessionId: string }>;
						}).create({});
						const sessionId = created.sessionId;
						const session = scoped.sessions.get(sessionId as never);
						if (!session) return json({ error: "created session unavailable" }, 503);
						appendLearningModeRecord(session, {
							enabled: true,
							phase: mode === "practice" ? "practice" : "probe",
							revision: 1,
						});
						// Mark the session in the list: the Learn Mode title badge.
						const title = `[${mode === "practice" ? "Practice" : "Learn"}] ${goal.replace(/\s+/g, " ").trim().slice(0, 60)}`;
						await (controller as {
							rename(request: Record<string, unknown>): Promise<unknown>;
						}).rename({ sessionId, title }).catch(() => {
							// A rename failure never blocks the lesson; the marker
							// text still carries the kind for the fold.
						});
						const marker = `[deep-learning: ${mode}]`;
						await (controller as {
							prompt(request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
						}).prompt(
							{
								sessionId,
								mode: "queue",
								content: [{ type: "text", text: `${marker}\n${goal}` }],
								requestId: `dl-${sessionId}-${Date.now()}`,
							},
							// The controller calls signal.throwIfAborted() — a real
							// signal is required, never undefined.
							new AbortController().signal,
						).catch(() => {
							// The prompt is queued best-effort; the learner can send
							// it themselves if this path failed.
						});
						return json({ ok: true, sessionId });
					} catch (err) {
							return json({ error: err instanceof Error ? err.message : "session create failed" }, 500);
						}
					},
			});
yield scoped.connection.fetch.register({
				path: "/api/deep-learning/models",
				methods: ["GET"],
				requestBody: "buffered",
				fetch: async () => {
					// The harness's own live catalog - providers + models for the
					// settings dropdowns (the Models page's source, same API).
					try {
						// sessionController.modelCatalog(): the same typed call
						// the Models page makes — the service owns its injects.
						const controller = scoped.get("sessionController") as {
							modelCatalog?(): Promise<unknown>;
						} | undefined;
						if (!controller || typeof controller.modelCatalog !== "function") {
							return json({ error: "model catalog unavailable" }, 503);
						}
						const catalog = await controller.modelCatalog();
						return json(catalog);
					} catch (err) {
						return json({ error: err instanceof Error ? err.message : String(err) }, 500);
					}
				},
			});
			yield scoped.connection.fetch.register({
				path: "/api/deep-learning/notes/import",
				methods: ["POST"],
				requestBody: "buffered",
				fetch: async (request: Request) => {
					const body = (await request.json().catch(() => ({}))) as { text?: string; filePath?: string };
					const text = typeof body.text === "string" ? body.text : "";
					const filePath = typeof body.filePath === "string" && body.filePath.length > 0 ? body.filePath : "pasted.md";
					const effective = resolveSettings(settingsStore.read());
					const extractorRoute = effective.agent.models.extractor;
					const auditorRoute = effective.agent.models.auditor;
					if (!extractorRoute || !auditorRoute) {
						return json({ error: "extraction roles not configured — set the extractor/auditor models in Settings > Deep Learning" }, 503);
					}
					const { importNotes } = await import("./server/extraction.js");
					const stats = await importNotes({
						llm: scoped.llm as never as import("./server/roles.js").LlmLike,
						extractor: { provider: extractorRoute.provider, model: extractorRoute.id },
						auditor: { provider: auditorRoute.provider, model: auditorRoute.id },
						filePath,
						text,
						store: graphStore,
						chunkTokens: effective.graph.extractionChunkTokens,
					});
					return json({ ok: true, nodes: stats.nodes, chains: stats.chains ?? 0 });
				},
			});
		}, "deep-learning: web routes");
	});

}

type LearningModeProjectionRegistrar = (definition: typeof learningModeProjection) => () => void;

/**
 * dsh-session-projection 0.2.1-rc.4 declares the registry overload against
 * its private ./types.ts module, while the public projection definition
 * re-exports that table through the package root. The runtime contract is
 * identical; keep the compatibility assertion at this package boundary.
 */
function registerLearningModeProjection(registry: { register: (...args: never[]) => () => void }): void {
	const register = registry.register.bind(registry) as unknown as LearningModeProjectionRegistrar;
	register(learningModeProjection);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function promptsRootOf(): string {
	// The package ships prompts/ next to lib/.
	return path.resolve(import.meta.dirname, "../../prompts");
}

function textOfContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text")
		.map((c) => c.text)
		.join("\n");
}

/** Adapt a SessionTool to the host ToolDefinition surface (a structural
 *  subset — the registry accepts a definition with these fields present). */
function toHostTool(
	tool: { name: string; description: string; parameters: Record<string, unknown>; outputSchema: Record<string, unknown>; execute: (args: unknown, exec: { callId: string }) => Promise<unknown> },
	_runtimeOf: () => TeachingRuntime,
): never {
	// The registered definition adapts the DSH ToolDefinition shape; the
	// runtime binds execute through the definition's own scope.
	return {
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		output: {
			schema: tool.outputSchema,
			render: (_args: unknown, value: unknown) => {
				const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
				return [{ type: "text", text }] as never;
			},
		},
		async execute(args: unknown, exec: { callId: string }) {
			const result = await tool.execute(args, { callId: exec.callId });
			return result;
		},
		// Teach questions and probe_done/problem poses conclude the turn:
		// the learner answers outside the turn.
		concludesTurn: concludesLearningToolTurn(tool.name),
	} as never;
}

// No `export default`: the DSH loader resolve prefers `exports.default` over
// the module face, and a bare function drops the exported `inject` list —
// the plugin would activate with an empty service declaration. Named exports
// only (same contract as dsh-doublecheck and the other bundled plugins).
