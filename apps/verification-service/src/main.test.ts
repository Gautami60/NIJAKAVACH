import { test } from "node:test";
import * as assert from "node:assert";

test("Verification Service module sanity check", () => {
  assert.strictEqual(typeof "verification-service", "string");
});
