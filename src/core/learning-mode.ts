import {
  appendPluginRecord,
  pluginRecordOf,
  type PluginRecordMap,
  type Session,
  type SessionEvent,
  type SessionSeq,
} from "@deepseek-ai/dsh-session";
import type {
  ProjectionDefinition,
  SessionProjectionMap,
  SessionProjectionStateMap,
} from "@deepseek-ai/dsh-session-projection";
import { z } from "zod";

export type LearningPhase = "probe" | "plan" | "teach" | "practice";

export interface LearningModeState {
  enabled: boolean;
  phase: LearningPhase;
  revision: number;
}

export interface LearningModeRecordPayload {
  version: 1;
  state: LearningModeState;
}

export const LEARNING_MODE_RECORD_TYPE = "plugin:deep-learning/learning-mode" as const;

const learningPhaseSchema = z.enum(["probe", "plan", "teach", "practice"]);
export const learningModeStateSchema: z.ZodType<LearningModeState> = z.object({
  enabled: z.boolean(),
  phase: learningPhaseSchema,
  revision: z.number().int().nonnegative(),
});

const learningModeRecordSchema: z.ZodType<LearningModeRecordPayload> = z.object({
  version: z.literal(1),
  state: learningModeStateSchema,
});

export const INITIAL_LEARNING_MODE_STATE: LearningModeState = {
  enabled: false,
  phase: "probe",
  revision: 0,
};

export function parseLearningModeState(value: unknown): LearningModeState {
  const parsed = learningModeStateSchema.safeParse(value);
  return parsed.success ? parsed.data : INITIAL_LEARNING_MODE_STATE;
}

export function readLearningModeState(registry: unknown, session: unknown): LearningModeState {
  if (typeof registry !== "object" || registry === null) return INITIAL_LEARNING_MODE_STATE;
  const stateOf = (registry as { stateOf?: unknown }).stateOf;
  if (typeof stateOf !== "function") return INITIAL_LEARNING_MODE_STATE;
  try {
    const value = (stateOf as (this: unknown, session: unknown, key: string) => unknown).call(
      registry,
      session,
      "deep-learning/learning-mode",
    );
    return parseLearningModeState(value);
  } catch {
    return INITIAL_LEARNING_MODE_STATE;
  }
}

export function resolveLearningModeMutation(
  current: LearningModeState,
  mutation: unknown,
): LearningModeState | null {
  if (typeof mutation !== "object" || mutation === null) return null;
  const value = mutation as { toggle?: unknown; enabled?: unknown };
  if (value.toggle === true) {
    return { ...current, enabled: !current.enabled, revision: current.revision + 1 };
  }
  if (typeof value.enabled !== "boolean") return null;
  if (value.enabled === current.enabled) return current;
  return { ...current, enabled: value.enabled, revision: current.revision + 1 };
}

export function appendLearningModeRecord(
  session: Session,
  state: LearningModeState,
): SessionSeq {
  const payload = learningModeRecordSchema.parse({ version: 1, state });
  return appendPluginRecord(session, LEARNING_MODE_RECORD_TYPE, payload);
}

export function reduceLearningMode(
  state: LearningModeState,
  event: SessionEvent,
): LearningModeState {
  const record = pluginRecordOf(event);
  if (!record || record.type !== LEARNING_MODE_RECORD_TYPE) return state;

  const payload = learningModeRecordSchema.safeParse(record.data);
  return payload.success ? payload.data.state : state;
}

export const learningModeProjection: ProjectionDefinition<
  "deep-learning/learning-mode",
  LearningModeState
> = {
  key: "deep-learning/learning-mode",
  stateSchema: learningModeStateSchema,
  init: () => INITIAL_LEARNING_MODE_STATE,
  apply: reduceLearningMode,
  wire: {
    viewSchema: learningModeStateSchema,
    view: (state) => state,
  },
  stateVersion: 1,
};

declare module "@deepseek-ai/dsh-session/types" {
  interface PluginRecordMap {
    "plugin:deep-learning/learning-mode": LearningModeRecordPayload;
  }
}

declare module "@deepseek-ai/dsh-session-projection" {
  interface SessionProjectionMap {
    "deep-learning/learning-mode": LearningModeState;
  }

  interface SessionProjectionStateMap {
    "deep-learning/learning-mode": LearningModeState;
  }
}

declare module "@deepseek-ai/dsh-session-projection/types" {
  interface SessionProjectionMap {
    "deep-learning/learning-mode": LearningModeState;
  }

  interface SessionProjectionStateMap {
    "deep-learning/learning-mode": LearningModeState;
  }
}

export type _LearningModePluginRecordMap = PluginRecordMap;
export type _LearningModeProjectionMap = SessionProjectionMap;
export type _LearningModeProjectionStateMap = SessionProjectionStateMap;
