import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Session, pluginRecordOf, type SessionEvent, type SessionId, type SessionSeq } from "@deepseek-ai/dsh-session";
import {
  INITIAL_LEARNING_MODE_STATE,
  LEARNING_MODE_RECORD_TYPE,
  learningModeProjection,
  parseLearningModeState,
  resolveLearningModeMutation,
  appendLearningModeRecord,
  reduceLearningMode,
  type LearningModeState,
} from "../core/learning-mode.js";

test("learning mode appends a durable whole-state record and projects it", () => {
  const session = Session.create("learning-test" as SessionId);
  const enabledState: LearningModeState = { enabled: true, phase: "probe", revision: 1 };
  const seq = appendLearningModeRecord(session, enabledState);
  const event = session.snapshotEvents()[0];

  assert.equal(seq, 0);
  assert.ok(event);
  const record = pluginRecordOf(event);
  assert.equal(record?.type, LEARNING_MODE_RECORD_TYPE);
  assert.deepEqual(record?.data, { version: 1, state: enabledState });
  assert.deepEqual(reduceLearningMode(INITIAL_LEARNING_MODE_STATE, event), enabledState);

  const disabledState: LearningModeState = { enabled: false, phase: "probe", revision: 2 };
  const disabledSeq = appendLearningModeRecord(session, disabledState);
  const disabledEvent = session.snapshotEvents()[disabledSeq as number];
  assert.ok(disabledEvent);
  assert.deepEqual(
    learningModeProjection.apply(enabledState, disabledEvent),
    disabledState,
  );
});

test("learning mode ignores unrelated and malformed events without changing state identity", () => {
  const state = { enabled: true, phase: "teach", revision: 4 } satisfies LearningModeState;
  const unrelated: SessionEvent = {
    type: "turn/start",
    seq: 3 as SessionSeq,
    time: 0,
    data: { turn: 1 },
  };
  const malformed = {
    type: LEARNING_MODE_RECORD_TYPE,
    seq: 4,
    time: 0,
    ignorable: true,
    data: { version: 1, state: { enabled: "yes" } },
  } as unknown as SessionEvent;

  assert.equal(learningModeProjection.apply(state, unrelated), state);
  assert.equal(learningModeProjection.apply(state, malformed), state);
});

test("learning mode reader validates restored projection values", () => {
  const restored = { enabled: true, phase: "teach", revision: 9 } satisfies LearningModeState;
  assert.deepEqual(parseLearningModeState(restored), restored);
  assert.deepEqual(parseLearningModeState({ enabled: "yes" }), INITIAL_LEARNING_MODE_STATE);
});

test("mode mutations toggle from authoritative state and explicit updates are idempotent", () => {
  const current = { enabled: true, phase: "teach", revision: 7 } satisfies LearningModeState;
  assert.deepEqual(resolveLearningModeMutation(current, { toggle: true }), { enabled: false, phase: "teach", revision: 8 });
  assert.equal(resolveLearningModeMutation(current, { enabled: true }), current);
  assert.equal(resolveLearningModeMutation(current, { enabled: "no" }), null);
});

test("learning mode projection validates and exposes the same client state shape", () => {
  const state = { enabled: true, phase: "plan", revision: 3 } satisfies LearningModeState;

  assert.equal(learningModeProjection.stateSchema.safeParse(state).success, true);
  assert.equal(learningModeProjection.wire?.viewSchema.safeParse(state).success, true);
  assert.deepEqual(learningModeProjection.wire?.view(state), state);
  assert.equal(learningModeProjection.stateVersion, 1);
});
