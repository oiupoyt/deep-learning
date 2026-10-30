import { test } from "node:test";
import * as assert from "node:assert/strict";
import { artifactCompletionText } from "../server/artifact-notice.js";

test("artifact completion points to persisted diagram without putting markup in chat", () => {
  assert.equal(artifactCompletionText({ persisted: true, artifactId: "a1", kind: "demo", title: "Orbit model", content: "<script>bad()</script>" }), "Interactive demo \"Orbit model\" is saved in Learning > Diagrams.");
  assert.equal(artifactCompletionText({ kind: "visual", title: "Unstored" }), null);
  assert.equal(artifactCompletionText("brief text"), null);
});
