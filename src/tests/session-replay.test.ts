import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Session, type SessionEvent, type SessionId } from "@deepseek-ai/dsh-session";
import { appendLearningModeRecord } from "../core/learning-mode.js";
import { replayLearningSession, foldLearningSessionEvent } from "../core/session-replay.js";

function event(type: string, data: unknown, seq: number): SessionEvent {
  return { type, data, seq, time: seq } as unknown as SessionEvent;
}

test("restored teaching sessions recover mode, phase, kind, and tool history", () => {
  const session = Session.create("restore-teach" as SessionId);
  appendLearningModeRecord(session, { enabled: true, phase: "probe", revision: 1 });
  const history = [
    ...session.snapshotEvents(),
    event("user/message", { message: { id: "u1", role: "user", content: [{ type: "text", text: "[deep-learning: teach]" }], source: { kind: "user" } } }, 1),
    event("tool/call", { turn: 1, step: 1, callId: "probe-call", name: "probe_done", arguments: "{}" }, 2),
    event("tool/result", { turn: 1, step: 1, message: { role: "tool", toolCallId: "probe-call", isError: false, content: [] } }, 3),
    event("tool/call", { turn: 2, step: 1, callId: "quiz-call", name: "quiz", arguments: JSON.stringify({ nodeId: "n1", type: "check" }) }, 4),
  ];

  const restored = replayLearningSession(history);
  assert.equal(restored.kind, "teach");
  assert.equal(restored.learningMode.enabled, true);
  assert.equal(restored.phase, "teach");
  assert.equal(restored.events.length, 4);
  assert.equal(restored.events[3]?.arguments && (restored.events[3].arguments as { nodeId?: string }).nodeId, "n1");
});

test("latest durable off record overrides an older legacy kind marker", () => {
  const session = Session.create("restore-off" as SessionId);
  appendLearningModeRecord(session, { enabled: true, phase: "probe", revision: 1 });
  appendLearningModeRecord(session, { enabled: false, phase: "teach", revision: 2 });
  const restored = replayLearningSession(session.snapshotEvents());
  assert.equal(restored.kind, null);
  assert.deepEqual(restored.learningMode, { enabled: false, phase: "teach", revision: 2 });
});

test("legacy learning marker restores without a plugin mode record", () => {
  const marker = event("user/message", { message: { id: "u1", role: "user", content: [{ type: "text", text: "[deep-learning: practice]" }], source: { kind: "user" } } }, 0);
  const restored = replayLearningSession([marker]);
  assert.equal(restored.kind, "practice");
  assert.equal(restored.phase, "practice");
});

test("live event folding uses the same canonical event envelope as restore", () => {
  const session = Session.create("live-fold" as SessionId);
  appendLearningModeRecord(session, { enabled: true, phase: "probe", revision: 1 });
  const state = replayLearningSession(session.snapshotEvents());
  const called = foldLearningSessionEvent(state, event("tool/call", { turn: 1, step: 1, callId: "done", name: "probe_done", arguments: "{}" }, 1));
  const next = foldLearningSessionEvent(called, event("tool/result", { turn: 1, step: 1, message: { role: "tool", toolCallId: "done", isError: false, content: [] } }, 2));
  assert.equal(next.kind, "teach");
  assert.equal(next.phase, "plan");
  assert.equal(next.events[0]?.name, "probe_done");
});
