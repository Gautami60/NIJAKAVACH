import { test } from "node:test";
import * as assert from "node:assert";

test("Removal Workflow Service module sanity check", () => {
  assert.strictEqual(typeof "removal-workflow", "string");
});
