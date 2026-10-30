import { test } from "node:test";
import * as assert from "node:assert";

test("Source Registry Service module sanity check", () => {
  assert.strictEqual(typeof "source-registry", "string");
});
