/**
 * PanelErrorBoundary — a class error boundary around the Learning panel.
 * A throw inside the panel must NEVER unmount the harness root (the
 * "can't click anything" failure mode): the boundary renders a quiet
 * error notice instead and keeps the shell alive.
 */
import * as React from "react";
export class PanelErrorBoundary extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
    componentDidCatch(err) {
        // eslint-disable-next-line no-console
        console.error("[deep-learning] panel crashed:", err);
        void fetch("/api/deep-learning/diag", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ at: Date.now(), kind: "panel-crash", message: err instanceof Error ? err.message : String(err) }),
        }).catch(() => { });
    }
    render() {
        if (this.state.error !== null) {
            return React.createElement("div", {
                style: {
                    padding: 24,
                    color: "#ef4444",
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 13,
                    lineHeight: 1.5,
                },
            }, React.createElement("div", { style: { fontWeight: 600, marginBottom: 8 } }, "The Learning panel hit an error:"), React.createElement("div", null, this.state.error));
        }
        return this.props.children;
    }
}
