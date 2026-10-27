/**
 * The Learning main panel — the knowledge graph canvas, the chain table,
 * notes import, and new teach/practice drafts. The graph is the home
 * page of the learning loop (the ported law); the canvas is a hand-rolled
 * Canvas 2D renderer over the snapshot's derived view (no sigma/d3-render
 * deps — the original's own choice, kept).
 */
import * as React from "react";
import { ensureStyle } from "./styles.js";
export function LearningPanel(props) {
    ensureStyle();
    const api = props.apiRoot ?? "/api/deep-learning";
    const [view, setView] = React.useState("graph");
    const [snapshot, setSnapshot] = React.useState(null);
    const [error, setError] = React.useState(null);
    const load = React.useCallback(() => {
        fetch(`${api}/graph`)
            .then((r) => r.json())
            .then((data) => {
            setSnapshot(data);
            setError(null);
        })
            .catch(() => setError("graph unavailable"));
    }, [api]);
    React.useEffect(() => {
        load();
    }, [load]);
    const propositionCount = snapshot?.propositions.length ?? 0;
    const chainCount = snapshot?.chains.length ?? 0;
    return React.createElement("div", { className: "dl-root" }, React.createElement("div", { className: "dl-head" }, React.createElement("span", { className: "dl-title" }, "Learning"), React.createElement("span", { className: "dl-sub" }, "knowledge graph"), React.createElement("span", { className: "dl-spacer" }), React.createElement("span", { className: "dl-count" }, `${propositionCount} propositions · ${chainCount} chains`)), React.createElement("div", { className: "dl-toolbar" }, React.createElement("button", { className: "dl-btn", "data-on": view === "graph" ? "true" : "false", onClick: () => setView("graph") }, "graph"), React.createElement("button", { className: "dl-btn", "data-on": view === "chains" ? "true" : "false", onClick: () => setView("chains") }, "chains"), React.createElement("span", { className: "dl-spacer" }), React.createElement("button", { className: "dl-btn", onClick: () => setView("import") }, "import notes"), React.createElement("button", { className: "dl-btn", onClick: () => setView("draft") }, "new session")), React.createElement("div", { className: "dl-body" }, error !== null && React.createElement("div", { className: "dl-empty" }, error), error === null &&
        (view === "graph"
            ? React.createElement(GraphCanvas, { snapshot: snapshot })
            : view === "chains"
                ? React.createElement(ChainTable, { snapshot: snapshot })
                : view === "draft"
                    ? React.createElement(NewSessionDraft, { api: api })
                    : React.createElement(NotesImport, { api: api, onImported: load }))));
}
// ─── the graph canvas (Canvas 2D over the snapshot) ──────────────────────────
function GraphCanvas({ snapshot }) {
    const canvasRef = React.useRef(null);
    const [camera, setCamera] = React.useState({ x: 0, y: 0, k: 1 });
    const [selected, setSelected] = React.useState(null);
    const dragRef = React.useRef(null);
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        canvas.width = w * window.devicePixelRatio;
        canvas.height = h * window.devicePixelRatio;
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        ctx.fillStyle = "#0b0b0b";
        ctx.fillRect(0, 0, w, h);
        if (!snapshot || snapshot.nodes.length === 0)
            return;
        const positions = snapshot.positions ?? {};
        const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
        // Fallback layout: deterministic circle by index (no positions yet).
        const fallback = (id, index) => {
            const p = positions[id];
            if (p)
                return p;
            const angle = (index / Math.max(snapshot.nodes.length, 1)) * Math.PI * 2;
            return { x: Math.cos(angle) * 200, y: Math.sin(angle) * 200 };
        };
        const idOrder = snapshot.nodes.map((n) => n.id);
        const posOf = (id) => fallback(id, idOrder.indexOf(id));
        const world = (p) => ({
            x: p.x * camera.k + w / 2 + camera.x,
            y: p.y * camera.k + h / 2 + camera.y,
        });
        // Edges (hairline; the selected node's edges in cyan).
        ctx.strokeStyle = "#1c1c1c";
        ctx.lineWidth = 1;
        for (const edge of snapshot.edges) {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to)
                continue;
            const a = world(posOf(edge.from));
            const b = world(posOf(edge.to));
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        if (selected !== null) {
            ctx.strokeStyle = "#38bdf8";
            for (const edge of snapshot.edges) {
                if (edge.from !== selected && edge.to !== selected)
                    continue;
                const a = world(posOf(edge.from));
                const b = world(posOf(edge.to));
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
            ctx.strokeStyle = "#1c1c1c";
        }
        // Nodes: square markers (the brand's square rule), labels gated on zoom.
        ctx.font = "11px 'JetBrains Mono', monospace";
        for (const node of snapshot.nodes) {
            const p = world(posOf(node.id));
            const isImp = node.name === "⟹";
            const isSel = node.id === selected;
            ctx.fillStyle = isSel ? "#38bdf8" : isImp ? "#333333" : "#4ade80";
            if (isImp) {
                ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
            }
            else {
                ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
            }
            if (camera.k > 0.5 && !isImp) {
                ctx.fillStyle = isSel ? "#ffffff" : "#cccccc";
                ctx.fillText(node.name, p.x + 8, p.y + 4);
            }
        }
    }, [snapshot, camera, selected]);
    // Drag to pan; click selects; wheel zooms.
    const onPointerDown = (e) => {
        dragRef.current = { x: e.clientX - camera.x, y: e.clientY - camera.y };
    };
    const onPointerMove = (e) => {
        if (!dragRef.current)
            return;
        setCamera((c) => ({ ...c, x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y }));
    };
    const onPointerUp = () => {
        dragRef.current = null;
    };
    const onWheel = (e) => {
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        setCamera((c) => ({ ...c, k: Math.min(4, Math.max(0.15, c.k * factor)) }));
    };
    const onClick = (e) => {
        if (!snapshot)
            return;
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        // nearest node within 10px
        const positions = snapshot.positions ?? {};
        const bestRef = { current: null };
        snapshot.nodes.forEach((node, index) => {
            const p = positions[node.id] ?? {
                x: Math.cos((index / snapshot.nodes.length) * Math.PI * 2) * 200,
                y: Math.sin((index / snapshot.nodes.length) * Math.PI * 2) * 200,
            };
            const sx = p.x * camera.k + rect.width / 2 + camera.x;
            const sy = p.y * camera.k + rect.height / 2 + camera.y;
            const d = Math.hypot(sx - mx, sy - my);
            if (d < 12 && (bestRef.current === null || d < bestRef.current.d))
                bestRef.current = { id: node.id, d };
        });
        setSelected(bestRef.current ? bestRef.current.id : null);
    };
    const selectedNode = snapshot?.nodes.find((n) => n.id === selected) ?? null;
    return React.createElement("div", { className: "dl-canvas-wrap" }, snapshot !== null && snapshot.nodes.length > 0
        ? React.createElement("canvas", {
            ref: canvasRef,
            className: "dl-canvas",
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onWheel,
            onClick,
        })
        : React.createElement("div", { className: "dl-empty" }, "no knowledge yet — teach a session or import notes, and the graph grows here"), selectedNode !== null &&
        React.createElement("div", {
            style: {
                position: "absolute",
                right: 16,
                bottom: 16,
                maxWidth: 340,
                background: "#111111",
                border: "1px solid #222222",
                padding: "12px 14px",
                fontSize: 12,
            },
        }, React.createElement("div", { style: { color: "#ffffff", fontWeight: 600, marginBottom: 4 } }, selectedNode.name), React.createElement("div", { style: { color: "#cccccc" } }, selectedNode.statement), selectedNode.aliases.length > 0 &&
            React.createElement("div", { style: { color: "#888888", marginTop: 6, fontSize: 11 } }, selectedNode.aliases.join(" · "))));
}
// ─── the chain table ──────────────────────────────────────────────────────────
function ChainTable({ snapshot }) {
    const chains = (snapshot?.chains ?? []).filter((c) => c !== null && typeof c === "object" && Array.isArray(c.premises) && typeof c.conclusion === "string");
    const propositions = (snapshot?.propositions ?? []).filter((n) => n != null);
    const rows = chains
        .map((chain) => {
        const names = propositions.filter((n) => chain.premises.includes(n.id) || chain.conclusion === n.id);
        const nameOf = (id) => names.find((n) => n.id === id)?.name ?? id;
        return {
            id: chain.id ?? "",
            line: `${[...chain.premises].sort().map(nameOf).join(", ")} → ${nameOf(chain.conclusion)}`,
            provenance: (Array.isArray(chain.provenance) ? chain.provenance : []).map((pt) => snapshot?.sessions?.[pt?.chatId ?? ""] ?? snapshot?.fileSources?.[pt?.chatId ?? ""] ?? pt?.chatId ?? ""),
        };
    })
        .sort((a, b) => a.id.localeCompare(b.id));
    if (rows.length === 0) {
        return React.createElement("div", { className: "dl-empty" }, "no reasoning chains yet");
    }
    return React.createElement("div", { className: "dl-table-wrap" }, React.createElement("table", { className: "dl-table" }, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "argument"), React.createElement("th", null, "born in"))), React.createElement("tbody", null, rows.map((row) => React.createElement("tr", { key: row.id }, React.createElement("td", null, row.line), React.createElement("td", { className: "dl-num" }, row.provenance.join(" · ")))))));
}
// ─── new session draft ────────────────────────────────────────────────────────
function NewSessionDraft({ api }) {
    const [mode, setMode] = React.useState("teach");
    const [goal, setGoal] = React.useState("");
    const [status, setStatus] = React.useState(null);
    const start = () => {
        if (goal.trim().length === 0) {
            setStatus("say what you want to learn first");
            return;
        }
        setStatus("starting…");
        // The plugin's own route: server-side create + Learn Mode title mark +
        // the kind-marker prompt (the fold reads the session kind from it).
        fetch(`${api}/session/start`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode, goal }),
        })
            .then((r) => r.json())
            .then((value) => {
            if (value.ok === true && value.sessionId) {
                window.location.hash = `#/session/${value.sessionId}`;
                setStatus(null);
            }
            else {
                setStatus(value.error ?? "session create failed");
            }
        })
            .catch(() => setStatus("session create failed"));
    };
    return React.createElement("div", { className: "dl-draft" }, React.createElement("div", { className: "dl-mode-row" }, React.createElement("button", { className: "dl-mode", "data-on": mode === "teach" ? "true" : "false", onClick: () => setMode("teach") }, "teach"), React.createElement("button", { className: "dl-mode", "data-on": mode === "practice" ? "true" : "false", onClick: () => setMode("practice") }, "practice")), React.createElement("label", null, mode === "teach" ? "what do you want to understand?" : "what do you want to practice?", React.createElement("textarea", {
        className: "dl-textarea",
        value: goal,
        onChange: (e) => setGoal(e.target.value),
        placeholder: mode === "teach" ? "e.g. why the chain rule works" : "e.g. derivative word problems",
    })), status !== null && React.createElement("div", { className: "dl-error" }, status), React.createElement("div", null, React.createElement("button", { className: "dl-btn", onClick: start, disabled: status === "starting…" }, "start session")));
}
// ─── notes import ─────────────────────────────────────────────────────────────
function NotesImport({ api, onImported }) {
    const [text, setText] = React.useState("");
    const [status, setStatus] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const submit = () => {
        if (text.trim().length === 0) {
            setStatus("paste your notes first");
            return;
        }
        setBusy(true);
        setStatus("importing…");
        fetch(`${api}/notes/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, filePath: `pasted-${new Date().toISOString().slice(0, 10)}.md` }),
        })
            .then((r) => r.json())
            .then((value) => {
            setBusy(false);
            if (value.error) {
                setStatus(`import failed: ${value.error}`);
            }
            else {
                setStatus(`merged ${value.nodes ?? 0} propositions, ${value.chains ?? 0} chains`);
                onImported();
            }
        })
            .catch(() => {
            setBusy(false);
            setStatus("import failed");
        });
    };
    return React.createElement("div", { className: "dl-draft" }, React.createElement("label", null, "paste notes to import into the graph", React.createElement("textarea", {
        className: "dl-textarea",
        value: text,
        onChange: (e) => setText(e.target.value),
        style: { minHeight: 200 },
        placeholder: "any markdown or plain text…",
    })), status !== null && React.createElement("div", { className: "dl-status", "data-err": status.includes("failed") ? "true" : "false" }, status), React.createElement("div", null, React.createElement("button", { className: "dl-btn", onClick: submit, disabled: busy }, "import")));
}
