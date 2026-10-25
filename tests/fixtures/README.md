# Golden fixtures — the on-disk format law

The fixture law (ported from learnharness tests/fixtures/golden-data):
these directories pin the REAL on-disk format of the plugin's data. Any
intentional format change updates the fixtures in the same commit; any
accidental one fails `tests/golden-fixtures.test.ts`.

`golden-graph/` is a REAL data root produced by the production store
adapters and the merge pipeline (never hand-edited): it must parse
through `FsGraphStore`, derive a graph end-to-end through `getGraph` +
`deriveView` + `birthSessionPartition`, and settle a layout without
error.

Regenerate with:

    npx tsx scripts/regen-golden.ts
