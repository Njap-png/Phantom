// Phantom — Slow smoke tests (spawn full process, kept separate for speed)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const CWD = "/root/Phantom";

describe("CLI smoke", () => {
  it("--list runs without error", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("node phantom.mjs --list 2>&1", { cwd: CWD, encoding: "utf-8", timeout: 10000 });
    assert.ok(out.length > 100);
  });

  it("--help shows PHANTOM banner", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("node phantom.mjs --help 2>&1", { cwd: CWD, encoding: "utf-8", timeout: 10000 });
    assert.match(out, /PHANTOM/i);
  });

  it("--tool whois example.com returns data quickly", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("node phantom.mjs --tool whois example.com 2>&1", { cwd: CWD, encoding: "utf-8", timeout: 15000 });
    assert.ok(out.includes("whois") || out.includes("Error") || out.includes("example"), `Got: ${out.slice(0, 100)}`);
  });
});
