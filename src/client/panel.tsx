import * as React from "react";
import { ensureStyle } from "./styles.js";
import { parseArtifactsResponse, parseSnapshot, type Snapshot, type SnapshotNode } from "./contracts.js";
import type { LearningArtifact } from "../store/artifacts.js";
type View = "overview" | "map" | "chains" | "diagrams" | "sources";

export function LearningPanel(props: { apiRoot?: string; initialView?: string; sessionId?: string } & Record<string, unknown>): React.ReactElement {
  ensureStyle();
  const api = props.apiRoot ?? "/api/deep-learning";
  const initialView = isView(props.initialView) ? props.initialView : "overview";
  const [view, setView] = React.useState<View>(initialView);
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [artifacts, setArtifacts] = React.useState<LearningArtifact[]>([]);
  const [artifactError, setArtifactError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    let cancelled = false;
    fetch(api + "/graph")
      .then((response) => response.json())
      .then((value: unknown) => {
        if (cancelled) return;
        const parsed = parseSnapshot(value);
        if (parsed === null) setError("graph returned an invalid snapshot");
        else { setSnapshot(parsed); setError(null); }
      })
      .catch(() => { if (!cancelled) setError("graph unavailable"); });
    return () => { cancelled = true; };
  }, [api]);
  React.useEffect(load, [load]);
  React.useEffect(() => {
    if (view !== "diagrams" || !props.sessionId) {
      setArtifacts([]);
      setArtifactError(null);
      return;
    }
    let cancelled = false;
    setArtifactError(null);
    fetch(api + "/artifacts?session=" + encodeURIComponent(props.sessionId))
      .then((response) => { if (!response.ok) throw new Error("artifact request failed"); return response.json(); })
      .then((value: unknown) => {
        if (cancelled) return;
        const parsed = parseArtifactsResponse(value);
        if (parsed === null) setArtifactError("artifacts returned an invalid response");
        else setArtifacts(parsed);
      })
      .catch(() => { if (!cancelled) setArtifactError("artifacts unavailable"); });
    return () => { cancelled = true; };
  }, [api, props.sessionId, view]);
  const propositionCount = snapshot?.propositions.length ?? 0;
  const chainCount = snapshot?.chains.length ?? 0;
  const tabs: Array<[View, string]> = [["overview", "Overview"], ["map", "Map"], ["chains", "Chains"], ["diagrams", "Diagrams"], ["sources", "Sources"]];
  return React.createElement(
    "section", { className: "dl-root", "aria-label": "Learning workspace" },
    React.createElement("header", { className: "dl-head" },
      React.createElement("div", null,
        React.createElement("div", { className: "dl-title" }, "Learning"),
        React.createElement("div", { className: "dl-sub" }, "measured understanding and durable knowledge"),
      ),
      React.createElement("span", { className: "dl-spacer" }),
      React.createElement("span", { className: "dl-count", "aria-live": "polite" }, String(propositionCount) + " propositions / " + String(chainCount) + " chains"),
    ),
    React.createElement("nav", { className: "dl-tabs", role: "tablist", "aria-label": "Learning views" },
      tabs.map(([key, label]) => React.createElement("button", {
        key, type: "button", role: "tab", className: "dl-tab", "aria-selected": view === key,
        tabIndex: view === key ? 0 : -1, onClick: () => setView(key),
      }, label)),
    ),
    React.createElement("main", { className: "dl-body" },
      error !== null && React.createElement("div", { className: "dl-error", role: "alert" }, error),
      error === null && view === "overview" && React.createElement(Overview, { snapshot, api, onImported: load }),
      error === null && view === "map" && React.createElement(GraphMap, { snapshot }),
      error === null && view === "chains" && React.createElement(ChainTable, { snapshot }),
      error === null && view === "diagrams" && React.createElement(ArtifactsView, { artifacts, error: artifactError, hasSession: Boolean(props.sessionId) }),
      error === null && view === "sources" && React.createElement(SourcesView, { snapshot }),
    ),
  );
}

function Overview({ snapshot, api, onImported }: { snapshot: Snapshot | null; api: string; onImported: () => void }): React.ReactElement {
  return React.createElement("div", { className: "dl-overview" },
    React.createElement("div", { className: "dl-overview-grid" },
      React.createElement(Stat, { label: "Propositions", value: snapshot?.propositions.length ?? 0 }),
      React.createElement(Stat, { label: "Reasoning chains", value: snapshot?.chains.length ?? 0 }),
      React.createElement(Stat, { label: "Sessions", value: Object.keys(snapshot?.sessions ?? {}).length }),
      React.createElement(Stat, { label: "Sources", value: Object.keys(snapshot?.fileSources ?? {}).length }),
    ),
    React.createElement("div", { className: "dl-section-heading" }, "Start or extend a lesson"),
    React.createElement(NewSessionDraft, { api }),
    React.createElement("div", { className: "dl-section-heading" }, "Import durable notes"),
    React.createElement(NotesImport, { api, onImported }),
  );
}
function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return React.createElement("div", { className: "dl-stat" }, React.createElement("strong", null, String(value)), React.createElement("span", null, label));
}

function GraphMap({ snapshot }: { snapshot: Snapshot | null }): React.ReactElement {
  const nodes = uniqueNodes(snapshot);
  const [selected, setSelected] = React.useState<string | null>(null);
  if (nodes.length === 0) return React.createElement(EmptyView, { title: "The map is ready", text: "Teach a session or import notes and the dependency map will appear here." });
  const positioned = layoutNodes(nodes);
  const byId = new Map(positioned.map((entry) => [entry.node.id, entry]));
  const edges = (snapshot?.edges ?? []).filter((edge) => byId.has(edge.from) && byId.has(edge.to));
  const selectedNode = nodes.find((node) => node.id === selected) ?? null;
  return React.createElement("div", { className: "dl-map-shell" },
    React.createElement("div", { className: "dl-map-meta" }, "Select a node to inspect its statement. Use Tab and Enter to navigate the map."),
    React.createElement("svg", { className: "dl-map", viewBox: "0 0 760 440", role: "group", "aria-label": "Knowledge dependency map" },
      React.createElement("defs", null, React.createElement("marker", { id: "dl-arrow", markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto" }, React.createElement("path", { d: "M0,0 L8,4 L0,8 Z", fill: "currentColor" }))),
      edges.map((edge) => {
        const from = byId.get(edge.from); const to = byId.get(edge.to);
        if (!from || !to) return null;
        return React.createElement("line", { key: edge.from + "-" + edge.to, className: "dl-map-edge", x1: from.x, y1: from.y, x2: to.x, y2: to.y, markerEnd: "url(#dl-arrow)", "aria-hidden": "true" });
      }),
      positioned.map(({ node, x, y }, index) => React.createElement("g", {
        key: node.id, className: "dl-map-node", transform: "translate(" + x + " " + y + ")", role: "button", tabIndex: 0,
        "aria-label": node.name + ": " + node.statement, "aria-pressed": selected === node.id,
        onClick: () => setSelected(node.id), onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(node.id); } },
        style: { animationDelay: String(index * 35) + "ms" },
      }, React.createElement("circle", { r: selected === node.id ? 25 : 20, className: selected === node.id ? "dl-map-dot dl-map-dot-selected" : "dl-map-dot" }), React.createElement("text", { className: "dl-map-label", x: 30, y: 4 }, truncate(node.name, 26)))),
    ),
    selectedNode !== null && React.createElement("aside", { className: "dl-map-inspector", "aria-live": "polite" }, React.createElement("strong", null, selectedNode.name), React.createElement("p", null, selectedNode.statement), selectedNode.aliases.length > 0 && React.createElement("span", null, selectedNode.aliases.join(" / "))),
  );
}

function ChainTable({ snapshot }: { snapshot: Snapshot | null }): React.ReactElement {
  const propositions = snapshot?.propositions ?? [];
  const nameOf = (id: string) => propositions.find((node) => node.id === id)?.name ?? id;
  const chains = snapshot?.chains ?? [];
  if (chains.length === 0) return React.createElement(EmptyView, { title: "No reasoning chains yet", text: "A completed teaching step will add premise-to-conclusion structure here." });
  return React.createElement("div", { className: "dl-table-wrap" }, React.createElement("table", { className: "dl-table" },
    React.createElement("caption", { className: "dl-sr-only" }, "Reasoning chains"),
    React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Argument"), React.createElement("th", null, "Source"))),
    React.createElement("tbody", null, chains.map((chain) => React.createElement("tr", { key: chain.id }, React.createElement("td", null, chain.premises.map(nameOf).join(", ") + " -> " + nameOf(chain.conclusion)), React.createElement("td", { className: "dl-num" }, chain.provenance.map((item) => snapshot?.sessions[item.chatId] ?? item.chatId).join(" / "))))),
  ));
}
function ArtifactsView({ artifacts, error, hasSession }: { artifacts: LearningArtifact[]; error: string | null; hasSession: boolean }): React.ReactElement {
  if (!hasSession) return React.createElement(EmptyView, { title: "Open a lesson to see diagrams", text: "Generated demos and figures are scoped to the active learning session." });
  if (error !== null) return React.createElement("div", { className: "dl-error", role: "alert" }, error);
  if (artifacts.length === 0) return React.createElement(EmptyView, { title: "No diagrams yet", text: "Use the teaching tools to generate a demo or figure. Saved artifacts appear here without running scripts in the panel." });
  return React.createElement("div", { className: "dl-artifact-list" }, artifacts.map((artifact) => React.createElement("article", { className: "dl-artifact", key: artifact.id },
    React.createElement("header", null, React.createElement("strong", null, artifact.title), React.createElement("span", null, artifact.kind === "demo" ? "Interactive demo" : "Visual figure")),
    artifact.notes && React.createElement("p", null, artifact.notes),
    React.createElement("iframe", { className: "dl-artifact-frame", title: artifact.title, sandbox: "", srcDoc: artifact.content })
  )));
}

function SourcesView({ snapshot }: { snapshot: Snapshot | null }): React.ReactElement {
  const sources = Object.entries(snapshot?.fileSources ?? {});
  if (sources.length === 0) return React.createElement(EmptyView, { title: "No imported sources", text: "Imported notes and research sources will be listed here with their graph provenance." });
  return React.createElement("ul", { className: "dl-source-list" }, sources.map(([id, label]) => React.createElement("li", { key: id }, React.createElement("strong", null, label), React.createElement("span", null, id))));
}
function EmptyView({ title, text }: { title: string; text: string }): React.ReactElement {
  return React.createElement("div", { className: "dl-empty" }, React.createElement("strong", null, title), React.createElement("p", null, text));
}

function NewSessionDraft({ api }: { api: string }): React.ReactElement {
  const [mode, setMode] = React.useState<"teach" | "practice">("teach");
  const [goal, setGoal] = React.useState(""); const [status, setStatus] = React.useState<string | null>(null);
  const start = () => {
    if (!goal.trim()) { setStatus("Say what you want to learn first."); return; }
    setStatus("Starting...");
    fetch(api + "/session/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, goal }) })
      .then((response) => response.json()).then((value: { ok?: boolean; sessionId?: string; error?: string }) => { if (value.ok && value.sessionId) window.location.hash = "#/session/" + value.sessionId; else setStatus(value.error ?? "Session create failed."); }).catch(() => setStatus("Session create failed."));
  };
  return React.createElement("div", { className: "dl-draft" },
    React.createElement("div", { className: "dl-mode-row", role: "group", "aria-label": "Lesson type" }, React.createElement("button", { type: "button", className: "dl-mode", "data-on": mode === "teach", onClick: () => setMode("teach") }, "Teach"), React.createElement("button", { type: "button", className: "dl-mode", "data-on": mode === "practice", onClick: () => setMode("practice") }, "Practice")),
    React.createElement("label", { className: "dl-draft-label" }, mode === "teach" ? "What do you want to understand?" : "What do you want to practice?", React.createElement("textarea", { className: "dl-textarea", value: goal, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setGoal(event.target.value), placeholder: "e.g. why the chain rule works" })),
    status !== null && React.createElement("div", { className: "dl-status", role: "status" }, status),
    React.createElement("button", { type: "button", className: "dl-btn", onClick: start, disabled: status === "Starting..." }, "Start session"),
  );
}
function NotesImport({ api, onImported }: { api: string; onImported: () => void }): React.ReactElement {
  const [text, setText] = React.useState(""); const [status, setStatus] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false);
  const submit = () => {
    if (!text.trim()) { setStatus("Paste your notes first."); return; }
    setBusy(true); setStatus("Importing...");
    fetch(api + "/notes/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, filePath: "pasted.md" }) })
      .then((response) => response.json()).then((value: { nodes?: number; chains?: number; error?: string }) => { setBusy(false); if (value.error) setStatus("Import failed: " + value.error); else { setStatus("Merged " + String(value.nodes ?? 0) + " propositions, " + String(value.chains ?? 0) + " chains."); setText(""); onImported(); } }).catch(() => { setBusy(false); setStatus("Import failed."); });
  };
  return React.createElement("div", { className: "dl-draft" }, React.createElement("label", { className: "dl-draft-label" }, "Markdown notes", React.createElement("textarea", { className: "dl-textarea", value: text, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value), placeholder: "Paste notes to extract propositions and chains." })), status !== null && React.createElement("div", { className: "dl-status", role: "status" }, status), React.createElement("button", { type: "button", className: "dl-btn", onClick: submit, disabled: busy }, busy ? "Importing..." : "Import notes"));
}
function uniqueNodes(snapshot: Snapshot | null): SnapshotNode[] {
  const map = new Map<string, SnapshotNode>();
  for (const node of [...(snapshot?.nodes ?? []), ...(snapshot?.propositions ?? [])]) if (node && typeof node.id === "string") map.set(node.id, node);
  return [...map.values()];
}
function layoutNodes(nodes: SnapshotNode[]): Array<{ node: SnapshotNode; x: number; y: number }> {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length))); const gapX = columns > 1 ? 650 / (columns - 1) : 0;
  return nodes.map((node, index) => ({ node, x: columns === 1 ? 380 : 55 + (index % columns) * gapX, y: 70 + Math.floor(index / columns) * 105 }));
}
function truncate(value: string, max: number): string { return value.length > max ? value.slice(0, max - 1) + "..." : value; }
function isView(value: unknown): value is View { return value === "overview" || value === "map" || value === "chains" || value === "diagrams" || value === "sources"; }
