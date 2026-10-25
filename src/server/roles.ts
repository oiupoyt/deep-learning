/**
 * The role runner — one-shot LLM loops over the harness's LLM seam with a
 * structured submit tool, ported from learnharness src/agent/subagents/
 * submit-agent.ts (AGPL-3.0, amosblomqvist/learnharness) onto DSH:
 *
 *   - The engine seam is LlmLike (ctx.llm's stream contract narrowed to
 *     what the loop needs); production wires ctx.llm, tests script it.
 *   - The loop: system prompt + user prompt; the model responds; a
 *     submit_findings-shaped tool call validates against the schema (+ the
 *     caller's validate hook) — an INVALID submit returns an error tool
 *     result and the model retries within maxTurns; a VALID submit is the
 *     run's value.
 *   - Exhaustion rejects honestly (the ported neverSubmitted message).
 *
 * NO hardcoded models anywhere: the caller resolves provider/model from
 * the settings pins (BYOK law).
 */

/** The narrowed ctx.llm seam the loops need (tests script it). */
export interface LlmLike {
	stream(options: {
		provider: string;
		model: string;
		system?: string;
		messages: RoleMessage[];
		tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
		signal?: AbortSignal;
	}): AsyncIterable<StreamChunkLike>;
}

/** The message vocabulary the loop speaks (the DSH LlmLike shapes). */
export interface RoleMessage {
	role: "user" | "assistant" | "tool";
	content: unknown;
	toolCallId?: string;
	isError?: boolean;
	toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export type StreamChunkLike =
	| { type: "text"; text: string }
	| { type: "tool-call"; id: string; name: string; arguments: string }
	| { kind: "stop" | "tool-calls" | "max-tokens" | "aborted" | "error"; failure?: unknown };

/** The JSON-Schema subset the loop validates against (an object root). */
export type SubmitSchema = Record<string, unknown>;

export interface RunSubmitAgentOptions {
	/** The LLM seam (production: ctx.llm; tests: scripted). */
	llm: LlmLike;
	/** Resolved route (never hardcoded — the settings pins). */
	provider: string;
	model: string;
	systemPrompt: string;
	prompt: string;
	toolName: string;
	toolDescription: string;
	schema: SubmitSchema;
	/** Cross-field validation: returns a problem string or null. */
	validate?: (value: Record<string, unknown>) => string | null;
	/** Max model calls (default 4). */
	maxTurns?: number;
	signal?: AbortSignal;
	/** Optional value pre-fill applied before validation (the ??-fill law). */
	fill?: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/** Minimal JSON Schema object validation: type/object/required/array/items
 *  shallow check — enough to catch the degraded-submit hole the original
 *  closed; the harness's full validator owns production boundaries. */
function schemaProblems(value: unknown, schema: SubmitSchema): string | null {
	if (typeof schema !== "object" || schema === null) return null;
	const type = (schema as { type?: string }).type;
	if (type === "object") {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return `expected an object, got ${Array.isArray(value) ? "an array" : typeof value}.`;
		}
		const obj = value as Record<string, unknown>;
		const required = (schema as { required?: string[] }).required;
		if (Array.isArray(required)) {
			for (const key of required) {
				if (!(key in obj)) return `the required field "${key}" is missing — pass it even when empty.`;
			}
		}
		const properties = (schema as { properties?: Record<string, Record<string, unknown>> }).properties;
		if (properties) {
			for (const [key, rule] of Object.entries(properties)) {
				if (!(key in obj)) continue;
				const problem = schemaProblems(obj[key], rule);
				if (problem) return `field "${key}": ${problem}`;
			}
		}
		return null;
	}
	if (type === "array") {
		if (!Array.isArray(value)) return `expected an array, got ${typeof value}.`;
		const items = (schema as { items?: Record<string, unknown> }).items;
		if (items) {
			for (const item of value) {
				const problem = schemaProblems(item, items);
				if (problem) return `an item: ${problem}`;
			}
		}
		return null;
	}
	if (type === "string") {
		return typeof value === "string" ? null : `expected a string, got ${typeof value}.`;
	}
	if (type === "number" || type === "integer") {
		return typeof value === "number" ? null : `expected a number, got ${typeof value}.`;
	}
	if (type === "boolean") {
		return typeof value === "boolean" ? null : `expected a boolean, got ${typeof value}.`;
	}
	return null;
}

/** Parse a tool-call arguments string into a value; a non-JSON string
 *  reports honestly (the stringified-payload wobble the original healed). */
function parseArguments(raw: string): { value: unknown } | { error: string } {
	try {
		return { value: JSON.parse(raw) };
	} catch {
		return { error: `the arguments are not valid JSON: ${raw.slice(0, 200)}` };
	}
}

/**
 * Run one one-shot submit loop. Resolves with the validated submit value;
 * rejects with the neverSubmitted message when maxTurns exhausts.
 */
export async function runSubmitAgent(options: RunSubmitAgentOptions): Promise<Record<string, unknown>> {
	const maxTurns = options.maxTurns ?? 4;
	const messages: RoleMessage[] = [{ role: "user", content: [{ type: "text", text: options.prompt }] }];
	let lastFailure: unknown;

	for (let turn = 0; turn < maxTurns; turn++) {
		let text = "";
		const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
		for await (const chunk of options.llm.stream({
			provider: options.provider,
			model: options.model,
			system: options.systemPrompt,
			messages,
			tools: [
				{
					name: options.toolName,
					description: options.toolDescription,
					parameters: options.schema,
				},
			],
			signal: options.signal,
		})) {
			if ("type" in chunk) {
				if (chunk.type === "text") text += chunk.text;
				else if (chunk.type === "tool-call") toolCalls.push(chunk);
			} else {
				lastFailure = (chunk as { failure?: unknown }).failure;
			}
		}

		const submit = toolCalls.find((tc) => tc.name === options.toolName);
		if (!submit) {
			// The model rambled without submitting: continue the loop with its
			// own text (the retry pressure is the missing submit itself).
			messages.push({ role: "assistant", content: [{ type: "text", text }] });
			if (toolCalls.length > 0) {
				// Unknown tool calls get a plain error result.
				for (const tc of toolCalls) {
					messages.push({
						role: "tool",
						toolCallId: tc.id,
						isError: true,
						content: [{ type: "text", text: `Unknown tool "${tc.name}". Use ${options.toolName} to submit.` }],
					});
				}
			} else {
				messages.push({
					role: "user",
					content: [{ type: "text", text: `Submit your result with the ${options.toolName} tool now.` }],
				});
			}
			continue;
		}

		const parsed = parseArguments(submit.arguments);
		if ("error" in parsed) {
			messages.push({ role: "assistant", content: [{ type: "text", text }], toolCalls });
			messages.push({
				role: "tool",
				toolCallId: submit.id,
				isError: true,
				content: [{ type: "text", text: `${options.toolName}: ${parsed.error}` }],
			});
			continue;
		}

		const filled = options.fill ? options.fill(parsed.value as Record<string, unknown>) : (parsed.value as Record<string, unknown>);
		const problem = schemaProblems(filled, options.schema) ?? options.validate?.(filled) ?? null;
		if (problem !== null) {
			messages.push({ role: "assistant", content: [{ type: "text", text }], toolCalls });
			messages.push({
				role: "tool",
				toolCallId: submit.id,
				isError: true,
				content: [{ type: "text", text: `${options.toolName}: ${problem}` }],
			});
			continue;
		}

		// Valid: the run's value. The tool result acknowledges (the model
		// loop ends here — one-shot).
		return filled;
	}

	throw new Error(`the model never submitted a valid ${options.toolName} result within ${maxTurns} turns${lastFailure ? ` (last failure: ${String(lastFailure)})` : ""}`);
}
