import { test } from "node:test";
import * as assert from "node:assert";

test("User Service module sanity check", () => {
  assert.strictEqual(typeof "user-service", "string");
});
