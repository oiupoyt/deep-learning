/**
 * The question cards — the toolview registrations for the teaching/
 * practice tools + the composer-dock companion that renders the pending
 * question and posts the learner's answer to /api/deep-learning.
 *
 * The answer UI (the ported dock law): options with seeded display order
 * already applied server-side, a thinking field, the confidence ladder,
 * "I don't know", and the reveal-collapsed check. Grading happens
 * server-side (question-core); the verdict + explanation render here.
 */
import * as React from "react";
import { ensureStyle } from "./styles.js";
import { ConfidenceRail, CONFIDENCE_STOPS } from "./confidence-rail.js";
const QUESTION_TOOLS = ["probe", "quiz", "recall", "explain"];
export function registerQuestionCards(slots, api) {
    ensureStyle();
    // The toolview cards: one keyed entry per teaching tool. The answer UI
    // mounts inside the card for question tools when their call is the
    // session's pending question.
    for (const tool of QUESTION_TOOLS) {
        slots.inject("tool.call.toolview", () => slots.register({
            name: "tool.call.toolview",
            key: tool,
            inject: () => ({ apiRoot: api, toolName: tool }),
        }, ToolCard));
    }
    // The composer-dock companion: while a question is pending, a compact
    // answer surface rides with the composer (the ported dock's placement).
    slots.inject("conversation.composer.dock", () => slots.register({
        name: "conversation.composer.dock",
        id: "deep-learning-question",
        order: 20,
        inject: () => ({ apiRoot: api }),
    }, DockCompanion));
}
// ─── the shared pending-question machinery ───────────────────────────────────
function usePending(api) {
    const [pending, setPending] = React.useState(null);
    React.useEffect(() => {
        let cancelled = false;
        const sessionId = sessionIdOf();
        if (!sessionId)
            return;
        fetch(`${api}/question?session=${encodeURIComponent(sessionId)}`)
            .then((r) => r.json())
            .then((data) => {
            if (!cancelled)
                setPending(data.question);
        })
            .catch(() => { });
        return () => {
            cancelled = true;
        };
    }, [api]);
    const answer = React.useCallback(async (request) => {
        const sessionId = sessionIdOf();
        if (!sessionId)
            return null;
        try {
            const r = await fetch(`${api}/question`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ session: sessionId, ...request }),
            });
            const data = (await r.json());
            return data;
        }
        catch {
            return null;
        }
    }, [api]);
    return { pending, answer };
}
/** The session id from the URL (the web client's session route). */
function sessionIdOf() {
    const match = window.location.hash.match(/session\/([a-zA-Z0-9-]+)/) ?? window.location.pathname.match(/session\/([a-zA-Z0-9-]+)/);
    return match?.[1] ?? null;
}
// ─── the toolview card ────────────────────────────────────────────────────────
function ToolCard(props) {
    const api = props.apiRoot ?? "/api/deep-learning";
    const tool = props.toolName ?? "";
    const { pending, answer } = usePending(api);
    const isQuestionTool = ["probe", "quiz", "recall", "explain"].includes(tool);
    if (!isQuestionTool) {
        // Non-question tools render the harness's generic card (return an
        // empty element so the default row shows through the slot).
        return React.createElement("div", { style: { display: "none" } });
    }
    if (pending === null || pending.tool !== tool) {
        return React.createElement("div", { style: { display: "none" } });
    }
    return React.createElement(QuestionBody, { pending: pending, answer: answer });
}
// ─── the dock companion ───────────────────────────────────────────────────────
function DockCompanion(props) {
    const api = props.apiRoot ?? "/api/deep-learning";
    const { pending, answer } = usePending(api);
    if (pending === null)
        return null;
    if (pending.tool === "problem") {
        // A practice problem: the statement shows here; the learner works in
        // the composer below (submissions arrive as messages, not answers).
        return React.createElement("div", { className: "dl-q", "data-dl-dock": "true" }, React.createElement("div", { className: "dl-q-kind" }, React.createElement("span", { className: "dl-kind-active" }, "problem")), React.createElement("div", { className: "dl-q-text" }, pending.question), React.createElement("div", { style: { color: "#8d8d8d", fontSize: "12.5px", marginTop: 8 } }, "work in the composer — your thinking arrives as your answer"));
    }
    return React.createElement("div", { "data-dl-dock": "true", style: { padding: "0 0 8px" } }, React.createElement(QuestionBody, { pending: pending, answer: answer }));
}
// ─── the question body (the card's content) ────────────────────────────────────
function QuestionBody({ pending, answer, }) {
    const multi = pending.mode === "multi-select";
    const [picked, setPicked] = React.useState(new Set());
    const [text, setText] = React.useState("");
    const [thinking, setThinking] = React.useState("");
    const [confidence, setConfidence] = React.useState(null);
    const [dontKnow, setDontKnow] = React.useState(false);
    const [revealed, setRevealed] = React.useState(!pending.needsReveal);
    const [verdict, setVerdict] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const kindLabel = pending.questionType === "predict"
        ? "prediction"
        : pending.questionType === "check"
            ? "check"
            : pending.tool === "probe" || pending.tool === "recall"
                ? "probe"
                : "question";
    const submit = async () => {
        if (busy)
            return;
        setBusy(true);
        const request = { dontKnow };
        if (pending.kind === "quiz" && !dontKnow) {
            if (picked.size === 0 && !multi)
                return setBusy(false);
            if (picked.size > 0)
                request.values = [...picked];
        }
        if (pending.kind === "explain" && !dontKnow)
            request.text = text;
        if (thinking.trim().length > 0)
            request.thinking = thinking;
        if (pending.kind === "quiz" && !dontKnow && confidence !== null)
            request.confidence = confidence;
        const result = await answer(request);
        setBusy(false);
        if (result !== null && (result.ok === true || result.ok === undefined)) {
            setVerdict({ submitted: true });
        }
    };
    if (verdict !== null) {
        return React.createElement("div", { className: "dl-q" }, React.createElement("div", { className: "dl-verdict", "data-c": "true" }, "answer submitted — the teacher continues from here"));
    }
    return React.createElement("div", { className: "dl-q" }, React.createElement("div", { className: "dl-q-kind" }, React.createElement("span", { className: pending.questionType === "predict" ? "dl-kind-active" : "dl-kind-check" }, kindLabel), pending.tool === "recall" || pending.tool === "explain"
        ? React.createElement("span", null, "free recall — answer in your own words")
        : null), React.createElement("div", { className: "dl-q-text" }, pending.question), pending.context !== undefined &&
        pending.context.length > 0 &&
        React.createElement("div", { style: { color: "#888888", marginTop: 6, fontSize: 12 } }, pending.context), !revealed
        ? React.createElement("button", { className: "dl-reveal", onClick: () => setRevealed(true) }, "check your understanding")
        : React.createElement(React.Fragment, null, pending.kind === "quiz" &&
            React.createElement("div", { className: "dl-q-options" }, pending.options.map((option, index) => React.createElement("button", {
                key: option.value,
                type: "button",
                className: "dl-opt",
                "data-picked": picked.has(option.value) ? "true" : "false",
                "data-square": multi ? "true" : "false",
                onClick: () => {
                    if (dontKnow)
                        return;
                    setPicked((prev) => {
                        const next = new Set(multi ? prev : []);
                        if (multi) {
                            if (prev.has(option.value))
                                next.delete(option.value);
                            else
                                next.add(option.value);
                            return next;
                        }
                        next.add(option.value);
                        return next;
                    });
                },
            }, React.createElement("span", { className: "dl-opt-marker" }, picked.has(option.value) ? (multi ? "\u2713" : "") : ""), React.createElement("span", null, option.label)))), pending.kind === "explain" &&
            React.createElement("textarea", {
                className: "dl-textarea",
                value: text,
                onChange: (e) => setText(e.target.value),
                placeholder: "your answer, in your own words",
                style: { marginTop: 10 },
            }), React.createElement("div", { className: "dl-thinking" }, React.createElement("span", { className: "dl-thinking-label" }, "Your thinking"), React.createElement("textarea", {
            className: "dl-textarea",
            value: thinking,
            onChange: (e) => setThinking(e.target.value),
            placeholder: "dump your reasoning — how you approached it, where you're unsure",
        })), pending.kind === "quiz" &&
            !dontKnow &&
            React.createElement("div", { className: "dl-confidence-row" }, React.createElement("span", { className: "dl-confidence-label" }, "confidence"), React.createElement(ConfidenceRail, { value: confidence ?? 50 }), React.createElement("div", { className: "dl-confidence-stop-btns" }, CONFIDENCE_STOPS.map((stop) => React.createElement("button", {
                key: stop,
                className: "dl-stop",
                "data-on": confidence === stop ? "true" : "false",
                onClick: () => setConfidence(stop),
            }, `${stop}`)))), React.createElement("div", { className: "dl-q-actions" }, pending.kind === "quiz" &&
            React.createElement("button", {
                className: "dl-btn",
                "data-on": dontKnow ? "true" : "false",
                onClick: () => setDontKnow((v) => !v),
            }, "i don't know"), React.createElement("span", { className: "dl-spacer" }), React.createElement("button", { className: "dl-btn", onClick: submit, disabled: busy }, busy ? "submitting…" : "submit"))));
}
