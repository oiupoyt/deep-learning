import { LearningPanel } from "./panel.js";
import { PanelErrorBoundary } from "./boundary.js";
import { registerQuestionCards } from "./question-cards.js";
import { registerSettingsSection } from "./settings-section.js";
import { LearningSidebarTab, LearningSidebarTitle } from "./sidebar.js";
import { mutateLearningMode, readLearningMode, type LearningModeState } from "./mode-api.js";
import { ensureStyle } from "./styles.js";
import * as React from "react";
import type { ActivityOwnerProps, ClientContextLike, SlotsLike } from "./slots-types.js";

export const name = "deep-learning-client";
export const inject = ["slots", "shortcuts", "sidebarRight", "sidebarRightTabs"];
const API = "/api/deep-learning";
const LEARNING_TAB_KIND = "deep-learning";
const LEARNING_TAB_ID = "deep-learning";

export function apply(ctx: unknown): void {
  ensureStyle();
  const root = ctx as ClientContextLike;
  const slots = (root.get?.("slots") ?? root.slots) as SlotsLike | undefined;
  if (!slots) return;
  registerBaseSlots(slots);

  const registerNative = (native: ClientContextLike) => registerNativeSurfaces(native, slots);
  if (typeof root.inject === "function") {
    root.inject(["shortcuts", "sidebarRight", "sidebarRightTabs"], registerNative);
  } else {
    registerNative({
      shortcuts: (root.get?.("shortcuts") as ClientContextLike["shortcuts"]),
      sidebarRight: (root.get?.("sidebarRight") as ClientContextLike["sidebarRight"]),
      sidebarRightTabs: (root.get?.("sidebarRightTabs") as ClientContextLike["sidebarRightTabs"]),
      effect: root.effect,
    });
  }
}

function registerBaseSlots(slots: SlotsLike): void {
  slots.inject("main", () => slots.register({ name: "main", key: LEARNING_TAB_ID, inject: () => ({ apiRoot: API }) }, (props: Record<string, unknown>) => React.createElement(PanelErrorBoundary, null, React.createElement(LearningPanel, props))));
  slots.inject("sidebar.panellist", () => slots.register({ name: "sidebar.panellist", id: LEARNING_TAB_ID, order: 30, label: () => "Learn Mode" }, PanelIcon));
  registerQuestionCards(slots, API);
  registerSettingsSection(slots, API);
}

function registerNativeSurfaces(ctx: ClientContextLike, slots: SlotsLike): void {
  const effect = ctx.effect ?? ((operation: () => void | (() => void)) => { operation(); });
  if (ctx.shortcuts) {
    effect(() => ctx.shortcuts?.register({
      id: "deep-learning.toggle",
      label: () => "Toggle Learn Mode",
      aliases: ["learn mode", "learning mode"],
      defaults: {
        "desktop:macos": { code: "KeyL", modifiers: ["primary"] },
        "desktop:windows": { code: "KeyL", modifiers: ["primary"] },
        "desktop:linux": { code: "KeyL", modifiers: ["primary"] },
        "web:macos": { code: "KeyL", modifiers: ["primary", "alt"] },
        "web:windows": { code: "KeyL", modifiers: ["primary", "alt"] },
      },
      regions: ["page", "editable", "terminal"],
      modals: [],
      resolve: ({ target }: { target: Element | null }) => {
        const captured = ctx.sidebarRight?.commandTarget(target);
        if (!captured || !ctx.sidebarRight) return { status: "blocked", reason: "Select a conversation first." };
        return { status: "handled", run: () => {
          void mutateLearningMode(API, captured.sessionId, { toggle: true }).then(() => ctx.sidebarRight?.openTabFromTarget(LEARNING_TAB_KIND, captured)).catch(() => undefined);
        } };
      },
    }), "deep-learning: toggle shortcut");
  }
  if (ctx.sidebarRightTabs) {
    effect(() => ctx.sidebarRightTabs?.register({ id: LEARNING_TAB_ID, kind: LEARNING_TAB_KIND, keepMounted: true, title: () => "Learning" }), "deep-learning: sidebar type");
  }
  slots.inject("conversation.input.activity", () => slots.register({
    name: "conversation.input.activity",
    inject: (sessionId: string) => ({
      apiRoot: API,
      sessionId,
      openSidebar: () => ctx.sidebarRight?.openTabIn(sessionId, LEARNING_TAB_KIND, { params: { view: "overview" } }),
    }),
  }, ActivityToggle));
  slots.inject("sidebar.right.pane.tab", () => slots.register({ name: "sidebar.right.pane.tab", key: LEARNING_TAB_ID }, LearningSidebarTab));
  slots.inject("sidebar.right.pane.tab.title", () => slots.register({ name: "sidebar.right.pane.tab.title", key: LEARNING_TAB_ID }, LearningSidebarTitle));
}

function ActivityToggle(props: ActivityOwnerProps & { apiRoot?: string; openSidebar?: () => void }): React.ReactElement {
  const api = props.apiRoot ?? API;
  const [state, setState] = React.useState<LearningModeState | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    if (!props.sessionId) { setState(null); return () => { cancelled = true; }; }
    void readLearningMode(api, props.sessionId).then((value) => { if (!cancelled) setState(value); }).catch(() => { if (!cancelled) setState(null); });
    return () => { cancelled = true; };
  }, [api, props.sessionId]);
  React.useEffect(() => () => props.onActiveChange(false), [props.onActiveChange]);
  const toggle = () => {
    if (props.locked || busy || !props.sessionId) return;
    setBusy(true);
    void mutateLearningMode(api, props.sessionId, { toggle: true }).then((next) => {
      setState(next);
      if (next.enabled) props.openSidebar?.();
    }).catch(() => undefined).finally(() => setBusy(false));
  };
  const enabled = state?.enabled === true;
  return React.createElement("button", {
    type: "button", className: "dl-activity", disabled: props.locked || busy || !props.sessionId,
    "aria-label": enabled ? "Disable Learn Mode" : "Enable Learn Mode", "aria-pressed": enabled,
    title: enabled ? "Learn Mode on" : "Learn Mode off", onClick: toggle,
  }, React.createElement("span", { className: "dl-activity-mark", "aria-hidden": "true" }, enabled ? "●" : "○"), "Learn");
}

function PanelIcon(props: { size?: number } & Record<string, unknown>): React.ReactElement {
  const size = typeof props.size === "number" ? props.size : 18;
  return React.createElement("span", { className: "dl-panel-icon", style: { width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }, "aria-hidden": "true" }, "◈");
}
