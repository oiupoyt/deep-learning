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
import "@deepseek-ai/dsh-agent";
import "@deepseek-ai/dsh-tools";
import "@deepseek-ai/dsh-system-prompt";
import "@deepseek-ai/dsh-host-webserver";
import "@deepseek-ai/dsh-web";
import { FsGraphStore } from "./store/graph.js";
import { FsSessionsStore, FsSettingsStore } from "./store/sessions.js";
import { createTeachingRuntime, type TeachingRuntime, type HarnessSeam } from "./server/tools.js";
import { composeInstructions } from "./server/prompts.js";
import { phaseAt, type PhaseEvent } from "./core/phases.js";
import { derivePlanStatuses } from "./core/plan-tree.js";
import { coverageOf, messageViewLines, type CoverageMessage } from "./core/coverage.js";
import { resolveSettings } from "./core/settings.js";
import type { UserSettings } from "./core/settings.js";
import type { PlanTree } from "./core/contracts/plan.js";

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
interface FoldEvent {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
		source?: { kind?: string };
		toolCallId?: string;
		toolName?: string;
		isError?: boolean;
	};
	turn?: number;
	step?: number;
	callId?: string;
	name?: string;
	arguments?: unknown;
}

/** A per-session fold state maintained over the event stream. */
interface SessionState {
	sessionId: string;
	kind: "teach" | "practice" | null;
	phase: "probe" | "plan" | "teach";
	/** Assistant messages in order, for phase/plan folds. */
	events: FoldEvent[];
	/** The live teaching runtime (tools + pending question). */
	runtime?: TeachingRuntime;
	runtimeKind?: "teach" | "practice";
	runtimeSettings?: string; // JSON of the settings snapshot it was built under
	pendingQuestionSeen: boolean;
}

export const name = "deep-learning";

/** Services the plugin waits for. */
export const inject = ["llm", "systemPrompt", "tools", "webServer", "session", "agents"];

/** Plugin configuration (none yet — the settings delta is the record). */
export interface Config {}

/** The plugin's host application. */
export function apply(ctx: Context, _config: Config): void {
	const dataRoot = dataRootOf(ctx);
	fs.mkdirSync(dataRoot, { recursive: true });
	const graphStore = new FsGraphStore(dataRoot);
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
				phase: "probe",
				events: [],
				pendingQuestionSeen: false,
			};
			states.set(sessionId, state);
		}
		return state;
	};

	/** Read the settings snapshot + build the session's runtime when the
	 *  kind is known. Rebuilt when the settings record changed (the
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
				await controller.prompt({
					sessionId: sessionId as never,
					mode: "queue",
					content: [{ type: "text", text }],
					requestId: `dl-${sessionId}-${Date.now()}` as never,
				});
			},
			listModelPins: () => settingsStore.read()?.models ?? ({} as never),
			runRole: async (role, input, signal) => {
				return runRoleJob(role, input, signal);
			},
		};
		const runtime = createTeachingRuntimeSync({ dataRoot, seam, settings: raw });
		state.runtime = runtime;
		state.runtimeKind = kind;
		state.runtimeSettings = snapshot;
		return runtime;
	};

	// createTeachingRuntime is async in the contract; the sync wrapper
	// exists because the host wiring constructs runtimes eagerly. The
	// promise resolves immediately (no awaits inside).
	function createTeachingRuntimeSync(options: {
		dataRoot: string;
		seam: HarnessSeam;
		settings: UserSettings | null;
	}): TeachingRuntime {
		let rt: TeachingRuntime | undefined;
		void createTeachingRuntime(options).then((resolved) => {
			rt = resolved;
		});
		// The factory performs no awaits before returning (see tools.ts);
		// a microtask has not run yet at synchronous call sites, so this
		// throws only if the contract changes.
		if (!rt) throw new Error("runtime factory must resolve synchronously");
		return rt;
	}

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
	async function runRoleJob(role: string, input: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
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
			if (role === "demo") return runDemoArtifact(options);
			return runVisualArtifact(options);
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

	// ── the session event fold (phases, kinds, coverage triggers) ─────────

	ctx.effect(function* () {
		yield ctx.on("session/event", (session, event: FoldEvent) => {
			const state = stateOf(session.id);
			// Tool results: the message carries toolCallId; the fold keeps the
			// paired call's name.
			if (event.type === "tool/result") {
				// The session event carries the message under `message`.
				const toolMessage = (event as unknown as { message?: { toolCallId?: string; isError?: boolean } }).message;
				if (toolMessage?.toolCallId) {
					// resolve name from the paired call in the fold
					const call = state.events.find((x) => x.type === "tool/call" && x.callId === toolMessage.toolCallId);
					state.events.push({
						type: "toolResult",
						message: {
							role: "toolResult",
							toolName: call?.name,
							isError: toolMessage.isError,
						},
					});
				}
				foldAdvance(state);
				return;
			}
			if (event.type === "tool/call") {
				state.events.push({
					type: "tool/call",
					callId: event.callId,
					name: event.name,
					arguments: event.arguments,
				});
				foldAdvance(state);
				return;
			}
			if (event.type === "assistant/message" || event.type === "user/message") {
				const message = (event as unknown as { message?: { role?: string; content?: unknown; source?: { kind?: string } } }).message;
				if (!message) return;
				state.events.push({
					type: event.type,
					message: {
						role: message.role,
						content: message.content,
						source: message.source,
					},
				});
				// The kind marker: a user message whose text starts with the
				// deep-learning session-context preamble.
				if (message.role === "user" && typeof message.content !== "undefined") {
					const text = textOfContent(message.content);
					if (text.startsWith("[deep-learning:")) {
						state.kind = text.includes("practice") ? "practice" : "teach";
					}
				}
				// Coverage: teacher prose only (assistant text blocks).
				if (message.role === "assistant" && state.kind === "teach") {
					maybeTriggerExtraction(state, session);
				}
				foldAdvance(state);
				return;
			}
			if (event.type === "turn/end") {
				foldAdvance(state);
				return;
			}
		});
	}, "deep-learning: session fold");

	/** Re-derive the phase + plan statuses after each event. */
	function foldAdvance(state: SessionState): void {
		if (state.kind !== "teach") return;
		const tree = sessionsStore.readTree(state.sessionId);
		const phaseEvents: PhaseEvent[] = state.events.map((e) => {
			if (e.type === "toolResult") {
				return { role: "toolResult", toolName: e.message?.toolName, isError: e.message?.isError };
			}
			if (e.type === "tool/call") {
				return { role: "assistant", toolCalls: [{ name: e.name ?? "", arguments: e.arguments }] };
			}
			return { role: e.message?.role };
		});
		state.phase = phaseAt(phaseEvents);
	}

	/** The extraction trigger: after a turn ends, when uncovered teacher
	 *  prose crosses the chunk budget (the ported seam). */
	function maybeTriggerExtraction(state: SessionState, _session: unknown): void {
		if (state.kind !== "teach") return;
		const effective = resolveSettings(settingsStore.read());
		if (!effective.graph.enabled) return;
		const messages: CoverageMessage[] = state.events
			.filter((e) => e.type === "assistant/message")
			.map((e) => ({
				id: (e as unknown as { message?: { id?: string } }).message?.id ?? `${e.type}-${state.events.indexOf(e)}`,
				role: "assistant",
				content: e.message?.content,
			}));
		// Note: coverage ids derive from message ids; the DSH log provides
		// them on the message. Absent ids use event positions (stable per
		// fold order but never persisted twice).
		const covered = coverageOf(messages, graphStore.readCoverage(), state.sessionId);
		if (covered.uncoveredTokens >= effective.graph.extractionChunkTokens) {
			void triggerExtraction(state);
		}
	}

	// ── the dynamic system prompt section ─────────────────────────────────

	ctx.effect(function* () {
		yield ctx.systemPrompt.section({
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

	ctx.effect(function* () {
		// The runtime registry is keyed by session; tools register on the
		// agent's creation and unregister on its disposal (global-scope
		// registration: DSH tools.register registers on the calling fiber;
		// per-agent scoping arrives with the plugin's own scope plumbing).
		const toolDisposers = new Map<string, Array<() => void>>();
		yield ctx.on("agent/created", ({ agent }) => {
			const state = states.get(agent.id);
			if (!state || state.kind === null) return;
			const kind = state.kind;
			const runtime = runtimeOf(agent.id, kind);
			const disposers: Array<() => void> = [];
			for (const tool of Object.values(runtime.tools())) {
				disposers.push(ctx.tools.register(toHostTool(tool, () => runtime)));
			}
			toolDisposers.set(agent.id, disposers);
		});
		yield ctx.on("agent/disposed", ({ agent }) => {
			const disposers = toolDisposers.get(agent.id);
			if (disposers) for (const dispose of disposers) dispose();
			toolDisposers.delete(agent.id);
			states.delete(agent.id);
		});
	}, "deep-learning: tools");

	// ── the web routes (the client bundle's API) ───────────────────────────

	ctx.effect(function* () {
		yield ctx.webServer.register({
			kind: "prefix",
			path: "/api/deep-learning",
			handler: async (req, res) => {
				const url = new URL(req.url ?? "/", "http://localhost");
				const route = url.pathname.replace(/\/+$/, "");
				try {
					// GET /api/deep-learning/question/:sessionId
					const questionMatch = route.match(/^\/api\/deep-learning\/question\/([^/]+)$/);
					if (req.method === "GET" && questionMatch) {
						const state = states.get(questionMatch[1]!);
						if (!state?.runtime) return json(res, 200, { question: null });
						return json(res, 200, { question: state.runtime.pendingQuestion(questionMatch[1]!) });
					}
					// POST /api/deep-learning/question/:sessionId/answer
					const answerMatch = route.match(/^\/api\/deep-learning\/question\/([^/]+)\/answer$/);
					if (req.method === "POST" && answerMatch) {
						const body = (await readJson(req)) as Record<string, unknown>;
						const state = states.get(answerMatch[1]!);
						if (!state?.runtime) return json(res, 409, { error: "no question pending" });
						const ok = state.runtime.answerQuestion(answerMatch[1]!, body as never);
						return json(res, ok ? 200 : 409, { ok });
					}
					// GET /api/deep-learning/graph — the snapshot (the ported
					// /api/graph, minimal payload for the panel wave)
					if (req.method === "GET" && route === "/api/deep-learning/graph") {
						const { graphSnapshot } = await import("./server/snapshot.js");
						return json(res, 200, graphSnapshot(graphStore, sessionsStore, ctx));
					}
					// GET /api/deep-learning/settings + PUT
					if (req.method === "GET" && route === "/api/deep-learning/settings") {
						return json(res, 200, { settings: settingsStore.read() });
					}
					if (req.method === "PUT" && route === "/api/deep-learning/settings") {
						const body = (await readJson(req)) as UserSettings;
						settingsStore.update(body);
						// invalidate cached runtimes (settings revision moved)
						for (const state of states.values()) state.runtimeSettings = "";
						return json(res, 200, { ok: true });
					}
					return json(res, 404, { error: "not found" });
				} catch (err) {
					return json(res, 500, { error: err instanceof Error ? err.message : "internal" });
				}
			},
		});
	}, "deep-learning: web routes");
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

function json(res: unknown, status: number, body: unknown): void {
	const r = res as {
		writeHead(status: number, headers: Record<string, string>): void;
		end(body: string): void;
	};
	r.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	r.end(JSON.stringify(body));
}

function readJson(req: unknown): Promise<unknown> {
	const chunks: Buffer[] = [];
	const r = req as { on(event: string, cb: (...args: unknown[]) => void): void };
	return new Promise((resolve, reject) => {
		r.on("data", (chunk) => chunks.push(chunk as Buffer));
		r.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}"));
			} catch (err) {
				reject(err);
			}
		});
		r.on("error", reject);
	});
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
		concludesTurn: ["probe_done", "problem"].includes(tool.name) || true,
	} as never;
}

export default apply;
