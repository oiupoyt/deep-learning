export interface LearningModeState {
  enabled: boolean;
  phase: "probe" | "plan" | "teach" | "practice";
  revision: number;
}

export async function readLearningMode(api: string, sessionId: string): Promise<LearningModeState> {
  const response = await fetch(api + "/mode?session=" + encodeURIComponent(sessionId));
  const value: unknown = await response.json();
  if (!response.ok || typeof value !== "object" || value === null || !("state" in value)) throw new Error("Could not read learning mode.");
  return parseState(value.state);
}

export function parseLearningModeStateResponse(value: unknown): LearningModeState {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || !isLearningPhase(value.phase)) {
    throw new Error("Learning mode returned invalid state.");
  }
  const revision = value.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Learning mode returned invalid state.");
  }
  return { enabled: value.enabled, phase: value.phase, revision };
}

function parseState(value: unknown): LearningModeState {
  return parseLearningModeStateResponse(value);
}

function isLearningPhase(value: unknown): value is LearningModeState["phase"] {
  return value === "probe" || value === "plan" || value === "teach" || value === "practice";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function mutateLearningMode(
  api: string,
  sessionId: string,
  mutation: { toggle: true } | { enabled: boolean },
): Promise<LearningModeState> {
  const response = await fetch(api + "/mode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: sessionId, ...mutation }),
  });
  const value: unknown = await response.json();
  if (!response.ok || typeof value !== "object" || value === null || !("state" in value)) {
    const message = typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : "Could not update learning mode.";
    throw new Error(message);
  }
  return parseLearningModeStateResponse(value.state);
}
