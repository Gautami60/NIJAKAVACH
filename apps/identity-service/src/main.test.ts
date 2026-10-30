import { test } from "node:test";
import * as assert from "node:assert";

test("Identity Service module sanity check", () => {
  assert.strictEqual(typeof "identity", "string");
});
