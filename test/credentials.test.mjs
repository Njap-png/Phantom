// Phantom — on-demand credential helper tests
// Verifies env/vault loading and that prompting is disabled in non-interactive runs.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { isInteractive, load, has, ensure, ensureAll } from "../lib/credentials.mjs";

const KEY = "PHANTOM_CRED_TEST_KEY";

describe("credentials helper", () => {
  before(() => { delete process.env[KEY]; });
  after(() => { delete process.env[KEY]; });

  it("isInteractive is false under the test runner", () => {
    assert.equal(isInteractive(), false);
  });

  it("load() reads from the environment", () => {
    process.env[KEY] = "env-value";
    assert.equal(load(KEY), "env-value");
    assert.equal(has(KEY), true);
    delete process.env[KEY];
  });

  it("load() returns null for an unset key", () => {
    assert.equal(load(KEY), null);
    assert.equal(has(KEY), false);
  });

  it("ensure() does not prompt when non-interactive and returns null", async () => {
    assert.equal(await ensure(KEY), null);
  });

  it("ensure() returns an existing value without prompting", async () => {
    process.env[KEY] = "already-set";
    assert.equal(await ensure(KEY), "already-set");
    delete process.env[KEY];
  });

  it("ensureAll() reports missing keys in non-interactive mode", async () => {
    const res = await ensureAll([KEY, "PHANTOM_CRED_TEST_KEY_2"]);
    assert.equal(res.ok, false);
    assert.deepEqual(res.missing, [KEY, "PHANTOM_CRED_TEST_KEY_2"]);
  });
});
