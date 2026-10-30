import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseArtifactsResponse, parseSnapshot } from "../client/contracts.js";

const node = { id: "n1", name: "Premise", statement: "A statement", aliases: [], createdAt: "2026-10-30T00:00:00.000Z", provenance: [{ chatId: "s1", messageId: "m1" }] };
const snapshot = { nodes: [node], propositions: [node], edges: [{ from: "n1", to: "n2" }], chains: [{ id: "c1", premises: ["n1"], conclusion: "n2", provenance: [{ chatId: "s1", messageId: "m1" }], createdAt: "2026-10-30T00:00:00.000Z" }], sessions: { s1: "Lesson" }, fileSources: {} };

test("graph response parser validates nested records instead of casting arrays", () => {
  assert.deepEqual(parseSnapshot(snapshot), snapshot);
  assert.equal(parseSnapshot({ ...snapshot, nodes: [{ id: "n1" }] }), null);
  assert.equal(parseSnapshot({ ...snapshot, edges: [{ from: "n1" }] }), null);
  assert.equal(parseSnapshot({ ...snapshot, chains: [{ id: "c1", premises: [], conclusion: "n2", provenance: [null] }] }), null);
  assert.equal(parseSnapshot({ ...snapshot, sessions: { s1: 3 } }), null);
});

test("artifact response parser accepts bounded demo and SVG records only", () => {
  const saved = { id: "a1", sessionId: "s1", kind: "visual", title: "Figure", content: "<svg></svg>", notes: "Authored", createdAt: "2026-10-30T00:00:00.000Z" };
  assert.deepEqual(parseArtifactsResponse([saved]), [saved]);
  assert.equal(parseArtifactsResponse([{ ...saved, kind: "script" }]), null);
  assert.equal(parseArtifactsResponse([{ ...saved, content: "x".repeat(256_001) }]), null);
  assert.equal(parseArtifactsResponse([null]), null);
});
