// Phantom — shared runtime state
// Mutable exports set by phantom.mjs, read by lib modules.
// ESM live bindings ensure imports see the latest values.

import { execFileSync } from "child_process";

export const __r = {
  llmInstance: null,
  _config: {},
  setProvider: null,
  PROVIDERS: null,
  PHANTOM_LLM_PROVIDER: "openai",
  ENV: null,
};

// ── External tool helper ─────────────────────────────────
// DRY wrapper for all external-binary tools.
// Handles dynamic import caching, which-check, error formatting.
// Returns trimmed stdout lines array. Throws on error.
const _cp = /* lazily cached */ null;
function _ensureChildProcess() {
  // execFileSync is already statically imported; this is a no-op
  // but kept for symmetry with tools that imported dynamically
  return { execFileSync };
}

/**
 * Run an external binary and return its trimmed stdout lines.
 *
 * @param {string} tool   Binary name (e.g. "nmap", "subfinder")
 * @param {string[]} args CLI arguments
 * @param {object}  [opts]
 * @param {number}  [opts.timeout=60000]
 * @param {number}  [opts.maxBuffer=1024*1024]
 * @param {string}  [opts.input]         stdin content
 * @param {string}  [opts.installGuide]  shown if binary missing
 * @returns {string[]} non-empty stdout lines
 */
export function runExternal(tool, args, opts = {}) {
  const { execFileSync } = _ensureChildProcess();
  const timeout = opts.timeout ?? 60000;
  const maxBuffer = opts.maxBuffer ?? 1024 * 1024;
  const input = opts.input;
  const guide = opts.installGuide || `go install ...${tool}@latest`;

  // which check
  try { execFileSync("which", [tool], { encoding: "utf-8", timeout: 5000 }); }
  catch {
    throw new Error(`[${tool}] NOT INSTALLED — ${guide}`);
  }

  const execOpts = { encoding: "utf-8", timeout, maxBuffer };
  if (input !== undefined) execOpts.input = input;

  const out = execFileSync(tool, args, execOpts);
  return out.trim().split("\n").filter(Boolean);
}

/**
 * Format external tool output for display.
 * @param {string} toolName
 * @param {string} target
 * @param {string[]} lines
 * @param {number} [maxLines=50]
 * @returns {string} formatted output
 */
export function formatExternal(toolName, target, lines, maxLines = 50) {
  if (!lines.length) return `[${toolName}] No results for ${target}`;
  const result = [`🔎 ${toolName}: ${target}`, `Results: ${lines.length}`];
  result.push(...lines.slice(0, maxLines).map(l => `  ${l}`));
  if (lines.length > maxLines) result.push(`  ... and ${lines.length - maxLines} more`);
  return result.join("\n");
}

// ── Tool execution wrapper ───────────────────────────────
// Handles JSON output, tool chaining/piping, error wrapping.

/**
 * Run a tool from the hackerTools registry with optional flags.
 *
 * @param {object} tools   - hackerTools object
 * @param {string} toolName
 * @param {string} input
 * @param {object} [opts]
 * @param {boolean} [opts.json=false]  Return JSON string instead of formatted text
 * @returns {Promise<string>}  Formatted text or JSON string
 */
export async function runTool(tools, toolName, input, opts = {}) {
  const fn = tools[toolName];
  if (!fn) {
    const msg = `[${toolName}] Unknown tool. Use --list to see available tools.`;
    return opts.json ? JSON.stringify({ ok: false, error: msg, tool: toolName }) : msg;
  }
  // Built-in --help for any tool
  const trimmed = (input || "").trim().toLowerCase();
  if (trimmed === "--help" || trimmed === "-h") {
    const help = `[${toolName}] Usage: @${toolName}|<args>
  Run "${toolName}" with empty input for built-in usage.
  Available tools: ${Object.keys(tools).length}`;
    return opts.json ? JSON.stringify({ ok: true, tool: toolName, help: true, data: help }) : help;
  }
  // Show spinner for slow tools (non-CLI mode — REPL handles its own feedback)
  const timer = setTimeout(() => process.stdout.write(`[*] ${toolName} running...\r`), 2000);
  try {
    const result = await fn(input);
    clearTimeout(timer);
    if (opts.json) {
      return JSON.stringify({ ok: true, tool: toolName, input, data: result, length: result.length });
    }
    return result;
  } catch (e) {
    clearTimeout(timer);
    const msg = `[${toolName} Error] ${e.message}`;
    return opts.json ? JSON.stringify({ ok: false, error: e.message, tool: toolName, input }) : msg;
  }
}

/**
 * Parse and execute a piped tool chain.
 * Format: tool1|args | tool2 | tool3|more_args
 *
 * @param {object} tools  - hackerTools object
 * @param {string} chain  - e.g. "subfinder|example.com | httpx | nuclei|https://x.com"
 * @param {object} [opts]
 * @returns {Promise<string>}
 */
export async function runPipe(tools, chain, opts = {}) {
  // Chain separator = " | " (space-pipe-space)
  // Tool/args separator = "|" (no spaces needed)
  // This avoids conflict between "shell|echo hi" and "subfinder|x.com | httpx"
  const segments = chain.split(/\s+\|\s+/).filter(Boolean);
  if (segments.length === 0) return opts.json ? JSON.stringify({ ok: false, error: "Empty pipe chain" }) : "[pipe] Empty chain";
  if (segments.length === 1) {
    // Single tool, no piping
    const [toolName, ...args] = segments[0].split("|");
    const input = args.join("|").trim();
    return runTool(tools, toolName, input, opts);
  }

  // Multi-segment pipe: output of each tool becomes input of the next
  let pipeInput = "";
  let lastResult = "";

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].trim();
    const [toolName, ...args] = seg.split("|");
    let input = args.join("|").trim();

    // If there's piped input from previous tool, prepend it
    // Format: previous output lines become part of the argument
    if (pipeInput && input) {
      // Both piped input and explicit args — append piped data
      input = input + " " + pipeInput;
    } else if (pipeInput && !input) {
      input = pipeInput;
    }

    // Last segment gets the opts as-is; intermediate segments are not JSON
    const segOpts = (i === segments.length - 1) ? opts : {};
    const result = await runTool(tools, toolName, input, segOpts);

    if (i === segments.length - 1) {
      lastResult = result;
    } else {
      // Intermediate output: take the last line or the whole thing
      const lines = result.split("\n").filter(Boolean);
      // Try to find the most relevant data lines (skip header/count)
      const dataLines = lines.filter(l => !l.startsWith("🔎") && !l.startsWith("Results:") && !l.startsWith("[") && l.trim());
      pipeInput = dataLines.length > 0 ? dataLines.join("\n") : lines.slice(-10).join("\n");
    }
  }

  return lastResult;
}

/**
 * Run a scheduled scan: executes a tool on each scope target.
 * @param {object}  tools     - hackerTools object
 * @param {string}  toolName  - tool to run
 * @param {string}  [extra]   - extra options
 * @param {number}  [concurrency=1]
 * @returns {Promise<string>}
 */
export async function runScheduledScan(tools, toolName, extra = "", concurrency = 1) {
  // Load scope
  const scopeResult = await tools.scope("export");
  const targets = scopeResult.split("\n").filter(l => l.trim() && !l.includes("(empty") && !l.includes("Commands"));
  if (targets.length === 0) return "[schedule] No scope targets defined. Use scope add <target> first.";

  const fn = tools[toolName];
  if (!fn) return `[schedule] Unknown tool: ${toolName}`;

  const results = [];
  for (const target of targets) {
    try {
      const r = await fn(`${target} ${extra}`.trim());
      results.push(`=== ${target} ===\n${r}`);
    } catch (e) {
      results.push(`=== ${target} ===\n[${toolName} Error] ${e.message}`);
    }
  }
  return results.join("\n\n");
}
