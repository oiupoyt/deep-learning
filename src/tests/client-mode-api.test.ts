import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseLearningModeStateResponse } from "../client/mode-api.js";

test("client mode parser accepts only the projection schema", () => {
  assert.deepEqual(parseLearningModeStateResponse({ enabled: true, phase: "teach", revision: 2 }), { enabled: true, phase: "teach", revision: 2 });
  assert.throws(() => parseLearningModeStateResponse({ enabled: true, phase: "invented", revision: 2 }));
  assert.throws(() => parseLearningModeStateResponse({ enabled: true, phase: "teach", revision: -1 }));
  assert.throws(() => parseLearningModeStateResponse({ enabled: true, phase: "teach", revision: 1.2 }));
});
