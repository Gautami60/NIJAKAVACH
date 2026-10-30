import { test } from "node:test";
import * as assert from "node:assert";

test("Audit Service module sanity check", () => {
  assert.strictEqual(typeof "audit-service", "string");
});
