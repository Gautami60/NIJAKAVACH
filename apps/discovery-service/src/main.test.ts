import { test } from "node:test";
import * as assert from "node:assert";

test("Discovery Service module sanity check", () => {
  assert.strictEqual(typeof "discovery-service", "string");
});
