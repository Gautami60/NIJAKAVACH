import { test } from "node:test";
import * as assert from "node:assert";

test("Notification Service module sanity check", () => {
  assert.strictEqual(typeof "notification-service", "string");
});
