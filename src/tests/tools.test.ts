// Red step for the tool registry: the teaching tools (quiz/probe/explain/
// recall variants, ask is the harness's own, probe_done, plan_init, problem,
// conclude, graph probes) with authoring validation, question pending
// grading/resolve, plan-tree persistence, and probe persistence.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createTeachingRuntime, type TeachingRuntime, type HarnessSeam } from "../server/tools.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dl-tools-"));

/** A scripted harness seam: records side effects, answers nothing. */
function fakeSeam(overrides: Partial<HarnessSeam> = {}): HarnessSeam {
	return {
		sessionId: "sess_1",
		kind: "teach" as const,
		concludeTurn: () => {},
		queueMessage: async () => {},
		listModelPins: () => ({}) as never,
		runRole: async () => {
			throw new Error("no role in tests");
		},
		...overrides,
	};
}

async function runtime(): Promise<TeachingRuntime> {
	return createTeachingRuntime({ dataRoot: root, seam: fakeSeam(), settings: null });
}

test("probe quiz tool validates authoring (Gate-3) and parks a pending question", async () => {
	const rt = await runtime();
	const probeTool = rt.tools()["probe"];
	assert.ok(probeTool, "probe tool exists");
	// invalid: duplicate option values -> error result the model retries on
	const bad = await probeTool.execute(
		{
			question: "Q?",
			options: [
				{ label: "A", value: "x" },
				{ label: "B", value: "x" },
			],
			explanation: "e",
			correctAnswer: "x",
		} as never,
		{ callId: "call_1" } as never,
	);
	assert.equal((bad as { ok: boolean }).ok, false);
	// valid: parks pending; execute resolves only when answered
	const asked = probeTool.execute(
		{
			question: "Which planet is closest?",
			options: [
				{ label: "Mercury", value: "mercury" },
				{ label: "Venus", value: "venus" },
			],
			explanation: "Mercury is closest.",
			correctAnswer: "mercury",
		} as never,
		{ callId: "call_2" } as never,
	);
	const pending = rt.pendingQuestion("sess_1");
	assert.ok(pending, "question parked");
	assert.equal(pending!.question, "Which planet is closest?");
	// the graded shape is hidden from the client payload (no correctIndices/committed fields exist on ClientPending)
	// answering resolves the tool with the compact model-facing verdict
	const answered = rt.answerQuestion("sess_1", { values: ["mercury"], thinking: "guessed low", confidence: 90 });
	assert.equal(answered, true);
	const result = (await asked) as { ok: boolean; verdict: Record<string, unknown> };
	assert.equal(result.ok, true);
	assert.equal(result.verdict.kind, "quiz");
	assert.equal(result.verdict.correct, true);
	assert.equal(result.verdict.confidence, 90);
	assert.equal(result.verdict.thinking, "guessed low");
	const answer = (result.verdict.answers as Array<{ index: number; label: string }>)[0]!;
	assert.equal(answer.label, "Mercury");
	assert.ok(answer.index >= 1); // 1-based display order (post-shuffle)
	assert.equal(rt.pendingQuestion("sess_1"), null); // cleared
});

test("teach quiz requires type + nodeId validated against the session tree", async () => {
	let concluded = false;
	const rt = await createTeachingRuntime({
		dataRoot: root,
		seam: fakeSeam({ concludeTurn: () => (concluded = true) }),
		settings: null,
	});
	const quiz = rt.tools()["quiz"];
	assert.ok(quiz);
	// no tree yet: any nodeId is rejected
	const noTree = await quiz.execute(
		{
			type: "check",
			nodeId: "chain-rule",
			question: "Q?",
			options: [
				{ label: "A", value: "a" },
				{ label: "B", value: "b" },
			],
			explanation: "e",
			correctAnswer: "a",
		} as never,
		{ callId: "call_3" } as never,
	);
	assert.equal((noTree as { ok: boolean }).ok, false);
	// write a tree via plan_init, then the tagged call parks
	const plan = rt.tools()["plan_init"];
	assert.ok(plan);
	const planResult = (await plan.execute(
		{ mermaid: "graph TD\n  basics --> chain-rule\n  chain-rule --> goal" } as never,
		{ callId: "call_4" } as never,
	)) as { ok: boolean; nodeIds?: string[] };
	assert.equal(planResult.ok, true);
	assert.deepEqual(planResult.nodeIds, ["basics", "chain-rule", "goal"]);
	const asked = quiz.execute(
		{
			type: "check",
			nodeId: "chain-rule",
			question: "What follows?",
			options: [
				{ label: "A", value: "a" },
				{ label: "B", value: "b" },
			],
			explanation: "e",
			correctAnswer: "a",
		} as never,
		{ callId: "call_5" } as never,
	);
	assert.ok(rt.pendingQuestion("sess_1"));
	rt.answerQuestion("sess_1", { dontKnow: true });
	const result = (await asked) as { ok: boolean; verdict: Record<string, unknown> };
	assert.equal(result.ok, true);
	assert.deepEqual(result.verdict, { kind: "quiz", dontKnow: true });
});

test("plan_init rejects a cycle with the named culprit edge", async () => {
	const rt = await runtime();
	const plan = rt.tools()["plan_init"];
	assert.ok(plan, "plan_init tool exists");
	const bad = (await plan.execute(
		{ mermaid: "graph TD\n  a --> b\n  b --> a" } as never,
		{ callId: "call_6" } as never,
	)) as { ok: boolean; error: string };
	assert.equal(bad.ok, false);
	assert.ok(bad.error.includes("cycle"));
});

test("probe_done persists the assessment and queues the handoff", async () => {
	const queued: string[] = [];
	let concluded = false;
	const rt = await createTeachingRuntime({
		dataRoot: root,
		seam: fakeSeam({
			queueMessage: async (text) => void queued.push(text),
			concludeTurn: () => (concluded = true),
		}),
		settings: null,
	});
	const done = rt.tools()["probe_done"];
	assert.ok(done);
	const result = (await done.execute(
		{
			assessment: {
				strands: [{ strand: "limits", assessment: "floor: functions; ceiling: epsilon-delta" }],
				summary: "ready for derivatives",
			},
		} as never,
		{ callId: "call_7" } as never,
	)) as { ok: boolean };
	assert.equal(result.ok, true);
	assert.equal(concluded, true); // the turn ends at probe_done
	// the assessment is persisted (the plugin record)
	const probeFile = path.join(root, "sessions", "sess_1", "probe.json");
	assert.ok(fs.existsSync(probeFile));
	// the handoff text queued for the next turn
	assert.equal(queued.length, 1);
	assert.ok(queued[0]!.includes("[Handoff]"));
});

test("free-recall mechanic swaps probe/quiz for recall/explain", async () => {
	const rt = await createTeachingRuntime({
		dataRoot: root,
		seam: fakeSeam(),
		settings: { agent: { tools: { explain: true } } },
	});
	const tools = rt.tools();
	assert.equal(tools["probe"], undefined);
	assert.ok(tools["recall"]);
	assert.equal(tools["quiz"], undefined);
	assert.ok(tools["explain"]);
});

test("graph probes list sessions and propositions from the ledgers", async () => {
	const rt = await createTeachingRuntime({
		dataRoot: root,
		seam: fakeSeam(),
		settings: { graph: { enabled: true, graphTools: { enabled: true } } },
	});
	const listSessions = rt.tools()["list_sessions"];
	const listProps = rt.tools()["list_propositions"];
	assert.ok(listSessions && listProps);
	const sessions = (await listSessions.execute({} as never, { callId: "c" } as never)) as {
		sessions: unknown[];
	};
	assert.deepEqual(sessions.sessions, []); // empty ledger reads empty
	const props = (await listProps.execute({ session: "chat_calculus" } as never, { callId: "c" } as never)) as {
		propositions: unknown[];
	};
	assert.deepEqual(props.propositions, []);
});

