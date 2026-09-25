import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTool, runPipe, formatExternal } from "../lib/runtime.mjs";
import { hackerTools } from "../lib/tools.mjs";
import { TUI } from "../lib/tui.mjs";
import { log } from "../lib/logger.mjs";

const CWD = dirname(dirname(fileURLToPath(import.meta.url)));

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
    const out = execSync("node phantom.mjs --tool --json shell 'echo json_test_cli' 2>&1", { cwd: CWD, encoding: "utf-8", timeout: 10000 });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.tool, "shell");
    assert.match(parsed.data, /json_test_cli/);
  });

  it("--tool --json with bad tool exits 1 with error", async () => {
    const { execSync } = await import("child_process");
    try {
      execSync("node phantom.mjs --tool --json bad_tool_xyz '' 2>&1", { cwd: CWD, encoding: "utf-8", timeout: 10000 });
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

describe("hackerone tool", () => {
  it("returns help for no args", async () => {
    const r = await hackerTools.hackerone("");
    assert.match(r, /HackerOne Tool/);
    assert.match(r, /programs/);
    assert.match(r, /scope/);
    assert.match(r, /reports/);
    assert.match(r, /report/);
    assert.match(r, /submit/);
    assert.match(r, /me/);
    assert.match(r, /test/);
  });

  it("returns help for 'help' command", async () => {
    const r = await hackerTools.hackerone("help");
    assert.match(r, /HackerOne Tool/);
  });

  it("returns help for 'list' command", async () => {
    const r = await hackerTools.hackerone("list");
    assert.match(r, /HackerOne Tool/);
  });

  it("handles 'programs' command (credentials may or may not work)", async () => {
    const r = await hackerTools.hackerone("programs");
    // Just verify it returns a string response (not an exception)
    assert.ok(typeof r === "string" && r.length > 0);
  });

  it("handles 'scope' command (credentials may or may not work)", async () => {
    const r = await hackerTools.hackerone("scope acme-corp");
    assert.ok(typeof r === "string" && r.length > 0);
  });

  it("handles 'reports' command (credentials may or may not work)", async () => {
    const r = await hackerTools.hackerone("reports acme-corp");
    assert.ok(typeof r === "string" && r.length > 0);
  });

  it("handles 'report' command (credentials may or may not work)", async () => {
    const r = await hackerTools.hackerone("report 1234567");
    assert.ok(typeof r === "string" && r.length > 0);
  });

  it("handles 'submit' command (credentials may or may not work)", async () => {
    const r = await hackerTools.hackerone('submit acme-corp "XSS" high "details"');
    assert.ok(typeof r === "string" && r.length > 0);
  });

  it("handles 'me' command (credentials may or may not work)", async () => {
    const r = await hackerTools.hackerone("me");
    assert.ok(typeof r === "string" && r.length > 0);
  });

  it("handles 'test' command (credentials may or may not work)", async () => {
    const r = await hackerTools.hackerone("test");
    assert.ok(typeof r === "string" && r.length > 0);
  });

  it("returns unknown command error for invalid command", async () => {
    const r = await hackerTools.hackerone("invalid_command");
    assert.match(r, /Unknown command/);
  });
});

class FakeTerminal {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.listeners = new Map();
    this.pending = "";
    this.raw = "";
    this.reset();
  }

  reset() {
    this.cells = Array.from({ length: this.rows }, () => Array(this.cols).fill(" "));
    this.row = 1;
    this.col = 1;
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
  }

  removeListener(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  resize(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.reset();
    for (const handler of this.listeners.get("resize") || []) handler();
  }

  write(value) {
    const text = String(value);
    this.raw += text;
    this.pending += text;
    while (this.pending) {
      if (this.pending.startsWith("\x1b[")) {
        const match = this.pending.match(/^\x1b\[([0-9;?]*)([A-Za-z])/);
        if (!match) break;
        this.pending = this.pending.slice(match[0].length);
        const params = match[1] || "0";
        const command = match[2];
        if (command === "H") {
          const [row = 1, col = 1] = params.split(";").map(Number);
          this.row = row;
          this.col = col;
        } else if (command === "J" && params === "2") {
          this.reset();
        } else if (command === "K" && params === "2") {
          this.cells[this.row - 1].fill(" ");
        }
        continue;
      }
      const char = this.pending[0];
      this.pending = this.pending.slice(1);
      if (char === "\r") {
        this.col = 1;
      } else if (char === "\n") {
        this.row = Math.min(this.rows, this.row + 1);
      } else if (char >= " ") {
        this.cells[this.row - 1][this.col - 1] = char;
        this.col++;
        if (this.col > this.cols) {
          this.col = 1;
          this.row = Math.min(this.rows, this.row + 1);
        }
      }
    }
    return true;
  }

  lines() {
    return this.cells.map(row => row.join("").trimEnd());
  }
}

const flushFrame = () => new Promise(resolve => setImmediate(resolve));
const plain = value => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

describe("TUI output isolation", () => {
  it("keeps overflowing conversation output out of the input area", async () => {
    const output = new FakeTerminal(10, 24);
    const tui = new TUI({ stdout: output, rows: 10, cols: 24 });
    tui.enter();
    tui.setInput("draft", 5);
    for (let i = 0; i < 20; i++) tui.log(`message ${i}`);
    await flushFrame();

    const lines = output.lines();
    assert.match(lines.slice(2, 7).join("\n"), /message 19/);
    assert.doesNotMatch(lines.slice(7).join("\n"), /message \d+/);
    assert.match(lines[9], /draft/);
    tui.exit();
  });

  it("keeps multiline, wrapped, and status output in reserved rows", async () => {
    const output = new FakeTerminal(14, 16);
    const tui = new TUI({ stdout: output, rows: 14, cols: 16 });
    tui.enter();
    tui.setInput("typing while output arrives", 26);
    tui.log("first line\nsecond line\n0123456789abcdefghijklmnopqrstuvwxyz");
    tui.setStatus("working");
    await flushFrame();

    const lines = output.lines();
    assert.match(lines.slice(6, 11).join("\n"), /first line/);
    assert.match(lines.slice(6, 11).join("\n"), /second line/);
    assert.match(lines[11], /working/);
    assert.match(lines[13], /utput arrives$/);
    assert.ok(plain(lines[13]).length <= 16);
    tui.exit();
  });

  it("handles tiny terminals and wide glyphs without overwriting input", async () => {
    const output = new FakeTerminal(1, 1);
    const tui = new TUI({ stdout: output, rows: 1, cols: 1 });
    tui.enter();
    tui.setInput("", 0);
    tui.log("界");
    await flushFrame();
    assert.equal(output.lines().length, 1);

    output.resize(3, 6);
    tui.setInput("ok", 2);
    tui.log("wide");
    await flushFrame();
    assert.match(output.lines()[0], /wide/);
    assert.match(output.lines()[2], /ok/);
    tui.exit();
  });

  it("strips terminal controls while preserving color across wraps", async () => {
    const output = new FakeTerminal(8, 12);
    const tui = new TUI({ stdout: output, rows: 8, cols: 12 });
    tui.enter();
    tui.log("\x1b[2Jowned\x1b[10;1Hbad\x1b[31m123456789012345\x1b[0m");
    await flushFrame();

    const lines = output.lines();
    assert.match(lines.join("\n"), /ownedbad/);
    assert.doesNotMatch(output.raw, /owned\x1b\[10;1Hbad/);
    assert.ok((output.raw.match(/\x1b\[31m/g) || []).length >= 2);
    tui.exit();
  });

  it("masks credential input and clips the logo to narrow terminals", () => {
    const output = new FakeTerminal(8, 8);
    const tui = new TUI({ stdout: output, rows: 8, cols: 8 });
    tui.enter();
    tui.setInput("secret", 6, { masked: true });
    assert.match(tui._inputView().visible, /^•+$/);
    assert.ok(tui._inputView().visible.length <= 5);
    assert.ok(tui._frame().rows.every(row => plain(row).length <= 8));
    tui.exit();
  });

  it("redraws safely after a resize", async () => {
    const output = new FakeTerminal(10, 24);
    const tui = new TUI({ stdout: output, rows: 10, cols: 24 });
    tui.enter();
    tui.setInput("resize me", 9);
    output.resize(12, 30);
    tui.log("after resize");
    await flushFrame();

    const lines = output.lines();
    assert.match(lines.join("\n"), /after resize/);
    assert.match(lines[11], /resize me/);
    assert.doesNotMatch(lines.slice(-2).join("\n"), /after resize/);
    tui.exit();
  });
});

describe("logger routing", () => {
  it("resolves console methods when called", () => {
    const original = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    try {
      log.info("late-bound output");
    } finally {
      console.log = original;
    }
    assert.deepEqual(output, ["late-bound output"]);
  });
});
