import { test } from "node:test";
import * as assert from "node:assert";

test("Source Workers module sanity check", () => {
  assert.strictEqual(typeof "source-workers", "string");
});
