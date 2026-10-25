/**
 * Probe contracts — ported from learnharness src/core/contracts/probe.ts
 * (AGPL-3.0, amosblomqvist/learnharness). The prober concludes with
 * probe_done, whose input is the learner assessment (authored by the
 * model, streamed live, persisted by the plugin).
 */

/** One dependency strand the planned lesson will rest on. */
export interface ProbeStrand {
	/** Name/description of the strand (e.g. "the derivative as a limit"). */
	strand: string;
	/** Free-form: where the learner's edge sits — floor, ceiling,
	 *  misconceptions found, what to build from. */
	assessment: string;
}

/** The prober's read of the learner, carried by probe_done. */
export interface ProbeAssessment {
	strands: ProbeStrand[];
	/** Optional overall synthesis: the learner's apparent goal and edge. */
	summary?: string;
}

/** probe_done tool input. */
export interface ProbeDoneInput {
	assessment: ProbeAssessment;
}

/** The probe_done ack's model-facing text: the assessment is the CALL's
 *  arguments — durable in the transcript, streamed to the learner — so
 *  echoing it back would duplicate the probe phase's largest payload in
 *  every future context. */
export const PROBE_DONE_ACK_TEXT =
	"Assessment recorded — it is shown to the learner now and the teacher plans from it. Say your closing sentence and end your turn; the teaching phase takes over from here.";

/** The handoff steer's model-facing text (queued after the prober's turn
 *  ends; the teacher constructs from this point on). */
export const HANDOFF_TEXT =
	"[Handoff] The probe is complete — the assessment is in the transcript above. Plan the lesson now: present the approach and the map (plan_init), then begin teaching.";

/** The session-context marker's preamble law (injected context, not
 *  learner speech). */
export const SESSION_CONTEXT_HEADER =
	"[Session context] — picked from the learner's knowledge map when starting this session:";
