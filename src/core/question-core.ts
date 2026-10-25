/**
 * question-core — the question contract + pure grading logic, ported from
 * LearnHarness (AGPL-3.0, amosblomqvist/learnharness: src/core/question-core.ts).
 *
 * Deterministic and unit-testable: no framework imports, no IO. The tool
 * boundary validates with quizInputProblems/explainInputProblems; the
 * browser grades with these functions and returns the verdict through the
 * plugin's answer route.
 *
 * Port deltas (mechanical, no behavior change):
 *  - TypeBox schemas -> plain JSON Schema objects (DSH defineTool contract).
 *  - The dock state machine (selection toggling) stays client-side; the
 *    grading/authoring/answer contracts live here.
 */

// ─── shared types ───────────────────────────────────────────────────────────

export interface QuizOption {
	label: string;
	value: string;
	description?: string;
}

// ─── authoring validation (the call-boundary contract) ───────────────────────

/** Option sanity shared by quiz + ask: labels non-empty, resolved values
 *  distinct. Returns problems plus the resolved keys for the correctAnswer
 *  check. */
function optionProblems(
	options: Array<{ label: string; value?: string }>,
): { problems: string[]; keys: string[] } {
	const problems: string[] = [];
	const keys: string[] = [];
	options.forEach((option, i) => {
		const label = option.label.trim();
		if (label.length === 0) {
			problems.push(`options[${i}].label is empty — every option needs a label.`);
			return;
		}
		const key = option.value?.trim() || label;
		if (keys.includes(key)) {
			problems.push(`Two options resolve to the same value "${key}" — options must be distinct.`);
		}
		keys.push(key);
	});
	return { problems, keys };
}

/** ask options: the shared sanity, nothing more (ask is not graded). */
export function askOptionProblems(options: Array<{ label: string; value?: string }>): string[] {
	return optionProblems(options).problems;
}

/** The full quiz authoring contract: option sanity + correctAnswer must be
 *  gradeable. Empty result = a quiz the card can arm and grade faithfully. */
export function quizInputProblems(input: {
	options: Array<{ label: string; value?: string }>;
	correctAnswer: string | string[];
	multiSelect?: boolean;
}): string[] {
	const { problems, keys } = optionProblems(input.options);
	const entries = coerceCorrectAnswer(input.correctAnswer, keys);
	const unique = [...new Set(entries)];
	if (unique.length === 0 || unique.some((v) => v.length === 0)) {
		problems.push("correctAnswer is required — provide the value (or label) of the correct option(s).");
		return problems;
	}
	for (const v of unique) {
		if (!keys.includes(v)) {
			problems.push(
				`correctAnswer "${v}" does not match any option value. Valid values: ${keys.map((k) => `"${k}"`).join(", ")}. ` +
					"Copy the exact value (or label) of the intended option — never a paraphrase or slug.",
			);
		}
	}
	if (unique.length > 1 && input.multiSelect !== true) {
		problems.push(
			`correctAnswer lists ${unique.length} values but multiSelect is not true — a single-select question with several ` +
				"correct answers can never be answered correctly. Set multiSelect: true, or make exactly one option correct.",
		);
	}
	return problems;
}

/** The explain authoring contract: the commitment must exist. */
export function explainInputProblems(input: { correctAnswer: string }): string[] {
	if (input.correctAnswer.trim().length === 0) {
		return ["correctAnswer is required — commit to the full correct answer BEFORE posing the question."];
	}
	return [];
}

/** The teaching-cycle role field, shared verbatim by both teach quizzing
 *  tools. Bare words, never quoted. */
export const QUIZ_QUESTION_TYPES = ["predict", "check"] as const;
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];

/** Normalize a persisted quiz `type` (display seam): absent or unhealable
 *  wobble degrades to undefined — callers render "Quiz" and the check-style
 *  card. */
export function normalizeQuizType(raw: unknown): QuizQuestionType | undefined {
	const v = typeof raw === "string" ? raw.trim().replace(/^"(.*)"$/, "$1") : "";
	return v === "predict" ? "predict" : v === "check" ? "check" : undefined;
}

/** The reveal law as a pure predicate: a teach-phase CHECK collapses behind
 *  the "Check your understanding" reveal — a prediction NEVER does, and
 *  neither do probe/plan questions or ask. */
export function questionNeedsReveal(tool: string, rawInput: unknown, phase: string): boolean {
	if ((tool !== "quiz" && tool !== "explain") || phase !== "teach") return false;
	return normalizeQuizType((rawInput as { type?: unknown } | null)?.type) !== "predict";
}

/** The tool names that carry the quizzing mechanic — the phase seam, the
 *  plan-position fold, and the pending gate recognize whichever is armed. */
export const QUIZ_TOOL_NAMES = ["quiz", "explain"] as const;

// ─── the tool input schemas (plain JSON Schema for DSH defineTool) ───────────

const quizOptionSchema = {
	type: "object" as const,
	properties: {
		label: { type: "string", description: "Display label for the answer option — a bare claim, no reasoning" },
		value: { type: "string", description: "Optional machine-readable value returned for the option. Defaults to the label." },
	},
	required: ["label"],
	additionalProperties: false,
};

const quizBaseProps = {
	question: {
		type: "string",
		description:
			"The single quiz question to ask. ONE question per turn: ask, then end your turn — the answer determines the next question.",
	},
	options: {
		type: "array",
		minItems: 2,
		items: quizOptionSchema,
		description:
			"REQUIRED. The answer options (2 or more) as a JSON ARRAY of option objects — never a " +
			"JSON-encoded string. Options only — there is no free-text mode. " +
			"Give each option a stable `value`; you reference the correct one by that value in correctAnswer. " +
			"Never add your own 'I don't know' option — that choice is added for you.",
	},
	multiSelect: {
		type: "boolean",
		description: "Set to true when more than one option is correct and the learner must select all of them.",
	},
	explanation: {
		type: "string",
		description:
			"REQUIRED. Explanation revealed AFTER the learner answers (shown whether they got it right or wrong). " +
			"Use it to reinforce why the correct answer is correct. It is written BEFORE correctAnswer by design: " +
			"reason it out first, then commit the answer the reasoning supports.",
	},
	correctAnswer: {
		oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
		description:
			"REQUIRED. The correct answer as the option value(s) — the `value` field of the option you intend. " +
			'Single-select: a single string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]); ' +
			"the learner is only correct if their selection matches this set exactly. " +
			"Always pass the value, not a position number — this is self-checking and prevents miscounting. " +
			"A value that matches no option fails validation and the call is returned to you to fix.",
	},
	details: {
		type: "string",
		description: "Optional extra context or instructions shown under the question.",
	},
};

const nodeIdProp = {
	type: "string",
	description:
		"REQUIRED plan-tree node id this question is about — must EXACTLY match one of this session's " +
		"plan_init node slugs (validated at call time; a mismatched id is rejected back to you). " +
		"The lesson's position on the map derives from these tags (the node the latest tagged question is about is " +
		"where the map stands; earlier ones count as visited). A node takes as many questions as it deserves: stay on " +
		"one node for as many turns as the understanding needs — one reasoning step at a time, never rush forward. " +
		"For off-map checks use ask_user_question.",
};

const predictCheckType = {
	oneOf: [{ const: "predict" }, { const: "check" }],
	description:
		"REQUIRED — the question's role in the teaching cycle, as a bare word (no quotes): predict = posed BEFORE " +
		"you teach the step (its own turn; the learner answers, then your teaching resolves it — arrives open, never " +
		"collapsed); check = posed AFTER the step's teaching is complete (arrives collapsed behind the Check your " +
		"understanding reveal). ONE question per turn either way.",
};

/** The TEACH-side quiz object. The required pair leads the property order:
 *  fields generated first get dropped least. */
export const quizInputObject = {
	type: "object" as const,
	properties: { type: predictCheckType, nodeId: nodeIdProp, ...quizBaseProps },
	required: ["type", "nodeId", "question", "options", "explanation", "correctAnswer"],
	additionalProperties: false,
};

/** The PROBE-side quiz declaration: no nodeId and no type at all. */
export const probeQuizInputSchema = {
	type: "object" as const,
	properties: { ...quizBaseProps },
	required: ["question", "options", "explanation", "correctAnswer"],
	additionalProperties: false,
};

/** The DISPLAY parse for persisted quiz calls: the base + type optional. */
export const quizDisplayInputSchema = {
	type: "object" as const,
	properties: { ...quizBaseProps, type: { type: "string" } },
	required: ["question", "options", "explanation", "correctAnswer"],
	additionalProperties: false,
};

const explainBaseProps = {
	question: {
		type: "string",
		description:
			"The single question to ask. ONE question per turn: ask, then end your turn — the answer determines the next.",
	},
	correctAnswer: {
		type: "string",
		description:
			"REQUIRED. The full correct answer in your own words, reasoning included — COMMITTED before the learner " +
			"ever sees the question. The commitment is immutable: when his answer returns, grade it strictly against this " +
			"text — never revise the commitment after seeing his words, and never mark a wrong answer right to be kind. " +
			"It is shown to him on submit; your next reply grades the nuance of what he wrote.",
	},
	details: {
		type: "string",
		description: "Optional extra context or instructions shown under the question.",
	},
};

/** The TEACH-side explain object: base + the role field + the position field. */
export const explainInputObject = {
	type: "object" as const,
	properties: { type: predictCheckType, nodeId: nodeIdProp, ...explainBaseProps },
	required: ["type", "nodeId", "question", "correctAnswer"],
	additionalProperties: false,
};

/** The PROBE-side recall declaration. */
export const recallInputSchema = {
	type: "object" as const,
	properties: { ...explainBaseProps },
	required: ["question", "correctAnswer"],
	additionalProperties: false,
};

/** The DISPLAY parse for persisted explain calls: type optional. */
export const explainDisplayInputSchema = {
	type: "object" as const,
	properties: { ...explainBaseProps, type: { type: "string" } },
	required: ["question", "correctAnswer"],
	additionalProperties: false,
};

export const askInputSchema = {
	type: "object" as const,
	properties: {
		question: {
			type: "string",
			description:
				"The single question to ask the learner. ONE question per turn: ask, then end your turn — the answer determines the next question.",
		},
		details: {
			type: "string",
			description: "Optional extra context or instructions shown under the question.",
		},
		options: {
			type: "array",
			minItems: 2,
			items: {
				type: "object",
				properties: {
					label: { type: "string", description: "User-facing option label" },
					value: { type: "string", description: "Optional machine-readable value. Defaults to the label." },
					description: { type: "string", description: "Optional extra detail shown below the option" },
				},
				required: ["label"],
				additionalProperties: false,
			},
			description:
				"Optional multiple-choice options. Omit for free-form text input. " +
				"The learner can always choose 'Other' and type a custom answer when options are provided.",
		},
		multiSelect: {
			type: "boolean",
			description: "Set to true to allow multiple answers to the same question.",
		},
	},
	required: ["question"],
	additionalProperties: false,
};

// ─── dock selection (the client state machine, pure for tests) ──────────────

export interface QuizAnswerOption {
	label: string;
	value: string;
	index: number; // 1-based display index
}

export type QuestionKind = "quiz" | "ask" | "explain";
export type SelectMode = "single-select" | "multi-select";
export type QuestionMode = SelectMode | "text";

/** Full question data — stored in the pending-question record. */
export interface QuestionData {
	id: string;
	kind: QuestionKind;
	/** quiz/explain only (teach phase): the question's role in the cycle. */
	questionType?: QuizQuestionType;
	question: string;
	context?: string;
	mode: QuestionMode;
	options: QuizOption[]; // display order (post-shuffle)
	// quiz only. NEVER send to the client before answering:
	correctIndices?: number[];
	// explain only. NEVER send to the client before answering:
	committedAnswer?: string;
	// quiz only (the MC "why"). NEVER send to the client before answering:
	explanation?: string;
	createdAt: string;
}

/** The learner's answer — full structured record. */
export interface QuestionAnswerData {
	kind: QuestionKind;
	/** The persisted call's tool NAME: probe/recall for probe-phase calls,
	 *  quiz/explain for teach — the cards label by it. */
	tool?: string;
	/** quiz/explain only (teach phase): the role snapshot for rendering. */
	questionType?: QuizQuestionType;
	questionText: string;
	options?: { index: number; label: string }[]; // snapshot for rendering
	dontKnow: boolean;
	answers: QuizAnswerOption[];
	other?: string; // ask: "Other" free text
	text?: string; // ask/explain: text-mode answer
	/** The learner's reasoning on the QUESTION. */
	thinking?: string;
	/** The learner's thinking WHILE READING the teaching prose — a separate
	 *  channel from thinking, captured by the reading field. */
	readingThinking?: string;
	confidence?: number; // quiz only: 0-100 raw probability
	correct?: boolean; // quiz only
	correctIndices?: number[]; // quiz only (rendering)
	committed?: string; // explain only (rendering): the model's committed answer
	explanation?: string; // quiz only (rendering)
	dismissed?: boolean;
	answeredAt: string;
}

/** Client-facing question payload — deliberately omits the answer. */
export interface ClientQuestion {
	id: string;
	kind: QuestionKind;
	questionType?: QuizQuestionType;
	question: string;
	context?: string;
	mode: QuestionMode;
	options: QuizOption[];
}

/** What the client sends when the learner answers. */
export interface AnswerRequest {
	dontKnow?: boolean;
	values?: string[]; // option values
	other?: string; // ask "Other"
	text?: string; // ask text-mode
	thinking?: string; // the reasoning-on-the-question channel
	readingThinking?: string; // the thinking-while-reading channel
	confidence?: number; // quiz only: 0-100 raw probability
}

/** The confidence slider's snap stops: raw probability that the selected
 *  answer is correct, uneven on purpose — resolution concentrates at the
 *  top where the calibration signal lives. 50 is a genuine coin flip and
 *  the resting default. */
export const CONFIDENCE_STOPS: readonly number[] = [0, 30, 50, 70, 90, 100];
export const DEFAULT_CONFIDENCE_INDEX = 2;

// ─── options ─────────────────────────────────────────────────────────────────

/** Models sometimes emit `options` as a JSON-encoded STRING instead of an
 *  array — parse it before use. Returns the input untouched when it isn't
 *  a parseable array. */
export function parseOptionsIfString<T>(options: string | T[] | undefined): unknown {
	if (typeof options !== "string") return options;
	try {
		const parsed: unknown = JSON.parse(options);
		if (Array.isArray(parsed)) return parsed;
	} catch {
		/* not JSON — fall through untouched */
	}
	return options;
}

export function normalizeOptions(
	options: string | Array<{ label: string; value?: string; description?: string }> | undefined,
): QuizOption[] {
	const seen = new Set<string>();
	const coerced = parseOptionsIfString(options);
	const list = Array.isArray(coerced)
		? (coerced as Array<{ label: string; value?: string; description?: string }>)
		: [];
	return list
		.map((option) => ({
			label: option.label.trim(),
			value: option.value?.trim() || option.label.trim(),
			description: option.description?.trim() || undefined,
		}))
		.filter((option) => {
			if (option.label.length === 0) return false;
			if (seen.has(option.value)) throw new Error(`duplicate option value "${option.value}"`);
			seen.add(option.value);
			return true;
		});
}

/** mulberry32 seeded by a string — deterministic shuffle for
 *  hydration-safe rendering. */
export function seededRandom(seed: string): () => number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	let a = h >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Fisher-Yates with an injectable RNG. A per-toolCallId seed keeps the
 *  order stable across reloads while still varying it per question. */
export function shuffleOptions(options: QuizOption[], rand: () => number = Math.random): QuizOption[] {
	const out = [...options];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		const a = out[i]!;
		const b = out[j]!;
		out[i] = b;
		out[j] = a;
	}
	return out;
}

// ─── quiz grading ────────────────────────────────────────────────────────────

/** Strip a value's trailing/leading debris (quotes, brackets) ONLY when it
 *  does not already match a canonical option key — content can be content. */
function stripDebris(value: string): string {
	let v = value.trim();
	if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("[") && v.endsWith("]") && false))) {
		v = v.slice(1, -1);
	}
	return v;
}

/** Preserve an exact option key before trying copy-syntax cleanup; then
 *  heal common model wobble (JSON-stringified multi-select). Shared by
 *  boundary, display, and grading; canonical option keys are never
 *  rewritten. */
export function coerceCorrectAnswer(
	correctAnswer: string | string[],
	optionValues: readonly string[],
): string[] {
	const clean = (value: string): string => {
		const trimmed = value.trim();
		return optionValues.includes(trimmed) ? trimmed : stripDebris(trimmed);
	};
	if (Array.isArray(correctAnswer)) return correctAnswer.map(clean);
	const trimmed = correctAnswer.trim();
	if (optionValues.includes(trimmed)) return [trimmed];
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.map((v) => clean(String(v)));
		} catch {
			// not valid JSON — treat as a single literal value
		}
	}
	return [clean(correctAnswer)];
}

/** Resolve author-supplied value(s) to 1-based display indices. Keying by
 *  value (not position) makes a typo a hard error instead of a silent
 *  wrong grade. Must run AFTER shuffling. */
export function resolveCorrect(
	correctAnswer: string | string[] | undefined,
	options: QuizOption[],
): { indices: number[]; error?: string } {
	if (correctAnswer === undefined) return { indices: [], error: "correctAnswer is required" };
	const arr = coerceCorrectAnswer(correctAnswer, options.map((o) => o.value));
	if (arr.length === 0) return { indices: [], error: "correctAnswer is required" };
	const byValue = new Map(options.map((o, i) => [o.value, i + 1]));
	const indices: number[] = [];
	for (const raw of arr) {
		const v = typeof raw === "string" ? raw.trim() : raw;
		const idx = byValue.get(v);
		if (idx === undefined) {
			const known = options.map((o) => `"${o.value}"`).join(", ");
			return { indices: [], error: `correctAnswer "${v}" does not match any option value (${known})` };
		}
		indices.push(idx);
	}
	return { indices: Array.from(new Set(indices)).sort((a, b) => a - b) };
}

/** Exact-set match: same number of selections, same indices. */
export function isCorrect(selectedIndices: number[], correctIndices: number[]): boolean {
	if (selectedIndices.length !== correctIndices.length) return false;
	const a = [...selectedIndices].sort((x, y) => x - y);
	const b = [...correctIndices].sort((x, y) => x - y);
	return a.every((v, i) => v === b[i]);
}

// ─── arming + answering ──────────────────────────────────────────────────────

export function toClientQuestion(qd: QuestionData): ClientQuestion {
	return {
		id: qd.id,
		kind: qd.kind,
		questionType: qd.questionType,
		question: qd.question,
		context: qd.context,
		mode: qd.mode,
		options: qd.options,
	};
}

/** Turn an AnswerRequest into the full answer record. Quiz answers are
 *  graded here; ask/explain answers are not. */
export function buildAnswer(qd: QuestionData, req: AnswerRequest, tool?: string): QuestionAnswerData {
	const base: QuestionAnswerData = {
		kind: qd.kind,
		...(tool ? { tool } : {}),
		questionType: qd.questionType,
		questionText: qd.question,
		options: qd.options.map((o, i) => ({ index: i + 1, label: o.label })),
		dontKnow: req.dontKnow === true,
		answers: [],
		thinking: req.thinking?.trim() || undefined,
		readingThinking: req.readingThinking?.trim() || undefined,
		answeredAt: new Date().toISOString(),
	};
	if (req.values && req.values.length > 0) {
		const byValue = new Map(qd.options.map((o, i) => [o.value, { ...o, index: i + 1 }]));
		for (const v of req.values) {
			const opt = byValue.get(v);
			if (!opt) continue; // unknown value — ignore
			base.answers.push({ label: opt.label, value: opt.value, index: opt.index });
		}
		base.answers.sort((a, b) => a.index - b.index);
	}
	if (req.other?.trim()) base.other = req.other.trim();
	if (req.text?.trim()) base.text = req.text.trim();

	if (qd.kind === "quiz") {
		base.correctIndices = qd.correctIndices ?? [];
		base.explanation = qd.explanation;
		base.correct = base.dontKnow ? false : isCorrect(base.answers.map((a) => a.index), qd.correctIndices ?? []);
		// The confidence slider rides on real quiz answers only — never on
		// "I don't know" (no answer, no probability). Clamped defensively.
		if (!base.dontKnow && req.confidence !== undefined) {
			base.confidence = Math.max(0, Math.min(100, Math.round(req.confidence)));
		}
	}
	if (qd.kind === "explain") {
		// No client grading — the model grades in its reply, against the
		// commitment. The commitment snapshots for the reveal + rendering.
		base.committed = qd.committedAnswer;
	}
	return base;
}

/** The dismissal record (ESC-abort from a pending question): the minimum
 *  honest answer. The model sees {kind, dismissed:true}; the card renders
 *  the question text + "skipped". */
export function dismissedAnswer(kind: QuestionKind, questionText: string): QuestionAnswerData {
	return {
		kind,
		questionText,
		dontKnow: false,
		answers: [],
		dismissed: true,
		answeredAt: new Date().toISOString(),
	};
}

/** The MODEL-VISIBLE answer record: returns ONLY what the learner added —
 *  selection or words, the graded verdict, stated confidence, thinking. */
export function compactAnswerForModel(ad: QuestionAnswerData): Record<string, unknown> {
	if (ad.dismissed) return { kind: ad.kind, dismissed: true };
	const out: Record<string, unknown> = { kind: ad.kind };
	if (ad.dontKnow) out.dontKnow = true;
	if (Array.isArray(ad.answers) && ad.answers.length > 0)
		out.answers = ad.answers.map((a) => ({ index: a.index, label: a.label }));
	if (ad.text) out.text = ad.text;
	if (ad.other) out.other = ad.other;
	if (ad.correct !== undefined && !ad.dontKnow) out.correct = ad.correct;
	if (ad.confidence !== undefined) out.confidence = ad.confidence;
	if (ad.thinking) out.thinking = ad.thinking;
	if (ad.readingThinking) out.thinkingWhileReading = ad.readingThinking;
	return out;
}
