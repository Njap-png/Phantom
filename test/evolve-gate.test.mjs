// Phantom — evolution gate, self-healing and push-auth tests
// Verifies: the project root is derived from the module (not ~/Phantom), the
// gate reports *why* it failed, code-level healing keeps a patch only when the
// suite improves, and pushes never hang on an interactive credential prompt.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { PHANTOM_DIR } from "../lib/config.mjs";
import {
  sourceFiles, checkSyntax, runTests, verifyEvolution, gitPush, gitRoot,
} from "../lib/evolve.mjs";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

// ── Project root ───────────────────────────────────────────

describe("project root resolution", () => {
  it("PHANTOM_DIR is derived from the module, not homedir", () => {
    assert.equal(PHANTOM_DIR, REPO, "PHANTOM_DIR must equal the repo root");
  });

  it("PHANTOM_DIR is not hardcoded to ~/Phantom", () => {
    assert.notEqual(basename(PHANTOM_DIR).toLowerCase(), "phantom-and-nothing-else");
    assert.ok(fs.existsSync(resolve(PHANTOM_DIR, "phantom.mjs")),
      "PHANTOM_DIR must actually contain phantom.mjs");
  });

  it("no source file hardcodes homedir()+Phantom", () => {
    const offenders = [];
    for (const rel of sourceFiles()) {
      const body = fs.readFileSync(resolve(PHANTOM_DIR, rel), "utf-8");
      if (/homedir\(\)\s*,\s*["']Phantom["']/.test(body)) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `hardcoded project root in: ${offenders.join(", ")}`);
  });

  it("every gate file exists on disk", () => {
    for (const f of ["phantom.mjs", "lib/evolve.mjs", "lib/tools.mjs", "lib/runtime.mjs", "lib/visual.mjs"]) {
      assert.ok(fs.existsSync(resolve(PHANTOM_DIR, f)), `missing ${f}`);
    }
  });
});

// ── Syntax gate ────────────────────────────────────────────

describe("checkSyntax", () => {
  it("passes on the real source tree", () => {
    const r = checkSyntax();
    assert.equal(r.missing.length, 0, `missing: ${r.missing.join(", ")}`);
    assert.equal(r.failed.length, 0, `syntax errors: ${JSON.stringify(r.failed)}`);
    assert.equal(r.ok, true);
  });

  it("reports a missing file by name instead of failing silently", () => {
    const r = checkSyntax(["lib/definitely-not-here.mjs"]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["lib/definitely-not-here.mjs"]);
  });

  it("reports the offending file for a real syntax error", () => {
    const tmp = resolve(PHANTOM_DIR, "lib", "__gate_probe.mjs");
    fs.writeFileSync(tmp, "export function broken( {\n", "utf-8");
    try {
      const r = checkSyntax(["lib/__gate_probe.mjs"]);
      assert.equal(r.ok, false);
      assert.equal(r.failed[0].file, "lib/__gate_probe.mjs");
      assert.ok(r.failed[0].error.length > 0, "must include the parser's reason");
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("sourceFiles lists phantom.mjs and the lib modules", () => {
    const files = sourceFiles();
    assert.ok(files.includes("phantom.mjs"));
    assert.ok(files.includes("lib/evolve.mjs"));
    assert.ok(!files.some(f => f.startsWith("test/")), "test files are not heal candidates");
  });
});

// ── Test runner ────────────────────────────────────────────

describe("runTests", () => {
  it("counts passes from a green suite", () => {
    const r = runTests("test/core.test.mjs", 60000);
    assert.equal(r.failed, 0);
    assert.ok(r.passed > 0, "expected some passing tests");
    assert.equal(r.ok, true);
    // Regression: an inherited NODE_TEST_CONTEXT made the child emit the
    // v8-serialized protocol instead of TAP, so the summary never parsed and a
    // green run reported 0 passes — which would let a broken patch look like
    // an improvement. This assertion only holds because runTests strips it.
    assert.equal(r.exact, true, "TAP summary should be parsed, not guessed");
  });

  it("counts a failure instead of reporting zero when the file does not exist", () => {
    const r = runTests("test/no-such-file.test.mjs", 20000);
    assert.equal(r.ok, false);
    assert.ok(r.failed >= 1, "a crashed run must not look like zero failures");
  });
});

// ── The gate ───────────────────────────────────────────────

describe("verifyEvolution", () => {
  it("passes on an unmodified tree", async () => {
    const v = await verifyEvolution();
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.phase, "tests");
    assert.match(v.reason, /passing/);
  });

  it("names the missing file when the gate cannot find its inputs", async () => {
    const v = await verifyEvolution({ files: ["lib/not-a-real-file.mjs"] });
    assert.equal(v.ok, false);
    assert.equal(v.phase, "syntax");
    assert.match(v.reason, /not-a-real-file\.mjs/);
  });

  it("does not silently pass when a gate file is unparseable", async () => {
    const probe = resolve(PHANTOM_DIR, "lib", "visual.mjs");
    const original = fs.readFileSync(probe, "utf-8");
    fs.writeFileSync(probe, "export const broken = {\n", "utf-8");
    try {
      const v = await verifyEvolution();
      assert.equal(v.ok, false);
      assert.equal(v.phase, "syntax");
      assert.match(v.reason, /visual\.mjs/);
    } finally {
      fs.writeFileSync(probe, original, "utf-8");
    }
  });
});

// ── Push auth ──────────────────────────────────────────────

describe("push authentication", () => {
  it("never blocks on an interactive credential prompt", () => {
    if (!gitRoot()) return; // not a git checkout — nothing to assert
    const t0 = Date.now();
    const r = gitPush();
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 20000, `gitPush took ${elapsed}ms — it may be waiting on stdin`);
    assert.equal(typeof r.pushed, "boolean");
    if (!r.pushed) assert.equal(typeof r.reason, "string");
  });

  it("explains itself when there is nothing to push or no token", () => {
    const r = gitPush();
    if (r.pushed === false) {
      assert.ok(r.reason && r.reason.length > 0, "a failed push must carry a reason");
      assert.ok(!/undefined/.test(r.reason), `unhelpful reason: ${r.reason}`);
    }
  });
});

// ── No leftover secrets or temp files ──────────────────────

describe("hygiene", () => {
  it("leaves no askpass helper behind in tmp", () => {
    let leftovers = [];
    try {
      leftovers = fs.readdirSync(tmpdir()).filter(f => f.startsWith("phantom-git-askpass-"));
    } catch { return; }
    assert.deepEqual(leftovers, [], `stale askpass helpers: ${leftovers.join(", ")}`);
  });

  it("evolve.mjs does not call .push on a plain object", () => {
    const body = fs.readFileSync(resolve(PHANTOM_DIR, "lib", "evolve.mjs"), "utf-8");
    // startupEvolve builds `results` as an object literal, so results.push(...)
    // is a TypeError that the surrounding catch{} used to swallow. Scope the
    // check to that one function so unrelated array pushes don't trip it.
    const start = body.indexOf("export async function startupEvolve");
    assert.ok(start > 0, "startupEvolve not found");
    const rest = body.slice(start + 1);
    const next = rest.search(/\n(?:export\s+)?(?:async\s+)?(?:function|const|class)\s/);
    const fn = next > 0 ? rest.slice(0, next) : rest;
    assert.ok(!/results\.push\(/.test(fn), "startupEvolve must not call .push on its results object");
    assert.ok(/notes:\s*\[\]/.test(fn), "startupEvolve results should carry a notes array");
  });
});
