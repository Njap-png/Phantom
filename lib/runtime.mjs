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
