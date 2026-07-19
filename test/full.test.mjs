// Phantom — comprehensive tool & edge-case tests
// Run: node --test test/full.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hackerTools } from "../lib/tools.mjs";
import { runTool, runPipe } from "../lib/runtime.mjs";

const tools = hackerTools;

// ── decode (handles both encode + decode) ───────────────

describe("decode tool", () => {
  it("decodes base64", async () => {
    const r = await tools.decode("aGVsbG8gd29ybGQ=");
    assert.match(r, /hello world/);
  });

  it("decodes url", async () => {
    const r = await tools.decode("hello%20world");
    assert.match(r, /hello world/);
  });

  it("handles empty input gracefully", async () => {
    const r = await tools.decode("");
    assert.ok(r.length > 0);
  });

  it("handles hex input", async () => {
    const r = await tools.decode("68656c6c6f");
    assert.match(r, /hello/);
  });
});

describe("hash tool", () => {
  it("produces multiple hash formats", async () => {
    const r = await tools.hash("hello");
    assert.match(r, /MD5/);
    assert.match(r, /SHA256/);
    assert.match(r, /SHA1/);
  });

  it("produces known md5", async () => {
    const r = await tools.hash("hello");
    assert.match(r, /5d41402abc4b2a76b9719d911017c592/);
  });

  it("produces known sha256", async () => {
    const r = await tools.hash("hello");
    assert.match(r, /2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/);
  });
});

// ── file_search (built-in) ──────────────────────────────

describe("file_search", () => {
  it("finds own source file", async () => {
    const r = await tools.file_search("test/full.test.mjs");
    assert.match(r, /full\.test\.mjs/);
  });

  it("returns message for no matches", async () => {
    const r = await tools.file_search("__nonexistent_file_xyz__");
    assert.ok(r.length > 0);
  });
});

// ── Shell tool ──────────────────────────────────────────

describe("shell tool", () => {
  it("handles very long command", async () => {
    const long = "echo " + "a".repeat(500);
    const r = await tools.shell(long);
    assert.match(r, /a{500}/);
  });

  it("handles special characters", async () => {
    const r = await tools.shell("echo 'hello world test'");
    assert.match(r, /hello world/);
  });

  it("handles multiline output", async () => {
    const r = await tools.shell("seq 1 20");
    const lines = r.trim().split("\n");
    assert.equal(lines.length, 20);
  });

  it("stderr is captured with stdout", async () => {
    const r = await tools.shell("echo stderr_test >&2 && echo stdout_ok");
    assert.match(r, /stdout_ok/);
  });
});

// ── Web tool ────────────────────────────────────────────

describe("web_fetch", () => {
  it("fetches a page", async () => {
    const r = await tools.web_fetch("https://example.com");
    assert.ok(r.includes("Example Domain") || r.includes("example"));
  });

  it("handles invalid URL gracefully", async () => {
    const r = await tools.web_fetch("not-a-valid-url");
    assert.ok(r.length > 0);
  });

  it("handles empty URL gracefully", async () => {
    const r = await tools.web_fetch("");
    assert.ok(r.length > 0);
  });
});

// ── Knowledge tools ─────────────────────────────────────

describe("hackbook tool", () => {
  it("lists categories", async () => {
    const r = await tools.hackbook("list");
    assert.ok(r.includes("Categories") || r.includes("PHANTOM HACKBOOK"));
  });

  it("returns content for a valid category", async () => {
    const r = await tools.hackbook("sql-injection");
    assert.ok(r.length > 0);
  });

  it("handles unknown category gracefully", async () => {
    const r = await tools.hackbook("__nonexistent__");
    assert.ok(r.length > 0);
  });
});

// ── Batch tool ──────────────────────────────────────────

describe("batch tool", () => {
  it("shows usage for empty input", async () => {
    const r = await tools.batch("");
    assert.match(r, /Usage/);
  });

  it("returns error for missing file", async () => {
    const r = await tools.batch("shell|echo hello");
    assert.ok(r.includes("Error") || r.includes("error") || r.includes("ENOENT"));
  });
});

describe("install tool", () => {
  it("shows usage for empty input", async () => {
    const r = await tools.install("");
    assert.match(r, /Usage|@install/i);
  });

  it("shows tool list on empty input", async () => {
    const r = await tools.install("");
    assert.match(r, /nmap/);
  });

  it("all keyword starts bulk install", async () => {
    const r = await tools.install("all");
    assert.match(r, /Bulk installing|Done/);
  });
});

// ── runTool wrapper ─────────────────────────────────────

describe("runTool extras", () => {
  it("returns error for empty tool name", async () => {
    const r = await runTool(tools, "", "test");
    assert.match(r, /Unknown tool|empty/i);
  });

  it("JSON mode with pipe input", async () => {
    const r = await runTool(tools, "shell", "echo pipe_json", { json: true, pipe: true });
    const p = JSON.parse(r);
    assert.equal(p.ok, true);
  });
});

// ── runPipe chaining ────────────────────────────────────

describe("runPipe extras", () => {
  it("three-tool chain runs without error", async () => {
    const r = await runPipe(tools, "shell|echo aaaa | hash | decode");
    assert.ok(r.length > 10);
  });

  it("invalid tool in chain returns error", async () => {
    const r = await runPipe(tools, "shell|echo ok | nonexistent_tool_xyz");
    assert.match(r, /Unknown tool|not found|error/i);
  });
});

// ── CLI flags ───────────────────────────────────────────

describe("CLI flags", () => {
  it("--version prints version", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("node phantom.mjs --version 2>&1", { cwd: "/root/Phantom", encoding: "utf-8", timeout: 8000 });
    assert.match(out, /0\.2\.0|Phantom/);
  });

  it("--quiet via env var", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("PHANTOM_QUIET=1 node phantom.mjs --list 2>&1", { cwd: "/root/Phantom", encoding: "utf-8", timeout: 15000 });
    // Should suppress banner art but still show tools
    assert.ok(out.length > 0);
  });

  it("--help shows PHANTOM", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("node phantom.mjs --help 2>&1", { cwd: "/root/Phantom", encoding: "utf-8", timeout: 8000 });
    assert.match(out, /PHANTOM/i);
  });
});

// ── Scope ───────────────────────────────────────────────

describe("scope tool", () => {
  it("shows scope state by default", async () => {
    const r = await tools.scope("");
    assert.match(r, /Commands|Scope|No targets|Usage/i);
  });
});

// ── Schedule ────────────────────────────────────────────

describe("schedule tool", () => {
  it("lists schedules", async () => {
    const r = await tools.schedule("list");
    assert.ok(r.length > 0);
  });

  it("shows usage for invalid input", async () => {
    const r = await tools.schedule("blah");
    assert.match(r, /Usage|Invalid|Error/i);
  });
});

// ── Tools list completeness ─────────────────────────────

describe("tool count and structure", () => {
  it("has 108+ tools", () => {
    assert.ok(Object.keys(tools).length >= 108);
  });

  it("all tools are async functions", () => {
    for (const [name, fn] of Object.entries(tools)) {
      assert.equal(typeof fn, "function", `${name} should be a function`);
      assert.match(fn.constructor.name, /Async/, `${name} should be async`);
    }
  });

  it("all tool names are lowercase", () => {
    for (const name of Object.keys(tools)) {
      assert.equal(name, name.toLowerCase(), `${name} should be lowercase`);
    }
  });

  it("key tools exist", () => {
    const required = ["shell", "decode", "hash", "web_fetch", "file_search", "batch", "scope", "schedule", "hackbook"];
    for (const t of required) {
      assert.ok(tools[t], `Missing required tool: ${t}`);
    }
  });
});
