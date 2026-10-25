# deep-learning data: a field reference

The files are the user's record, not an import format to rewrite. Work read-only.
The bundled readers make common views convenient; they are not required for custom
analysis. This reference describes the v1 formats.

## File map

Paths below are relative to the selected **data** directory (default
`~/.dsh/deep-learning`):

```text
graph/nodes.jsonl          Proposition assertions; IDs can repeat (link-appends)
graph/chains.jsonl          Reasoning-chain assertions; same (premises, conclusion) can repeat
graph/sessions.jsonl        Notes-import checkpoints, NOT the session index
graph/coverage.jsonl        Per-message extraction fingerprints, NOT learner assessment
graph/sources.json          Imported-note source metadata, keyed by source ID
graph/positions.json        Canvas layout, not semantic relationships
sessions/<session-id>/probe.json   The concluded probe assessment (strands + summary)
sessions/<session-id>/tree.json     The session's plan tree (nodes, edges, version)
settings.json               The plugin settings delta (model pins, overrides)
prompts/                    Per-segment prompt override files (when switches are on)
```

`settings.json` and `prompts/` are user preferences, not learning evidence.
Session **transcripts** are owned by the DeepSeek Harness session log under the
harness home (`sessions/` at the harness root), not this folder; the harness's
session API is the correct reader for them.

## The graph ledgers

`nodes.jsonl` — one line per node write. The FIRST line for an id defines
`name`/`statement`/`createdAt`; a later line with the same id is a link-append
(its statement and aliases join the node's aliases; provenance unions at read
time). Readers merge by id.

| Field | Meaning |
| --- | --- |
| `id` | `"n_" + hex` — stable, store-assigned |
| `name` | A short label (glossary headword); presentational only, may repeat |
| `statement` | The proposition at full precision — the identity anchor |
| `aliases` | Verbatim phrasings sessions used for the same idea |
| `createdAt` | ISO timestamp of the first write |
| `provenance` | `[{chatId, messageId}]` — where the idea came up; notes imports carry `"src_…"` ids with empty messageIds |

`chains.jsonl` — one line per chain ASSERTION. A chain is premises that JOINTLY
entail a conclusion; independent arguments for one conclusion are separate lines
that may share a conclusion. Readers merge by (sorted premises, conclusion).

| Field | Meaning |
| --- | --- |
| `id` | `"arg_" + hex` — also the derived implication node's id on the canvas |
| `premises` | Node ids used together (>= 1) |
| `conclusion` | The node id the premises jointly imply |
| `provenance` | The asserting session's points (chat-level) |
| `createdAt` | ISO timestamp of the first assertion |

Edges are NEVER stored: the canvas view (implication nodes + arrows) is derived
from chains on every read. Deleting a proposition cascades to every chain that
references it; deleting an `arg_` id removes exactly that one argument.

## The plugin's session records

`sessions/<id>/probe.json` — the probe assessment the prober filed:

| Field | Meaning |
| --- | --- |
| `strands` | `[{strand, assessment}]` — each dependency strand and the learner's edge on it |
| `summary` | Optional overall synthesis |

`sessions/<id>/tree.json` — the session's plan tree (structure only):

| Field | Meaning |
| --- | --- |
| `nodes` | `[{id, title, summary?}]` — ids are permanent slugs (quiz `nodeId` references these) |
| `edges` | `[{from, to}]` — `from` must be understood before `to` |
| `version` | Increments on every plan_init rewrite |

Progress is never stored: the session's current/visited nodes derive from tagged
question calls in the transcript. The plan is scaffolding, not mastery.

## Question evidence

Learner answers live in the **session transcript** (the harness session log's
tool-call and tool-result events), not this folder. When reading them there:

- Question tool calls: `probe`/`quiz` (multiple choice) or `recall`/`explain`
  (free recall), each carrying the question, options (MC), the committed correct
  answer, and — for teach-phase questions — `type` (`predict`/`check`) and
  `nodeId` (the plan node it assesses).
- The tool RESULT carries the learner's answer: selected options (1-based display
  order), free text, `dontKnow`, `confidence` (0-100 self-reported), and the
  `thinking` / `readingThinking` channels.
- A call with no result message was pending or interrupted; never invent an answer.
- `ask_user_question` calls (the harness's own tool) carry preference answers, not
  graded quiz verdicts.

Learner confidence is self-reported; 50 is a genuine coin flip; absent is not
zero. The `thinking` fields are the highest-signal data in the record.

## Extraction bookkeeping

`coverage.jsonl` — one line per extracted message: `{chatId, fp, tokens,
foldedAt}`. `fp` is a sha256 of the message's teacher-prose view; a message
re-opens itself when (and only when) its teacher prose changes. `sessions.jsonl`
carries whole-file checkpoints for notes imports. `sources.json` maps `src_`
ids to file paths. None of these are learner assessments.
