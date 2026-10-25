/**
 * Background role jobs — ported from learnharness's sub-agents (researcher,
 * demo-builder, visual-maker, pdf-reader: AGPL-3.0, amosblomqvist/
 * learnharness), as one-shot role runs over the harness seams:
 *
 *   research   a multi-step loop over the harness's web_search/web_fetch
 *              tools (ctx.web seam) producing a cited brief.
 *   demo       a write/test/fix loop producing single-file HTML verified
 *              headlessly before delivery. v0.1: authored + verified by
 *              the research seam's fetch of a data: URL is NOT possible —
 *              the demo lands as authored HTML with a clear untested note
 *              when no browser seam is present; the browser seam (ctx.
 *              browser, when dsh-builtin-browser is loaded) verifies.
 *   visual     an SVG author/render/look loop; render + look need the
 *              browser seam + a vision model. v0.1: single-shot authored
 *              SVG (no untested delivery — the card labels it authored).
 *   pdf        reader brief over a local PDF; v0.1: the file's text
 *              extracted with the harness fs seam when available.
 *
 * All roles resolve their model from the settings pins (BYOK law); the
 * ack-and-steer delivery law (fire-and-forget tool acks, results as
 * queued messages) lives in the tools' host wiring.
 */

import { runSubmitAgent, type LlmLike } from "./roles.js";

/** The harness web seam (production: ctx.web; tests script it). */
export interface WebSeam {
	search(request: { queries: string[] }, signal?: AbortSignal): Promise<{ results: Array<{ title: string; url: string; snippet?: string }> }>;
	fetch(request: { url: string }, signal?: AbortSignal): Promise<{ text: string; url: string }>;
}

export interface RoleResolution {
	provider: string;
	model: string;
}

export interface RunResearchOptions {
	llm: LlmLike;
	web: WebSeam;
	route: RoleResolution;
	/** The single research question + optional context. */
	question: string;
	context?: string;
	signal?: AbortSignal;
	/** Model call budget for the loop (default 8). */
	maxSteps?: number;
}

/** The researcher: 2-4 searchable facets, search + fetch, a cited brief.
 *  Ported doctrine from learnharness's researcher instructions. */
export async function runResearch(options: RunResearchOptions): Promise<string> {
	const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
		{
			role: "user",
			content: [
				{
					type: "text",
					text:
						`Research question: ${options.question}\n` +
						(options.context ? `Context (why it matters): ${options.context}\n` : "") +
						`\nWork alone: break the question into 2-4 facets, use the web_search tool for angles (the direct answer, authoritative sources, practical experience, recent developments when time-sensitive), read the most promising sources with web_fetch, and produce a brief the teacher can teach from. Your FINAL assistant message is your entire deliverable and must stand alone:\n\n## Summary\n2-3 sentence direct answer.\n\n## Findings\nNumbered findings with inline source citations.\n\n## Sources\nKept sources with why; dropped sources with why excluded.\n\n## Gaps\nWhat couldn't be answered and suggested next steps.`,
				},
			],
		},
	];

	const searchTool = {
		name: "web_search",
		description: "Search the web. Input: { queries: [2-4 query strings] }.",
		parameters: { type: "object", properties: { queries: { type: "array", items: { type: "string" } } }, required: ["queries"] } as Record<string, unknown>,
	};
	const fetchTool = {
		name: "web_fetch",
		description: "Fetch one URL's text. Input: { url: string }.",
		parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } as Record<string, unknown>,
	};

	const maxSteps = options.maxSteps ?? 8;
	for (let step = 0; step < maxSteps; step++) {
		let text = "";
		const calls: Array<{ id: string; name: string; arguments: string }> = [];
		for await (const chunk of options.llm.stream({
			provider: options.route.provider,
			model: options.route.model,
			system:
				"You are a research specialist serving a teacher inside a learning application. You operate in an isolated context with no knowledge of the lesson — all necessary context is in the task. Verify with search before asserting; cite sources inline; never invent results or sources; say plainly when research is impossible.",
			messages: messages.map((m) => ({ ...m, toolCallId: undefined })),
			tools: [searchTool, fetchTool],
			signal: options.signal,
		})) {
			if ("type" in chunk) {
				if (chunk.type === "text") text += chunk.text;
				else calls.push(chunk);
			}
		}
		messages.push({ role: "assistant", content: [{ type: "text", text }] });
		if (calls.length === 0) {
			if (text.trim().length > 0) return text; // the brief
			break;
		}
		// Execute the web calls (the tools this role owns).
		for (const call of calls) {
			messages.push({ role: "assistant", content: [], toolCalls: [call] } as never);
			let resultText: string;
			if (call.name === "web_search") {
				try {
					const parsed = JSON.parse(call.arguments) as { queries?: string[] };
					const result = await options.web.search({ queries: parsed.queries ?? [] }, options.signal);
					resultText = JSON.stringify(result.results, null, 1);
				} catch (err) {
					resultText = `search unavailable: ${err instanceof Error ? err.message : String(err)}`;
				}
			} else if (call.name === "web_fetch") {
				try {
					const parsed = JSON.parse(call.arguments) as { url?: string };
					const result = await options.web.fetch({ url: parsed.url ?? "" }, options.signal);
					resultText = result.text.slice(0, 20000);
				} catch (err) {
					resultText = `fetch failed: ${err instanceof Error ? err.message : String(err)}`;
				}
			} else {
				resultText = `unknown tool "${call.name}"`;
			}
			messages.push({ role: "assistant", content: [{ type: "text", text: resultText }], toolCallId: call.id, isError: false } as never);
		}
	}
	// Budget exhausted: ask for the brief now with one final call.
	const brief = await runSubmitAgent({
		llm: options.llm,
		provider: options.route.provider,
		model: options.route.model,
		systemPrompt: "You are a research specialist. Produce the brief NOW from what you have gathered.",
		prompt: messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n").slice(-40000),
		toolName: "submit_brief",
		toolDescription: "Submit the final research brief (plain markdown, the deliverable itself, as the text field).",
		schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
		maxTurns: 2,
		signal: options.signal,
	});
	return brief.text as string;
}

// ─── demo / visual / pdf (v0.1 single-shot authored forms) ────────────────────

export interface RunArtifactOptions {
	llm: LlmLike;
	route: RoleResolution;
	/** The teacher's brief (the artifact's entire world). */
	brief: string;
	title?: string;
	signal?: AbortSignal;
}

/** The demo-builder's authored form: a self-contained HTML document. The
 *  builder never sees the lesson. v0.1 has no headless verification seam
 *  wired (the browser plugin is optional), so the result is honestly
 *  labeled authored-untested — the original's "verify, never one-shot"
 *  law upgrades this when the seam is present. */
export async function runDemoArtifact(options: RunArtifactOptions): Promise<{ title: string; html: string; tested: boolean; notes: string }> {
	const result = await runSubmitAgent({
		llm: options.llm,
		provider: options.route.provider,
		model: options.route.model,
		systemPrompt:
			"You are a demo builder inside a learning application. You receive a brief for ONE interactive teaching instrument and deliver a single self-contained HTML document that runs it. You never see the lesson; the brief is everything you know. Runtime contract: single file, vanilla JS + Canvas 2D or SVG, NO localStorage/sessionStorage/cookies (the sandbox throws), normal flowing layout, prefer dependency-free. Label controls clearly; the learner should operate the idea.",
		prompt: `Build the demo for this brief:\n\n${options.brief}`,
		toolName: "submit_demo",
		toolDescription: "Submit the demo: the complete single-file HTML document.",
		schema: { type: "object", properties: { title: { type: "string" }, html: { type: "string" } }, required: ["title", "html"] },
		maxTurns: 3,
		signal: options.signal,
	});
	return {
		title: (result.title as string) || options.title || "Interactive demo",
		html: result.html as string,
		tested: false,
		notes: "Authored (no headless verification in this build) — report any misbehavior and a re-build will be dispatched.",
	};
}

/** The visual-maker's authored form: one precise SVG. The original's
 *  render-and-look verification loop needs a vision model + rasterizer;
 *  v0.1 ships the authored SVG, honestly labeled. */
export async function runVisualArtifact(options: RunArtifactOptions): Promise<{ svg: string; notes: string }> {
	const result = await runSubmitAgent({
		llm: options.llm,
		provider: options.route.provider,
		model: options.route.model,
		systemPrompt:
			"You are a visual maker inside a learning application. You receive a brief describing ONE idea that needs exact spatial placement (coordinates, vectors, number lines, layouts) and return ONE clean, correct SVG. You never see the lesson; the brief is everything you know. Above everything CORRECTNESS: the picture must not assert anything false. Output the complete SVG markup.",
		prompt: `Draw the figure for this brief:\n\n${options.brief}`,
		toolName: "submit_svg",
		toolDescription: "Submit the figure: the complete SVG markup.",
		schema: { type: "object", properties: { svg: { type: "string" } }, required: ["svg"] },
		maxTurns: 3,
		signal: options.signal,
	});
	return {
		svg: result.svg as string,
		notes: "Authored (the render-and-look verification loop arrives with the vision-role wiring) — report any inaccuracy and a re-draw will be dispatched.",
	};
}

/** The PDF reader's v0.1 form: a brief over the file's extractable text.
 *  The original's triage + page-level visual reading needs the pdfjs
 *  seam; v0.1 extracts plain text when the harness fs seam can read it. */
export async function runPdfBrief(options: RunArtifactOptions & { pdfText: string }): Promise<string> {
	const result = await runSubmitAgent({
		llm: options.llm,
		provider: options.route.provider,
		model: options.route.model,
		systemPrompt:
			"You are a PDF reader inside a learning application. You receive a document's extractable text and one question; produce a focused brief with page-cited quotes when the text carries page markers. You never see the lesson.",
		prompt: `The question: ${options.brief}\n\nThe document's text:\n\n${options.pdfText.slice(0, 60000)}`,
		toolName: "submit_brief",
		toolDescription: "Submit the brief (plain markdown, the deliverable as the text field).",
		schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
		maxTurns: 2,
		signal: options.signal,
	});
	return result.text as string;
}
