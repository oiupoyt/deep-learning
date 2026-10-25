/**
 * Shared client styles — the KAT Square Minimalist tokens as a single
 * injected stylesheet (one style element, idempotent). All plugin
 * classes are prefixed `dl-` and never touch host chrome outside its own
 * panels.
 */

export const DL_STYLE_ID = "deep-learning-client-style";

export function ensureStyle(): void {
	if (typeof document === "undefined") return;
	if (document.getElementById(DL_STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = DL_STYLE_ID;
	style.textContent = `
/* deep-learning — KAT Square Minimalist (DESIGN.md) */
.dl-root, .dl-root * { box-sizing: border-box; border-radius: 0 !important; margin: 0; padding: 0; }
.dl-root {
	font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	background: #0b0b0b; color: #cccccc; font-size: 13px; line-height: 1.55;
	display: flex; flex-direction: column; height: 100%; min-height: 0;
}
.dl-head {
	display: flex; align-items: center; gap: 10px; padding: 10px 16px;
	border-bottom: 1px solid #1c1c1c; flex: none;
}
.dl-title { font-size: 15px; font-weight: 600; letter-spacing: -0.02em; color: #ffffff; }
.dl-sub { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.12em; color: #666666; }
.dl-count { font-variant-numeric: tabular-nums; color: #888888; font-size: 0.78rem; }
.dl-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

/* toolbar row */
.dl-toolbar {
	display: flex; align-items: center; gap: 8px; padding: 8px 16px;
	border-bottom: 1px solid #1c1c1c; flex: none;
}
.dl-btn {
	display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
	background: #161616; color: #dddddd; border: 1px solid #303030;
	font-size: 0.78rem; font-family: inherit; cursor: pointer; letter-spacing: 0.02em;
	transition: all 0.15s ease;
}
.dl-btn:hover:not(:disabled) { background: #242424; border-color: #555555; color: #ffffff; }
.dl-btn:active:not(:disabled) { background: #ffffff; color: #000000; border-color: #ffffff; }
.dl-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.dl-btn[data-on="true"] { border-color: #38bdf8; color: #38bdf8; }
.dl-spacer { flex: 1; }

/* canvas */
.dl-canvas-wrap { position: relative; flex: 1; min-height: 0; background: #0b0b0b; }
.dl-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }
.dl-canvas:active { cursor: grabbing; }
.dl-empty {
	position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
	color: #555555; font-size: 0.82rem; text-align: center; padding: 24px;
}

/* chain table */
.dl-table-wrap { flex: 1; min-height: 0; overflow: auto; }
table.dl-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
table.dl-table th {
	text-align: left; font-weight: 500; font-size: 0.72rem; text-transform: uppercase;
	letter-spacing: 0.12em; color: #666666; padding: 8px 12px;
	border-bottom: 1px solid #222222; position: sticky; top: 0; background: #0b0b0b;
}
table.dl-table td { padding: 7px 12px; border-bottom: 1px solid #1c1c1c; color: #cccccc; vertical-align: top; }
table.dl-table tr:hover td { background: #141414; }
.dl-num { font-variant-numeric: tabular-nums; color: #888888; }

/* new-session draft */
.dl-draft { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
.dl-draft label { display: flex; flex-direction: column; gap: 4px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.12em; color: #666666; }
.dl-input, .dl-textarea, .dl-select {
	background: #0e0e0e; color: #e5e5e5; border: 1px solid #222222;
	padding: 8px 10px; font-family: inherit; font-size: 0.82rem; outline: none;
	transition: border-color 0.15s ease; text-transform: none; letter-spacing: normal;
}
.dl-input:focus, .dl-textarea:focus, .dl-select:focus { border-color: #555555; }
.dl-textarea { resize: vertical; min-height: 64px; }
.dl-mode-row { display: flex; gap: 0; }
.dl-mode {
	flex: 1; padding: 8px 0; text-align: center; background: #111111; color: #888888;
	border: 1px solid #222222; cursor: pointer; font-size: 0.78rem; transition: all 0.15s ease;
}
.dl-mode + .dl-mode { border-left: none; }
.dl-mode[data-on="true"] { background: #161616; color: #38bdf8; border-color: #38bdf8; }
.dl-error { color: #ff5555; font-size: 0.78rem; }

/* question card (toolview + dock companion share these) */
.dl-q { border: 1px solid #222222; background: #111111; padding: 12px; font-size: 13px; }
.dl-q-kind { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.12em; color: #666666; margin-bottom: 6px; display: flex; gap: 8px; }
.dl-q-kind .dl-kind-active { color: #38bdf8; }
.dl-q-kind .dl-kind-check { color: #4ade80; }
.dl-q-text { color: #e5e5e5; white-space: pre-wrap; }
.dl-q-options { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.dl-opt {
	display: flex; gap: 8px; align-items: baseline; padding: 8px 10px;
	background: #0e0e0e; border: 1px solid #222222; cursor: pointer; transition: all 0.15s ease;
}
.dl-opt:hover { border-color: #333333; }
.dl-opt[data-picked="true"] { border-color: #38bdf8; color: #38bdf8; }
.dl-opt[data-correct="true"] { border-color: #4ade80; color: #4ade80; }
.dl-opt[data-wrong="true"] { border-color: #ff5555; color: #ff5555; }
.dl-opt-idx { color: #888888; font-variant-numeric: tabular-nums; flex: none; }
.dl-thinking { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.dl-confidence-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.dl-confidence-track { flex: 1; display: flex; gap: 0; }
.dl-stop {
	flex: 1; padding: 6px 0; text-align: center; background: #0e0e0e; color: #666666;
	border: 1px solid #222222; cursor: pointer; font-size: 0.72rem;
	font-variant-numeric: tabular-nums; transition: all 0.15s ease;
}
.dl-stop + .dl-stop { border-left: none; }
.dl-stop[data-on="true"] { background: #161616; color: #38bdf8; border-color: #38bdf8; }
.dl-q-actions { display: flex; gap: 8px; margin-top: 12px; }
.dl-q-actions .dl-btn { flex: none; }
.dl-reveal {
	margin-top: 8px; padding: 8px 10px; background: #0e0e0e; border: 1px dashed #333333;
	color: #888888; cursor: pointer; font-size: 0.78rem; width: 100%;
	transition: all 0.15s ease;
}
.dl-reveal:hover { color: #e5e5e5; border-color: #555555; }
.dl-verdict { margin-top: 8px; font-size: 0.82rem; }
.dl-verdict[data-c="true"] { color: #4ade80; }
.dl-verdict[data-c="false"] { color: #ff5555; }
.dl-explanation { margin-top: 8px; padding: 10px; background: #0e0e0e; border-left: 2px solid #4ade80; color: #cccccc; font-size: 0.8rem; white-space: pre-wrap; }

/* settings */
.dl-settings { display: flex; flex-direction: column; gap: 18px; }
.dl-settings h3 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.12em; color: #666666; font-weight: 500; }
.dl-pin-row { display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; }
.dl-pin-label { color: #cccccc; font-size: 0.8rem; }
.dl-seg-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #1c1c1c; }
.dl-seg-name { flex: 1; color: #cccccc; font-size: 0.8rem; }
.dl-status { display: flex; gap: 8px; align-items: center; margin-top: 12px; color: #4ade80; font-size: 0.78rem; }
.dl-status[data-err="true"] { color: #ff5555; }
`;
	document.head.appendChild(style);
}
