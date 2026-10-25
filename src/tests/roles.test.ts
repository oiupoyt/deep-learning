// Red step for the role runner: one-shot LLM loops over ctx.llm with a
// structured submit tool (the ported runSubmitAgent seam) — schema-invalid
// submits error back for retry within maxTurns; exhaustion fails honestly.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { runSubmitAgent } from "../server/roles.js";
import type { LlmLike } from "../server/roles.js";

/** A scripted LlmLike: returns queued assistant responses; records requests. */
function fakeLlm(responses: Array<{ text?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>): LlmLike & { requests: unknown[] } {
	const requests: unknown[] = [];
	let call = 0;
	return {
		requests,
		stream(options) {
			requests.push(options);
			const response = responses[Math.min(call, responses.length - 1)]!;
			call++;
			const chunks: Array<Record<string, unknown>> = [];
			if (response.text) chunks.push({ type: "text", text: response.text });
			for (const tc of response.toolCalls ?? []) {
				chunks.push({ type: "tool-call", id: tc.id, name: tc.name, arguments: tc.arguments });
			}
			chunks.push({ kind: response.toolCalls?.length ? "tool-calls" : "stop" });
			return (async function* () {
				for (const chunk of chunks) yield chunk as never;
			})();
		},
	};
}

const findingsSchema = {
	type: "object",
	properties: {
		propositions: { type: "array", items: { type: "object" } },
		chains: { type: "array", items: { type: "object" } },
	},
	required: ["propositions", "chains"],
	additionalProperties: false,
} as const;

test("valid submit on first try resolves the structured value", async () => {
	const llm = fakeLlm([
		{
			toolCalls: [
				{
					id: "c1",
					name: "submit_findings",
					arguments: JSON.stringify({ propositions: [{ id: "p1", name: "A", statement: "A." }], chains: [] }),
				},
			],
		},
	]);
	const value = await runSubmitAgent({
		llm,
		provider: "deepseek-official",
		model: "deepseek-chat",
		systemPrompt: "You are the extractor.",
		prompt: "Extract this.",
		toolName: "submit_findings",
		toolDescription: "Submit findings.",
		schema: findingsSchema,
		maxTurns: 4,
	});
	assert.deepEqual(value, { propositions: [{ id: "p1", name: "A", statement: "A." }], chains: [] });
	// the submit tool was declared in the request
	const request = llm.requests[0] as { tools?: Array<{ name: string }> };
	assert.ok(request.tools?.some((t) => t.name === "submit_findings"));
	// the system prompt carried the role instructions
	const req = llm.requests[0] as { system?: string; messages?: unknown[] };
	assert.ok(req.system?.includes("extractor") || JSON.stringify(req.messages ?? []).includes("extractor"));
});

test("schema-invalid submit errors back; the model retries within maxTurns", async () => {
	const llm = fakeLlm([
		{ toolCalls: [{ id: "c1", name: "submit_findings", arguments: JSON.stringify({ propositions: [] }) }] }, // missing chains
		{
			toolCalls: [
				{
					id: "c2",
					name: "submit_findings",
					arguments: JSON.stringify({ propositions: [], chains: [{ premises: ["p1"], conclusion: "p2" }] }),
				},
			],
		},
	]);
	const value = await runSubmitAgent({
		llm,
		provider: "deepseek-official",
		model: "deepseek-chat",
		systemPrompt: "S",
		prompt: "P",
		toolName: "submit_findings",
		toolDescription: "D",
		schema: findingsSchema,
		maxTurns: 4,
	});
	assert.deepEqual(value.chains, [{ premises: ["p1"], conclusion: "p2" }]);
	// two model calls happened (the retry)
	assert.equal(llm.requests.length, 2);
	// the invalid submit produced an error tool result in the follow-up request
	const second = llm.requests[1] as { messages?: Array<{ role?: string; isError?: boolean }> };
	assert.ok(second.messages?.some((m) => m.isError === true), "the invalid submit must come back as an error result");
});

test("maxTurns exhaustion rejects honestly (neverSubmitted message)", async () => {
	const llm = fakeLlm([{ text: "I will not submit." }]);
	await assert.rejects(
		runSubmitAgent({
			llm,
			provider: "deepseek-official",
			model: "deepseek-chat",
			systemPrompt: "S",
			prompt: "P",
			toolName: "submit_findings",
			toolDescription: "D",
			schema: findingsSchema,
			maxTurns: 2,
		}),
		/never submitted|no valid submit/i,
	);
});

test("validator refusals error back like schema failures", async () => {
	const llm = fakeLlm([
		{ toolCalls: [{ id: "c1", name: "submit_findings", arguments: JSON.stringify({ propositions: [], chains: [] }) }] }, // validator: chains empty ok? no — our validator demands >=1
		{
			toolCalls: [
				{
					id: "c2",
					name: "submit_findings",
					arguments: JSON.stringify({ propositions: [], chains: [{ premises: ["x"], conclusion: "y" }] }),
				},
			],
		},
	]);
	const value = await runSubmitAgent({
		llm,
		provider: "deepseek-official",
		model: "deepseek-chat",
		systemPrompt: "S",
		prompt: "P",
		toolName: "submit_findings",
		toolDescription: "D",
		schema: findingsSchema,
		maxTurns: 3,
		validate: (v: Record<string, unknown>) =>
			(Array.isArray(v.chains) ? (v.chains as unknown[]).length : 0) === 0 ? "chains: at least one argument is required here." : null,
	});
	assert.equal((value.chains as unknown[]).length, 1);
});
