# deep-learning

LearnHarness's learning loop, ported natively into the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) as a
plugin: **measure, plan, teach, practice** — plus the persistent
knowledge graph, background research, and a practice mode.

Ported from [amosblomqvist/learnharness](https://github.com/amosblomqvist/learnharness)
(AGPL-3.0). This repository keeps that license and attributes the original
in [NOTICE](NOTICE). The teaching methodology — probe the learner's edge,
plan a dependency map, teach one reasoning step at a time, practice in
fresh surfaces — is carried verbatim in the prompt library under
[`prompts/`](prompts/); see the original's
[teaching methodology doc](https://github.com/amosblomqvist/learnharness/blob/main/docs/teaching-methodology.md)
for the theory behind it.

## How it works

1. **Measure.** The prober finds where your understanding ends on each
   strand the lesson depends on. Your answers, confidence, and
   think-out-loud notes tell it where to start.
2. **Plan.** The teacher authors a dependency map from that starting
   point to your goal (`plan_init`). The map lives beside the lesson and
   adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already hold. You
   predict, get the explanation, and check your understanding — checks
   with a wrong answer are repaired before anything is built on them.
4. **Practice.** Practice sessions pose problems that require the right
   knowledge to come to mind without being named first. Problems and
   hints adapt to your thinking.

**Think out loud.** Every question carries a thinking field — your
reasoning, uncertainties, and reactions in your own words. This is how
the teacher gets a detailed picture rather than a record of right and
wrong answers.

**The graph carries it forward.** What you are taught accumulates as
propositions and reasoning chains in a knowledge graph you can inspect
(plain files under `~/.dsh/deep-learning/graph/`). Future sessions read
the graph instead of starting from scratch; practice draws from it; the
Learning panel renders it. Import your own notes into the same graph.

## Install

Requirements: a DeepSeek Harness installation (`dsh`) with the `web`
profile, and one configured model route (any provider the harness
supports).

**From this repository (profile link):**

```bash
cd ~/.dsh/profiles/web
pnpm add link:/path/to/deep-learning
# or, with the npm workflow:
npm install /path/to/deep-learning
```

Then add `"deep-learning"` to the `dsh.profile.bundles` list in
`~/.dsh/profiles/web/package.json` and restart:

```bash
dsh web
```

The Learning panel appears in the sidebar; the "Deep Learning" section
appears in Settings.

**From npm (once published):** `dsh plugin --profile web add deep-learning`.

## Usage

### Start a teaching session

Open the **Learning** panel → *new session* → pick **teach** → describe
what you want to understand → *start session*. The conversation begins
with the probe; answer in the question cards (options, a thinking field,
a confidence ladder). When the probe concludes you'll see your
assessment, then the plan map, then teaching begins.

Everything the model says or asks is inspectable and editable:

- **Prompts**: the fragment files under the package's `prompts/` directory
  are the system prompts. Copy any segment you want to change to
  `~/.dsh/deep-learning/prompts/<agent>/<file>.md` (same layout) and flip
  its switch in Settings → Deep Learning.
- **Data**: every learning record is a plain file under
  `~/.dsh/deep-learning/` — open them, back them up, grep them.

### Practice

Learning panel → *new session* → **practice** → describe what you want
to practice. Problems arrive one at a time; submit your working or your
answer; ask for a nudge when stuck; say "next problem" to move on.

### The graph

The Learning panel's **graph** view shows propositions (squares) and
arguments (junction dots) — drag to pan, scroll to zoom, click a node
for its statement. The **chains** view is the table of every reasoning
chain with its birth session. *import notes* pastes any text into the
graph through the same extraction pipeline the sessions use.

### Settings

Settings → **Deep Learning**:

| Setting | What it pins |
|---|---|
| model slots (strong / cheap / vision) | The default tiers conversation and background roles fall back to |
| role overrides (researcher, demo builder, visual maker, pdf reader, extractor, auditor) | A specific model for one role |
| quizzing mechanic | Multiple choice (probe/quiz) or free recall (recall/explain) |
| extraction chunk budget | Tokens per background extraction batch (floor 500) |
| prompt override switches | Which of your edited prompt segments go live |

## How model roles map to harness settings

The plugin never hardcodes a model. Every model call resolves through
the harness's own model configuration:

| Role | What it does | Where its model comes from |
|---|---|---|
| prober / teacher | The conversation (probe questions, planning, teaching) | **The session's model** — pick it with the harness's per-session model selector; nothing here overrides your choice |
| practice agent | Practice problem posing, hints, verdicts | The session's model (same rule) |
| researcher | Web research briefs (via the harness's web_search / web_fetch) | *researcher override* → else the **cheap** slot |
| demo builder | Interactive single-file HTML teaching instruments | *demoBuilder override* → else the cheap slot |
| visual maker | Precise SVG figures | *visualMaker override* → else the **vision** slot |
| pdf reader | Cited briefs over learner PDFs | *pdfReader override* → else the vision slot |
| extractor | Propositions + reasoning chains from your teaching (background) | *extractor override* → else the cheap slot |
| auditor | Identity verdicts merging new findings into the graph (background) | *auditor override* → else the cheap slot |

Unset pins degrade honestly: the Learning panel says what's missing, and
the feature that needs the role refuses with a clear message instead of
guessing.

The strong/cheap/vision slots exist so one settings edit can retune a
whole tier; per-role overrides win when set. Provider credentials, model
catalogs, streaming, retries, and cost metering all belong to the
harness (the Models page) — this plugin only names *which* model each
role uses.

## Development

```bash
npm install        # once (the harness peers symlink from the dsh install)
npm run build      # tsc (server) + esbuild (client bundle)
npm test           # deterministic suite: no network, no LLM, no filesystem writes outside temp dirs
npm run typecheck  # all three tsconfigs
```

Test layout mirrors the original's strata: pure core units (merger,
derivation, coverage, grading, plan parsing, phases, layout), pipeline
flows with scripted fake LLMs, and golden fixtures pinning the real
on-disk format (regenerate with `npx tsx scripts/regen-golden.ts`;
update fixtures in the same commit as any format change).

## License

[AGPL-3.0-only](LICENSE) — see [NOTICE](NOTICE) for the attribution to
amosblomqvist/learnharness and dependency license notes.
