import * as React from "react";
import { LearningPanel } from "./panel.js";
import { ensureStyle } from "./styles.js";

export function LearningSidebarTab(props: Record<string, unknown>): React.ReactElement {
  ensureStyle();
  const useTabInfo = props.useTabInfo;
  const info = typeof useTabInfo === "function" ? (useTabInfo as () => { tab?: { navigation?: { params?: unknown } } })() : undefined;
  const params = info?.tab?.navigation?.params;
  const startView = typeof params === "object" && params !== null && "view" in params && typeof params.view === "string" ? params.view : undefined;
  const sessionId = typeof props.sessionId === "string" ? props.sessionId : undefined;
  return React.createElement(LearningPanel, { apiRoot: "/api/deep-learning", initialView: startView, sessionId });
}

export function LearningSidebarTitle(): React.ReactElement {
  return React.createElement("span", { className: "dl-sidebar-title" }, "Learning");
}
