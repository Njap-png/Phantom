// Phantom — On-demand credential prompting
// Loads secrets from env or the vault; if a task needs one and it is missing,
// asks for it interactively (TTY only) and saves it to the secret vault.
// Zero-dependency (Node builtins only).

import readline from "readline";
import { get as vaultGet, set as vaultSet } from "./vault.mjs";

const LABELS = {
  OPENROUTER_API_KEY: "OpenRouter API key",
  OPENAI_API_KEY: "OpenAI API key",
  ANTHROPIC_API_KEY: "Anthropic API key",
  GEMINI_API_KEY: "Google Gemini API key",
  GROQ_API_KEY: "Groq API key",
  DEEPSEEK_API_KEY: "DeepSeek API key",
  MISTRAL_API_KEY: "Mistral API key",
  OPENCODE_ZEN_API_KEY: "OpenCode Zen API key",
  HACKERONE_API_USERNAME: "HackerOne username (API token identifier)",
  HACKERONE_API_TOKEN: "HackerOne API token",
  BUGCROWD_API_TOKEN: "Bugcrowd API token",
  BUGCROWD_API_USERNAME: "Bugcrowd username",
  GITHUB_TOKEN: "GitHub token",
  GIT_TOKEN: "Git token",
};

export function isInteractive() {
  return !!process.stdin.isTTY && !process.env.CI;
}

export function load(envVar) {
  if (process.env[envVar]) return process.env[envVar];
  const v = vaultGet(envVar);
  if (v) {
    process.env[envVar] = v;
    return v;
  }
  return null;
}

export function has(envVar) {
  return !!load(envVar);
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Ensure a credential is available. Returns the value or null.
// Prompts (and persists to the vault) only when interactive.
export async function ensure(envVar, opts = {}) {
  const existing = load(envVar);
  if (existing) return existing;
  if (opts.interactive === false || !isInteractive()) return null;
  const label = opts.label || LABELS[envVar] || envVar;
  const hint = opts.hint ? ` ${opts.hint}` : "";
  const answer = await ask(`🔑 ${label}${hint}: `);
  const value = (answer || "").trim();
  if (!value) return null;
  process.env[envVar] = value;
  let saved = false;
  try { saved = vaultSet(envVar, value); } catch {}
  if (opts.quiet !== true) {
    console.log(saved
      ? `✓ ${label} saved to the secret vault — Phantom will reuse it automatically (no need to enter it again).`
      : `✓ ${label} set for this session (could not write to the vault).`);
  }
  return value;
}

// Ensure several credentials. Returns { ok, missing }.
export async function ensureAll(envVars, opts = {}) {
  const missing = [];
  for (const envVar of envVars) {
    const v = await ensure(envVar, { ...opts, label: opts.labels?.[envVar] });
    if (!v) missing.push(envVar);
  }
  return { ok: missing.length === 0, missing };
}
