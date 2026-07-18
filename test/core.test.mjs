import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runExternal, formatExternal } from "../lib/runtime.mjs";

// ── Runtime helpers ──────────────────────────────────────

describe("formatExternal", () => {
  it("returns no-results message for empty lines", () => {
    const r = formatExternal("Test", "example.com", [], 50);
    assert.equal(r, "[Test] No results for example.com");
  });

  it("formats results with header and count", () => {
    const r = formatExternal("Nmap", "scanme.org", ["22/tcp open ssh", "80/tcp open http"], 50);
    assert.match(r, /🔎 Nmap: scanme.org/);
    assert.match(r, /Results: 2/);
    assert.match(r, /22\/tcp open ssh/);
    assert.match(r, /80\/tcp open http/);
  });

  it("truncates beyond maxLines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `result ${i + 1}`);
    const r = formatExternal("Test", "x.com", lines, 10);
    assert.match(r, /Results: 100/);
    assert.match(r, /and 90 more/);
  });
});

describe("runExternal", () => {
  it("throws NOT INSTALLED for missing binary", () => {
    assert.throws(
      () => runExternal("nonexistent-tool-xyz", ["--help"]),
      /NOT INSTALLED/
    );
  });

  it("runs a real binary (ls)", () => {
    const r = runExternal("ls", ["-1"], { timeout: 3000 });
    assert.ok(r.length > 0);
  });

  it("passes stdin input to grep", () => {
    const r = runExternal("grep", ["hello"], { input: "hello world\ngoodbye\nhello again\ntest", timeout: 3000 });
    assert.equal(r.length, 2);
    assert.ok(r.every(l => l.includes("hello")));
  });
});

// ── Tool behavior ────────────────────────────────────────

describe("hackerTools", () => {
  it("loads with 100+ tools", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    assert.ok(hackerTools);
    assert.ok(Object.keys(hackerTools).length > 100);
  });

  it("has key external tools as functions", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    for (const t of ["katana", "subfinder", "nmap", "whatweb", "gitleaks", "interactsh", "ffuf", "gobuster", "hydra"]) {
      assert.equal(typeof hackerTools[t], "function", `${t} should be a function`);
    }
  });

  it("returns usage help when called with no input", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const helps = await Promise.all([
      hackerTools.nmap(""),
      hackerTools.katana(""),
      hackerTools.whatweb(""),
      hackerTools.subfinder(""),
      hackerTools.gobuster(""),
    ]);
    for (const h of helps) {
      assert.match(h, /Usage:/, `Should show — ${h.slice(0, 80)}`);
    }
  });

  it("scope returns scope state (not Usage) for empty input", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.scope("");
    // scope used without args shows current scope state, not usage
    assert.ok(r.includes("Scope") || r.includes("scope"));
  });

  it("install returns tool list for empty input", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.install("");
    assert.match(r, /\[install\] Usage/);
    assert.match(r, /nmap|sqlmap|gobuster/);
  });

  it("decode/base64 works", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.decode("aGVsbG8gd29ybGQ=");
    assert.match(r, /base64/);
    assert.match(r, /hello world/);
  });

  it("shell runs a simple command", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.shell("echo 'test_ok'");
    assert.match(r, /test_ok/);
  });

  it("web_fetch returns content or error", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.web_fetch("https://example.com");
    assert.ok(r.includes("Example Domain") || r.includes("Error") || r.includes("refused"));
  });

  it("hash produces output", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.hash("hello");
    assert.ok(r.length > 10);
  });
});

describe("CLI smoke", () => {
  it("--list runs without error", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("node phantom.mjs --list 2>&1", { cwd: "/root/Phantom", encoding: "utf-8", timeout: 10000 });
    assert.ok(out.length > 100);
  });

  it("--help shows PHANTOM banner", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("node phantom.mjs --help 2>&1", { cwd: "/root/Phantom", encoding: "utf-8", timeout: 10000 });
    assert.match(out, /PHANTOM/i);
  });

  it("--tool whois example.com returns data quickly", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("node phantom.mjs --tool whois example.com 2>&1", { cwd: "/root/Phantom", encoding: "utf-8", timeout: 15000 });
    assert.ok(out.includes("whois") || out.includes("Error") || out.includes("example"), `Got: ${out.slice(0, 100)}`);
  });
});
