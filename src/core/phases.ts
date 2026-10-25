/**
 * Phase derivation — ported from learnharness src/core/phases.ts
 * (AGPL-3.0, amosblomqvist/learnharness). EXPLICIT EVENTS, never occupancy:
 *
 *   probe — until the prober's `probe_done` call CONCLUDES (a clean tool
 *           result; the assessment rides the call's arguments)
 *   plan  — probe concluded, until teaching actually BEGINS
 *   teach — the first quiz/explain tool call tagged with a `nodeId`
 *           (a question ABOUT a plan node — probe quizzes carry no nodeId
 *           in their schema, so nothing false-triggers). The CALL is the
 *           seam, not its answer.
 *
 * Practice sessions never enter this machine (a separate session kind).
 *
 * The transcript shape here is the DSH session-log projection: assistant
 * messages carry toolCalls; tool results carry role "toolResult" with
 * toolName + isError.
 */

/** The three phases of a teaching session, as the header/panel sees them. */
export const PHASES = ["probe", "plan", "teach"] as const;
export type Phase3 = (typeof PHASES)[number];

/**
 * Minimal structural slice of one transcript message for the phase scan.
 * Native DSH projection form: assistant carries toolCalls; results carry
 * toolName/isError.
 */
export interface PhaseEvent {
	role?: string;
	/** Assistant messages: the model's tool calls. */
	toolCalls?: ReadonlyArray<{ name: string; arguments: unknown }>;
	/** Tool-result messages. */
	toolName?: string;
	isError?: boolean;
}

/** A quiz/explain call's input carries `nodeId` iff it is tagged (teach-only). */
function taggedNodeId(input: unknown): boolean {
	return (
		typeof input === "object" &&
		input !== null &&
		typeof (input as { nodeId?: unknown }).nodeId === "string" &&
		((input as { nodeId: string }).nodeId as string).length > 0
	);
}

/** One message's advance of the phase (pure fold step). */
function advance(phase: Phase3, message: PhaseEvent | undefined): Phase3 {
	if (!message) return phase;
	// STRICTLY SEQUENTIAL: probe → plan only via a concluded probe_done,
	// plan → teach only via the first nodeId-tagged quizzing CALL (the call,
	// not its answer — an errored-and-retried call still proves teaching
	// began).
	if (message.role === "toolResult" && message.toolName === "probe_done") {
		if (phase === "probe" && message.isError !== true) phase = "plan";
	}
	if (message.role === "assistant" && Array.isArray(message.toolCalls)) {
		for (const call of message.toolCalls) {
			if (
				phase === "plan" &&
				(call.name === "quiz" || call.name === "explain") &&
				taggedNodeId(call.arguments)
			) {
				phase = "teach";
			}
		}
	}
	return phase;
}

/** The phase after folding the messages in order. */
export function phaseAt(messages: ReadonlyArray<PhaseEvent>): Phase3 {
	let phase: Phase3 = "probe";
	for (const message of messages) {
		phase = advance(phase, message);
	}
	return phase;
}
