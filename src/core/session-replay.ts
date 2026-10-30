import { pluginRecordOf, type SessionEvent } from "@deepseek-ai/dsh-session";
import {
  INITIAL_LEARNING_MODE_STATE,
  LEARNING_MODE_RECORD_TYPE,
  reduceLearningMode,
  type LearningModeState,
  type LearningPhase,
} from "./learning-mode.js";
import { phaseAt, type Phase3, type PhaseEvent } from "./phases.js";

export interface ReplayFoldEvent {
  type: string;
  message?: {
    id?: string;
    role?: string;
    content?: unknown;
    source?: { kind?: string };
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  };
  callId?: string;
  name?: string;
  arguments?: unknown;
}

export interface LearningSessionReplay {
  kind: "teach" | "practice" | null;
  learningMode: LearningModeState;
  phase: LearningPhase;
  events: ReplayFoldEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } =>
      isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function dataOf(event: SessionEvent): Record<string, unknown> | null {
  return isRecord(event.data) ? event.data : null;
}

function messageOf(data: Record<string, unknown> | null): Record<string, unknown> | null {
  return data && isRecord(data.message) ? data.message : null;
}

function phaseFrom(mode: LearningModeState, events: readonly ReplayFoldEvent[]): LearningPhase {
  if (mode.phase === "practice") return "practice";
  const derived = phaseAt(toPhaseEvents(events));
  if (mode.phase === "teach") return "teach";
  if (mode.phase === "plan" && derived === "probe") return "plan";
  return derived;
}

function toPhaseEvents(events: readonly ReplayFoldEvent[]): PhaseEvent[] {
  return events.map((event) => {
    if (event.type === "toolResult") {
      return {
        role: "toolResult",
        toolName: event.message?.toolName,
        isError: event.message?.isError,
      };
    }
    if (event.type === "tool/call") {
      return {
        role: "assistant",
        toolCalls: [{ name: event.name ?? "", arguments: event.arguments }],
      };
    }
    return { role: event.message?.role };
  });
}

function modeKind(mode: LearningModeState): "teach" | "practice" | null {
  if (!mode.enabled) return null;
  return mode.phase === "practice" ? "practice" : "teach";
}

export function foldLearningSessionEvent(
  state: LearningSessionReplay,
  event: SessionEvent,
): LearningSessionReplay {
  const nextMode = reduceLearningMode(state.learningMode, event);
  const data = dataOf(event);
  const message = messageOf(data);
  const nextEvents = state.events.slice();
  let legacyKind = state.kind;

  if (event.type === "tool/call" && data) {
    nextEvents.push({
      type: "tool/call",
      callId: typeof data.callId === "string" ? data.callId : undefined,
      name: typeof data.name === "string" ? data.name : undefined,
      arguments: parseArguments(data.arguments),
    });
  } else if ((event.type === "assistant/message" || event.type === "user/message") && message) {
    const role = typeof message.role === "string" ? message.role : undefined;
    const content = message.content;
    nextEvents.push({
      type: event.type,
      message: {
        id: typeof message.id === "string" ? message.id : undefined,
        role,
        content,
        source: isRecord(message.source) && typeof message.source.kind === "string"
          ? { kind: message.source.kind }
          : undefined,
      },
    });
    if (role === "user" && textOfContent(content).startsWith("[deep-learning:")) {
      legacyKind = textOfContent(content).includes("practice") ? "practice" : "teach";
    }
  } else if (event.type === "tool/result" && message) {
    const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    const call = nextEvents.find((candidate) => candidate.type === "tool/call" && candidate.callId === toolCallId);
    nextEvents.push({
      type: "toolResult",
      message: {
        role: "toolResult",
        toolName: call?.name,
        toolCallId,
        isError: message.isError === true,
      },
    });
  }

  const modeChanged = nextMode !== state.learningMode;
  const nextKind = modeChanged ? modeKind(nextMode) : legacyKind;
  return {
    kind: nextKind,
    learningMode: nextMode,
    phase: nextKind === "practice" ? "practice" : nextKind === null ? nextMode.phase : phaseFrom(nextMode, nextEvents),
    events: nextEvents,
  };
}

export function replayLearningSession(events: readonly SessionEvent[]): LearningSessionReplay {
  let state: LearningSessionReplay = {
    kind: null,
    learningMode: INITIAL_LEARNING_MODE_STATE,
    phase: "probe",
    events: [],
  };
  let sawModeRecord = false;
  for (const event of events) {
    const before = state.learningMode;
    const next = foldLearningSessionEvent(state, event);
    const record = pluginRecordOf(event);
    const hasModeRecord = record?.type === LEARNING_MODE_RECORD_TYPE;
    if (hasModeRecord && next.learningMode !== before) sawModeRecord = true;
    state = next;
    if (sawModeRecord) {
      state = {
        ...state,
        kind: modeKind(state.learningMode),
        phase: state.learningMode.enabled ? phaseFrom(state.learningMode, state.events) : state.learningMode.phase,
      };
    }
  }
  return state;
}

export function phaseEventsOf(events: readonly ReplayFoldEvent[]): PhaseEvent[] {
  return toPhaseEvents(events);
}

export type ReplayPhase = Phase3 | "practice";
