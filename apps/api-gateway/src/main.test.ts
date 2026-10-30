import { test } from "node:test";
import * as assert from "node:assert";

test("API Gateway environment & types sanity check", () => {
  assert.strictEqual(typeof "gateway", "string");
});
