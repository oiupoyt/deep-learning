/**
 * The teaching runtime — the plugin's tool registry + question pending
 * machinery, ported from learnharness src/agent/tools.ts + tool-execute.ts
 * (AGPL-3.0, amosblomqvist/learnharness), adapted to the DSH tool
 * contract (defineTool-shaped definitions; the registry registers them
 * per session scope).
 *
 * THE QUESTION LAW (ported): a question tool call PARKS — execute resolves
 * only when the learner answers (the browser card + dock companion post to
 * the plugin's answer route, which flips the pending record). The model
 * sees ONLY the compact verdict (compactAnswerForModel): selection,
 * graded correctness, confidence, thinking. The full graded record rides
 * the plugin's own JSON for the UI.
 *
 * THE MECHANIC LAW (ported): one quizzing tool at a time — multiple choice
 * (probe/quiz) or free recall (recall/explain), armed by the settings'
 * tools.explain switch. ask_user_question is the harness's own tool and
 * stays native.
 */

import { FsGraphStore } from "../store/graph.js";
import { FsSessionsStore } from "../store/sessions.js";
import {
	buildAnswer,
	compactAnswerForModel,
	explainInputProblems,
	quizInputProblems,
	normalizeOptions,
	questionNeedsReveal,
	resolveCorrect,
	shuffleOptions,
	seededRandom,
	toClientQuestion,
	askOptionProblems,
	type AnswerRequest,
	type QuestionData,
	type QuestionAnswerData,
} from "../core/question-core.js";
import { canonicalizePlan, planToMermaid } from "../core/plan-tree.js";
import { getGraph } from "../core/graph.js";
import { quizMechanics, resolveSettings, type UserSettings } from "../core/settings.js";
import { HANDOFF_TEXT, PROBE_DONE_ACK_TEXT, type ProbeAssessment } from "../core/contracts/probe.js";
import type { PlanTree } from "../core/contracts/plan.js";

// ─── the harness seam (what the plugin host injects per session) ─────────────

/** What the DSH host provides to the runtime. Injectable for tests. */
export interface HarnessSeam {
	/** The DSH session id. */
	sessionId: string;
	/** The session's kind: teach (probe→plan→teach) or practice. */
	kind: "teach" | "practice";
	/** Mark the current agent turn complete (probe_done / problem pose). */
	concludeTurn(): void;
	/** Queue a user-role message for the next turn (the handoff / wake
	 *  delivery seam). */
	queueMessage(text: string): Promise<void>;
	/** List the user's model pins (the settings role resolution). */
	listModelPins(): Record<string, unknown>;
	/** Run one background role to completion (research/demo/visual/pdf/
	 *  extractor/auditor); throws when the role is unconfigured. */
	runRole(role: string, input: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}

/** The composed runtime: tools by name + the pending-question machinery. */
export interface TeachingRuntime {
	/** The tool definitions, keyed by tool name. Each carries a DSH-shaped
	 *  definition (name/description/parameters/output/execute). */
	tools(): Record<string, SessionTool>;
	/** The pending question for a session, client-shaped (answers hidden);
	 *  null when none. */
	pendingQuestion(sessionId: string): ClientPending | null;
	/** Resolve the pending question with the learner's answer. Returns
	 *  false when no question is pending. */
	answerQuestion(sessionId: string, request: AnswerRequest): boolean;
	/** The persisted plan tree for a session (null before plan_init). */
	readTree(sessionId: string): PlanTree | null;
}

/** A client-facing pending question (the answer never ships to the client). */
export interface ClientPending {
	id: string;
	tool: string;
	kind: "quiz" | "ask" | "explain";
	questionType?: string;
	question: string;
	context?: string;
	mode: string;
	options: Array<{ label: string; value: string }>;
	/** The reveal law: teach-phase checks collapse behind the reveal. */
	needsReveal: boolean;
}

/** The DSH-shaped tool surface the runtime exposes (a structural subset of
 *  defineTool's definition — the host adapts and registers). */
export interface SessionTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	/** The output schema for the model-facing result. */
	outputSchema: Record<string, unknown>;
	execute(args: unknown, exec: { callId: string }): Promise<unknown>;
}

// ─── the pending-question record ──────────────────────────────────────────────

interface PendingRecord {
	toolCallId: string;
	sessionId: string;
	tool: string;
	data: QuestionData;
	resolve: (verdict: Record<string, unknown>) => void;
}

// ─── the runtime factory ─────────────────────────────────────────────────────

export interface RuntimeOptions {
	dataRoot: string;
	seam: HarnessSeam;
	/** The raw settings delta record (null = factory defaults). */
	settings: UserSettings | null;
	/** An existing pending record (crash resume); optional. */
	resume?: QuestionAnswerData | null;
}

export async function createTeachingRuntime(options: RuntimeOptions): Promise<TeachingRuntime> {
	const { seam } = options;
	const graphStore = new FsGraphStore(options.dataRoot);
	const sessions = new FsSessionsStore(options.dataRoot);
	const effective = resolveSettings(options.settings);
	const mechanics = quizMechanics(effective.agent.tools);

	const pending = new Map<string, PendingRecord>(); // keyed by sessionId (one question at a time — the original's dock law)

	const park = (toolCallId: string, tool: string, data: QuestionData): Promise<Record<string, unknown>> => {
		return new Promise((resolve) => {
			pending.set(seam.sessionId, {
				toolCallId,
				sessionId: seam.sessionId,
				tool,
				data,
				resolve: (verdict) => {
					pending.delete(seam.sessionId);
					resolve(verdict);
				},
			});
		});
	};

	// ── the quizzing tools ──

	const quizDescription = (name: "quiz" | "probe"): string => {
		const nodeClause =
			name === "quiz"
				? "REQUIRED type (predict/check) + nodeId naming the plan node this question is about — both validated at call time. "
				: "";
		return (
			`Ask the learner a graded ${name === "quiz" ? "check" : "probe"} question (multiple choice). ` +
			nodeClause +
			"The call ends the turn — the learner answers in the question card; the verdict (correctness, confidence, thinking) returns as the tool result. ONE question per turn."
		);
	};

	const makeQuizTool = (name: "quiz" | "probe"): SessionTool => {
		const isTeach = name === "quiz";
		return {
			name,
			description: quizDescription(name),
			parameters: isTeach
				? {
						type: "object",
						properties: {
							type: { oneOf: [{ const: "predict" }, { const: "check" }] },
							nodeId: { type: "string" },
							question: { type: "string" },
							options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label"] } },
							multiSelect: { type: "boolean" },
							explanation: { type: "string" },
							correctAnswer: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
							details: { type: "string" },
						},
						required: ["type", "nodeId", "question", "options", "explanation", "correctAnswer"],
					}
				: {
						type: "object",
						properties: {
							question: { type: "string" },
							options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label"] } },
							multiSelect: { type: "boolean" },
							explanation: { type: "string" },
							correctAnswer: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
							details: { type: "string" },
						},
						required: ["question", "options", "explanation", "correctAnswer"],
					},
			outputSchema: {
				type: "object",
				properties: { ok: { type: "boolean" }, verdict: { type: "object" } },
				required: ["ok"],
			},
			execute: async (args, exec) => {
				const input = args as {
					type?: string;
					nodeId?: string;
					question: string;
					options: Array<{ label: string; value?: string }>;
					multiSelect?: boolean;
					explanation: string;
					correctAnswer: string | string[];
					details?: string;
				};
				const problems = quizInputProblems(input);
				if (problems.length > 0) return { ok: false, error: problems.join("\n") };
				if (isTeach) {
					const tree = sessions.readTree(seam.sessionId);
					if (!tree) {
						return { ok: false, error: "No plan exists yet — author the map with plan_init before asking teach questions." };
					}
					const nodeId = input.nodeId ?? "";
					if (!tree.nodes.some((n) => n.id === nodeId)) {
						return {
							ok: false,
							error: `nodeId "${nodeId}" is not one of this session's plan nodes (${tree.nodes.map((n) => n.id).join(", ")}).`,
						};
					}
				}
				if (pending.has(seam.sessionId)) {
					return { ok: false, error: "A question is already pending — one question at a time." };
				}
				const options = shuffleOptions(normalizeOptions(input.options), seededRandom(exec.callId));
				const { indices, error } = resolveCorrect(input.correctAnswer, options);
				if (error) return { ok: false, error };
				const verdictPromise = park(exec.callId, name, {
					id: exec.callId,
					kind: "quiz",
					questionType: isTeach ? (input.type as QuestionData["questionType"]) : undefined,
					question: input.question,
					context: input.details,
					mode: input.multiSelect === true ? "multi-select" : "single-select",
					options,
					correctIndices: indices,
					explanation: input.explanation,
					createdAt: new Date().toISOString(),
				});
				const verdict = await verdictPromise;
				return { ok: true, verdict };
			},
		};
	};

	const makeExplainTool = (name: "explain" | "recall"): SessionTool => {
		const isTeach = name === "explain";
		return {
			name,
			description:
				`Ask the learner a free-recall ${isTeach ? "check" : "probe"} question — they answer in their own words. ` +
				(isTeach
					? "REQUIRED type (predict/check) + nodeId naming the plan node. "
					: "") +
				"The commitment (correctAnswer) is written BEFORE posing, hidden from the learner until they answer; your next reply grades their words against it strictly.",
			parameters: isTeach
				? {
						type: "object",
						properties: {
							type: { oneOf: [{ const: "predict" }, { const: "check" }] },
							nodeId: { type: "string" },
							question: { type: "string" },
							correctAnswer: { type: "string" },
							details: { type: "string" },
						},
						required: ["type", "nodeId", "question", "correctAnswer"],
					}
				: {
						type: "object",
						properties: { question: { type: "string" }, correctAnswer: { type: "string" }, details: { type: "string" } },
						required: ["question", "correctAnswer"],
					},
			outputSchema: {
				type: "object",
				properties: { ok: { type: "boolean" }, verdict: { type: "object" } },
				required: ["ok"],
			},
			execute: async (args, exec) => {
				const input = args as {
					type?: string;
					nodeId?: string;
					question: string;
					correctAnswer: string;
					details?: string;
				};
				const problems = explainInputProblems(input);
				if (problems.length > 0) return { ok: false, error: problems.join("\n") };
				if (isTeach) {
					const tree = sessions.readTree(seam.sessionId);
					if (!tree) {
						return { ok: false, error: "No plan exists yet — author the map with plan_init before asking teach questions." };
					}
					const nodeId = input.nodeId ?? "";
					if (!tree.nodes.some((n) => n.id === nodeId)) {
						return {
							ok: false,
							error: `nodeId "${nodeId}" is not one of this session's plan nodes (${tree.nodes.map((n) => n.id).join(", ")}).`,
						};
					}
				}
				if (pending.has(seam.sessionId)) {
					return { ok: false, error: "A question is already pending — one question at a time." };
				}
				const verdictPromise = park(exec.callId, name, {
					id: exec.callId,
					kind: "explain",
					questionType: isTeach ? (input.type as QuestionData["questionType"]) : undefined,
					question: input.question,
					context: input.details,
					mode: "text",
					options: [],
					committedAnswer: input.correctAnswer,
					createdAt: new Date().toISOString(),
				});
				const verdict = await verdictPromise;
				return { ok: true, verdict };
			},
		};
	};

	// ── probe_done (the phase seam) ──

	const probeDone: SessionTool = {
		name: "probe_done",
		description:
			"Conclude the probe: submit the learner assessment (dependency strands, each with your read of their edge). The assessment shows to the learner; the teacher plans from it. Exactly one call; refused while a question is open.",
		parameters: {
			type: "object",
			properties: {
				assessment: {
					type: "object",
					properties: {
						strands: {
							type: "array",
							items: {
								type: "object",
								properties: {
									strand: { type: "string" },
									assessment: { type: "string" },
								},
								required: ["strand", "assessment"],
							},
						},
						summary: { type: "string" },
					},
					required: ["strands"],
				},
			},
			required: ["assessment"],
		},
		outputSchema: { type: "object", properties: { ok: { type: "boolean" }, text: { type: "string" } }, required: ["ok"] },
		execute: async (args) => {
			if (pending.has(seam.sessionId)) {
				return { ok: false, error: "A question is still open — resolve it before concluding." };
			}
			if (sessions.readProbe(seam.sessionId)) {
				return { ok: false, error: "The probe is already concluded." };
			}
			const input = args as { assessment: ProbeAssessment };
			const assessment = input.assessment;
			if (!assessment || !Array.isArray(assessment.strands) || assessment.strands.length === 0) {
				return { ok: false, error: "assessment.strands must name at least one dependency strand." };
			}
			sessions.saveProbe(seam.sessionId, assessment);
			// The turn ends; the handoff queues the teacher's first move.
			seam.concludeTurn();
			void seam.queueMessage(HANDOFF_TEXT).catch(() => {
				// The transcript is the source of truth: a lost wake is
				// healed by the learner's next message constructing the teacher.
			});
			return { ok: true, text: PROBE_DONE_ACK_TEXT };
		},
	};

	// ── plan_init (the author-once map) ──

	const planInit: SessionTool = {
		name: "plan_init",
		description:
			"Write or REWRITE this session's plan map — the dependency graph the learner follows live. " +
			"A mermaid graph block: one node per line (`slug[Short Title]` — slugs are permanent lowercase ids), `-->` edges meaning 'from must be understood before to'. " +
			"Re-call whenever the map is wrong; the new block replaces the old tree. Every check you fire names the node it assesses via `nodeId`.",
		parameters: {
			type: "object",
			properties: { mermaid: { type: "string" } },
			required: ["mermaid"],
		},
		outputSchema: {
			type: "object",
			properties: { ok: { type: "boolean" }, nodeIds: { type: "array", items: { type: "string" } }, error: { type: "string" } },
			required: ["ok"],
		},
		execute: async (args) => {
			const input = args as { mermaid: string };
			const previous = sessions.readTree(seam.sessionId);
			const result = canonicalizePlan(input.mermaid, previous?.version ?? 0);
			if (!result.ok) return { ok: false, error: result.error };
			sessions.saveTree(seam.sessionId, result.tree);
			return {
				ok: true,
				nodeIds: result.tree.nodes.map((n) => n.id),
				reminder: "These ids are binding for every quiz/explain call's nodeId.",
			};
		},
	};

	// ── practice tools (problem / conclude) ──

	const problemTool: SessionTool = {
		name: "problem",
		description:
			"Pose one practice problem. Ends the turn — the learner works in the thinking field; their thinking traces and answer commits arrive back as labeled messages. The modelSolution rides this call's arguments and stays hidden until you conclude. Only one problem may be active — conclude it before posing the next.",
		parameters: {
			type: "object",
			properties: {
				statement: { type: "string" },
				mode: { oneOf: [{ const: "recall" }, { const: "discrimination" }, { const: "composition" }] },
				target: { type: "array", items: { type: "string" } },
				modelSolution: { type: "string" },
			},
			required: ["statement", "mode", "modelSolution"],
		},
		outputSchema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } }, required: ["ok"] },
		execute: async (args, exec) => {
			const input = args as { statement: string; mode: string; target?: string[]; modelSolution: string };
			if (!input.statement?.trim()) return { ok: false, error: "statement is required." };
			if (!input.modelSolution?.trim()) return { ok: false, error: "modelSolution is required — commit to the full solution BEFORE posing." };
			if (pending.has(seam.sessionId)) {
				return { ok: false, error: "a problem is already active — call conclude on it before posing the next one" };
			}
			// target validation against the whole graph, only when present
			if (input.target && input.target.length > 0 && effective.graph.enabled) {
				const graph = getGraph(graphStore);
				const known = new Set(graph.nodes.map((n) => n.id));
				const unknown = input.target.filter((t) => !known.has(t));
				if (unknown.length > 0) {
					return {
						ok: false,
						error: `target ${JSON.stringify(unknown)} is not a known proposition — targets must be proposition ids from the session context; if the material is not in the map, omit target entirely`,
					};
				}
			}
			// The pose parks like a question (the learner's working field
			// submits through the same lane); the turn ends.
			pending.set(seam.sessionId, {
				toolCallId: exec.callId,
				sessionId: seam.sessionId,
				tool: "problem",
				data: {
					id: exec.callId,
					kind: "explain", // the working lane is free text
					question: input.statement,
					mode: "text",
					options: [],
					committedAnswer: input.modelSolution, // the hidden commitment (the reveal)
					createdAt: new Date().toISOString(),
				},
				resolve: (verdict) => {
					pending.delete(seam.sessionId);
					// The problem pose itself resolves immediately: practice
					// submissions arrive as new messages, not tool results.
					void verdict;
				},
			});
			seam.concludeTurn();
			return { ok: true };
		},
	};

	const concludeTool: SessionTool = {
		name: "conclude",
		description:
			"End the active problem: records the outcome and verdict, reveals the committed model solution verbatim. After the conclude result you may speak closing words and END YOUR TURN — no further tool calls. Rejected when no problem is active.",
		parameters: {
			type: "object",
			properties: {
				outcome: { oneOf: [{ const: "solved" }, { const: "solvedWithHints" }, { const: "movedOn" }, { const: "surrendered" }, { const: "dismissed" }] },
				verdict: { type: "string" },
				rung: { oneOf: [{ const: "R0" }, { const: "R1" }, { const: "R2" }, { const: "R3" }, { const: "R4" }, { const: "R5" }, { type: "null" }] },
				missClass: { oneOf: [{ const: "cue" }, { const: "discrimination" }, { const: "execution" }, { const: "careless" }, { const: "structural" }, { type: "null" }] },
				retest: { type: "boolean" },
			},
			required: ["outcome", "verdict", "rung", "missClass", "retest"],
		},
		outputSchema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } }, required: ["ok"] },
		execute: async () => {
			const record = pending.get(seam.sessionId);
			if (!record || record.tool !== "problem") {
				return { ok: false, error: "no problem is active — pose one with the problem tool first" };
			}
			record.resolve({ kind: "practice", concluded: true });
			return { ok: true, reveal: record.data.committedAnswer };
		},
	};

	// ── graph probes (the teacher's read-only reach into the ledgers) ──

	const graphTools: SessionTool[] = effective.graph.enabled && effective.graph.graphTools
		? [
				{
					name: "list_sessions",
					description:
						"List the learner's past learning sessions that contributed to the knowledge graph (birth sessions): title and proposition count, most recent first. Use this to ground what they already hold before re-probing.",
					parameters: { type: "object", properties: {} },
					outputSchema: {
						type: "object",
						properties: { sessions: { type: "array", items: { type: "object" } } },
						required: ["sessions"],
					},
					execute: async () => {
						const graph = getGraph(graphStore);
						const byBirth = new Map<string, number>();
						for (const node of graph.nodes) {
							const birth = node.provenance[0]?.chatId;
							if (birth) byBirth.set(birth, (byBirth.get(birth) ?? 0) + 1);
						}
						const sources = new Map(graphStore.readSources().map((s) => [s.id, s]));
						return {
							sessions: [...byBirth.entries()]
								.map(([id, propositions]) => ({
									id,
									name: sources.get(id)?.filePath ?? id,
									propositions,
								}))
								.sort((a, b) => b.propositions - a.propositions),
						};
					},
				},
				{
					name: "list_propositions",
					description:
						"List the propositions BORN in one session (what that session first articulated): the compact names the graph shows at a glance. Read these to see what the learner already holds; do not re-teach them.",
					parameters: {
						type: "object",
						properties: { session: { type: "string", description: "The session id from list_sessions." } },
						required: ["session"],
					},
					outputSchema: {
						type: "object",
						properties: { propositions: { type: "array", items: { type: "object" } } },
						required: ["propositions"],
					},
					execute: async (args) => {
						const input = args as { session: string };
						const graph = getGraph(graphStore);
						return {
							propositions: graph.nodes
								.filter((n) => n.provenance[0]?.chatId === input.session)
								.map((n) => ({ id: n.id, name: n.name }))
								.sort((a, b) => (a.id < b.id ? -1 : 1)),
						};
					},
				},
			]
		: [];

	// ── the registry (mechanics-gated) ──

	const tools: Record<string, SessionTool> = {};
	if (seam.kind === "teach") {
		// The quizzing mechanic arms ONE tool pair.
		if (mechanics === "choice") {
			tools.probe = makeQuizTool("probe");
			tools.quiz = makeQuizTool("quiz");
		} else {
			tools.recall = makeExplainTool("recall");
			tools.explain = makeExplainTool("explain");
		}
		tools.probe_done = probeDone;
		tools.plan_init = planInit;
		for (const tool of graphTools) tools[tool.name] = tool;
	} else {
		tools.problem = problemTool;
		tools.conclude = concludeTool;
	}

	const runtime: TeachingRuntime = {
		tools: () => tools,
		pendingQuestion(sessionId: string): ClientPending | null {
			const record = pending.get(sessionId);
			if (!record) return null;
			const client = toClientQuestion(record.data);
			return {
				id: record.toolCallId,
				tool: record.tool,
				kind: record.data.kind,
				questionType: record.data.questionType,
				question: client.question,
				context: client.context,
				mode: client.mode,
				options: client.options.map((o) => ({ label: o.label, value: o.value })),
				needsReveal: questionNeedsReveal(record.tool, { type: record.data.questionType }, "teach"),
			};
		},
		answerQuestion(sessionId: string, request: AnswerRequest): boolean {
			const record = pending.get(sessionId);
			if (!record) return false;
			const answer = buildAnswer(record.data, request, record.tool);
			const verdict = compactAnswerForModel(answer);
			record.resolve(verdict);
			return true;
		},
		readTree(sessionId: string): PlanTree | null {
			return sessions.readTree(sessionId);
		},
	};

	return runtime;
}
