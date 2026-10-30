import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { artifactInputFromRoleResult, FsArtifactStore } from "../store/artifacts.js";

test("artifacts persist across store instances and filter by session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dl-artifacts-"));
  try {
    const store = new FsArtifactStore(root);
    const saved = store.save({ sessionId: "session-a", kind: "demo", title: "Chain rule", content: "<h1>Demo</h1>" });
    assert.equal(saved.kind, "demo");
    assert.equal(store.list("session-b").length, 0);
    const restored = new FsArtifactStore(root).list("session-a");
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.id, saved.id);
    assert.equal(restored[0]?.content, "<h1>Demo</h1>");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("artifact store rejects invalid kinds, empty content, and oversized payloads", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dl-artifacts-"));
  try {
    const store = new FsArtifactStore(root);
    assert.throws(() => store.save({ sessionId: "s", kind: "script" as never, title: "x", content: "x" }));
    assert.throws(() => store.save({ sessionId: "s", kind: "visual", title: "x", content: "" }));
    assert.throws(() => store.save({ sessionId: "s", kind: "demo", title: "x", content: "x".repeat(300_000) }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("role results map to persistable artifacts without accepting arbitrary payloads", () => {
  assert.deepEqual(artifactInputFromRoleResult("session-a", "demo", { title: "Demo", html: "<main>ok</main>", tested: false, notes: "authored" }), {
    sessionId: "session-a", kind: "demo", title: "Demo", content: "<main>ok</main>", notes: "authored",
  });
  assert.deepEqual(artifactInputFromRoleResult("session-a", "visual", { svg: "<svg></svg>", notes: "authored" }), {
    sessionId: "session-a", kind: "visual", title: "Visual figure", content: "<svg></svg>", notes: "authored",
  });
  assert.equal(artifactInputFromRoleResult("session-a", "research", { text: "not an artifact" }), null);
  assert.equal(artifactInputFromRoleResult("session-a", "visual", { svg: "" }), null);
});
