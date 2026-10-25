// The red step for scaffold verification: the plugin's entry point must
// exist, export a Cordis plugin surface (name + apply), and declare the
// services it injects. This test fails until the server entry exists.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as plugin from "../index.js";

test("plugin exports a cordis plugin surface", () => {
	assert.equal(typeof plugin.name, "string");
	assert.ok((plugin.name as string).length > 0);
	assert.equal(typeof plugin.apply, "function");
});
