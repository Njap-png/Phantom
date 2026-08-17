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

  it("env detects platform", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const { __r } = await import("../lib/runtime.mjs");
    const { populateEnv } = await import("../lib/env.mjs");
    if (!__r.ENV) { __r.ENV = {}; populateEnv(__r.ENV); }
    const r = await hackerTools.env("");
    assert.match(r, /Platform:/);
    assert.match(r, /Tools:/);
  });

  it("env availability cached in __r.ENV", async () => {
    const { __r } = await import("../lib/runtime.mjs");
    const { populateEnv } = await import("../lib/env.mjs");
    if (!__r.ENV) { __r.ENV = {}; populateEnv(__r.ENV); }
    assert.ok(__r.ENV.tools);
    assert.ok(typeof __r.ENV.availableTools === "number");
  });

  it("batch runs multiple tools sequentially", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.batch("env\nhash hello");
    assert.match(r, /✓ env/);
    assert.match(r, /✓ hash/);
  });

  it("batch handles unknown tool gracefully", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.batch("# comment\nnonexistent_tool_xyz");
    assert.match(r, /✗ nonexistent_tool_xyz/);
  });

  it("graph returns empty or linked data", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.graph("");
    assert.ok(r.includes("[graph]") || r.includes("links"));
  });

  it("browser_auto detects missing playwright", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.browser_auto("https://example.com");
    assert.match(r, /Playwright not installed/);
  });

  it("session save/load round-trips", async () => {
    const { saveSession, loadSession, clearSession } = await import("../lib/session.mjs");
    clearSession();
    const before = loadSession();
    assert.deepEqual(before, {});
    saveSession({ test: "roundtrip", stats: { toolsUsed: 99 } });
    const after = loadSession();
    assert.equal(after.test, "roundtrip");
    assert.equal(after.stats.toolsUsed, 99);
    clearSession();
  });

  it("knowledge graph link/query", async () => {
    const { linkTool, queryGraph, loadGraph, saveGraph } = await import("../lib/session.mjs");
    saveGraph({});
    linkTool("test_tool", { books: ["test_book"], cves: ["CVE-2025-TEST"], tags: ["test"] });
    const g = loadGraph();
    assert.ok(g.test_tool);
    assert.equal(g.test_tool.books[0], "test_book");
    const q = queryGraph("test_book");
    assert.ok(q.length > 0);
    assert.equal(q[0].tool, "test_tool");
    saveGraph({});
  });

  it("self_integrate handles missing file", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.self_integrate("/nonexistent/path.mjs");
    assert.match(r, /File not found/);
  });

  it("rollback save/status/restore round-trips", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const { execFileSync } = await import("child_process");
    const fs = await import("fs");
    const MARKER = ".hermes/rollback_head";
    // Clean marker
    if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER);
    // Save
    const saved = await hackerTools.rollback("save");
    assert.match(saved, /Saved HEAD:/);
    // Status should show same
    const status1 = await hackerTools.rollback("status");
    assert.match(status1, /same/);
    // Restore (should be no-op at same commit)
    const restore1 = await hackerTools.rollback("restore");
    assert.match(restore1, /nothing to revert/);
    // Clean up
    if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER);
  });
});
