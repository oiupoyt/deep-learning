# deep-learning

A native learning-mode plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), ported from [LearnHarness](https://github.com/amosblomqvist/learnharness). It combines guided teaching, practice, background extraction, and an inspectable knowledge graph inside the normal DSH conversation and sidebar surfaces.

The teaching loop is:

1. **Probe**: measure the learner's current understanding and confidence.
2. **Plan**: build a dependency map from the learner's starting point to the goal.
3. **Teach**: explain one reasoning step at a time and check understanding.
4. **Practice**: retrieve the knowledge in fresh problems without naming the answer.

The original methodology is preserved in the prompt library under [prompts/](prompts/). This repository keeps the original AGPL-3.0 license and attribution; see [NOTICE](NOTICE).

## Native DSH surfaces

The plugin uses DSH session events and projections as its source of truth. Learning state is recorded in the session, restored when an agent is created, and folded again when new events arrive. Tools are registered on the owning agent and disposed with it, so a learning tool cannot leak into another conversation.

The web client adds:

- A **Learn** activity toggle beside the conversation input/model controls.
- A keyboard command, **Cmd/Ctrl+Alt+L** in the web client, to toggle Learn Mode for the selected conversation and open its sidebar tab.
- A right-sidebar **Learning** tab with five views: **Overview**, **Map**, **Chains**, **Diagrams**, and **Sources**.
- An animated, keyboard-accessible black-and-white SVG graph. Nodes have focusable labels and visible selection state; the graph is not canvas-only.
- Persisted demo and visual artifacts rendered in sandboxed iframe documents.
- Native question cards and a Deep Learning section in Settings for model roles, graph extraction, quiz mechanics, and prompt overrides.

The sidebar and settings are registered through DSH client slots. The server routes are registered through the authenticated DSH connection rather than a replacement web server.

## Install

Requirements:

- A DeepSeek Harness installation with the web profile.
- A configured DSH model/provider route.
- pnpm for local installation and development.

From a local checkout, link the plugin into the DSH web profile:

    cd ~/.dsh/profiles/web
    pnpm add link:/path/to/deep-learning

Add deep-learning to the profile's dsh.profile.bundles list if it is not already present, then restart the web profile:

    dsh web

The plugin package declares its DSH server and client injections in package.json. The client bundle is built into client/client.js; the server entry is lib/index.js.

## Use it

### Start learning

Select a conversation and turn on **Learn** from the activity toggle or keyboard command. To start a dedicated lesson, use the Learning sidebar's new-session action, choose **Teach** or **Practice**, and describe the goal.

Teach sessions move from probe to plan to teaching. Probe and teaching questions use the native question-card surface, including thinking notes, confidence, single-select or multi-select answers, and free-recall mode when configured. Practice sessions pose problems and hints against the knowledge already present in the graph.

### Inspect the learning record

The Learning sidebar is organized for repeated use:

- **Overview** summarizes the current graph and session activity.
- **Map** shows propositions and reasoning links in the animated SVG graph.
- **Chains** lists the stored reasoning chains and their birth sessions.
- **Diagrams** lists persisted interactive demos and visual artifacts. Each artifact is opened in a sandboxed document.
- **Sources** shows imported notes and source provenance.

Import notes from the Sources or Overview workflow. Notes use the same extractor and auditor pipeline as teaching output, so imported knowledge follows the same identity and provenance rules.

### Data and restore

The plugin keeps plain, inspectable files under ~/.dsh/deep-learning/ for graph ledgers, coverage, settings, sessions, and artifacts. Learning mode itself is durable session state, not a process-global flag. On resume, the plugin replays canonical data payloads, pairs tool calls with tool results, restores the phase and session kind, and then re-registers the correct tools for that agent.

## Model roles

Conversation turns use the model selected by DSH for the session. Background work resolves through the Deep Learning Settings pins and never hardcodes a provider or model:

| Role | Purpose | Fallback |
|---|---|---|
| researcher | Web research briefs | cheap slot |
| demo builder | Single-file interactive HTML artifacts | cheap slot |
| visual maker | SVG visual artifacts | vision slot |
| PDF reader | Cited briefs over learner PDFs | vision slot |
| extractor | Propositions and reasoning chains | cheap slot |
| auditor | Identity and merge decisions | cheap slot |

A role override wins over its slot. An unset role refuses the operation with a clear message; it does not silently choose a model. Provider credentials, streaming, retries, and model catalogs remain owned by DSH.

## Development

Install dependencies and run the full local check:

    pnpm install
    pnpm run check

pnpm run check performs strict TypeScript typechecking, builds the server and client bundle, and runs the deterministic Node test suite. The tests use fake seams and temporary directories; they do not require network access or an LLM.

Useful individual commands:

    pnpm run typecheck
    pnpm run build
    pnpm test

The source is split into pure domain folds and DSH adapters. The important boundaries are:

- src/core/session-replay.ts: canonical session-event replay and live folding.
- src/core/learning-mode.ts: durable projection and mode mutations.
- src/index.ts: DSH lifecycle, scoped tools, system prompt, routes, and extraction triggers.
- src/client/: native activity toggle, shortcut, sidebar tab, graph, diagrams, questions, and settings.
- src/store/: append-only graph, session, settings, and artifact ledgers.

## License

[AGPL-3.0-only](LICENSE) - see [NOTICE](NOTICE) for the LearnHarness attribution and dependency license notes.
