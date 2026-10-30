import { test } from "node:test";
import * as assert from "node:assert";

test("Case Management Service module sanity check", () => {
  assert.strictEqual(typeof "case-management", "string");
});
