/**
 * Shared client styles — the LearnHarness skin, ported for the plugin.
 * The original's design tokens (app/globals.css, wave 5) as one injected
 * stylesheet: #141414 main / #1c1c1c cards / #434343 borders, JetBrains
 * Mono chrome + Source Sans 3 prose, the 4/8/12/16 radii ladder, the
 * muted #8d8d8d, the confidence ramp's exact colors. All plugin classes
 * stay `dl-`-prefixed and never touch host chrome outside the plugin's
 * own panels.
 */

export const DL_STYLE_ID = "deep-learning-client-style";

export function ensureStyle(): void {
	if (typeof document === "undefined") return;
	if (document.getElementById(DL_STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = DL_STYLE_ID;
	style.textContent = `
/* deep-learning — the LearnHarness skin (ported tokens) */
.dl-root, .dl-root * { box-sizing: border-box; margin: 0; padding: 0; }
/* The token block ALSO at :root level: settings/toolview surfaces render
   OUTSIDE .dl-root (the harness hosts them directly), where .dl-root's
   custom properties would resolve to nothing — invisible buttons. */
:root, .dl-root {
	--dl-background: #141414;
	--dl-foreground: #e6e6e6;
	--dl-card: #1c1c1c;
	--dl-border: #434343;
	--dl-muted: #8d8d8d;
	--dl-accent: #2a2a2a;
	--dl-input: #434343;
	--dl-font-ui: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
	--dl-font-prose: 'Source Sans 3', ui-sans-serif, system-ui, sans-serif;
	--dl-radius-sm: 4px; --dl-radius-md: 8px; --dl-radius-lg: 12px; --dl-radius-xl: 16px;
	font-family: var(--dl-font-ui);
	background: var(--dl-background); color: var(--dl-foreground);
	font-size: 14px; line-height: 1.45;
	display: flex; flex-direction: column; height: 100%; min-height: 0;
	color-scheme: dark;
}
.dl-root :focus-visible { outline: 2px solid var(--dl-foreground); outline-offset: 3px; }
.dl-root :focus:not(:focus-visible) { outline: none; }
.dl-head {
	display: flex; align-items: baseline; gap: 12px; padding: 16px 20px 10px;
	flex: none;
}
.dl-title {
	font-family: var(--dl-font-prose); font-weight: 900; font-size: 25px;
	line-height: 1.3; letter-spacing: -0.01em; color: var(--dl-foreground);
}
.dl-sub { font-size: 12.5px; color: var(--dl-muted); }
.dl-count { font-size: 12.5px; color: var(--dl-muted); font-variant-numeric: tabular-nums; margin-left: auto; }
.dl-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

/* toolbar row */
.dl-toolbar {
	display: flex; align-items: center; gap: 8px; padding: 6px 20px 12px;
	border-bottom: 1px solid var(--dl-card); flex: none;
}
.dl-btn {
	display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px;
	background: var(--dl-card); color: var(--dl-foreground);
	border: 1px solid var(--dl-border); border-radius: var(--dl-radius-md);
	font-size: 13px; font-family: inherit; cursor: pointer;
	transition: background-color 0.15s ease, border-color 0.15s ease;
}
.dl-btn:hover:not(:disabled) { background: var(--dl-accent); }
.dl-btn:active:not(:disabled) { background: var(--dl-foreground); color: var(--dl-background); border-color: var(--dl-foreground); }
.dl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.dl-btn[data-on="true"] { background: var(--dl-foreground); color: var(--dl-background); border-color: var(--dl-foreground); }
.dl-spacer { flex: 1; }

/* learning views */
.dl-tabs { display: flex; gap: 2px; padding: 0 16px; overflow-x: auto; border-bottom: 1px solid var(--dl-border); flex: none; scrollbar-width: thin; }
.dl-tab { flex: none; min-height: 40px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--dl-muted); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.dl-tab:hover { color: var(--dl-foreground); }
.dl-tab[aria-selected="true"] { color: var(--dl-foreground); border-bottom-color: var(--dl-foreground); }
.dl-activity { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 9px; border: 1px solid var(--dl-border); border-radius: 6px; background: transparent; color: var(--dl-muted); font: inherit; font-size: 12px; cursor: pointer; }
.dl-activity:hover:not(:disabled), .dl-activity[aria-pressed="true"] { color: var(--dl-foreground); border-color: var(--dl-foreground); }
.dl-activity:disabled { opacity: .45; cursor: not-allowed; }
.dl-activity-mark { font-size: 10px; }
.dl-overview { flex: 1; min-height: 0; overflow: auto; padding: 18px 20px 28px; }
.dl-overview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--dl-border); margin-bottom: 24px; }
.dl-stat { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 14px; border-right: 1px solid var(--dl-border); }
.dl-stat:last-child { border-right: 0; }
.dl-stat strong { color: var(--dl-foreground); font-size: 20px; font-variant-numeric: tabular-nums; }
.dl-stat span, .dl-section-heading { color: var(--dl-muted); font-size: 12px; }
.dl-section-heading { padding: 12px 0 4px; border-top: 1px solid var(--dl-border); text-transform: uppercase; }
.dl-map-shell { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; padding: 8px 12px 18px; }
.dl-map-meta { flex: none; padding: 5px 4px 10px; color: var(--dl-muted); font-size: 12px; }
.dl-map { flex: none; width: 100%; min-width: 560px; height: auto; min-height: 280px; overflow: visible; color: var(--dl-muted); }
.dl-map-edge { stroke: var(--dl-border); stroke-width: 1.5; }
.dl-map-node { cursor: pointer; transform-box: fill-box; transform-origin: center; animation: dl-node-enter 420ms cubic-bezier(.2,.75,.25,1) both; }
.dl-map-node:focus { outline: none; }
.dl-map-node:focus-visible .dl-map-dot { stroke: var(--dl-foreground); stroke-width: 3; }
.dl-map-dot { fill: var(--dl-card); stroke: var(--dl-muted); stroke-width: 1.5; transition: r 160ms ease, fill 160ms ease, stroke 160ms ease; }
.dl-map-dot-selected { fill: var(--dl-foreground); stroke: var(--dl-foreground); }
.dl-map-label { fill: var(--dl-foreground); font: 12px var(--dl-font-ui); pointer-events: none; }
.dl-map-inspector { flex: none; margin: 10px 4px 0; padding: 12px 14px; border-left: 2px solid var(--dl-foreground); background: var(--dl-card); }
.dl-map-inspector p { margin-top: 5px; color: var(--dl-muted); white-space: pre-wrap; }
.dl-map-inspector span { display: block; margin-top: 7px; color: var(--dl-muted); font-size: 12px; }
.dl-empty { flex: 1; min-height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--dl-muted); font-size: 14px; text-align: center; padding: 24px; }
.dl-empty strong { color: var(--dl-foreground); }
.dl-empty p { max-width: 440px; }
.dl-source-list { flex: 1; min-height: 0; overflow: auto; list-style: none; padding: 8px 20px; }
.dl-source-list li { display: flex; flex-direction: column; gap: 4px; padding: 12px 0; border-bottom: 1px solid var(--dl-border); overflow-wrap: anywhere; }
.dl-source-list li span { color: var(--dl-muted); font-size: 12px; }
.dl-artifact-list { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px 24px; display: grid; gap: 14px; }
.dl-artifact { border: 1px solid var(--dl-border); background: var(--dl-card); padding: 12px; }
.dl-artifact header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.dl-artifact header span { color: var(--dl-muted); font-size: 11px; white-space: nowrap; }
.dl-artifact p { margin: 8px 0 10px; color: var(--dl-muted); font-size: 12px; white-space: pre-wrap; }
.dl-artifact-frame { display: block; width: 100%; min-height: 240px; border: 1px solid var(--dl-border); background: #fff; }
.dl-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.dl-sidebar-title { color: var(--dl-foreground); font-size: 12px; }
@keyframes dl-node-enter { from { opacity: 0; scale: .82; } to { opacity: 1; scale: 1; } }
@media (max-width: 620px) {
  .dl-head { padding: 12px 14px 8px; }
  .dl-tabs { padding: 0 8px; }
  .dl-tab { padding: 0 9px; }
  .dl-overview { padding: 14px; }
  .dl-overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dl-stat:nth-child(2) { border-right: 0; }
  .dl-stat:nth-child(-n+2) { border-bottom: 1px solid var(--dl-border); }
  .dl-map { min-width: 520px; }
  .dl-artifact header { align-items: flex-start; flex-direction: column; gap: 4px; }
  .dl-artifact-frame { min-height: 190px; }
}
@media (prefers-reduced-motion: reduce) { .dl-map-node { animation: none; } .dl-map-dot { transition: none; } }

/* chain table */
.dl-table-wrap { flex: 1; min-height: 0; overflow: auto; }
table.dl-table { width: 100%; border-collapse: collapse; font-size: 13px; }
table.dl-table th {
	text-align: left; font-weight: 500; font-size: 12.5px; color: var(--dl-muted);
	padding: 10px 14px; border-bottom: 1px solid var(--dl-border);
	position: sticky; top: 0; background: var(--dl-background);
}
table.dl-table td { padding: 9px 14px; border-bottom: 1px solid var(--dl-card); color: var(--dl-foreground); vertical-align: top; }
table.dl-table tr:hover td { background: var(--dl-card); }
.dl-num { font-variant-numeric: tabular-nums; color: var(--dl-muted); }

/* new-session draft (the original minimal-home composer feel) */
.dl-draft { display: flex; flex-direction: column; gap: 12px; padding: 24px 20px; max-width: 640px; }
.dl-draft-label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--dl-muted); }
.dl-input, .dl-textarea, .dl-select {
	background: var(--dl-background); color: var(--dl-foreground);
	border: 1px solid var(--dl-input); border-radius: var(--dl-radius-md);
	padding: 8px 11px; font-family: inherit; font-size: 13px;
	transition: border-color 0.15s ease; width: 100%;
}
.dl-input:focus, .dl-textarea:focus, .dl-select:focus { border-color: var(--dl-muted); }
.dl-input::placeholder, .dl-textarea::placeholder { color: var(--dl-muted); }
.dl-textarea { resize: vertical; min-height: 72px; }
.dl-mode-row { display: flex; gap: 0; }
.dl-mode {
	flex: 1; padding: 9px 0; text-align: center; background: var(--dl-card);
	color: var(--dl-muted); border: 1px solid var(--dl-border); cursor: pointer;
	font-size: 13px; font-family: inherit; border-radius: 0;
	transition: color 0.15s ease, background-color 0.15s ease;
}
.dl-mode:first-child { border-radius: var(--dl-radius-md) 0 0 var(--dl-radius-md); border-right: none; }
.dl-mode:last-child { border-radius: 0 var(--dl-radius-md) var(--dl-radius-md) 0; }
.dl-mode[data-on="true"] { color: var(--dl-foreground); background: var(--dl-accent); }
.dl-error { color: #ef4444; font-size: 12.5px; }
.dl-status { display: flex; gap: 8px; align-items: center; margin-top: 12px; color: var(--dl-muted); font-size: 12.5px; }
.dl-status[data-err="true"] { color: #ef4444; }

/* question card (the original dock: card + bordered option rows + rail) */
.dl-q {
	border: 1px solid var(--dl-border); border-radius: var(--dl-radius-lg);
	background: var(--dl-card); padding: 14px 16px; font-size: 14px;
}
.dl-q-kind { font-size: 12.5px; color: var(--dl-muted); margin-bottom: 8px; display: flex; gap: 8px; }
.dl-q-kind .dl-kind-active { color: var(--dl-foreground); font-weight: 500; }
.dl-q-text { color: var(--dl-foreground); white-space: pre-wrap; font-family: var(--dl-font-prose); font-size: 15px; font-weight: 500; }
.dl-q-options { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.dl-opt {
	display: flex; gap: 10px; align-items: flex-start; padding: 8px 11px;
	background: transparent; border: 1px solid var(--dl-border);
	border-radius: var(--dl-radius-md); cursor: pointer; text-align: left;
	font-size: 13.5px; font-family: var(--dl-font-prose); color: var(--dl-foreground);
	transition: background-color 0.15s ease, border-color 0.15s ease; width: 100%;
}
.dl-opt:hover { background: rgba(42, 42, 42, 0.5); }
.dl-opt[data-picked="true"] { border-color: var(--dl-foreground); background: var(--dl-accent); }
.dl-opt-marker {
	flex: none; width: 16px; height: 16px; margin-top: 2px; display: flex;
	align-items: center; justify-content: center; border: 1px solid var(--dl-muted);
	border-radius: 999px; font-size: 10px; color: var(--dl-background);
}
.dl-opt[data-square="true"] .dl-opt-marker { border-radius: 3px; }
.dl-opt[data-picked="true"] .dl-opt-marker { border-color: var(--dl-foreground); background: var(--dl-foreground); }
.dl-opt-idx { color: var(--dl-muted); font-variant-numeric: tabular-nums; flex: none; }
.dl-thinking { margin-top: 12px; display: flex; flex-direction: column; gap: 4px; }
.dl-thinking-label { font-size: 12.5px; color: var(--dl-muted); }
.dl-q-actions { display: flex; gap: 8px; margin-top: 14px; align-items: center; }
.dl-q-actions .dl-btn { flex: none; }
.dl-reveal {
	margin-top: 12px; padding: 9px 11px; background: var(--dl-card);
	border: 1px dashed var(--dl-border); border-radius: var(--dl-radius-md);
	color: var(--dl-muted); cursor: pointer; font-size: 13px; width: 100%;
	transition: color 0.15s ease, border-color 0.15s ease;
}
.dl-reveal:hover { color: var(--dl-foreground); border-color: var(--dl-muted); }
.dl-verdict { margin-top: 10px; font-size: 13px; }
.dl-verdict[data-c="true"] { color: #10b981; }
.dl-verdict[data-c="false"] { color: #ef4444; }
.dl-explanation {
	margin-top: 10px; padding: 11px; background: var(--dl-background);
	border-left: 2px solid var(--dl-muted); border-radius: var(--dl-radius-sm);
	color: var(--dl-foreground); font-size: 13.5px; white-space: pre-wrap;
	font-family: var(--dl-font-prose);
}

/* confidence rail (the original's paint: #141414 base, solid ticks under a
   transparent-past fill; ramp 0 red -> 100 emerald) */
.dl-confidence-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.dl-confidence-label { font-size: 12.5px; color: var(--dl-muted); flex: none; }
.dl-confidence-track { flex: 1; position: relative; height: 6px; border: 1px solid var(--dl-border); border-radius: 999px; overflow: hidden; background: var(--dl-background); }
.dl-confidence-fill { position: absolute; inset: 0; }
.dl-confidence-ticks { position: absolute; inset: 0; display: flex; }
.dl-confidence-tick { flex: 1; border-right: 1px solid rgba(230, 230, 230, 0.35); }
.dl-confidence-tick:last-child { border-right: none; }
.dl-confidence-stop-btns { display: flex; gap: 6px; margin-top: 6px; justify-content: space-between; }
.dl-stop {
	flex: none; padding: 3px 7px; background: transparent; color: var(--dl-muted);
	border: none; cursor: pointer; font-size: 11px; line-height: 1.4;
	font-variant-numeric: tabular-nums; transition: color 0.15s ease;
}
.dl-stop[data-on="true"] { color: var(--dl-foreground); font-weight: 600; }

/* the sidebar panel icon glyph (Learn Mode entry) */
.dl-panel-icon { color: var(--dl-muted); font-size: 16px; line-height: 1; }

/* settings */
.dl-settings { display: flex; flex-direction: column; gap: 20px; padding: 4px 0; }
.dl-settings h3 { font-size: 12.5px; color: var(--dl-muted); font-weight: 500; letter-spacing: 0.01em; }
.dl-pin-row { display: grid; grid-template-columns: 190px 1fr 1fr; gap: 8px; align-items: center; padding: 5px 0; }
.dl-pin-label { color: var(--dl-foreground); font-size: 13px; }
.dl-pin-note { font-size: 12.5px; color: var(--dl-muted); padding: 8px 0 2px; }
.dl-seg-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--dl-card); }
.dl-seg-name { flex: 1; color: var(--dl-foreground); font-size: 13px; }
.dl-select { appearance: none; background-image: none; }
.dl-select option { background: var(--dl-card); color: var(--dl-foreground); }
`;
	document.head.appendChild(style);
}
