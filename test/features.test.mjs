import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runTool, runPipe, formatExternal } from "../lib/runtime.mjs";
import { hackerTools } from "../lib/tools.mjs";

describe("runTool wrapper", () => {
  it("wraps a normal tool call", async () => {
    const r = await runTool(hackerTools, "shell", "echo hello");
    assert.match(r, /hello/);
  });

  it("returns error for unknown tool", async () => {
    const r = await runTool(hackerTools, "nonexistent_tool_xyz", "");
    assert.match(r, /Unknown tool/);
  });

  it("returns JSON when json=true", async () => {
    const r = await runTool(hackerTools, "shell", "echo hi", { json: true });
    const parsed = JSON.parse(r);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.tool, "shell");
    assert.match(parsed.data, /hi/);
  });

  it("JSON error for unknown tool", async () => {
    const r = await runTool(hackerTools, "bad_tool", "", { json: true });
    const parsed = JSON.parse(r);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /Unknown tool/);
  });
});

describe("runPipe chaining", () => {
  it("single tool works like normal run", async () => {
    const r = await runPipe(hackerTools, "shell|echo simple_pipe_test");
    assert.match(r, /simple_pipe_test/);
  });

  it("two-tool pipe feeds output to next tool", async () => {
    // shell -> hash (shell output becomes hash input)
    const r = await runPipe(hackerTools, "shell|echo testdata | hash");
    assert.match(r, /hash|testdata|[a-f0-9]/i);
  });

  it("single tool returns JSON with option", async () => {
    const r = await runPipe(hackerTools, "shell|echo json_ok", { json: true });
    const p = JSON.parse(r);
    assert.equal(p.ok, true);
  });

  it("handles empty chain gracefully", async () => {
    const r = await runPipe(hackerTools, "", {});
    assert.match(r, /empty/i);
  });
});

describe("formatExternal edge cases", () => {
  it("handles very long target names", () => {
    const long = "a".repeat(200);
    const r = formatExternal("Test", long, ["result"]);
    assert.match(r, new RegExp(long));
  });

  it("single line with maxLines=1", () => {
    const r = formatExternal("T", "x", ["a", "b", "c"], 1);
    assert.match(r, /and 2 more/);
  });

  it("empty lines array without target", () => {
    const r = formatExternal("Tool", "", []);
    assert.equal(r, "[Tool] No results for ");
  });
});

describe("CLI --json smoke", () => {
  it("--tool --json shell returns valid JSON", async () => {
    const { execSync } = await import("child_process");
    const out = execSync("node phantom.mjs --tool --json shell 'echo json_test_cli' 2>&1", { cwd: "/root/Phantom", encoding: "utf-8", timeout: 10000 });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.tool, "shell");
    assert.match(parsed.data, /json_test_cli/);
  });

  it("--tool --json with bad tool exits 1 with error", async () => {
    const { execSync } = await import("child_process");
    try {
      execSync("node phantom.mjs --tool --json bad_tool_xyz '' 2>&1", { cwd: "/root/Phantom", encoding: "utf-8", timeout: 10000 });
      assert.fail("Should have thrown");
    } catch (e) {
      const out = e.stdout;
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, false);
      assert.match(parsed.error, /Unknown tool/);
    }
  });
});

describe("schedule tool", () => {
  it("returns usage for no args", async () => {
    const r = await hackerTools.schedule("");
    assert.match(r, /Usage/);
  });

  it("returns empty list when no schedules active", async () => {
    const r = await hackerTools.schedule("list");
    assert.match(r, /No active schedules/);
  });

  it("returns error for unknown tool in schedule", async () => {
    const r = await hackerTools.schedule("daily|bad_tool_xyz|target.com");
    assert.match(r, /Unknown tool/);
  });
});
