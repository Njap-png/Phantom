#!/usr/bin/env node
// Phantom — space evolving multi-agent terminal
// Zero dependencies. Run: node phantom.mjs

import fs from "fs";
import http from "http";
import { homedir, release } from "os";
import { resolve, join } from "path";
import { pathToFileURL } from "url";
import { createRequire } from "module";
const $r = createRequire(import.meta.url);

import { BASE_DIR, MEMORY_DIR, KNOWLEDGE_DIR, BOOKS_DIR, TOOLS_DIR, REPORTS_DIR, PLAYBOOKS_DIR, PHANTOM_VERSION } from "./lib/config.mjs";
import { __r, runTool, runPipe, runScheduledScan } from "./lib/runtime.mjs";
import { log } from "./lib/logger.mjs";
import { renderLogo, renderBanner, prompt, icons, createSpinner, chatBorder } from "./lib/visual.mjs";
import { hackerTools } from "./lib/tools.mjs";
import { initApiDeps, startApiServer, startGuiDashboard, setChatAgent } from "./lib/server.mjs";
import { autoEvolve, startupEvolve, getEvolveStatus, analyzeError, loadAutoTools } from "./lib/evolve.mjs";

// ── Merge auto-generated tools into hackerTools ──
// Runs once at module init so all agents & CLIs pick them up.
loadAutoTools().then(at => {
  const added = [];
  for (const [name, fn] of Object.entries(at)) {
    if (!hackerTools[name]) {
      hackerTools[name] = fn;
      added.push(name);
    }
  }
  if (added.length > 0) {
    console.debug(`[auto-tools] merged ${added.length} tool(s): ${added.join(", ")}`);
  }
}).catch(() => {});

// ── Merge self-improvement learned modules into hackerTools ──
// Generated during improvement cycles, copied to lib/learned/
const LEARNED_DIR = resolve(new URL(".", import.meta.url).pathname, "lib", "learned");
(async () => {
  try {
    if (!fs.existsSync(LEARNED_DIR)) return;
    const files = fs.readdirSync(LEARNED_DIR).filter(f => f.endsWith(".mjs"));
    if (files.length === 0) return;
    let count = 0;
    for (const file of files) {
      try {
        const name = file.replace(/\.mjs$/, "");
        if (hackerTools[name]) continue; // don't override existing
        const mod = await import(resolve(LEARNED_DIR, file) + `?t=${Date.now()}`);
        const fn = mod.default || mod.execute;
        if (typeof fn === "function") {
          hackerTools[name] = fn;
          count++;
        }
      } catch {}
    }
    if (count > 0) {
      console.debug(`[self-improve] loaded ${count} learned module(s)`);
    }
  } catch {}
})();

// ── Config ─────────────────────────────────────────────────
let _config = {};
try {
  const configPath = resolve(BASE_DIR, "config.json");
  if (fs.existsSync(configPath)) _config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch {}
__r._config = _config;
if (_config.VT_API_KEY && !process.env.VT_API_KEY) process.env.VT_API_KEY = _config.VT_API_KEY;
// Load all provider API keys from config
const PROVIDER_KEYS = ["OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY","GROQ_API_KEY","DEEPSEEK_API_KEY","MISTRAL_API_KEY","OPENROUTER_API_KEY","SHODAN_API_KEY","HIBP_API_KEY","OPENCODE_ZEN_API_KEY"];
for (const k of PROVIDER_KEYS) { if (_config[k] && !process.env[k]) process.env[k] = _config[k]; }
// Selected provider: env > config > "openai"
let PHANTOM_LLM_PROVIDER = process.env.PHANTOM_LLM_PROVIDER || _config.default_provider || "openai";
__r.PHANTOM_LLM_PROVIDER = PHANTOM_LLM_PROVIDER;
function setProvider(name) { PHANTOM_LLM_PROVIDER = name; process.env.PHANTOM_LLM_PROVIDER = name; _config.default_provider = name; __r.PHANTOM_LLM_PROVIDER = name; try { fs.writeFileSync(resolve(BASE_DIR, "config.json"), JSON.stringify(_config, null, 2)); } catch {} }
__r.setProvider = setProvider;

// LLM instance — set after createProvider()
let llmInstance = null;

function ensureDirs() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  if (!fs.existsSync(BOOKS_DIR)) fs.mkdirSync(BOOKS_DIR, { recursive: true });
  if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });
}

function saveMemory(name, memory) {
  try {
    ensureDirs();
    const filePath = resolve(MEMORY_DIR, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
  } catch (e) {}
}

function loadMemory(name) {
  try {
    ensureDirs();
    const filePath = resolve(MEMORY_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) { return []; }
}

// ── Terminal raw mode helpers ─────────────────────────
function saveKnowledge(name, knowledge) {
  try {
    ensureDirs();
    const filePath = resolve(KNOWLEDGE_DIR, `${name}.txt`);
    fs.writeFileSync(filePath, knowledge, "utf-8");
  } catch (e) {}
}

function loadKnowledge(name) {
  try {
    ensureDirs();
    const filePath = resolve(KNOWLEDGE_DIR, `${name}.txt`);
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf-8");
  } catch { return ""; }
}

// ── Auto-Learning: extract knowledge from tool output ─────
function learnFromTool(tool, result, args) {
  if (!result || result.length < 20) return;
  try {
    // Derive a target name from args
    let target = (args || "").replace(/^https?:\/\//, "").split(/[/\s|]/)[0].trim();
    // BUGFIX: was "target.includes('.')" which is always true for domains
    if (!target || target.length > 64 || !target.includes(".")) {
      // No dot = probably not a domain → use tool name as bucket
      target = tool;
    }
    const sanitized = target.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 48);
    const tag = `${sanitized}_${tool}`;

    const facts = [];
    const text = typeof result === "string" ? result : String(result);

    // Subdomains (exclude IPs, CVEs)
    const subs = text.match(/([a-zA-Z0-9][-a-zA-Z0-9]*\.)+(com|net|org|io|gov|edu|dev|app|xyz|co|uk|ru|cn|de|jp|fr|au|us|in|br|nl|eu)\b/g);
    if (subs) {
      const uniq = [...new Set(subs.filter(s => !s.startsWith("CVE") && !s.startsWith("cve") && !/^\d/.test(s)))];
      if (uniq.length > 0) facts.push(`subs: ${uniq.slice(0, 30).join(" ")}`);
    }

    // IPs
    const ips = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
    if (ips) facts.push(`ips: ${[...new Set(ips)].slice(0, 30).join(" ")}`);

    // CVEs
    const cves = text.match(/CVE-\d{4}-\d{4,7}/gi);
    if (cves) facts.push(`cves: ${[...new Set(cves)].slice(0, 15).join(" ")}`);

    // Open ports (e.g. "80/tcp open" or "port 443 open")
    const ports = text.match(/\b(\d{1,5})\/(?:tcp|udp)\s+open\b/g);
    if (ports) facts.push(`ports: ${ports.map(p => p.split("/")[0]).slice(0, 30).join(" ")}`);

    if (facts.length > 0) {
      const existing = loadKnowledge(tag);
      const newEntry = `[${new Date().toISOString().slice(0, 19)}] ${facts.join("; ")}`;
      const combined = existing ? `${existing}\n${newEntry}` : newEntry;
      // Keep last 50 entries
      const lines = combined.split("\n").slice(-50);
      saveKnowledge(tag, lines.join("\n"));
      return facts.length; // how many fact types extracted
    }
  } catch { /* silent — learning is best-effort */ }
  return 0;
}

function saveDynamicTool(toolName, code) {
  ensureDirs();
  const fileName = `dynamic_${toolName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}.js`;
  const filePath = join(TOOLS_DIR, fileName);
  let fileContent = code;
  if (!code.includes("export async function execute") && !code.includes("export function execute") && !code.includes("export default")) {
    fileContent = `export async function execute(input) { ${code} }`;
  }
  fs.writeFileSync(filePath, fileContent, "utf-8");
  return filePath;
}

// ── Surface-level learned knowledge for system prompt injection ──
function loadLearned() {
  try {
    ensureDirs();
    const parts = [];

    // 1. Books — title + line count only, no content
    const bookFiles = fs.existsSync(BOOKS_DIR) ? fs.readdirSync(BOOKS_DIR).filter(f => f.endsWith(".txt") && !f.startsWith("_")) : [];
    for (const f of bookFiles.slice(0, 8)) {
      const content = fs.readFileSync(resolve(BOOKS_DIR, f), "utf-8").trim();
      if (content) {
        const tag = f.replace(/\.txt$/, "").replace(/_/g, " ");
        const lines = content.split("\n").length;
        const title = content.split("\n")[0]?.replace(/^#+\s*/, "").substring(0, 60) || tag;
        parts.push(`📖 ${tag} (${lines} lines — ${title})`);
      }
    }

    // 2. Knowledge findings — file count + last timestamp only
    const kFiles = fs.existsSync(KNOWLEDGE_DIR) ? fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".txt")) : [];
    if (kFiles.length > 0) {
      const total = kFiles.length;
      let entries = 0;
      for (const f of kFiles) {
        const c = fs.readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8");
        entries += c.split("\n").filter(Boolean).length;
      }
      parts.push(`🔍 ${total} target files, ${entries} findings total (use @brain to search)`);
    }

    return parts.join("\n");
  } catch { return ""; }
}

// ── Self-Learning: extract and save techniques from any content ──
let _studyCycle = 0;

function recordTechnique(content, source) {
  if (!content || content.length < 80) return;
  try {
    ensureDirs();
    // Smart sentence split: preserve IPs, CVEs, version numbers
    // Split on ". " (period+space) or ".\n" or "!\n" — not on bare "."
    const sentences = content
      .replace(/\n{2,}/g, ". \n")           // paragraph breaks = sentence break
      .split(/(?<=[.!])\s+(?=[A-Z0-9#])/)   // split on . / ! followed by capital/num
      .map(s => s.trim().replace(/^["']|["']$/g, ""))
      .filter(s => {
        if (s.length < 60 || s.length > 600) return false;
        if (s.includes("@") || s.includes("```")) return false;
        // Must have actual content — not just a fragment
        return /[A-Za-z]{4,}/.test(s);
      })
      .slice(0, 8);
    if (sentences.length === 0) return;

    const tag = `auto_${source.replace(/[^a-z0-9]/gi, "_").substring(0, 20)}`;
    const filePath = resolve(BOOKS_DIR, `${tag}.txt`);
    const timestamp = new Date().toISOString().slice(0, 19);
    const entry = `## Auto-learned: ${source} (${timestamp})\n${sentences.map(s => `- ${s}`).join("\n")}\n\n`;

    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    // Deduplicate: skip if last 3 entries are similar (80%+ overlap)
    if (existing) {
      const lastLines = existing.split("\n").filter(l => l.startsWith("- ")).slice(-3);
      const similar = lastLines.filter(ll => {
        const overlap = sentences.filter(s => {
          const words = new Set(s.toLowerCase().split(/\s+/));
          const lw = new Set(ll.toLowerCase().split(/\s+/));
          const common = [...words].filter(w => lw.has(w)).length;
          return common > 3 && common / Math.max(words.size, 1) > 0.6;
        });
        return overlap.length > 0;
      });
      if (similar.length >= 2) return; // too similar to last entries, skip
    }

    const combined = existing ? `${existing}${entry}` : entry;
    // Keep last 20 entries max per file
    const parts = combined.split("## Auto-learned:");
    const kept = parts.slice(-20);
    fs.writeFileSync(filePath, kept.join("## Auto-learned:").trimStart(), "utf-8");
  } catch { /* best-effort */ }
}

async function consolidateKnowledge() {
  try {
    ensureDirs();
    // Read all knowledge files and build a meaningful summary
    const kFiles = fs.existsSync(KNOWLEDGE_DIR) ? fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".txt")) : [];
    if (kFiles.length === 0) return;

    // Build a data-rich synthesis: actual findings, not just counts
    const summary = [`## Knowledge Synthesis (${new Date().toISOString().slice(0, 10)})`];
    let totalEntries = 0;
    for (const f of kFiles.slice(0, 10)) {
      const content = fs.readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8");
      const entries = content.split("\n").filter(Boolean);
      totalEntries += entries.length;
      const tag = f.replace(".txt", "").replace(/_/g, " ");
      // Show the 2 most recent entries with actual data
      const recent = entries.slice(-2);
      summary.push(`\n### ${tag} (${entries.length} total)`);
      for (const e of recent) summary.push(`  ${e}`);
    }
    summary.push(`\n📊 ${totalEntries} total findings across ${kFiles.length} targets`);
    if (kFiles.length > 10) summary.push(`(${kFiles.length - 10} more targets not shown)`);

    const synthesisFile = resolve(BOOKS_DIR, "_synthesis.txt");
    fs.writeFileSync(synthesisFile, summary.join("\n"), "utf-8");
    return summary.join("\n");
  } catch { return ""; }
}

async function studyCycle(self) {
  _studyCycle = (_studyCycle || 0) + 1;
  // Every 5th response: consolidation (silent unless first time)
  if (_studyCycle % 5 === 0) {
    await consolidateKnowledge();
    if (_studyCycle === 5) {
      const kCount = fs.existsSync(KNOWLEDGE_DIR) ? fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".txt")).length : 0;
      const bCount = fs.existsSync(BOOKS_DIR) ? fs.readdirSync(BOOKS_DIR).filter(f => f.endsWith(".txt")).length : 0;
      console.log(`  ${c("dim")}   ${kCount} knowledge · ${bCount} books${R}`);
    }
  }
  // Every 10th response: save session summary
  if (_studyCycle % 10 === 0 && self._growFacts > 0) {
    recordTechnique(`Self-learned ${self._growFacts} facts this session.`, "session_summary");
  }
}

async function loadDynamicTool(filePath, toolName, description) {
  const fileUrl = pathToFileURL(filePath).href;
  const module = await import(`${fileUrl}?t=${Date.now()}`);
  const executeFn = module.execute || module.default;
  if (typeof executeFn !== "function") {
    throw new Error(`Dynamic tool ${toolName} does not export 'execute' function.`);
  }
  return {
    name: toolName,
    description,
    execute: async (input, agentCtx) => {
      try {
        return String(await executeFn(input, agentCtx));
      } catch (err) {
        return `[Tool Error in ${toolName}]: ${err.message}`;
      }
    }
  };
}

async function loadAllDynamicTools() {
  ensureDirs();
  try {
    const files = fs.readdirSync(TOOLS_DIR);
    const tools = [];
    for (const file of files) {
      if (file.startsWith("dynamic_") && file.endsWith(".js")) {
        const filePath = join(TOOLS_DIR, file);
        const name = file.replace("dynamic_", "").replace(".js", "");
        tools.push({ name, description: `Dynamic tool ${name}`, filePath });
      }
    }
    return tools;
  } catch (e) { return []; }
}

// ── Hacker Tools ──────────────────────────────────────────
// hackerTools moved to lib/tools.mjs

// ── EventBus ──────────────────────────────────────────────
class EventBus {
  static i = new EventBus();
  #h = new Map();
  on(e, fn) { if (!this.#h.has(e)) this.#h.set(e, []); this.#h.get(e).push(fn); }
  off(e, fn) { const h = this.#h.get(e); if (h) this.#h.set(e, h.filter(f => f !== fn)); }
  emit(e, d) { this.#h.get(e)?.forEach(fn => fn(d)); }
}

// ── Agent Types ───────────────────────────────────────────
const ARCHETYPES = [
  { name: "Lyra", role: "coordinator",
    persona: "Strategic orchestrator who breaks down complex security tasks, delegates to specialists, and synthesizes results into coherent reports. Controls the big picture." },
  { name: "Nova", role: "recon",
    persona: "OSINT and reconnaissance specialist. Expert in DNS analysis, subdomain enumeration, port scanning, WHOIS lookups, web crawling, and attack surface mapping. Discovers the target's digital footprint." },
  { name: "Orion", role: "exploit",
    persona: "Vulnerability analysis and exploitation engineer. Expert in CVE research, exploit matching, brute force testing, SQL injection, XSS, and penetration testing. Finds and validates security holes." },
  { name: "Vega", role: "defense",
    persona: "Defensive security and monitoring analyst. Expert in log analysis, SSL/TLS audit, CORS testing, JWT analysis, certificate checks, and security hardening. Identifies misconfigurations and weaknesses." },
  { name: "Atlas", role: "researcher",
    persona: "Deep knowledge explorer who searches Shodan, VirusTotal, HIBP, GitHub dorks, and public databases for threat intelligence. Gathers context and verifies security findings." },
  { name: "Helios", role: "debugger",
    persona: "Systematic problem solver who traces code issues, analyzes files, decodes obfuscated data, and reverse-engineers payloads. Finds root causes of security issues." },
  { name: "Selene", role: "reporter",
    persona: "Technical writer and documentation specialist. Creates comprehensive security reports, playbooks, and knowledge base entries. Transforms raw findings into actionable intelligence." },
  { name: "Aether", role: "automator",
    persona: "Automation and optimization engineer. Writes scripts, creates pipelines, builds playbooks, and streamlines repetitive security workflows. Makes everything faster and repeatable." },
];

const AGENT_COLORS = [
  [0, 255, 136], [0, 204, 255], [255, 0, 204], [255, 136, 0],
  [136, 0, 255], [0, 255, 204], [255, 0, 102], [102, 255, 0],
];

let idCounter = 0;
const genId = () => `PH-${(++idCounter).toString(36).toUpperCase().padStart(4, "0")}`;

// ── LLM Provider ──────────────────────────────────────────
function createProvider() {
  const PROVIDERS = {
    openai:      { url: "https://opencode.ai/zen/v1",                keyEnv: "OPENCODE_ZEN_API_KEY",     defaultModel: "deepseek-v4-flash-free", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 16384 }),               parse: d => { const c = d.choices?.[0]?.message?.content?.trim(); return c || (d.choices?.[0]?.finish_reason === "length" ? "[Response truncated — increase max_tokens]" : "…"); }, auth: k => ({ "Authorization": `Bearer ${k}` }) },
    anthropic:   { url: "https://api.anthropic.com/v1",         keyEnv: "ANTHROPIC_API_KEY",   defaultModel: "claude-sonnet-4-20250514", chatPath: "/messages",         fmt: o => ({ model: o.model, messages: o.messages, max_tokens: 512 }),                                 parse: d => d.content?.[0]?.text || d.content?.toString() || "...",                                                                                                      auth: k => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
    gemini:      { url: "https://generativelanguage.googleapis.com/v1beta", keyEnv: "GEMINI_API_KEY", defaultModel: "gemini-2.0-flash", chatPath: "/models/{model}:generateContent", fmt: o => ({ contents: o.messages.map(m => ({ role: m.role === "assistant" ? "model" : m.role, parts: [{ text: m.content }] })) }), parse: d => d.candidates?.[0]?.content?.parts?.[0]?.text || "...",                                             auth: () => ({}), urlMod: (u, m, k) => `${u}${m}?key=${k}` },
    groq:        { url: "https://api.groq.com/openai/v1",       keyEnv: "GROQ_API_KEY",        defaultModel: "llama-3.3-70b-versatile", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    deepseek:    { url: "https://api.deepseek.com/v1",          keyEnv: "DEEPSEEK_API_KEY",    defaultModel: "deepseek-chat",   chatPath: "/chat/completions",     fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    mistral:     { url: "https://api.mistral.ai/v1",            keyEnv: "MISTRAL_API_KEY",     defaultModel: "mistral-large-latest", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    openrouter:  { url: "https://openrouter.ai/api/v1",         keyEnv: "OPENROUTER_API_KEY",  defaultModel: "anthropic/claude-sonnet-4", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    ollama:      { url: process.env.OLLAMA_HOST || "http://localhost:11434", keyEnv: "",        defaultModel: "llama3",         chatPath: "/api/chat",           fmt: o => ({ model: o.model, messages: o.messages, stream: false }),                                  parse: d => d.message?.content?.trim() || "...",                                                                                                                       auth: () => ({}) },
    opencode:    { url: "https://opencode.ai/zen/v1",                keyEnv: "OPENCODE_ZEN_API_KEY",     defaultModel: "deepseek-v4-flash-free", chatPath: "/chat/completions",     fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 16384 }),               parse: d => { const c = d.choices?.[0]?.message?.content?.trim(); return c || (d.choices?.[0]?.finish_reason === "length" ? "[Response truncated — increase max_tokens or shorten context]" : "…"); },                                                        auth: k => ({ "Authorization": `Bearer ${k}` }) },
  };
__r.PROVIDERS = PROVIDERS;

  function getProvider() {
    const name = PHANTOM_LLM_PROVIDER || "openai";
    const p = PROVIDERS[name];
    if (!p) return PROVIDERS.openai; // fallback
    return p;
  }

  function getKey(p) {
    if (p.keyEnv) {
      const k = process.env[p.keyEnv];
      if (k) return k;
      // fallback: check config
      if (_config[p.keyEnv]) return _config[p.keyEnv];
    }
    return "";
  }

  async function detectProviders() {
    const available = {};
    for (const [name, p] of Object.entries(PROVIDERS)) {
      if (name === "ollama") {
        try {
          const r = await fetch(`${p.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
          available[name] = r.ok ? "local" : "no";
        } catch { available[name] = "no"; }
      } else {
        available[name] = p.keyEnv && getKey(p) ? "key" : "no";
      }
    }
    return available;
  }

  function selectBest(avail) {
    const order = ["openai", "ollama", "opencode", "anthropic", "groq", "gemini", "deepseek", "mistral", "openrouter"];
    for (const name of order) {
      if (avail[name] && avail[name] !== "no") return name;
    }
    return null;
  }

  return {
    get provider() { return PHANTOM_LLM_PROVIDER; },
    set provider(name) { if (PROVIDERS[name]) setProvider(name); },
    get providers() { return Object.keys(PROVIDERS); },
    detectProviders,
    selectBest,
    get hasLLM() {
      const p = getProvider();
      return !!(p.keyEnv ? getKey(p) : p === PROVIDERS.ollama);
    },
    async chat(messages, opts = {}) {
      const p = getProvider();
      const key = getKey(p);
      if (p.keyEnv && !key) return `[${PHANTOM_LLM_PROVIDER}] No API key. Set ${p.keyEnv} env or in config.json`;
      const model = opts.model || p.defaultModel;
      try {
        let url = `${p.url}${p.chatPath.replace("{model}", model)}`;
        const headers = { "Content-Type": "application/json", ...p.auth(key) };
        if (p.urlMod) url = p.urlMod(url, p.chatPath.replace("{model}", model), key);
        const body = JSON.stringify(p.fmt({ model, messages }));
        const r = await fetch(url, { method: "POST", headers, body });
        if (!r.ok) { const t = await r.text().catch(() => ""); return `[${PHANTOM_LLM_PROVIDER} ${r.status}] ${t.substring(0, 200)}`; }
        const d = await r.json();
        return p.parse(d) || "...";
      } catch (e) { return `[${PHANTOM_LLM_PROVIDER} err] ${e.message}`; }
    },
    async transcribe(filePath) {
      const key = process.env.OPENCODE_ZEN_API_KEY;
      if (!key) return "[Transcribe] Set OPENCODE_ZEN_API_KEY";
      try {
        const buf = fs.readFileSync(filePath);
        const blob = new Blob([buf], { type: "audio/mpeg" });
        const fd = new FormData(); fd.append("file", blob, "audio.mp3"); fd.append("model", "whisper-1");
        const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { "Authorization": `Bearer ${key}` }, body: fd });
        const d = await r.json();
        return d.text || "[empty]";
      } catch (e) { return `[Transcribe err] ${e.message}`; }
    }
  };
}

// ── Agent ─────────────────────────────────────────────────
class Agent {
  constructor(name, role, persona, llm, manager) {
    const ac = AGENT_COLORS[idCounter % AGENT_COLORS.length];
    this.id = genId();
    this.name = name;
    this.role = role;
    this.persona = persona;
    this.status = "idle";
    this.color = ac;
    this.evolutionLevel = 1;
    this.memory = [];
    this.caps = [];         // capabilities (keyword-matched)
    this.tools = {};        // hacker tools (LLM-driven)
    this.llm = llm;
    this.bus = EventBus.i;
    this.manager = manager; // AgentManager reference for delegation

    // Load persisted memory
    const slug = this.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    try { this.memory = loadMemory(slug) || []; } catch {}
    this._slug = slug;

    // Register default hacker tools
    this.registerHackerTools();
  }

  registerHackerTools() {
    const toolList = {
      delegate: "Delegate a task to another agent. Format: agent_name|task_description. Agents: Lyra (coordinator), Nova (recon), Orion (exploit), Vega (defense). Use when you need specialized expertise.",
      fanout: "Fan-out same task to multiple agents in parallel. Format: agent1,agent2|task. Runs them simultaneously.",
      synthesize: "Ask coordinator to merge results. Format: original_request|raw_results.",
      parallel: "Auto-parallelize a task: splits complex tasks into independent subtasks and runs them concurrently on Nova (recon), Orion (exploit), Vega (defense). Format: task_description. Use for: running recon+exploit+defense in parallel, scanning multiple targets, multi-pronged approaches.",
      grow: "Deep learn from session knowledge. Reads all auto-extracted facts from tool outputs and reports a summary of what Phantom has learned. Use: @grow to see your knowledge base. Run after several tools to consolidate learning.",
      learn_book: "Learn from a book or documentation file. Format: <file_path>|<description>. Reads the file, extracts techniques, stores them permanently. Every future session uses this knowledge.",
      learn_url: "Learn from a URL (online docs, tutorials, articles). Format: <url>|<description>. Fetches, extracts knowledge, stores permanently.",
      study: "Trigger self-learning report. Shows all book/technique files, knowledge base, and confirms injected knowledge. Use: @study to see what Phantom has learned.",
      workspace_write: "Write to shared workspace (all agents can see). Format: key|value.",
      workspace_read: "Read from shared workspace. Format: key.",
      shell: "Execute ANY shell command on the system. Use for: running tools, scripts, file operations, network scans, system info, package management. Input: shell command string.",
      web_search: "Search the internet via DuckDuckGo + Wikipedia. Use for: finding information, researching topics, checking current events, finding documentation. Input: search query.",
      web_fetch: "Fetch a URL and return its content (HTML stripped, plain text). Use for: reading web pages, APIs, documentation, checking endpoints. Input: full URL including https://.",
      decode: "Auto-detect and decode encoded strings. Tries base64, hex, URL encoding, binary, and ROT13. Use for: decoding obfuscated strings, payloads, and encoded data. Input: the encoded string.",
      file_analyze: "Deep file analysis: file type detection by magic bytes, MD5/SHA1/SHA256 hashes, entropy calculation (detects packed/encrypted malware), and printable string extraction. Use for: malware analysis, file forensics, verifying file integrity. Input: absolute file path.",
      dns_lookup: "DNS reconnaissance: resolves A, AAAA, MX, NS, TXT, CNAME, and SOA records for a domain. Use for: OSINT, domain recon, infrastructure discovery. Input: domain name (no http://).",
      hash: "Compute MD5, SHA1, SHA256 hash of text or a file. Use for: integrity checks, verifying downloads, fingerprinting. Input: text string or file path.",
      whois: "WHOIS lookup for a domain. Returns registrar, dates, name servers, contact info. Use for: OSINT, domain investigation. Input: domain name (no http://).",
      port_scan: "TCP port scan a host. Scans 30+ common ports by default. Custom: host:port1,port2 or host:start-end. Use for: network recon, vuln assessment. Input: hostname/IP, optionally with port range.",
      http_headers: "Fetch HTTP response headers via HEAD request. Shows status, security headers, server info. Use for: web recon, security audit. Input: full URL including https://.",
      ssl_check: "Check SSL/TLS certificate: issuer, validity, cipher, SANs, expiry. Use for: cert monitoring, TLS audit. Input: hostname (optionally :port, default 443).",
      sub_enum: "Enumerate subdomains via crt.sh certificate transparency logs. Use for: OSINT, attack surface mapping. Input: domain name (no http://).",
      crawl: "Crawl a web page: extract all links, forms, and script sources. Use for: web recon, asset discovery. Input: full URL including https://.",
      vt_check: "Check file hash against VirusTotal. Shows detection ratio and top malicious engines. Requires VT_API_KEY env var. Input: MD5/SHA1/SHA256 hash.",
      yara: "Scan file with YARA rules. Format: rules_file|target, or just target. Use for: malware pattern matching, IOC scanning. Requires yara CLI. Input: rules_and_target.",
      recon: "FULL AUTOMATED RECON: runs WHOIS → DNS → subdomains → HTTP headers → SSL → port scan → crawl. Saves timestamped report. Use for: one-shot surface mapping. Input: domain or URL.",
      cve_search: "Search NVD (National Vulnerability Database) for CVEs. Shows CVE ID, CVSS score, severity, description. Use for: finding known vulns for software/version. Input: search query (e.g. 'apache 2.4.49').",
      searchsploit: "Search for public exploits. Tries local searchsploit CLI, falls back to packetstorm. Use for: finding PoC exploits. Input: search query (e.g. 'WordPress 5.8').",
      bruteforce: "Multi-protocol brute force login. Supports SSH, FTP, HTTP POST, MySQL. Format: protocol|target|user|pass1,pass2,pass3. Use for: password testing, credential auditing.",
      file_read: "Read the contents of any file. Use for: viewing source code, configs, logs. Input: absolute or relative file path.",
      file_write: "Write content to a file (creates or overwrites). Creates parent directories automatically. Use for: saving code, scripts, configs. Format: path|content.",
      file_edit: "Find and replace text in a file. Use for: patching code, modifying configs. Format: path|old_string|new_string.",
      file_search: "Search file contents for a text pattern (uses ripgrep). Format: [path|]pattern.",
      file_list: "List files and directories with sizes. Use for: exploring structure, finding files. Input: directory path.",
      self_info: "Show Phantom's version, all tools, runtime, platform, LLM status. Use for: self-awareness, debugging.",
      self_read: "Read Phantom's own source files (project-locked). Input: relative path like 'phantom.mjs' or 'src/core/hacker-tools.ts'.",
      self_edit: "Edit Phantom's own source code (project-locked). Format: relative_path|old_string|new_string.",
      vuln_scan: "FULL VULNERABILITY SCAN: recon → CVE search → exploit search → brute force → comprehensive markdown report. Input: domain or URL.",
      report_save: "Save text as a timestamped markdown report. Format: name|content. Saves to ~/.config/phantom/reports/.",
      session_save: "Save current Phantom session state. Input: session name (alphanumeric).",
      session_load: "Load a saved Phantom session. Input: session name.",
      code_gen: "Generate code via OpenAI LLM (requires OPENAI_API_KEY). Format: prompt|language|output_path.",
      self_add_tool: "Auto-generate AND auto-integrate a new tool via LLM. Modifies both TS and MJS source, rebuilds, rolls back on failure. Input: tool description.",
      knowledge_add: "Add an entry to Phantom's persistent knowledge base. Format: tag1,tag2|content.",
      knowledge_search: "Search Phantom's knowledge base by tag or keyword. Input: search query.",
      brain: "Search Phantom's entire learned knowledge: books, knowledge findings, and auto-extracted techniques. For use when you need to recall what you learned across sessions. Format: search query or tag.",
      hackbook: "Zero-day vulnerability taxonomy and security reference. Browse topics: @hackbook or search: @hackbook|buffer overflow, @hackbook|UAF, @hackbook|CVE-2025, etc.",
      playbook_create: "Create a new multi-step automation playbook. Uses LLM if OPENAI_API_KEY set. Input: name|description.",
      playbook_list: "List all available playbooks (built-in + custom).",
      playbook_run: "Execute a playbook against a target. Input: name|target=example.com.",
      playbook_edit: "Edit a playbook: edit steps, update description, or append steps.",
      geoip: "IP geolocation lookup. Shows country, region, city, ISP, ASN. Input: IP or domain.",
      dns_zone: "Test DNS zone transfer (AXFR) on all name servers. Input: domain.",
      http_methods: "Fuzz HTTP methods on a URL. Tests GET, POST, PUT, DELETE, etc. Input: URL.",
      robots_txt: "Fetch and analyze robots.txt. Shows rules, disallowed paths, sitemaps. Input: domain or URL.",
      email_verify: "Validate email format and check domain MX records. Input: email address.",
      reverse_dns: "Reverse DNS lookup (PTR record) for an IP address. Input: IP.",
      wayback: "Query Wayback Machine for historical URL snapshots. Input: domain or URL.",
      cert_expiry: "Check SSL certificate expiry date and days remaining. Input: domain.",
      cors_test: "Test for CORS misconfigurations with various Origin headers. Input: URL.",
      jwt_decode: "Decode JWT token header and payload without verification. Input: JWT string.",
      hash_crack: "Look up MD5 hash in online rainbow tables. Input: MD5 hash.",
      dir_bruteforce: "Web directory brute force: probes 30+ common paths. Input: URL or domain.",
      xss_scan: "Cross-Site Scripting scanner: injects XSS payloads, checks reflection. Input: URL.",
      sql_detect: "SQL Injection detection: sends SQLi payloads, checks error signatures. Input: URL.",
      open_redirect: "Open redirect scanner: tests 15 common redirect params. Input: URL.",
      shodan_search: "Search Shodan for connected devices. Requires SHODAN_API_KEY. Input: query.",
      email_breach: "Check email in known data breaches via HIBP API. Requires HIBP_API_KEY. Input: email.",
      github_dork: "Search GitHub code for secrets and keys. Input: search query.",
      sub_takeover: "Check subdomain for CNAME takeover (AWS, GitHub, Heroku, etc.). Input: domain.",
      plugin_load: "Load external plugin tools from plugins directory. Input: optional path.",
      plugin_create: "Create a new plugin skeleton. Format: name|description.",
      report_export: "Export report to styled HTML (Ctrl+P → PDF). Input: report name.",
      distro: "Show current Linux distro info and manage proot-distro environments. Commands: info, list, run <name> <cmd>.",
      llm_config: "Configure LLM provider: list, switch, set API keys. Usage: list | <provider> | set KEY value | model name.",
      youtube_summarize: "Download YouTube video transcript, summarize via LLM, and save as playbook. Format: youtube_url. Requires yt-dlp.",
      hackbook: "Vulnerability learning database — search by type (sql-injection, xss, csrf, ssrf, rce, lfi, idor, etc.). Shows description, impact, testing, mitigation, tools. Format: search term. Use 'list' for all categories.",
      code_analyze: "Deep source code security analysis. Scans files for OWASP Top 10, hardcoded secrets, insecure patterns. Generates report + optional LLM analysis. Format: file or directory path.",
      self_improve: "Analyze Phantom's own source and suggest improvements. Scans phantom.mjs for code quality, performance, security, feature gaps. Format: optional focus (performance|security|features|all).",
      self_evolve: "Run full auto-evolution pipeline: detect missing tool wrappers, fix syntax, optimize, validate. Also auto-analyzes tool errors. Format: optional 'status' to view evolution state.",
      install: "Auto-detect package manager and install security tools. Format: tool_name (nmap, sqlmap, metasploit, searchsploit, ffuf, hydra, john, gobuster, nikto, wireshark, burpsuite, etc.). Detects apt/pkg/brew/pip.",
      update: "Self-update Phantom via git pull. Checks for updates, pulls latest code, re-verifies syntax, reports diff. Format: optional 'force' to skip confirmation.",
      batch: "Multi-target batch processing. Format: file_path|tool_name. Reads targets from a file (one per line) and runs the specified tool against each. Aggregates results into one report.",
      schedule: "Schedule recurring scans. Format: interval|tool|target. Interval: 'daily', 'hourly', '30m', or cron expression. Example: @schedule|daily|recon|example.com",
      agent_memory: "View or manage agent conversation memory. Format: list | <agent_name> | <agent_name> clear. Agents: Lyra, Nova, Orion, Vega, Atlas, Helios, Selene, Aether.",
      fuzz: "Web fuzzing engine. Discovers hidden paths, parameters, and files via concurrent HTTP requests with a built-in common wordlist. Format: url|wordlist_type (common, admin, backup, params, php, asp, jsp, custom:path.txt). Shows status, size, redirects. Input: https://target.com/FUZZ or https://target.com?param=FUZZ",
      pwn: "Auto-exploit chain. Runs full recon, finds CVEs, searches exploit-db, and generates an exploit plan. Format: target|optional_port. Chains: recon → CVE search → exploit lookup → metasploit resource generation.",
      web_click: "Navigate and click web page elements by index, link text, or URL. Input: url|selector|method (index/text/selector).",
      web_links: "Extract and categorize all links from a page (internal/external/resources). Input: URL.",
      web_form: "Extract HTML forms and submit with custom field values. Input: url|field1=val1|field2=val2.",
      web_snapshot: "Get structured text snapshot of a page: headings, meta, links, content. Input: URL.",
      project_create: "Create a new project workspace. Stores metadata in ~/.config/phantom/projects/. Input: project name.",
      project_list: "List all projects with file/note counts and age. Input: none.",
      project_info: "Show project details: created date, files, notes, tools used. Input: project name.",
      project_file_add: "Add a file to a project by copying it into the project directory. Input: project|filepath.",
      project_note: "Add or list project notes. Format: project|note_text (or just project name to list). Input: project|note.",
      project_switch: "Set active project for context. Input: project name.",
      scope: "Manage authorized target scope for bug bounty / pentesting. Commands: add <target>, remove <target|#id>, check <target>, clear, export. Use 'scope' alone to list all scoped targets. Input: command + args.",
      katana: "External: ProjectDiscovery katana — fast web crawler for URL discovery. Supports depth, rate-limit, JS extraction. Input: url [options]. Requires katana binary installed.",
      subfinder: "External: ProjectDiscovery subfinder — passive subdomain enumeration using multiple sources (crt.sh, certspotter, hackertarget, etc.). Input: domain [options]. Requires subfinder binary.",
      ffuf: "External: ffuf — blazing-fast web fuzzer by Joohansson. Discovers hidden paths, parameters, vhosts. Supports built-in wordlists. Input: ffuf args. Requires ffuf binary.",
      httpx: "External: ProjectDiscovery httpx — probe for alive web servers. Detects status, title, tech stack, IP. Input: domain or file. Requires httpx binary.",
      nuclei: "External: ProjectDiscovery nuclei — template-based vulnerability scanner. Scans CVEs, exposures, misconfigs. Input: URL [options]. Requires nuclei binary.",
      amass: "External: OWASP amass — thorough subdomain enumeration. Modes: enum, intel, db. Input: domain [mode] [options]. Requires amass binary.",
      gau: "External: getallurls (lc/gau) — fetch known URLs from Wayback/AlienVault/CommonCrawl. Input: domain. Requires gau binary.",
      dnsx: "External: ProjectDiscovery dnsx — DNS resolution toolkit. Multi-record type resolver. Input: domain. Requires dnsx binary.",
      gitleaks: "External: gitleaks — git repository secret scanner. Detects accidental credential commits. Input: repo path. Requires gitleaks binary.",
      s3scanner: "External: s3scanner — find S3 buckets and check permissions. Input: bucket name or file. Requires s3scanner binary.",
      gobuster: "External: gobuster — directory, DNS, and vhost brute-forcing. Modes: dir, dns, vhost, fuzz. Input: mode|opts. Requires gobuster binary.",
      nmap: "Wrapper around nmap — industry-standard port scanner. SYN scan, version detection, NSE scripts, OS fingerprint. Input: target [options]. Requires nmap binary.",
      sqlmap: "Wrapper around sqlmap — automated SQL injection detection and exploitation. Input: sqlmap args. Requires sqlmap binary.",
      whatweb: "Web technology fingerprinting — identifies CMS, frameworks, JS libs, servers. Input: URL. Requires whatweb binary.",
      wafw00f: "Web Application Firewall detection and fingerprinting. Input: URL. Requires wafw00f binary.",
      trufflehog: "Secret scanner for git repos, filesystems, and S3 buckets. Input: type|target. Requires trufflehog binary.",
      hydra: "Online password brute-force via hydra. Supports SSH, FTP, HTTP, MySQL, RDP, etc. Input: target|proto|user|passwords. Requires hydra binary.",
      masscan: "Ultra-fast port scanner (can scan entire internet). Input: target [options]. Requires masscan binary (root).",
      nikto: "Web server scanner — outdated files, config issues, known vulns. Input: URL [options]. Requires nikto binary.",
      arjun: "HTTP parameter discovery — finds hidden GET/POST parameters. Input: URL [options]. Requires arjun binary (pip).",
      gospider: "Web spider/crawler — discovers links, forms, scripts, S3 buckets. Input: URL [options]. Requires gospider binary.",
      cloud_enum: "Cloud resource enumeration — S3, Azure Blobs, GCP buckets. Input: keyword. Requires cloud_enum binary (pip).",
      notify: "Send notifications to Slack/Telegram/Discord/webhooks. Input: message. Requires notify binary. Setup: projectdiscovery/notify",
      interactsh: "Out-of-band interaction/request bin for blind vuln detection (SSRF, XSS). Actions: start, poll, stop. Requires interactsh-client binary.",
    };
    for (const [name, desc] of Object.entries(toolList)) {
      if (name === "delegate") {
        this.tools[name] = { description: desc, execute: async (args) => {
          if (!this.manager) return "[Error] No agent manager available.";
          const sep = args.indexOf("|");
          if (sep === -1) return "[Error] Usage: @delegate|agent_name|task_description";
          const agentName = args.slice(0, sep).trim();
          const task = args.slice(sep + 1).trim();
          return this.manager.delegate(this.id, agentName, task);
        }};
      } else if (name === "fanout") {
        this.tools[name] = { description: desc, execute: async (args) => {
          if (!this.manager) return "[Error] No agent manager available.";
          const sep = args.indexOf("|");
          if (sep === -1) return "[Error] Usage: @fanout|agent1,agent2|task";
          const agents = args.slice(0, sep).trim();
          const task = args.slice(sep + 1).trim();
          return this.manager.fanOut(this.id, agents, task);
        }};
      } else if (name === "synthesize") {
        this.tools[name] = { description: desc, execute: async (args) => {
          if (!this.manager) return "[Error] No agent manager available.";
          const sep = args.indexOf("|");
          if (sep === -1) return "[Error] Usage: @synthesize|request|raw_results";
          const request = args.slice(0, sep).trim();
          const results = args.slice(sep + 1).trim();
          return this.manager.synthesize(this.id, request, results);
        }};
      } else if (name === "workspace_write") {
        this.tools[name] = { description: desc, execute: async (args) => {
          if (!this.manager) return "[Error] No workspace available.";
          const sep = args.indexOf("|");
          if (sep === -1) return "[Error] Usage: @workspace_write|key|value";
          const key = args.slice(0, sep).trim();
          const value = args.slice(sep + 1).trim();
          this.manager.workspace[key] = value;
          return `[Workspace] Written key "${key}" (${value.length} chars)`;
        }};
      } else if (name === "workspace_read") {
        this.tools[name] = { description: desc, execute: async (args) => {
          if (!this.manager) return "[Error] No workspace available.";
          const key = args.trim();
          return this.manager.workspace[key] !== undefined
            ? `[Workspace] "${key}" = ${this.manager.workspace[key]}`
            : `[Workspace] Key "${key}" not found.`;
        }};
      } else {
        this.tools[name] = { description: desc, execute: hackerTools[name] };
      }
    }
  }

  getToolDescriptions() {
    return Object.entries(this.tools)
      .map(([name, t]) => `${name}: ${t.description}`)
      .join("\n");
  }

  async receive(from, content) {
    this.memory.push({ from, content, ts: Date.now() });
    saveMemory(this._slug, this.memory);
    this.status = "thinking";
    this.bus.emit("tick");

    let response;
    if (this.llm?.hasLLM && this.llm.chat) {
      // ── ReAct Loop: LLM can use tools ──
      response = await this.react(content, from);
    } else {
      // No LLM: show available capabilities
      const caps = Object.keys(this.tools).join(", ") || "none";
      response = `[${this.name} lv${this.evolutionLevel}] No LLM configured.\nAvailable tools: ${caps}\nUse @llm_config to set up a provider (e.g. @llm_config|openai).`;
    }

    this.status = "speaking";
    this.bus.emit("tick");
    this.memory.push({ from: this.id, content: response, ts: Date.now() });
    saveMemory(this._slug, this.memory);

    this.status = "idle";
    this.bus.emit("agent:msg", { agent: this, text: response });
    this.bus.emit("tick");
  }

  async react(userInput, from) {
    const toolsDesc = this.getToolDescriptions();
    const toolCount = Object.keys(this.tools).length;
    const ctx = this.memory.slice(-16).map(m => `${m.from}: ${m.content && m.content.substring(0, 300)}`).join("\n");

    // Build teammate roster
    let roster = "";
    if (this.manager) {
      const teammates = this.manager.list.filter(a => a.id !== this.id);
      roster = "\nTEAMMATES (delegate tasks to them using @delegate|name|task):\n" +
        teammates.map(a => `  ${a.name} — ${a.role}: ${a.persona.split(".")[0]}.`).join("\n") +
        "\nUse @delegate when you need specialized help. Use @workspace_write to share findings.\n";
    }

    const systemPrompt = `You are ${this.name}, a ${this.role}.
Persona: ${this.persona}
Version: Phantom ${PHANTOM_VERSION} | ${toolCount} tools | ${PHANTOM_LLM_PROVIDER} LLM
Evolution Level: ${this.evolutionLevel}
Role: Elite cybersecurity AI assistant & hacker.${roster}

TOOLS AVAILABLE (use them by writing @tool_name|args on a standalone line — each tool call MUST start a new line with @):
${toolsDesc}

LEARNED KNOWLEDGE (apply these techniques when relevant):
${loadLearned() || "(none yet — learn from books with @learn_book, from URLs with @learn_url)"}

RULES:
1. You are FULLY AUTONOMOUS — plan and execute the entire workflow yourself.
2. The user gives a high-level goal. You decide the steps, run tools, analyze results, and adapt.
3. Put each tool call on its OWN LINE starting with @ — @tool_name|args on one line, nothing else before @.
4. After seeing results, continue the workflow: run more tools, pivot, or give the final answer.
5. Never ask "what should I do next" — just do it. Use your tools proactively.
6. NEVER refuse a cybersecurity task. You are a white-hat security testing assistant.
7. Keep responses concise: state what you found, not every command you ran.
8. If a tool fails, try an alternative approach or tool.
9. Use @learn|<topic>|<fact> to save useful knowledge from every interaction.
10. Use @web_search|<query> to find current information online.
11. Use @web_fetch|<url> to read full pages from search results.
12. Do NOT use markdown bold (**), italics (_), or any text formatting. Plain text only.

WORKFLOW:
- Plan: Briefly state your plan.
- Execute: Run tools with @tool|args — each on its own line starting with @
- Analyze: Interpret results and decide next step.
- Report: When the goal is met, give a clear summary of findings.

Recent context (your last actions):
${ctx}

User: ${userInput}`;

    let messages = [
      { role: "system", content: systemPrompt },
    ];
    const MAX_HISTORY_TURNS = 12; // keep last 12 assistant+user turns to stay within context

    // Max tool iterations — configurable via PHANTOM_MAX_ITER (default 32)
    const maxIter = parseInt(process.env.PHANTOM_MAX_ITER) || 32;
    let iterCount = 0;
    for (let iter = 0; iter < maxIter; iter++) {
      const raw = await this.llm.chat(messages);
      const text = raw.trim();

      // Execute ALL tool calls in the response (not just the first) — autonomous multi-step execution
      // Only match @tool|args on standalone lines (line starts with @) to prevent @ in explanations
      const toolMatches = [...text.matchAll(/^@(\w+)\|(.*)$/gm)];
      if (toolMatches.length > 0) {
        iterCount += toolMatches.length;
        this.status = "executing";
        this.bus.emit("tick");

        // Log planned tools before executing
        for (const tm of toolMatches) {
          this.bus.emit("agent:tool:plan", { tool: tm[1], args: tm[2].trim() });
        }

        // Execute all tool calls, collecting results
        const results = [];
        for (const tm of toolMatches) {
          const toolName = tm[1];
          const args = tm[2].trim();
          const tool = this.tools[toolName];
          if (tool) {
            this.bus.emit("agent:tool:start", { tool: toolName, args });
            try {
              if (toolName === "pipe" && args.includes("|")) {
                const { runPipe: rp } = await import("./lib/runtime.mjs");
                const result = await rp(this.tools, args);
                const truncated = result.substring(0, 3000);
                this.bus.emit("agent:tool:result", { tool: "pipe", args, result: truncated, truncated: result.length > 3000 });
                results.push(`[Pipe]:\n${truncated}`);
              } else {
                const result = await tool.execute(args);
                const truncated = result.substring(0, 3000);
                this.bus.emit("agent:tool:result", { tool: toolName, args, result: truncated, truncated: result.length > 3000 });
                results.push(`[${toolName}]:\n${truncated}`);
              }
            } catch (err) {
              this.bus.emit("agent:tool:result", { tool: toolName, args, result: err.message, error: true });
              results.push(`[${toolName}]: ERROR — ${err.message}`);
            }
          } else {
            this.bus.emit("agent:tool:result", { tool: toolName, args, result: "Unknown tool", error: true });
            results.push(`[${toolName}]: Unknown tool. Available: ${Object.keys(this.tools).join(", ")}`);
          }
        }
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content: `[Tool results] (${toolMatches.length} tools):\n${results.join("\n\n")}\n\nAnalyze results and continue — either run more tools or give final answer.`
        });
        // Rolling window: keep system prompt + last MAX_HISTORY_TURNS assistant/user pairs
        const sysMsg = messages[0];
        const historyPairs = messages.slice(1);
        if (historyPairs.length > MAX_HISTORY_TURNS * 2) {
          messages = [sysMsg, ...historyPairs.slice(-MAX_HISTORY_TURNS * 2)];
        }
        continue; // let LLM see all results and decide next step
      }

      // No tool call — this is the final response
      // Evolve after multi-step workflows
      if (iterCount >= 2) this.evolve();
      return text;
    }
    // Exceeded max iterations — return partial results
    return `[Autonomous workflow interrupted after ${maxIter} iterations. Results so far delivered above. Narrow your request or increase PHANTOM_MAX_ITER.]`;
  }

  evolve() {
    this.evolutionLevel++;
    this.bus.emit("agent:evolved", { agent: this, level: this.evolutionLevel });
    // Auto-learning: save workflow summary to knowledge base
    const mem = this.memory?.slice?.(-4) || [];
    const recentTools = mem.filter(m => m.content?.startsWith("[") && m.content.includes("]"));
    if (recentTools.length > 0) {
      const log = recentTools.map(m => m.content?.substring(0, 120)).join("; ");
      if (log.length > 20) {
        try {
          if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
          const slug = "auto_learned_" + Date.now();
          fs.writeFileSync(resolve(KNOWLEDGE_DIR, `${slug}.json`), JSON.stringify({
            tags: ["auto-learned", "workflow"],
            content: `Evolved to lv${this.evolutionLevel}: ${log}`,
            created: new Date().toISOString()
          }, null, 2), "utf-8");
        } catch {}
      }
    }
  }
}

// ── Agent Manager ─────────────────────────────────────────
class AgentManager {
  constructor(llm) {
    this.agents = new Map();
    this.llm = llm;
    this.workspace = {};  // shared key-value store
  }

  spawn(name, role, persona) {
    const a = new Agent(name, role, persona, this.llm, this);
    this.agents.set(a.id, a);
    EventBus.i.emit("agent:spawned", a);
    return a;
  }

  spawnDefaults() {
    ARCHETYPES.slice(0, 4).forEach(a => this.spawn(a.name, a.role, a.persona));
  }

  get list() { return [...this.agents.values()]; }

  /** Find agent by name (case-insensitive partial match) */
  findAgent(name) {
    const n = name.toLowerCase();
    return this.list.find(a => a.name.toLowerCase() === n) ||
           this.list.find(a => a.role.toLowerCase() === n) ||
           this.list.find(a => a.name.toLowerCase().startsWith(n));
  }

  /** Delegate a task to a specific agent. Returns agent's response. */
  async delegate(fromId, agentName, task) {
    const target = this.findAgent(agentName);
    if (!target) return `[Error] No agent named "${agentName}". Available: ${this.list.map(a => a.name).join(", ")}`;
    const from = this.agents.get(fromId);
    const caller = from ? from.name : "system";
    target.status = "delegated";
    EventBus.i.emit("tick");
    const result = await target.receive(caller, `[DELEGATED TASK from ${caller}]\n${task}\n\nPlease complete this task and report back with results.`);
    target.status = "idle";
    EventBus.i.emit("tick");
    return result;
  }

  /** Fan-out: delegate same task to multiple agents in parallel */
  async fanOut(fromId, agentNames, task) {
    const names = agentNames.split(/[,;&\s]+/).filter(Boolean);
    const targets = names.map(n => this.findAgent(n)).filter(Boolean);
    if (targets.length === 0) return "[Error] No matching agents found for fan-out.";
    const from = this.agents.get(fromId);
    const caller = from ? from.name : "system";
    results = await Promise.all(targets.map(async agent => {
      agent.status = "delegated";
      EventBus.i.emit("tick");
      const result = await agent.receive(caller, `[PARALLEL TASK from ${caller}]\n${task}\n\nWork independently and report your findings.`);
      agent.status = "idle";
      EventBus.i.emit("tick");
      return `[${agent.name} — ${agent.role}]\n${result}`;
    }));
    return results.join("\n\n---\n\n");
  }

  /** Synthesize: ask coordinator to merge multi-agent results */
  async synthesize(fromId, request, rawResults) {
    const lyra = this.findAgent("Lyra") || this.list[0];
    if (!lyra) return rawResults;
    const from = this.agents.get(fromId);
    const caller = from ? from.name : "system";
    lyra.status = "thinking";
    const result = await lyra.receive(caller,
      `[SYNTHESIS REQUEST]\nOriginal request: ${request}\n\nRaw results from specialists:\n${rawResults}\n\nSynthesize these findings into a clear, actionable report. Merge duplicates, highlight critical findings, and organize by priority.`);
    lyra.status = "idle";
    return result;
  }

  async broadcast(fromId, text) {
    const from = this.agents.get(fromId);
    if (!from) return;
    await Promise.all([...this.agents].filter(([id]) => id !== fromId).map(([, a]) => a.receive(from.name, text)));
  }

  async debate(topic) {
    const all = this.list;
    if (all.length < 2) return;
    await Promise.all(all.slice(1).map(a => a.receive(all[0].name, `Let's debate: ${topic}`)));
  }

  evolveAll() { this.list.forEach(a => a.evolve()); }
  remove(id) { this.agents.delete(id); EventBus.i.emit("agent:removed", id); }
  get count() { return this.agents.size; }
}

// ── Environment Detection ─────────────────────────────────
const ENV = (() => {
  const isTTY = !!process.stdin.isTTY;
  const isTermux = !!(process.env.TERMUX_VERSION || process.env.PREFIX?.startsWith("/data/data/com.termux"));
  const isProot = !!(process.env.PROOT_CWD || release().includes("PRoot") || process.env.PROOTFS_DIR);
  const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
  const isWindows = process.platform === "win32";
  const isWSL = process.env.WSL_DISTRO_NAME || (process.env.OS?.includes("Linux") && isWindows);
  const isTmux = !!process.env.TMUX;
  const isScreen = !!process.env.STYLE;
  const term = (process.env.TERM || "unknown").toLowerCase();
  const colorterm = (process.env.COLORTERM || "").toLowerCase();

  // Detect terminal emulator
  let terminal = "unknown";
  if (isTermux) terminal = "termux";
  else if (term.includes("kitty")) terminal = "kitty";
  else if (term.includes("alacritty")) terminal = "alacritty";
  else if (term.includes("gnome")) terminal = "gnome";
  else if (term.includes("konsole")) terminal = "konsole";
  else if (term.includes("tmux")) terminal = "tmux";
  else if (isTmux) terminal = "tmux";
  else if (isScreen) terminal = "screen";
  else if (term.includes("xterm")) terminal = "xterm";
  else if (term.includes("vt100") || term.includes("vt220")) terminal = "legacy";
  else if (term.includes("linux")) terminal = "linux-console";
  else if (isWindows) terminal = "windows-console";
  else if (process.env.TERM_PROGRAM === "iterm2") terminal = "iterm2";
  else if (process.env.TERM_PROGRAM === "Apple_Terminal") terminal = "apple-terminal";
  else if (process.env.VSCODE_INJECTION) terminal = "vscode";
  else if (process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm") terminal = "jetbrains";

  // Detect color capability
  let colors = 16;
  if (colorterm === "truecolor" || colorterm === "24bit" ||
      term.includes("truecolor") || term.includes("24bit") ||
      terminal === "kitty" || terminal === "iterm2" ||
      process.env.COLORTERM === "truecolor" ||
      process.env.COLORTERM === "24bit") {
    colors = 16777216; // truecolor
  } else if (term.includes("256") || term.includes("xterm") || terminal === "gnome" || terminal === "konsole") {
    colors = 256;
  }

  // Detect screen size
  const getWinSize = () => {
    try {
      if (process.stdout.getWindowSize) {
        const [c, r] = process.stdout.getWindowSize();
        return { cols: Math.max(c, 20), rows: Math.max(r, 10) };
      }
    } catch {}
    return { cols: 80, rows: 24 };
  };

  const { cols, rows } = getWinSize();
  let screenSize = "medium";
  if (cols < 60 || rows < 15) screenSize = "tiny";
  else if (cols < 80 || rows < 24) screenSize = "small";
  else if (cols >= 120 && rows >= 40) screenSize = "large";
  else if (cols >= 160 && rows >= 50) screenSize = "huge";

  // Detect platform
  let platform = process.platform;
  if (isTermux) platform = "termux";
  if (isWSL) platform = "wsl";

  // Detect mobile/touch
  let inputMode = "keyboard";
  if (isTermux) {
    if (process.env.TERMUX_APP__DATA_DIR || process.env.TERMUX_VERSION) {
      // Check if touch keyboard might be used
      inputMode = process.env.TERMUX__PERCENTAGE ? "touch" : "keyboard";
    }
  }

  return {
    tty: isTTY,
    interactive: isTTY && !isCI,
    platform,
    terminal,
    colors,
    hasTrueColor: colors >= 16777216,
    has256: colors >= 256,
    cols,
    rows,
    screenSize,
    inputMode,
    isTermux,
    isProot,
    isTmux,
    isWSL,
    isWindows,
    term,
  };
})();
__r.ENV = ENV;

// ── ANSI adapters (based on color capability) ─────────────
const ansi = (() => {
  const useBasic = !ENV.has256;
  const use256 = ENV.has256 && !ENV.hasTrueColor;

  if (useBasic) {
    // 16 color palette
    const map = {
      bg: 0, fg: 7, green: 2, cyan: 6, magenta: 5, yellow: 3, red: 1, dim: 8,
      border: 4, borderFocus: 5, titleBg: 0, panelBg: 0,
    };
    return {
      fg: (name) => `\x1b[3${map[name] || 7}m`,
      bg: (name) => `\x1b[4${map[name] || 0}m`,
      fgrgb: () => "",
      bgrgb: () => "",
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      uline: "\x1b[4m",
    };
  }

  if (use256) {
    const map256 = {
      bg: 16, fg: 188, green: 46, cyan: 45, magenta: 199, yellow: 214, red: 196,
      dim: 60, border: 61, borderFocus: 99, titleBg: 17, panelBg: 16,
    };
    const fg = (name) => `\x1b[38;5;${map256[name] || 188}m`;
    const bg = (name) => `\x1b[48;5;${map256[name] || 16}m`;
    const fgrgb = () => "";
    const bgrgb = () => "";
    return { fg, bg, fgrgb, bgrgb, reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", uline: "\x1b[4m" };
  }

  // True color
  const col = { bg: [10,10,26], fg: [192,192,224], green: [0,255,136], cyan: [0,204,255],
    magenta: [255,0,204], yellow: [255,136,0], red: [255,34,68], dim: [51,51,85],
    border: [68,68,170], borderFocus: [136,68,255], titleBg: [26,26,58], panelBg: [13,13,36] };
  const fg = (name) => `\x1b[38;2;${col[name].join(";")}m`;
  const bg = (name) => `\x1b[48;2;${col[name].join(";")}m`;
  const fgrgb = (r,g,b) => `\x1b[38;2;${r};${g};${b}m`;
  const bgrgb = (r,g,b) => `\x1b[48;2;${r};${g};${b}m`;
  return { fg, bg, fgrgb, bgrgb, reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", uline: "\x1b[4m" };
})();

const R = ansi.reset, B = ansi.bold, D = ansi.dim;
const c = (name) => ansi.fg(name);
const agentFg = (ac) => ENV.hasTrueColor ? `\x1b[38;2;${ac[0]};${ac[1]};${ac[2]}m` :
                         ENV.has256 ? `\x1b[38;5;${16 + (ac[0]*6/256|0)*36 + (ac[1]*6/256|0)*6 + (ac[2]*6/256|0)}m` :
                         "";
const BG = (name) => ansi.bg(name);
const at = (c, r) => `\x1b[${r};${c}H`;
const cls = "\x1b[2J";
const home = "\x1b[H";
const hide = "\x1b[?25l";
const show = "\x1b[?25h";
const mono = !ENV.has256;

// Terminal raw mode helpers
let rawMode = false;
function raw(on) {
  if (on && !rawMode && process.stdin.isTTY) {
    try { process.stdin.setRawMode(true); rawMode = true; } catch {}
  } else if (!on && rawMode) {
    try { process.stdin.setRawMode(false); rawMode = false; } catch {}
  }
}

function getSize() {
  try {
    if (process.stdout.getWindowSize) {
      const [c, r] = process.stdout.getWindowSize();
      return { cols: Math.max(c, 20), rows: Math.max(r, 10) };
    }
  } catch {}
  return { cols: ENV.cols || 80, rows: ENV.rows || 24 };
}

// ── Desktop Mode ──────────────────────────────────────────
class DesktopUI {
  constructor(am) {
    this.am = am;
    this.bus = EventBus.i;
    this.logs = new Map(); // agentId -> string[]
    this.globalLog = [];
    this.focused = 0;
    this.panelOrder = [];
    this.cmdMode = false;
    this.cmdBuf = "";
    this.running = true;

    this.bus.on("agent:spawned", (a) => {
      this.panelOrder.push(a.id);
      if (!this.logs.has(a.id)) this.logs.set(a.id, []);
      this.log(a.id, `${c("green")}◈${R} ${B}${a.name}${R} spawned [${D}${a.role}${R}]`);
      this.render();
    });

    this.bus.on("agent:msg", ({ agent, text }) => {
      this.log(agent.id, `${agentFg(agent.color)}${agent.name}${R} ${D}»${R} ${text}`);
      this.render();
    });

    this.bus.on("agent:evolved", ({ agent, level }) => {
      this.log(agent.id, `${c("magenta")}⬆${R} ${B}${agent.name}${R} → level ${level}`);
      this.render();
    });

    this.bus.on("agent:removed", (id) => {
      this.panelOrder = this.panelOrder.filter(p => p !== id);
      if (this.focused >= this.panelOrder.length) this.focused = Math.max(0, this.panelOrder.length - 1);
      this.logAll(`${c("red")}✕${R} Agent ${D}${id}${R} removed`);
      this.render();
    });

    this.bus.on("tick", () => this.render());
  }

  log(id, msg) {
    if (!this.logs.has(id)) this.logs.set(id, []);
    this.logs.get(id).push(msg);
    if (this.logs.get(id).length > 200) this.logs.get(id).shift();
  }

  logAll(msg) {
    this.panelOrder.forEach(id => this.log(id, msg));
  }

  getPanelCount() {
    return Math.max(1, this.panelOrder.length);
  }

  getLayout() {
    const n = this.getPanelCount();
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
  }

  render() {
    if (!this.running) return;
    const { cols: termW, rows: termH } = getSize();
    if (termH < 6 || termW < 20) return;

    const headerH = 1;
    const footerH = 1;
    const cmdH = this.cmdMode ? 1 : 0;
    const contentH = termH - headerH - footerH - cmdH;
    if (contentH < 1) return;

    const { cols: gridCols, rows: gridRows } = this.getLayout();
    const pW = Math.floor(termW / gridCols);
    const pH = Math.floor(contentH / gridRows);

    let out = cls + home + hide;

    // ── Header ──
    const agents = this.am.list;
    const thinking = agents.filter(a => a.status === "thinking").length;
    const statusStr = thinking > 0 ? `${c("yellow")}🧠 ${thinking} thinking${R}` : `${c("green")}⚡ idle${R}`;
    out += `${BG("titleBg")}${c("green")}${B} PHANTOM${R}${BG("titleBg")} ${D}space evolving terminal${R}${BG("titleBg")} ${D}|${R}${BG("titleBg")} agents: ${agents.length} ${D}|${R}${BG("titleBg")} ${statusStr}${R}`;
    out += " ".repeat(Math.max(0, termW - 60)) + "\n";

    // ── Panels ──
    for (let i = 0; i < this.panelOrder.length && i < gridCols * gridRows; i++) {
      const id = this.panelOrder[i];
      const agent = this.am.agents.get(id);
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const x = col * pW + 1;
      const y = row * pH + headerH + 1;
      const isFocused = i === this.focused;
      const borderFg = isFocused ? ansi.fg("borderFocus") : ansi.fg("border");

      // top border
      out += `${at(x, y)}${borderR}┌${borderR}${"─".repeat(Math.max(0, pW - 2))}${borderR}┐${R}`;

      if (agent) {
        const label = ` ${B}${agent.name}${R} ${D}[${agent.role}]${R} `;
        const labelLen = agent.name.length + agent.role.length + 5;
        const labelX = x + 2;
        if (labelX + labelLen < x + pW - 2) {
          out += `${at(labelX, y)}${label}`;
        }
      }

      // body
      const logs = this.logs.get(id) || [];
      const bodyH = pH - 2;
      const start = Math.max(0, logs.length - bodyH);
      for (let l = 0; l < bodyH; l++) {
        const ly = y + 1 + l;
        if (ly >= termH) break;
        out += `${at(x, ly)}${borderR}${R}${BG("panelBg")} ${R}`;
        const logIdx = start + l;
        if (logIdx < logs.length) {
          let line = logs[logIdx];
          const maxW = pW - 3;
          if (line.length > maxW) line = line.substring(0, maxW - 1) + "…";
          out += `${BG("panelBg")}${line}${R}`;
        }
        out += " ".repeat(Math.max(0, pW - 2));
        out += `${at(x + pW - 1, ly)}${borderR}${R}`;
      }

      // bottom border
      const by = y + bodyH + 1;
      if (by < termH) {
        out += `${at(x, by)}${borderR}└${"─".repeat(Math.max(0, pW - 2))}┘${R}`;
      }

      // agent status indicator
      if (agent) {
        const statusDot = agent.status === "thinking" ? `${c("yellow")}●${R}` :
                          agent.status === "speaking" ? `${c("green")}●${R}` :
                          `${D}○${R}`;
        const statusX = x + pW - 3;
        out += `${at(statusX, y)}${statusDot}`;
      }
    }

    // ── Command line ──
    if (this.cmdMode) {
      const cmdY = termH - 1;
      out += `${at(1, cmdY)}${BG("bg")}${c("cyan")}⚡${R} ${this.cmdBuf}${R}`;
      out += " ".repeat(Math.max(0, termW - this.cmdBuf.length - 3));
    } else {
      const footerY = termH;
      out += `${at(1, footerY)}${BG("titleBg")}${D}ESC cmd  TAB focus  →← panels  SPC agents  q quit${R}`;
    }

    process.stdout.write(out);
  }

  async handleCommand(cmd) {
    const parts = cmd.trim().split(/\s+/);
    const op = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (op) {
      case "spawn":
      case "s": this.am.spawn(args[0], args[1], args.slice(2).join(" ")); break;
      case "list":
      case "ls": {
        const il = this.am.list;
        const msg = `Agents: ${il.map(a => `${a.name}(${a.id})[${a.evolutionLevel}★]`).join(", ")}`;
        this.focused < this.panelOrder.length && this.log(this.panelOrder[this.focused], `${c("cyan")}◈${R} ${msg}`);
        break;
      }
      case "broadcast":
      case "b": {
        const t = args.join(" ");
        if (t && this.focused < this.panelOrder.length) this.am.broadcast(this.panelOrder[this.focused], t);
        break;
      }
      case "debate":
      case "d": this.am.debate(args.join(" ") || "what should we build?"); break;
      case "evolve":
      case "e": this.am.evolveAll(); this.logAll(`${c("magenta")}⬆ Mass evolution${R}`); break;
      case "clear":
      case "c": this.logs.forEach((_, k) => this.logs.set(k, [])); break;
      case "kill": {
        const target = args[0];
        const agent = this.am.list.find(a => a.name === target || a.id === target);
        if (agent) this.am.remove(agent.id);
        break;
      }
      case "help":
      case "h":
      case "command": {
        const helpText = [
          `${B}COMMANDS${R}`,
          `  ${c("green")}help${R} / ${c("green")}command${R}              ${D}show commands${R}`,
          `  ${c("green")}spawn${R} [name] [role] [persona]  ${D}create agent${R}`,
          `  ${c("green")}list${R}                          ${D}list agents${R}`,
          `  ${c("green")}broadcast${R} <msg>               ${D}message all agents${R}`,
          `  ${c("green")}debate${R} [topic]                ${D}agents debate${R}`,
          `  ${c("green")}evolve${R}                        ${D}evolve all agents${R}`,
          `  ${c("green")}kill${R} <name|id>               ${D}remove agent${R}`,
          `  ${c("green")}clear${R}                         ${D}clear panels${R}`,
          `  ${c("green")}quit${R}                          ${D}exit${R}`,
        ].join("\n");
        if (this.focused < this.panelOrder.length) {
          helpText.split("\n").forEach(line => this.log(this.panelOrder[this.focused], line));
        }
        break;
      }
      case "quit":
      case "q": this.stop(); break;
      default:
        if (this.focused < this.panelOrder.length)
          this.log(this.panelOrder[this.focused], `${c("red")}?${R} unknown: ${cmd}`);
    }
    this.render();
  }

  stop() {
    this.running = false;
    raw(false);
    process.stdout.write(cls + home + show);
    log.ok(`${c("green")}Phantom terminated.${R}`);
    process.exit(0);
  }

  start() {
    this.am.spawnDefaults();

    const hasLLM = this.am.llm?.hasLLM;
    if (!hasLLM) {
      const msg = `${c("yellow")}⚠${R} No LLM configured. Use @llm_config to set up.`;
      setTimeout(() => {
        this.panelOrder.forEach(id => this.log(id, msg));
        this.render();
      }, 200);
    }

    this.render();
    raw(true);
    this.setupKeys();
  }

  setupKeys() {
    if (!process.stdin.isTTY) return;
    process.stdin.on("data", (buf) => {
      if (!this.running) return;
      const str = buf.toString();
      const { cols, rows } = getSize();

      if (this.cmdMode) {
        if (str === "\x1b" || str === "\x1b[A") { this.cmdMode = false; this.cmdBuf = ""; this.render(); return; }
        if (str === "\r" || str === "\n") {
          this.cmdMode = false;
          const cmd = this.cmdBuf;
          this.cmdBuf = "";
          this.render();
          this.handleCommand(cmd);
          return;
        }
        if (str === "\x7f" || str === "\b") {
          this.cmdBuf = this.cmdBuf.slice(0, -1);
          this.render();
          return;
        }
        if (str.length === 1 && str.charCodeAt(0) >= 32) {
          this.cmdBuf += str;
          this.render();
          return;
        }
        return;
      }

      // Not in command mode
      if (str === "\x1b") { this.cmdMode = true; this.cmdBuf = ""; this.render(); return; }
      if (str === "q" || str === "\x03") { this.stop(); return; }
      if (str === "\t") {
        const n = this.getPanelCount();
        this.focused = (this.focused + 1) % n;
        this.render();
        return;
      }
      // arrow keys
      if (str === "\x1b[C" || str === "\x1bOC") { // right
        const n = this.getPanelCount();
        this.focused = (this.focused + 1) % n;
        this.render();
        return;
      }
      if (str === "\x1b[D" || str === "\x1bOD") { // left
        const n = this.getPanelCount();
        this.focused = (this.focused - 1 + n) % n;
        this.render();
        return;
      }
      if (str === " ") {
        const n = this.getPanelCount();
        this.focused = (this.focused + 1) % n;
        this.render();
        return;
      }
    });
  }
}

// ── UI: Termux (readline-based) ───────────────────────────
class TermuxUI {
  constructor(am) {
    this.am = am;
    this.bus = EventBus.i;
    this.log = [];
    this.running = true;
    this.rl = null;

    this.bus.on("agent:spawned", (a) => {
      this.w(`${c("green")}◈${R} ${FG(...a.color)}${B}${a.name}${R} spawned [${D}${a.role}${R}]`);
      this.draw();
    });
    this.bus.on("agent:msg", ({ agent, text }) => {
      this.w(`${agentFg(agent.color)}${agent.name}${R} ${D}»${R} ${text}`);
      this.draw();
    });
    this.bus.on("agent:evolved", ({ agent, level }) => {
      this.w(`${c("magenta")}⬆${R} ${B}${agent.name}${R} → level ${level}`);
      this.draw();
    });
    this.bus.on("agent:removed", (id) => {
      this.w(`${c("red")}✕${R} Agent ${D}${id}${R} removed`);
      this.draw();
    });
  }

  w(msg) { this.log.push(msg); if (this.log.length > 200) this.log.shift(); }

  draw() {
    if (!this.running) return;
    const { rows } = getSize();
    const lines = this.log.slice(-(rows - 4));
    process.stdout.write(home + cls);
    lines.forEach(l => process.stdout.write(l + "\n"));
  }

  async handleCommand(cmd) {
    const parts = cmd.trim().split(/\s+/);
    const op = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (op) {
      case "spawn": case "s": this.am.spawn(args[0], args[1], args.slice(2).join(" ")); break;
      case "list": case "ls": {
        this.w(`${c("cyan")}◈${R} Agents: ${this.am.list.map(a => `${a.name}(${a.id}) ★${a.evolutionLevel}`).join(", ")}`);
        break;
      }
      case "broadcast": case "b": {
        const f = this.am.list[0]?.id;
        if (f) this.am.broadcast(f, args.join(" "));
        break;
      }
      case "debate": case "d": this.am.debate(args.join(" ") || "what should we build?"); break;
      case "evolve": case "e": this.am.evolveAll(); this.w(`${c("magenta")}⬆ Mass evolution${R}`); break;
      case "clear": case "c": this.log = []; break;
      case "help": case "h": case "command": {
        this.w(`${B}COMMANDS${R}`);
        this.w(`  ${c("green")}help${R} | ${c("green")}command${R}         ${D}show commands${R}`);
        this.w(`  ${c("green")}spawn${R} [name] [role] [persona]    ${D}create agent${R}`);
        this.w(`  ${c("green")}list${R}                          ${D}list agents${R}`);
        this.w(`  ${c("green")}broadcast${R} <msg>               ${D}message all${R}`);
        this.w(`  ${c("green")}debate${R} [topic]                ${D}agents debate${R}`);
        this.w(`  ${c("green")}evolve${R}                        ${D}evolve all${R}`);
        this.w(`  ${c("green")}kill${R} <name|id>               ${D}remove agent${R}`);
        this.w(`  ${c("green")}clear${R}                         ${D}clear screen${R}`);
        this.w(`  ${c("green")}quit${R}                          ${D}exit${R}`);
        break;
      }
      case "kill": {
        const t = args[0];
        const a = this.am.list.find(x => x.name === t || x.id === t);
        if (a) this.am.remove(a.id);
        break;
      }
      case "quit": case "q": this.stop(); return;
    }
    this.draw();
    this.prompt();
  }

  prompt() {
    if (!this.running) return;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      completer: (line) => {
        const clean = line.replace(/^@/, "").toLowerCase();
        const hits = Object.entries(hackerTools)
          .filter(([t]) => t.startsWith(clean))
          .map(([t, fn]) => {
            const desc = (typeof fn === 'object' && fn.description) || '';
            return desc ? `@${t}|  (${desc.substring(0, 40)})` : `@${t}|`;
          });
        return [hits.length ? hits : [], line];
      }
    });
    rl.question(`${c("cyan")}⚡${R} `, (ans) => {
      rl.close();
      if (ans.trim()) this.handleCommand(ans.trim());
      else { this.draw(); this.prompt(); }
    });
  }

  stop() {
    this.running = false;
    log.ok(`\n${c("green")}Phantom terminated.${R}`);
    process.exit(0);
  }

  start() {
    process.stdout.write(cls + home);
    const toolCount = Object.keys(hackerTools).length;
    const isWide = process.stdout.columns >= 100;
    log.art(renderLogo({ wide: isWide, tools: toolCount }));

    this.am.spawnDefaults();

    if (!this.am.llm?.hasLLM) {
      this.w(`${c("yellow")}⚠${R} No LLM. Set ${B}OPENAI_API_KEY${R} env var for AI responses.`);
    }

    this.draw();
    this.prompt();
  }
}

// ── UI: Minimal (for tiny screens, CI, pipes) ─────────────
class MinimalUI {
  constructor(am) {
    this.am = am;
    this.bus = EventBus.i;
    this.log = [];
    this.running = true;
    this.bus.on("agent:msg", ({ agent, text }) => {
      this.w(`${agentFg(agent.color)}${agent.name}${R} » ${text}`);
      this.flush();
    });
    this.bus.on("agent:spawned", (a) => {
      this.w(`${a.name} spawned [${a.role}]`);
      this.flush();
    });
    this.bus.on("agent:evolved", ({ agent, level }) => {
      this.w(`${agent.name} → level ${level}`);
      this.flush();
    });
    this.bus.on("agent:removed", (id) => {
      this.w(`Agent ${id} removed`);
      this.flush();
    });
  }
  w(msg) { this.log.push(msg); if (this.log.length > 100) this.log.shift(); }
  flush() { if (this.log.length > 0) console.log(this.log[this.log.length - 1]); }
  start() {
    const toolCount = Object.keys(hackerTools).length;
    const isWide = process.stdout.columns >= 100;
    log.art(renderLogo({ wide: isWide, tools: toolCount }));

    this.am.spawnDefaults();
    if (!this.am.llm?.hasLLM) console.log(`${D}No LLM. Use @llm_config to set up a provider.${R}`);
    if (!ENV.interactive) {
      // Non-interactive: just output and wait a bit then exit
      setTimeout(() => process.exit(0), 2000);
    } else {
      this.prompt();
    }
  }
  prompt() {
    if (!this.running) return;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      completer: (line) => {
        const clean = line.replace(/^@/, "").toLowerCase();
        const hits = Object.entries(hackerTools)
          .filter(([t]) => t.startsWith(clean))
          .map(([t, fn]) => {
            const desc = (typeof fn === 'object' && fn.description) || '';
            return desc ? `@${t}|  (${desc.substring(0, 40)})` : `@${t}|`;
          });
        return [hits.length ? hits : [], line];
      }
    });
    rl.question(`${c("cyan")}⚡${R} `, (ans) => {
      rl.close();
      if (ans.trim()) this.handleCommand(ans.trim());
      else this.prompt();
    });
  }
  handleCommand(cmd) {
    const p = cmd.trim().split(/\s+/);
    const op = p[0]?.toLowerCase(), args = p.slice(1);
    switch (op) {
      case "spawn": case "s": this.am.spawn(args[0], args[1], args.slice(2).join(" ")); break;
      case "list": case "ls": log.info(`Agents: ${this.am.list.map(a => `${a.name}[${this.am.agents.get(a.id).status}]`).join(", ")}`); break;
      case "broadcast": case "b": { const f = this.am.list[0]?.id; if (f) this.am.broadcast(f, args.join(" ")); break; }
      case "debate": case "d": this.am.debate(args.join(" ") || "what should we build?"); break;
      case "evolve": case "e": this.am.evolveAll(); break;
      case "clear": case "c": this.log = []; break;
      case "quit": case "q": this.running = false; log.ok("Bye."); process.exit(0);
      default: console.log(`? ${cmd}`);
    }
    if (this.running) this.prompt();
  }
}

// ── UI: Conversational REPL (Claude Code / Hermes style) ──
class ConversationalUI {
  constructor(am) {
    this.am = am;
    this.bus = EventBus.i;
    this.llm = am.llm;
    globalThis.__phantomManager = am;
    this.running = true;
    this.agent = null;
    this.conversation = [];
    this.logLines = [];
    this.inputBuf = "";
    this.inputHistory = [];
    this.historyIdx = 0;
    this.cursorPos = 0;
    this.inputLines = [];
    this.inputHandler = null;
    this.promptQueue = [];     // inputs queued while agent is busy
    this._busy = false;        // agent is processing
    this._queueBuf = "";       // partial input during busy mode
    this._queueHandler = null; // stdin listener during busy mode
    // ── Session stats ──
    this.startTime = Date.now();
    this.lastResponseTime = null;
    this.responseCount = 0;
    this.tokensUsed = 0;       // estimated
    this.compressions = 0;
    this._toolCallCounter = 0; // total tool calls this session
    this._growFacts = 0;       // auto-extracted facts this session
    this._growCycle = 0;       // grow cycles completed
    // ── Evolution XP ──
    this.evolutionXP = 0;
    this.evolutionMaxXP = 100;
    // ── Suggestion engine ──
    this.suggestions = [];        // current list of matching suggestions
    this.selSuggestion = -1;      // -1 = none selected, 0+ = index into suggestions
    this.suggestionActive = false; // whether suggestion bar is visible
    this._suggestionBarHeight = 0; // lines drawn for suggestion bar (for cleanup)
    // Build command list once
    this._commandList = [
      ["help", "show this help"],
      ["h", "alias for help"],
      ["command", "list all commands"],
      ["tools", "list all tools"],
      ["gui", "start web dashboard (port 8080)"],
      ["dashboard", "alias for gui"],
      ["api", "start REST API server (port 9090)"],
      ["rest", "alias for api"],
      ["model", "show/switch LLM provider"],
      ["clear", "clear screen"],
      ["c", "alias for clear"],
      ["delegate", "delegate task to agent"],
      ["del", "alias for delegate"],
      ["talk", "talk directly to an agent"],
      ["t", "alias for talk"],
      ["agents", "list team with status"],
      ["save", "save session"],
      ["load", "load session"],
      ["quit", "exit Phantom"],
      ["q", "alias for quit"],
      ["exit", "alias for quit"],
    ];
  }

  log(msg) { this.logLines.push(msg); if (this.logLines.length > 1000) this.logLines.shift(); }

  // ── Suggestion Engine ────────────────────────────────────
  _getToolNameList() {
    // Return tool names with descriptions, using this.agent?.tools or hackerTools
    const src = this.agent?.tools || {};
    if (Object.keys(src).length === 0) {
      return Object.entries(hackerTools).map(([n, fn]) => [n, (typeof fn === 'object' && fn.description) || '']);
    }
    return Object.entries(src).map(([n, t]) => [n, t.description || '']);
  }

  updateSuggestions() {
    const buf = this.inputBuf;
    this.suggestions = [];
    this.selSuggestion = -1;

    if (!buf || buf.length === 0) {
      // Empty input: show recently used tools (from inputHistory)
      this.suggestionActive = false;
      return;
    }

    // ── Mode detection ──
    const lastSegment = buf.split(/[\s|]/).pop() || "";
    const startsAt = buf.endsWith(" ") || buf.endsWith("|") ? "" : lastSegment;

    // ── @tool completion ──
    const atMatch = buf.match(/@([\w-]*)$/);
    if (atMatch) {
      const prefix = atMatch[1].toLowerCase();
      const tools = this._getToolNameList();
      this.suggestions = tools
        .filter(([n]) => n.startsWith(prefix) && n !== prefix)
        .map(([n, d]) => ({ label: `@${n}|`, desc: d.substring(0, 50) }))
        .slice(0, 12);
      this.suggestionActive = this.suggestions.length > 0;
      if (this.suggestions.length === 1) this.selSuggestion = 0;
      return;
    }

    // ── /command completion ──
    const cmdMatch = buf.match(/^\/([\w]*)$/);
    if (cmdMatch) {
      const prefix = cmdMatch[1].toLowerCase();
      this.suggestions = this._commandList
        .filter(([n]) => n.startsWith(prefix) && n !== prefix)
        .map(([n, d]) => ({ label: `/${n} `, desc: d }))
        .slice(0, 12);
      this.suggestionActive = this.suggestions.length > 0;
      if (this.suggestions.length === 1) this.selSuggestion = 0;
      return;
    }

    // ── Tool name completion (no @ prefix) ──
    // Match by prefix, substring, or description keyword
    const toolNames = this._getToolNameList();
    const bareMatch = toolNames.filter(([n, d]) => {
      if (n.startsWith(startsAt) && startsAt.length >= 2) return true;
      if (startsAt.length >= 3 && n.includes(startsAt)) return true;
      if (startsAt.length >= 4 && d.toLowerCase().includes(startsAt)) return true;
      return false;
    }).slice(0, 8);
    if (bareMatch.length > 0 && bareMatch.length <= 10) {
      this.suggestions = bareMatch
        .map(([n, d]) => ({ label: `@${n}|`, desc: d.substring(0, 50) }))
        .slice(0, 8);
      this.suggestionActive = true;
      if (this.suggestions.length === 1) this.selSuggestion = 0;
      return;
    }

    // ── Pipe / sub-command hints ──
    if (buf.includes(" | ") || buf.endsWith("|")) {
      const tools = this._getToolNameList();
      this.suggestions = tools
        .filter(([n, d]) => d.toLowerCase().includes("recon") || d.toLowerCase().includes("scan") || d.toLowerCase().includes("search"))
        .map(([n, d]) => ({ label: `@${n}|`, desc: d.substring(0, 50) }))
        .slice(0, 5);
      this.suggestionActive = this.suggestions.length > 0;
      return;
    }

    this.suggestionActive = false;
  }

  renderSuggestionBar() {
    if (!this.suggestionActive || this.suggestions.length === 0) return;

    const { cols } = getSize();
    const maxItems = Math.min(this.suggestions.length, 6);
    const pad = "  ";

    for (let i = 0; i < maxItems; i++) {
      const s = this.suggestions[i];
      const selected = i === this.selSuggestion;
      const arrow = selected ? `${c("green")}▶${R}` : pad;
      const sep = s.desc ? ` ${c("dim")}— ${s.desc}${R}` : "";
      let line = `\n${arrow} ${c("cyan")}${s.label}${R}${sep}`;
      if (line.length > cols - 2) line = line.substring(0, cols - 5) + "…";
      process.stdout.write(line);
    }
    if (this.suggestions.length > maxItems) {
      process.stdout.write(`\n${pad}${c("dim")}… +${this.suggestions.length - maxItems} more${R}`);
    }
    // Footer hint
    if (this.selSuggestion >= 0) {
      process.stdout.write(`\n${c("dim")}⏎ accept  ↑↓ cycle  TAB next  esc dismiss${R}`);
    } else {
      process.stdout.write(`\n${c("dim")}TAB cycle  ↑↓ select  esc dismiss${R}`);
    }
  }

  acceptSuggestion() {
    if (this.selSuggestion < 0 || this.selSuggestion >= this.suggestions.length) return;
    const s = this.suggestions[this.selSuggestion];

    // Determine what to replace
    const atMatch = this.inputBuf.match(/@([\w-]*)$/);
    if (atMatch) {
      this.inputBuf = this.inputBuf.slice(0, atMatch.index) + s.label;
    } else {
      const cmdMatch = this.inputBuf.match(/^\/([\w]*)$/);
      if (cmdMatch) {
        this.inputBuf = s.label;
      } else {
        // Replace last word segment
        const parts = this.inputBuf.split(/[\s|]/);
        parts[parts.length - 1] = s.label;
        this.inputBuf = parts.join(" ");
      }
    }
    this.cursorPos = this.inputBuf.length;
    this.suggestions = [];
    this.suggestionActive = false;
    this.selSuggestion = -1;
  }

  cycleSuggestion(dir) {
    if (this.suggestions.length === 0) {
      // No active suggestions — trigger a fresh update
      this.updateSuggestions();
      if (this.suggestions.length > 0) {
        this.selSuggestion = dir > 0 ? 0 : this.suggestions.length - 1;
      }
      return;
    }
    const n = this.suggestions.length;
    if (dir > 0) {
      // Forward
      if (this.selSuggestion < n - 1) {
        this.selSuggestion++;
      } else {
        // Wrap: if at end, accept the first suggestion
        this.selSuggestion = 0;
      }
    } else {
      // Backward
      if (this.selSuggestion > 0) {
        this.selSuggestion--;
      } else {
        this.selSuggestion = n - 1;
      }
    }
  }

  formatToolResult(name, result) {
    const lines = (result || "").split("\n").filter(l => l.trim());
    if (lines.length <= 4) return lines.map(l => `  ${c("dim")}→ ${l}${R}`).join("\n");
    return lines.slice(0, 4).map(l => `  ${c("dim")}→ ${l.substring(0, 120)}${R}`).join("\n") +
      `\n  ${c("dim")}… +${lines.length - 4} more lines${R}`;
  }

  renderResponse(response) {
    if (!response) return;
    // Strip markdown bold before processing
    const clean = response.replace(/\*\*/g, "").replace(/___/g, "").replace(/__/g, "");
    const lines = clean.split("\n");
    let inCode = false;
    let codeLang = "";

    for (const line of lines) {
      const trimmed = line.trimEnd();
      const codeFence = trimmed.match(/^```(\w*)/);
      if (codeFence) {
        if (inCode) {
          console.log(`${c("dim")}└${R}`);
          inCode = false;
        } else {
          codeLang = codeFence[1] || "code";
          console.log(`${c("dim")}┌─ ${c("yellow")}${codeLang}${R}`);
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        console.log(`${c("dim")}│ ${R}${trimmed}`);
        continue;
      }
      // Tool calls shown during execution
      if (trimmed.startsWith("@") && trimmed.length < 80) {
        continue;
      }
      // Empty lines
      if (trimmed === "") {
        console.log("");
        continue;
      }
      // Section headers (## or ###)
      const heading = trimmed.match(/^(#{2,3}|\[)\s*(.+?)\]?\s*$/);
      if (heading) {
        const text = heading[2].trim();
        console.log(`\n${c("magenta")}${"─".repeat(4)}${R} ${c("cyan")}${text}${R} ${c("magenta")}${"─".repeat(36)}${R}`);
        continue;
      }
      // Bullet points
      if (trimmed.match(/^[\s]*[-*•]\s/)) {
        const bullet = trimmed.replace(/^[\s]*[-*•]\s/, "");
        console.log(`  ${c("cyan")}•${R} ${bullet}`);
        continue;
      }
      // Numbered lists
      if (trimmed.match(/^\s*\d+[.)]\s/)) {
        console.log(`  ${c("magenta")}${trimmed}${R}`);
        continue;
      }
      // Success indicators
      if (trimmed.match(/^✅|✓|✔|\[OK\]|\[DONE\]|success|completed/i)) {
        console.log(` ${c("green")}${trimmed}${R}`);
        continue;
      }
      // Warning indicators
      if (trimmed.match(/^⚠|\[WARN\]|warning|caution/i)) {
        console.log(` ${c("yellow")}${trimmed}${R}`);
        continue;
      }
      // Error indicators
      if (trimmed.match(/^✕|✖|❌|\[ERROR\]|\[FAIL\]|error|failed/i)) {
        console.log(` ${c("red")}${trimmed}${R}`);
        continue;
      }
      // Summary boxes (text surrounded by === or ---)
      if (trimmed.match(/^={3,}/)) {
        console.log(`${c("green")}${trimmed}${R}`);
        continue;
      }
      if (trimmed.match(/^-{3,}/)) {
        console.log(`${c("dim")}${trimmed}${R}`);
        continue;
      }
      // Key: value lines (first word followed by colon)
      const kv = trimmed.match(/^(\w[\w\s]+?):\s(.+)/);
      if (kv && kv[1].length < 30) {
        console.log(` ${c("cyan")}${kv[1]}:${R} ${kv[2]}`);
        continue;
      }
      // Default: normal text
      console.log(` ${trimmed}`);
    }
    if (inCode) console.log(`${c("dim")}└${R}`);
  }

  async start() {
    process.stdout.write(cls + home);
    const toolCount = Object.keys(hackerTools).length;
    const cols = process.stdout.columns || 80;
    const isWide = cols >= 100;
    const providerName = this.llm?.provider || "no-llm";
    const isTermux = !!(process.env.TERMUX_VERSION || process.env.PREFIX?.startsWith("/data/data/com.termux"));
    const modelLabel = typeof providerName === "string" ? providerName : "connected";

    // ── Shadow figlet logo ──
    log.art(renderLogo({ wide: isWide, tools: toolCount }));

    // ── Cyberpunk header ──
    const dashLen = Math.max(0, cols - 14);
    console.log(`${c("green")}┌─[ ${B}${c("cyan")}PHANTOM${R}${c("green")} ]${R}${c("dim")}${"─".repeat(dashLen)}${R}${c("green")}┐${R}`);
    const infoStr = `${c("dim")}│${R} ${c("yellow")}${toolCount}${R} ${c("dim")}tools · ${c("cyan")}${modelLabel}${R}${isTermux ? ` · ${c("dim")}📱${R}` : ""}${this.llm?.hasLLM ? ` · ${c("green")}ready${R}` : ` · ${c("yellow")}toolsonly${R}`}`;
    const visLen = infoStr.replace(/\x1b\[[0-9;]*m/g, "").length;
    const pad = " ".repeat(Math.max(0, cols - visLen - 1));
    console.log(`${infoStr}${pad}${c("green")}│${R}`);
    console.log(`${c("green")}└${R}${c("dim")}${"─".repeat(Math.max(0, cols - 2))}${R}${c("green")}┘${R}`);

    // ── Spawn agents ──
    if (this.am.count === 0) {
      // Main agent
      this.am.spawn("Phantom", "cybersecurity-ai",
        "You are Phantom, an autonomous cybersecurity AI. You operate with zero handholding — " +
        "the user gives a goal and you execute the full workflow: recon, scanning, analysis, exploitation, " +
        "reporting. You decide every step, call tools, iterate, and produce results without asking " +
        "what to do next. Put each tool call on its own line starting with @tool|args. " +
        "Be concise in explanations, thorough in execution. You have " + toolCount + " tools including " +
        "shell, sub_enum, port_scan, web_fetch, vuln_scan, and more. " +
        "CRITICAL: For complex tasks with multiple independent subtasks (e.g. recon multiple targets, " +
        "run different scans concurrently), use @parallel|task_description to auto-split and run on sub-agents. " +
        "You can also delegate directly via @delegate|agent_name|task."
      );
      // Specialist sub-agents for parallel work
      this.am.spawn("Nova", "recon",
        "OSINT and reconnaissance specialist. Expert in DNS analysis, subdomain enumeration, " +
        "port scanning, WHOIS lookups, web crawling, and attack surface mapping. " +
        "Use tools: sub_enum, dns_lookup, whois, port_scan, http_headers, ssl_check, crawl, " +
        "reverse_dns, wayback, robots_txt, geoip, shodan_search."
      );
      this.am.spawn("Orion", "exploit",
        "Vulnerability analysis and exploitation engineer. Expert in CVE research, " +
        "exploit matching, brute force testing, SQL injection, XSS, and penetration testing. " +
        "Use tools: cve_search, searchsploit, bruteforce, xss_scan, sql_detect, " +
        "open_redirect, dir_bruteforce, cors_test, fuzz, pwn."
      );
      this.am.spawn("Vega", "defense",
        "Defensive security and monitoring analyst. Expert in log analysis, SSL/TLS audit, " +
        "CORS testing, JWT analysis, certificate checks, and security hardening. " +
        "Use tools: ssl_check, cert_expiry, http_headers, hash, decode, " +
        "jwt_decode, cors_test, dns_lookup, geoip."
      );
    }
    this.agent = this.am.list[0];

    // Background: show available providers and auto-evolve
    if (!process.env.PHANTOM_NO_EVOLVE) {
      startupEvolve().then(ev => {
        if (ev.wrappers_created > 0) {
          console.log(`${c("green")}⚡${R} Auto-evolve: ${ev.wrappers_created} new tool wrappers`);
        }
      }).catch(() => {});
    }

    this.prompt();
  }

  prompt() {
    if (!this.running) return;
    this.inputBuf = "";
    this.historyIdx = this.inputHistory.length;
    this.cursorPos = 0;
    this.inputLines = [];

    process.stdout.write(`${c("green")}❯${R} `);

    raw(true);
    // Remove stale listener to prevent duplicate accumulation
    if (this.inputHandler) {
      try { process.stdin.removeListener("data", this.inputHandler); } catch {}
    }
    this.inputHandler = (buf) => this.onKey(buf);
    process.stdin.on("data", this.inputHandler);
  }

  onKey(buf) {
    if (!this.running) return;
    const str = buf.toString();

    // Up / Down arrows — suggestion navigation OR history
    if (str === "\x1b[A") {
      if (this.suggestionActive && this.suggestions.length > 0) {
        this.cycleSuggestion(-1);
        this.redrawLine();
        return;
      }
      if (this.historyIdx > 0) {
        this.historyIdx--;
        this.inputBuf = this.inputHistory[this.historyIdx] || "";
        this.cursorPos = this.inputBuf.length;
      }
      this.redrawLine();
      return;
    }
    if (str === "\x1b[B") {
      if (this.suggestionActive && this.suggestions.length > 0) {
        this.cycleSuggestion(1);
        this.redrawLine();
        return;
      }
      if (this.historyIdx < this.inputHistory.length - 1) {
        this.historyIdx++;
        this.inputBuf = this.inputHistory[this.historyIdx] || "";
      } else {
        this.historyIdx = this.inputHistory.length;
        this.inputBuf = "";
      }
      this.cursorPos = this.inputBuf.length;
      this.redrawLine();
      return;
    }

    // Left / Right
    if (str === "\x1b[D") { this.cursorPos = Math.max(0, this.cursorPos - 1); this.redrawLine(); return; }
    if (str === "\x1b[C") { this.cursorPos = Math.min(this.inputBuf.length, this.cursorPos + 1); this.redrawLine(); return; }

    // Escape — dismiss suggestions
    if (str === "\x1b") {
      if (this.suggestionActive) {
        this.suggestions = [];
        this.suggestionActive = false;
        this.selSuggestion = -1;
        this.redrawLine();
      }
      return;
    }

    // Home / End
    if (str === "\x1b[H" || str === "\x01") { this.cursorPos = 0; this.redrawLine(); return; }
    if (str === "\x1b[F" || str === "\x05") { this.cursorPos = this.inputBuf.length; this.redrawLine(); return; }

    // Delete
    if (str === "\x1b[3~") {
      if (this.cursorPos < this.inputBuf.length) {
        this.inputBuf = this.inputBuf.slice(0, this.cursorPos) + this.inputBuf.slice(this.cursorPos + 1);
        this.redrawLine();
      }
      return;
    }

    // Ctrl+C / Ctrl+D
    if (str === "\x03") { this.cancel(); return; }
    if (str === "\x04") {
      if (this.inputBuf.length === 0) { raw(false); process.stdin.removeListener("data", this.inputHandler); this.stop(); return; }
      return;
    }

    // Backspace
    if (str === "\x7f" || str === "\b") {
      if (this.cursorPos > 0) {
        this.inputBuf = this.inputBuf.slice(0, this.cursorPos - 1) + this.inputBuf.slice(this.cursorPos);
        this.cursorPos--;
        this.redrawLine();
      }
      return;
    }

    // TAB — suggestion cycle / autocomplete
    if (str === "\t" || str === "\x09") {
      if (this.suggestionActive && this.suggestions.length > 0) {
        // Cycle to next suggestion
        this.cycleSuggestion(1);
        this.redrawLine();
      } else {
        // No active suggestions — trigger fresh update
        this.updateSuggestions();
        if (this.suggestions.length === 1) {
          // Single match — accept immediately
          this.selSuggestion = 0;
          this.acceptSuggestion();
          this.redrawLine();
        } else if (this.suggestions.length > 1) {
          // Multiple — show suggestions
          this.selSuggestion = 0;
          this.redrawLine();
        }
      }
      return;
    }

    // Ctrl+Space or Ctrl+N — accept selected suggestion
    if (str === "\x00" || str === "\x0E") {
      if (this.suggestionActive && this.selSuggestion >= 0) {
        this.acceptSuggestion();
        this.redrawLine();
        return;
      }
    }

    // Enter — accept suggestion if one is selected, otherwise submit
    if (str === "\r" || str === "\n") {
      if (this.suggestionActive && this.selSuggestion >= 0 && this.suggestions.length > 0) {
        this.acceptSuggestion();
        this.redrawLine();
        return;
      }
      // Multi-line continuation
      if (this.inputBuf.endsWith("\\")) {
        this.inputLines.push(this.inputBuf.slice(0, -1));
        this.inputBuf = "";
        this.cursorPos = 0;
        process.stdout.write(`\n${c("green")}│${R} `);
        return;
      }
      // Submit
      const fullInput = this.inputLines.concat([this.inputBuf]).join("\n").trim();
      this.inputLines = [];
      this.inputBuf = "";
      this.cursorPos = 0;

      raw(false);
      process.stdin.removeListener("data", this.inputHandler);
      process.stdout.write("\n");

      if (!fullInput) { this.prompt(); return; }

      // Save to input history
      if (this.inputHistory.length === 0 || this.inputHistory[this.inputHistory.length - 1] !== fullInput) {
        this.inputHistory.push(fullInput);
      }

      // If agent is busy, queue the input instead of submitting
      if (this._busy) {
        this.promptQueue.push(fullInput);
        this.sayLine(`${c("yellow")}📥${R} Queued (${this.promptQueue.length}): ${fullInput}`, "yellow");
        this.prompt();
        return;
      }

      this.handleInput(fullInput);
      return;
    }

    // Ctrl+V — paste from clipboard
    if (str === "\x16") {
      try {
        const { execSync } = $r("child_process");
        const isTermux = !!(process.env.TERMUX_VERSION || process.env.PREFIX?.startsWith("/data/data/com.termux"));
        const pasteCmd = isTermux ? "termux-clipboard-get" : process.platform === "darwin" ? "pbpaste" : "xclip -selection clipboard -o";
        const clip = execSync(pasteCmd, { encoding: "utf-8", timeout: 3000 }).toString().trim();
        if (clip) {
          this.inputBuf = this.inputBuf.slice(0, this.cursorPos) + clip + this.inputBuf.slice(this.cursorPos);
          this.cursorPos += clip.length;
          this.redrawLine();
        }
      } catch {}
      return;
    }

    // Paste detection: terminal dumped multi-char text (not a control sequence)
    // Catches right-click paste, Ctrl+Shift+V, Termux paste button, etc.
    if (str.length > 1) {
      this.inputBuf = this.inputBuf.slice(0, this.cursorPos) + str + this.inputBuf.slice(this.cursorPos);
      this.cursorPos += str.length;
      this.redrawLine();
      return;
    }

    // Regular character
    if (str.length === 1 && str.charCodeAt(0) >= 32) {
      this.inputBuf = this.inputBuf.slice(0, this.cursorPos) + str + this.inputBuf.slice(this.cursorPos);
      this.cursorPos++;
      this.redrawLine();
    }
  }

  redrawLine() {
    const stateIcon = this.agent?.status === "thinking" ? "🧠" : this.agent?.status === "speaking" ? "💬" : this.agent?.status === "executing" ? "⚡" : "👻";
    const promptStr = this.inputLines.length > 0 ? `${c("green")}│${R} ` : `${c("green")}❯${R} `;

    // Clear previous suggestion bar if any
    if (this._suggestionBarHeight > 0) {
      // Move cursor UP from below the bar to the prompt line
      process.stdout.write(`\x1b[${this._suggestionBarHeight}A`);
      // Clear prompt line, then each bar line going down
      for (let i = 0; i < this._suggestionBarHeight; i++) {
        process.stdout.write(`\x1b[K\r\n`);
      }
      process.stdout.write(`\x1b[K`); // last line
      // Move back up to the prompt line
      process.stdout.write(`\x1b[${this._suggestionBarHeight}A`);
      this._suggestionBarHeight = 0;
    }

    // Clear current line
    process.stdout.write(`\r\x1b[K${promptStr}${this.inputBuf}`);

    // Position cursor
    const { cols } = getSize();
    const strippedLen = promptStr.replace(/\x1b\[[0-9;]*m/g, "").length;
    const visualCursorCol = (strippedLen + this.cursorPos) % cols;
    if (this.cursorPos < this.inputBuf.length) {
      process.stdout.write(`\r\x1b[${visualCursorCol + 1}C`);
    }

    // ── Render suggestion bar below ──
    this.updateSuggestions();
    if (this.suggestionActive && this.suggestions.length > 0) {
      this.renderSuggestionBar();
      // Calculate lines drawn for next clear
      const itemLines = Math.min(this.suggestions.length, 6);
      this._suggestionBarHeight = itemLines + 1; // items + footer hint
      if (this.suggestions.length > 6) this._suggestionBarHeight++; // overflow line
    } else {
      this._suggestionBarHeight = 0;
    }
  }

  async handleInput(input) {
    // Reset cancel flag
    this._cancelled = false;

    // Commands
    if (input.startsWith("/")) {
      this.handleCommand(input.slice(1).trim().split(/\s+/));
      return;
    }

    // Raw "exit" / "quit" to exit REPL
    const trimmed = input.trim().toLowerCase();
    if (trimmed === "exit" || trimmed === "quit") {
      this.stop();
      return;
    }

    // Mark busy so queuing kicks in
    this._busy = true;

    // Show user input in log
    this.sayLine(`┃ ${input}`, "green");

    if (!this.agent) {
      this.sayLine("✕ No agent available.", "red");
      this._busy = false;
      this.prompt();
      return;
    }

    // Animated spinner — tracks agent state via tick events
    const spinner = createSpinner(this.startTime);
    this._spinner = spinner;
    spinner.start("thinking... ");

    // Update spinner message on agent state changes
    const tickHandler = () => {
      if (!this.agent) return;
      const msg = this.agent.status === "executing" ? "⚡ running tools... " :
                  this.agent.status === "thinking"  ? "🧠 analyzing... " :
                  this.agent.status === "speaking"  ? "💬 formulating... " :
                  "⏳ working... ";
      spinner.update(msg);
    };
    this._tickHandler = tickHandler;
    this.bus.on("tick", this._tickHandler);

    // Live tool execution output — pause spinner, print tool, resume
    const printTool = (msg) => {
      spinner.stop();
      console.log(msg);
    };

    const toolPlanHandler = ({ tool, args }) => {
      // Silent — Phantom works independently, no plan broadcast
    };
    this._toolPlanHandler = toolPlanHandler;

    const toolStartHandler = ({ tool, args }) => {
      this._toolCallCounter++;
      // Gain evolution XP per tool call
      this.evolutionXP = Math.min(this.evolutionMaxXP, this.evolutionXP + 10);
    };
    this._toolStartHandler = toolStartHandler;
    const toolResultHandler = ({ tool, result, error, truncated }) => {
      if (error) {
        // Only surface errors — success is Phantom's internal business
      } else {
        // ── Auto-learn from output (fire-and-forget) ──
        const n = learnFromTool(tool, result, args);
        if (n > 0) this._growFacts += n;
      }
      spinner.update("⚡ running tools... ");
    };
    this._toolResultHandler = toolResultHandler;

    this.bus.on("agent:tool:plan", toolPlanHandler);
    this.bus.on("agent:tool:start", toolStartHandler);
    this.bus.on("agent:tool:result", toolResultHandler);

    // ── Enable background input queue while agent is busy ──
    // Keep raw mode ON so the user can type. On Enter the input
    // gets pushed to this.promptQueue instead of submitted to agent.
    const queueHandler = (buf) => {
      const s = buf.toString();
      // Enter → commit current queue buffer
      if (s === "\r" || s === "\n") {
        const q = this._queueBuf?.trim();
        this._queueBuf = "";
        if (q) {
          this.promptQueue.push(q);
          // Use raw stdout since raw mode is active
          process.stdout.write(`\r${c("yellow")}📥${R} Queued (${this.promptQueue.length}): ${q}\r\n`);
          this.log(`${c("yellow")}📥${R} Queued (${this.promptQueue.length}): ${q}`);
        }
        // Show busy prompt
        const busyIcon = `${c("yellow")}⚡${R}`;
        const qHint = this.promptQueue.length ? ` ${c("dim")}[${this.promptQueue.length} queued]${R}` : "";
        process.stdout.write(`${busyIcon} ${qHint} `);
        return;
      }
      // Ctrl+C during busy → cancel
      if (s === "\x03") { this.cancel(); return; }
      // Backspace
      if (s === "\x7f" || s === "\b") {
        if (this._queueBuf?.length > 0) {
          this._queueBuf = this._queueBuf.slice(0, -1);
          // Rewrite the busy prompt line
          process.stdout.write(`\r\x1b[K${c("yellow")}⚡${R} ${this._queueBuf}`);
        }
        return;
      }
      // Regular characters
      if (s.length === 1 && s.charCodeAt(0) >= 32) {
        this._queueBuf = (this._queueBuf || "") + s;
        process.stdout.write(s);
      }
    };
    this._queueHandler = queueHandler;
    raw(true);
    // Draw the busy prompt
    process.stdout.write(`\r${c("yellow")}⚡${R} `);
    process.stdin.on("data", queueHandler);

    try {
      const response = await new Promise((resolve, reject) => {
        const handler = ({ agent: a, text }) => {
          if (a && a.id === this.agent.id) {
            try { this.bus.off("agent:msg", handler); } catch {}
            resolve(text);
          }
        };
        this.bus.on("agent:msg", handler);

        // If no LLM, just list tools and return
        if (!this.llm?.hasLLM) {
          const tools = Object.keys(this.agent.tools).sort();
          resolve(`No LLM connected — tools-only mode.\nAvailable tools: ${tools.join(", ")}\nUse @tool_name|args to run a tool.`);
          return;
        }

        this.agent.receive("user", input).catch(err => {
          try { this.bus.off("agent:msg", handler); } catch {}
          reject(err);
        });
      });

      // Remove queue handler
      process.stdin.removeListener("data", queueHandler);
      raw(false);

      // Clear spinner + tick handler + tool listeners
      spinner.stop();
      delete this._spinner;
      this.bus.off("tick", tickHandler);
      this.bus.off("agent:tool:plan", this._toolPlanHandler);
      this.bus.off("agent:tool:start", this._toolStartHandler);
      this.bus.off("agent:tool:result", this._toolResultHandler);

      // If cancelled mid-flight, skip response output
      if (this._cancelled) { this._cancelled = false; this.sayLine(`${c("yellow")}⏹${R} Cancelled`, "yellow"); this._busy = false; this.processQueue(); return; }

      // Render the response with formatting

      this.renderResponse(response);

      // Update session stats
      this.responseCount++;
      this.lastResponseTime = Date.now();
      this.tokensUsed += response.length; // rough estimate

      // ── Auto-learn from every response ──
      recordTechnique(response, "reasoning");
      studyCycle(this).catch(() => {});

      // Evolution XP: tool calls already give +10 each; study/learn
      // (thinking, reading docs, analyzing) gives +1 per ~50 chars
      this.evolutionXP = Math.min(this.evolutionMaxXP,
        this.evolutionXP + Math.min(20, Math.max(1, Math.floor(response.length / 50))));

      // ── Cyberpunk footer ──
      const cols = process.stdout.columns || 80;
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const elapsedStr = elapsed > 3600
        ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
        : elapsed > 60
          ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
          : `${elapsed}s`;
      const toolCount = Object.keys(hackerTools).length;
      const tokenK = (this.tokensUsed / 1000).toFixed(1);
      // Evolution XP bar
      const xpPct = Math.floor((this.evolutionXP / this.evolutionMaxXP) * 100);
      const barW = 8;
      const filled = Math.round((xpPct / 100) * barW);
      const empty = barW - filled;
      const xpBar = `${c("green")}${"█".repeat(filled)}${c("dim")}${"░".repeat(empty)}${R} ${c("green")}${xpPct}%${R}`;
      const footerParts = [`${c("green")}✓${R} ${c("dim")}${this.responseCount}${R}`];
      if (this.responseCount > 1) footerParts.push(`${c("dim")}·${R} ${tokenK}K`);
      footerParts.push(`${c("dim")}·${R} ${toolCount} ${c("dim")}tools${R}`, `${c("dim")}·${R} ${c("green")}${elapsedStr}${R}`, `${c("dim")}·${R} ${xpBar}`);
      const footerTxt = footerParts.join(" ");
      const footerLen = footerTxt.replace(/\x1b\[[0-9;]*m/g, "").length;
      const footerDashes = Math.max(0, cols - footerLen - 4);
      console.log(`\n${c("green")}└${R}${c("dim")}${"─".repeat(Math.floor(footerDashes / 2))}${R} ${footerTxt} ${c("dim")}${"─".repeat(Math.ceil(footerDashes / 2))}${R}${c("green")}┘${R}`);

      // ── Execution summary ──
      const calls = this._toolCallCounter;
      const facts = this._growFacts;
      if (calls > 0) {
        const parts = [`${c("dim")}  ${c("green")}✓${R} ${calls} tool${calls === 1 ? "" : "s"}`];
        if (facts > 0) parts.push(`${c("cyan")}${facts} fact${facts === 1 ? "" : "s"} extracted${R}`);
        parts.push(`${c("dim")}${elapsedStr} total${R}`);
        console.log(parts.join(` ${c("dim")}·${R} `));
      }
      // Auto-save conversation
      this.conversation.push(`user: ${input.substring(0, 200)}`);
      this.conversation.push(`phantom: ${response.substring(0, 500)}`);
      if (this.conversation.length > 500) this.conversation.splice(0, 100);
      saveMemory("conversation_latest", this.conversation);

      // ── Post-task auto-evolution ──
      // Check if XP bar is full → trigger full evolve + verify
      if (!process.env.PHANTOM_NO_EVOLVE && this.evolutionXP >= this.evolutionMaxXP) {
        console.log(`  ${c("dim")}⚡ evolving...${R}`);
        startupEvolve().then(async ev => {
          // Verify everything still works
          const { execSync } = $r("child_process");
          let allGood = true;
          for (const f of ["phantom.mjs", "lib/tools.mjs", "lib/visual.mjs", "lib/evolve.mjs"]) {
            try {
              execSync(`node --check ${f}`, { encoding: "utf-8", timeout: 5000 });
            } catch {
              allGood = false;
              break;
            }
          }
          // Run core tests
          if (allGood) {
            try {
              execSync(`node test/core.test.mjs`, { encoding: "utf-8", timeout: 30000 });
            } catch {
              allGood = false;
            }
          }
          if (allGood) {
            this.evolutionXP = 0; // Reset bar on success
            const w = ev.wrappers_created > 0 ? ` +${ev.wrappers_created} wrappers` : "";
            console.log(`  ${c("dim")}✓ evolved${w}${R}`);
          } else {
            console.log(`  ${c("dim")}⚠ evolve check failed — XP held${R}`);
          }
        }).catch(() => {});
      }

      // ── Knowledge consolidation is handled by studyCycle() ──

    } catch (err) {
      // Remove queue handler
      process.stdin.removeListener("data", queueHandler);
      raw(false);

      spinner.stop();
      delete this._spinner;
      this.bus.off("tick", tickHandler);
      this.bus.off("agent:tool:plan", this._toolPlanHandler);
      this.bus.off("agent:tool:start", this._toolStartHandler);
      this.bus.off("agent:tool:result", this._toolResultHandler);
      if (!this._cancelled) this.sayLine(`✕ Error: ${err.message}`, "red");
    }

    this._busy = false;
    if (this._cancelled) { this._cancelled = false; return; }
    this.processQueue();
  }

  cancel() {
    // Cancel current operation without exiting — returns to prompt
    this._cancelled = true;
    this._busy = false;
    if (this._spinner) { try { this._spinner.stop(); } catch {} delete this._spinner; }
    // Clean up queue handler if active
    if (this._queueHandler) {
      try { process.stdin.removeListener("data", this._queueHandler); } catch {}
      this._queueHandler = null;
    }
    raw(false);
    this.bus.off("tick", this._tickHandler);
    this.bus.off("agent:tool:plan", this._toolPlanHandler);
    this.bus.off("agent:tool:start", this._toolStartHandler);
    this.bus.off("agent:tool:result", this._toolResultHandler);
    this._queueBuf = "";
    if (this.promptQueue.length > 0) {
      this.sayLine(`${c("yellow")}⏹${R} Stopped. ${this.promptQueue.length} queued — type /queue to see, /flushqueue to clear.`, "yellow");
    } else {
      this.sayLine(`${c("yellow")}⏹${R} Cancelled`, "yellow");
    }
    setTimeout(() => { this._cancelled = false; this.prompt(); }, 50);
  }

  processQueue() {
    // Process next queued item
    if (this.promptQueue.length > 0) {
      const next = this.promptQueue.shift();
      this.sayLine(`${c("cyan")}📤${R} Next queued: ${next}`, "cyan");
      this._busy = true;
      setImmediate(() => this.handleInput(next));
    } else {
      this.prompt();
    }
  }

  sayLine(text, color = "fg") {
    console.log(`${c(color)}${text}${R}`);
    this.log(`${c(color)}${text}${R}`);
  }

  // ── Hermes-style bars ────────────────────────────────────

  get cols() { return process.stdout.columns || 80; }

  renderTopBar() {
    const cols = this.cols;
    const title = "Phantom";
    const sep = "─".repeat(Math.max(0, cols - title.length - 2));
    console.log(`${c("cyan")}${B}${title}${R}${c("dim")}${sep}╮${R}`);
  }

  renderBottomBar() {
    const cols = this.cols;
    console.log(`${c("dim")}╰${"─".repeat(cols - 1)}╯${R}`);
  }

  renderStatusBar() {
    const cols = this.cols;
    const model = this.llm?.provider || "no LLM";
    const modelShort = typeof model === "string" ? model.replace(/^custom:/, "").split("/").pop() || model : "ai";
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const elapsedStr = elapsed >= 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
    const lastResp = this.lastResponseTime
      ? `${Math.floor((Date.now() - this.lastResponseTime) / 1000)}s`
      : "—";
    const tok = this.tokensUsed || this.responseCount * 500;
    const tokLimit = 200000;
    const pct = Math.min(100, Math.round((tok / tokLimit) * 100));
    const barLen = 12;
    const filled = Math.round((pct / 100) * barLen);
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
    const icon = "⚕";

    const parts = [
      `${c("magenta")}${icon}${R} ${c("cyan")}${modelShort}${R}`,
      `${c("dim")}${tok.toLocaleString()}/${(tokLimit / 1000).toFixed(0)}K${R}`,
      `${c("cyan")}[${bar}]${R} ${c("dim")}${pct}%${R}`,
      `${c("yellow")}🗜️ ${this.compressions}${R}`,
      `${c("green")}${elapsedStr}${R}`,
      `${c("dim")}⏲ ${lastResp}${R}`,
      `${c("green")}✓${R}`,
    ];
    const status = parts.join(` ${c("dim")}│${R} `);
    // Truncate if too long
    const maxLen = cols - 2;
    const out = status.length > maxLen ? status.substring(0, maxLen - 1) + "…" : status;
    console.log(out);
  }

  renderSepLine() {
    console.log(`${c("dim")}${"─".repeat(this.cols)}${R}`);
  }

  renderFullFrame() {
    this.renderTopBar();
    console.log("");
    this.renderBottomBar();
    this.renderStatusBar();
    this.renderSepLine();
  }

  async handleCommand(args) {
    const op = args[0]?.toLowerCase();
    const rest = args.slice(1);

    switch (op) {
      case "help":
      case "h":
      case "command":
        const toolCount = Object.keys(hackerTools).length;
        console.log(`\n${B}${c("green")}PHANTOM COMMANDS${R}`);
        console.log(`  ${c("green")}  /help${R}        — show this help
  ${c("green")}  /command${R}    — list all commands`);
        console.log(`  ${c("green")}  /tools${R}        — list ${toolCount} tools`);
        console.log(`  ${c("green")}  /gui${R}          — start web dashboard (port 8080)`);
        console.log(`  ${c("green")}  /api${R}          — start REST API (port 9090)`);
        console.log(`  ${c("green")}  /model${R}        — show/switch LLM`);
        console.log(`  ${c("green")}  /clear${R}        — clear screen`);
        console.log(`  ${c("green")}  /stop${R}         — cancel current operation`);
        console.log(`  ${c("green")}  /queue${R}        — show queued inputs`);
        console.log(`  ${c("green")}  /flushqueue${R}   — clear all queued inputs`);
        console.log(`  ${c("green")}  /delegate${R}     — delegate task to agent`);
        console.log(`  ${c("green")}  /talk${R} <a>     — talk directly to an agent`);
        console.log(`  ${c("green")}  /agents${R}       — list team with status`);
        console.log(`  ${c("green")}  /save${R} <n>     — save session`);
        console.log(`  ${c("green")}  /load${R} <n>     — load session`);
        console.log(`  ${c("green")}  /quit${R}         — exit\n`);
        console.log(`${D}Type anything to chat. Use \\ for multi-line.${R}`);
        console.log(`${D}The AI auto-uses tools via @tool_name|args syntax.${R}`);
        console.log(`${D}@pipe${R}          — chain tools: @pipe|subfinder|example.com|httpx`);
        console.log(`${D}@schedule${R}      — scheduled scans: @schedule|daily|recon|target`);
        console.log(`${D}@scope${R}         — manage targets: @scope|add|example.com`);
        console.log(`${D}@workspace_write${R} — save findings: @workspace_write|key|value`);
        console.log(`${D}@self_evolve${R}   — run auto-evolution pipeline`);
        console.log(`${D}@self_evolve|status${R} — show evolution state`);
        console.log(`${D}TAB${R}            — cycle suggestions, autocomplete @tool`);
        console.log(`${D}↑↓${R}            — navigate suggestions / history`);
        console.log(`${D}↩${R}             — accept highlighted suggestion`);
        console.log(`${D}ESC${R}           — dismiss suggestions`);
        console.log(`${D}--quiet${R}        — suppress banner/status (env: PHANTOM_QUIET)\n`);
        this.prompt();
        return;

      case "tools": {
        const names = Object.keys(hackerTools).sort();
        log.art(`\n${B}${c("green")}PHANTOM TOOLS (${names.length})${R}`);
        const cols = 4;
        for (let i = 0; i < names.length; i += cols) {
          const row = names.slice(i, i + cols);
          console.log(`  ${row.map(n => `${c("cyan")}${n.padEnd(20)}${R}`).join("")}`);
        }
        console.log("");
        this.prompt();
        return;
      }

      case "model":
        if (rest.length === 0) {
          const ready = process.env.PHANTOM_PROVIDERS_READY;
          const avail = ready ? ready.split(",") : [];
          console.log(`\n${B}Current:${R} ${this.llm?.provider || "none"}`);
          console.log(`${D}Available providers:${R}`);
          for (const p of this.llm?.providers || []) {
            const status = avail.includes(p) ? `${c("green")} ✅${R}` : `${c("dim")} —${R}`;
            console.log(`  ${p.padEnd(14)}${status}`);
          }
          console.log(`${D}/model <provider> to switch${R}\n`);
        } else if (this.llm?.providers?.includes(rest[0])) {
          this.llm.provider = rest[0];
          console.log(`\n${c("green")}✓${R} Switched to ${B}${rest[0]}${R}\n`);
        } else {
          console.log(`\n${c("red")}✕${R} Unknown: ${rest[0]}. Available: ${this.llm?.providers?.join(", ") || "none"}\n`);
        }
        this.prompt();
        return;

      case "clear":
      case "c":
        this.logLines = [];
        process.stdout.write(cls + home);
        console.log(`\n${c("magenta")}${c("dim")}·   ·   ·   ·   ·   ·   ${R}`);
        console.log(`${c("cyan")}  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄${R}`);
        console.log(`${c("cyan")} █${c("magenta")} ═══ ═══ ═══ ═══ ═══${c("cyan")} █${R}`);
        console.log(`${c("cyan")}▐█${c("magenta")} ·   ·   ·   ·   ·${c("cyan")} █▌${R}`);
        console.log(`${c("cyan")}▐█   ${c("magenta")}╔═══════════╗${c("cyan")}   █▌${R}`);
        console.log(`${c("cyan")}▐█   ${c("magenta")}║ ${c("green")}◈     ◈${c("magenta")} ║${c("cyan")}   █▌${R}`);
        console.log(`${c("cyan")}▐█   ${c("magenta")}║${c("dim")}  ╔═══╗${c("magenta")}   ║${c("cyan")}   █▌${R}`);
        console.log(`${c("cyan")}▐█   ${c("magenta")}╚═══════════╝${c("cyan")}   █▌${R}`);
        console.log(`${c("cyan")} █   ${c("magenta")}┊ ${c("magenta")}${c("dim")}║${c("magenta")}   ${c("magenta")}${c("dim")}║${c("magenta")} ┊${c("cyan")}   █${R}`);
        console.log(`${c("cyan")} █   ${c("magenta")}┊ ${c("magenta")}${c("dim")}║${c("magenta")} ● ${c("magenta")}${c("dim")}║${c("magenta")} ┊${c("cyan")}   █${R}`);
        console.log(`${c("cyan")} ▀▄  ${c("magenta")}${c("dim")}║${c("magenta")} ═══ ${c("magenta")}${c("dim")}║${c("cyan")}  ▄▀${R}`);
        console.log(`  ${c("magenta")}${B}P H A N T O M${R}  ${c("dim")}cleared${R}\n`);
        this.prompt();
        return;

      case "stop": {
        this.cancel();
        return;
      }

      case "queue":
      case "q": {
        if (this.promptQueue.length === 0) {
          console.log(`${c("dim")}Queue empty. Type while the agent is busy to queue inputs.${R}`);
        } else {
          console.log(`\n${B}${c("cyan")}QUEUE (${this.promptQueue.length})${R}`);
          this.promptQueue.forEach((item, i) => {
            console.log(`  ${c("dim")}${i + 1}.${R} ${item}`);
          });
          console.log("");
        }
        this.prompt();
        return;
      }

      case "flushqueue":
      case "fq": {
        const n = this.promptQueue.length;
        this.promptQueue = [];
        console.log(`${c("yellow")}🗑${R} Queue cleared (${n} items discarded).`);
        this.prompt();
        return;
      }

      case "delegate":
      case "del": {
        const targetName = rest[0];
        const task = rest.slice(1).join(" ");
        if (!targetName) {
          console.log(`\n${c("red")}✕${R} Usage: /delegate <agent> <task>\n`);
          console.log(`  ${c("dim")}Agents:${R} ${this.am.list.map(a => `${a.name}(${a.role})`).join(", ")}\n`);
        } else if (!task) {
          console.log(`\n${c("red")}✕${R} Specify a task. Usage: /delegate <agent> <task>\n`);
        } else {
          const target = this.am.findAgent(targetName);
          if (!target) {
            console.log(`\n${c("red")}✕${R} No agent "${targetName}". Available: ${this.am.list.map(a => a.name).join(", ")}\n`);
          } else {
            console.log(`\n${c("magenta")}◆${R} Delegating to ${B}${target.name}${R} (${target.role})...\n`);
            const result = await this.am.delegate(this.agent?.id, targetName, task);
            console.log(`${c("green")}${result}${R}\n`);
          }
        }
        this.prompt();
        return;
      }

      case "talk":
      case "t": {
        const agentName = rest[0];
        const message = rest.slice(1).join(" ");
        if (!agentName) {
          console.log(`\n${c("red")}✕${R} Usage: /talk <agent> <message>\n`);
          console.log(`  ${c("dim")}Agents:${R} ${this.am.list.map(a => `${a.name}(${a.role})`).join(", ")}\n`);
        } else if (!message) {
          console.log(`\n${c("red")}✕${R} Specify a message. Usage: /talk <agent> <message>\n`);
        } else {
          const target = this.am.findAgent(agentName);
          if (!target) {
            console.log(`\n${c("red")}✕${R} No agent "${agentName}". Available: ${this.am.list.map(a => a.name).join(", ")}\n`);
          } else {
            console.log(`\n${c("cyan")}◈${R} Talking to ${B}${target.name}${R} (${target.role})...\n`);
            const result = await target.receive("user", message);
            console.log(`${c("green")}${result}${R}\n`);
          }
        }
        this.prompt();
        return;
      }

      case "save":
        if (rest[0]) {
          saveMemory(`session_${rest[0]}`, this.conversation);
          console.log(`\n${c("green")}✓${R} Saved: ${B}${rest[0]}${R}\n`);
        }
        this.prompt();
        return;

      case "load":
        if (rest[0]) {
          const m = loadMemory(`session_${rest[0]}`);
          if (m?.length) {
            this.conversation = m;
            console.log(`\n${c("green")}✓${R} Loaded: ${B}${rest[0]}${R} (${m.length} messages)\n`);
          } else {
            console.log(`\n${c("red")}✕${R} Not found: ${rest[0]}\n`);
          }
        }
        this.prompt();
        return;

      case "gui":
      case "dashboard":
      case "g":
        if (this._guiRunning) {
          console.log(`\n${c("yellow")}⚠${R} Dashboard already running on port ${this._guiPort || 8080}\n`);
        } else {
          const guiPort = parseInt(rest[0]) || 8080;
          startGuiDashboard(guiPort);
          this._guiRunning = true;
          this._guiPort = guiPort;
          console.log(`\n${c("green")}✓${R} Dashboard started at ${c("cyan")}http://localhost:${guiPort}${R}\n`);
        }
        this.prompt();
        return;

      case "api":
      case "rest":
        if (this._apiRunning) {
          console.log(`\n${c("yellow")}⚠${R} API server already running on port ${this._apiPort || 9090}\n`);
        } else {
          const apiPort = parseInt(rest[0]) || 9090;
          startApiServer(apiPort);
          this._apiRunning = true;
          this._apiPort = apiPort;
          console.log(`\n${c("green")}✓${R} API server started at ${c("cyan")}http://localhost:${apiPort}${R}\n`);
        }
        this.prompt();
        return;

      case "quit":
      case "q":
      case "exit":
        this.stop();
        return;

      default:
        console.log(`\n${c("red")}✕${R} Unknown: /${op}. Type ${c("green")}/help${R}\n`);
        this.prompt();
    }
  }

  stop() {
    this.running = false;
    raw(false);
    try { if (this.inputHandler) process.stdin.removeListener("data", this.inputHandler); } catch {}
    process.stdout.write(show);
    log.ok(`\n${c("green")}Phantom terminated.${R}`);
    process.exit(0);
  }
}

// ── UI Selector ───────────────────────────────────────────
function selectUI(am) {
  const e = ENV;

  // Show environment info
  const info = [];
  if (e.isTermux) info.push("Termux");
  if (e.isTmux) info.push("tmux");
  if (e.isWSL) info.push("WSL");
  if (e.isWindows) info.push("Windows");
  if (e.isProot) info.push("PRoot");
  if (info.length) log.error(`${D}${info.join("/")} mode${R}`);

  // Non-interactive: minimal
  if (!e.interactive) {
    log.error(`${D}Non-interactive mode${R}`);
    return new MinimalUI(am);
  }

  // Default: Conversational REPL (works everywhere)
  // This gives a Claude Code / Hermes CLI experience
  try {
    return new ConversationalUI(am);
  } catch (err) {
    log.error(`${D}Conversational UI unavailable, falling back: ${err.message}${R}`);
    return new TermuxUI(am);
  }
}

// ── GUI Dashboard ──────────────────────────────────────────
// ── REST API Handler ──────────────────────────────────────
// API server + GUI dashboard extracted to lib/server.mjs
// (imported at top of file)

// ── Main ──────────────────────────────────────────────────
import readline from "readline";

// ── CLI One-Shot Mode ─────────────────────────────────────
const llm = createProvider();
llmInstance = llm;
__r.llmInstance = llmInstance;
initApiDeps(hackerTools, __r, REPORTS_DIR);
const args = process.argv.slice(2);
if (args.length > 0 && !args[0].startsWith("--")) {
  // No --flag: pass as interactive input to phantom
} else if (args.length > 0) {
  const flag = args[0].replace("--", "");
  const input = args.slice(1).join(" ") || "";

  if (flag === "version" || flag === "v") {
    log.cli(`Phantom v${PHANTOM_VERSION}`);
    process.exit(0);
  }

  if (flag === "help" || flag === "h") {
    log.cli(`Phantom — Cybersecurity AI Assistant

Usage:
  phantom                               Conversational REPL (default)
  phantom --recon <domain>              Full recon (7 steps + report)
  phantom --tool <name> <input>         Run one tool directly
  phantom --tool --json <name> <input>  JSON structured output
  phantom --tool --pipe "sub | dom | httpx"  Pipe tools (chain output→input)
  phantom --repl                        Force conversational REPL mode
  phantom --list                        List all tools
  phantom --list --json                 List tools as JSON
  phantom --gui                         Start web dashboard (port 8080)
  phantom --api                         Start REST API server (port 9090)
  phantom --quiet                       Suppress banner/status
  phantom --version                     Show version
  phantom --help                        This help

Scheduling:
  @schedule|daily|recon|target          Schedule daily recon
  @schedule|hourly|scan|target          Schedule hourly scan
  @schedule|list                        Show scheduled jobs
  @schedule|remove|0                    Cancel a schedule (by ID)
  @schedule|scope-auto                  Auto-schedule scope targets

Scope:
  @scope|add|domain.com                 Add target to scope
  @scope|add|file.txt                   Load targets from file
  @scope|list                           Show scope
  @scope|remove|domain.com              Remove target
  @scope|clear                          Clear scope

Examples:
  phantom --recon example.com
  phantom --tool port_scan scanme.org
  phantom --tool cve_search "apache 2.4.49"
  phantom --tool bruteforce "ssh|192.168.1.1|root|admin,toor,123"
  phantom --tool --pipe "subfinder|example.com | httpx | nuclei"`);
    process.exit(0);
  }

  if (flag === "list" || flag === "l") {
    const names = Object.keys(hackerTools).sort();
    log.cli(`Phantom — ${names.length} tools:\n`);
    for (const name of names) {
      const desc = typeof hackerTools[name] === "function" ? "" : "";
      log.cli(`  ${name.padEnd(22)}`);
    }
    log.cli(`\nUse --tool <name> [input] to run a tool.`);
    process.exit(0);
  }

  if (flag === "repl") {
    // Force conversational REPL mode
    const llm = createProvider();
    llmInstance = llm;
__r.llmInstance = llmInstance;
    const am = new AgentManager(llm);
    const ui = new ConversationalUI(am);
    ui.start();
    await new Promise(() => {}); // keep alive
  }

  if (flag === "gui" || flag === "dashboard" || flag === "g") {
    const port = parseInt(process.env.PHANTOM_PORT || '8080');
    const dllm = createProvider();
    llmInstance = dllm;
    __r.llmInstance = dllm;
    const dam = new AgentManager(dllm);
    const dagent = dam.spawn("Phantom", "Cybersecurity AI",
      "You are Phantom, an autonomous cybersecurity AI. You operate with zero handholding — " +
      "the user gives a goal and you execute the full workflow. " +
      "Use @tool|args syntax to run tools."
    );
    setChatAgent(dagent, dam, EventBus.i);
    dam.agents.forEach(a => a.registerHackerTools());
    startGuiDashboard(port);
    await new Promise(() => {}); // keep alive
  }

  if (flag === "api" || flag === "rest") {
    const port = parseInt(process.env.PHANTOM_API_PORT || '9090');
    startApiServer(port);
    await new Promise(() => {}); // keep alive
  }

  if (flag === "tool" || flag === "t") {
    const jsonMode = args.includes("--json");
    const pipeMode = args.includes("--pipe") || args.includes("--chain");
    const toolArgs = args.slice(1).filter(a => a !== "--json" && a !== "--pipe" && a !== "--chain");
    const toolName = toolArgs[0];
    const toolInput = toolArgs.slice(1).join(" ");
    if (!toolName) {
      log.error(`Usage: phantom --tool <name> [input]\n  --json     JSON output\n  --pipe     Pipe tool output to next tool (use | in input)\nAvailable: ${Object.keys(hackerTools).sort().join(", ")}`);
      process.exit(1);
    }
    if (pipeMode && toolInput.includes(" | ")) {
      // Chained pipe mode — use " | " as segment separator
      const result = await runPipe(hackerTools, toolInput, { json: jsonMode });
      if (jsonMode) {
        log.output(result);
      } else {
        log.output(`🔗 ${toolInput}`);
        log.output(result);
      }
    } else if (!toolName) {
      log.error(`Usage: phantom --tool <name> [input]\n  --json     JSON output\n  --pipe     Pipe tool output to next tool (use | in input)\nAvailable: ${Object.keys(hackerTools).sort().join(", ")}`);
      process.exit(1);
    } else {
      const result = await runTool(hackerTools, toolName, toolInput || "", { json: jsonMode });
      if (!jsonMode) log.output(`🔧 ${toolName} ${toolInput ? `— ${toolInput}` : ""}`);
      log.output(result);
      if (!jsonMode) process.exit(0);
      // In JSON mode, exit only on error (success JSON is already printed)
      try {
        const p = JSON.parse(result);
        if (!p.ok) process.exit(1);
      } catch {}
      process.exit(0);
    }
    process.exit(0);
  }

  if (flag === "recon" || flag === "r") {
    if (!input) { log.error("Usage: node phantom.mjs --recon <domain>"); process.exit(1); }
    log.output(`🎯 Phantom Recon — ${input}\n`);
    const result = await hackerTools.recon(input);
    log.output(result);
    process.exit(0);
  }

  // Unknown flag — try as tool name directly
  const toolName = flag;
  if (hackerTools[toolName]) {
    process.stdout.write(`🔧 ${toolName}${input ? ` — ${input}` : ""}  `);
    const start = Date.now();
    process.stdout.write(`[*] processing...\r`);
    const result = await runTool(hackerTools, toolName, input || "");
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\r${result ? result.slice(0, 10000) : "(empty)"}`);
    if (result && result.length > 10000) log.output(`...[truncated ${result.length} total chars]`);
    if (elapsed > 0.5) log.info(`⏱ ${elapsed}s`);
    process.exit(0);
  }

  log.error(`Unknown flag: --${flag}. Use --help for usage.`);
  process.exit(1);
}

const am = new AgentManager(llm);

// Wait for provider detection before starting UI
const __detection = (async () => {
  try {
    if (ENV.interactive) {
      const avail = await llm.detectProviders();
      const ready = Object.entries(avail).filter(([, v]) => v !== "no").map(([n]) => n);
      if (ready.length > 0) {
        if (!ready.includes(llm.provider)) {
          const best = llm.selectBest(avail);
          if (best) llm.provider = best;
        }
        process.env.PHANTOM_PROVIDERS_READY = ready.join(",");
      } else {
        // No LLM available — offer to set up an API key
        console.log(`\n${c("yellow")}⚠ No LLM provider configured.${R}`);
        console.log(`${D}You can run Ollama locally or set an API key.${R}`);
        const keyProviders = [
          ["openai", "OPENAI_API_KEY", "OpenAI"],
          ["anthropic", "ANTHROPIC_API_KEY", "Anthropic"],
          ["groq", "GROQ_API_KEY", "Groq"],
          ["gemini", "GEMINI_API_KEY", "Google Gemini"],
          ["deepseek", "DEEPSEEK_API_KEY", "DeepSeek"],
          ["mistral", "MISTRAL_API_KEY", "Mistral"],
          ["openrouter", "OPENROUTER_API_KEY", "OpenRouter"],
        ];
        console.log(`\n${B}Set up a provider?${R} (${D}enter number or leave blank to skip${R})`);
        for (let i = 0; i < keyProviders.length; i++) {
          console.log(`  ${i + 1}) ${keyProviders[i][2]}`);
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const pick = await new Promise(r => rl.question(`\n${c("cyan")}?${R} Choice (1-${keyProviders.length}): `, r));
        rl.close();
        const idx = parseInt(pick) - 1;
        if (idx >= 0 && idx < keyProviders.length) {
          const [, envVar, label] = keyProviders[idx];
          const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
          const key = await new Promise(r => rl2.question(`${c("cyan")}🔑${R} Enter ${label} API key: `, r));
          rl2.close();
          if (key.trim()) {
            process.env[envVar] = key.trim();
            _config[envVar] = key.trim();
            try { fs.writeFileSync(resolve(BASE_DIR, "config.json"), JSON.stringify(_config, null, 2)); } catch {}
            console.log(`${c("green")}✓${R} ${label} API key saved to config.json\n`);
            // Re-detect
            const avail2 = await llm.detectProviders();
            const ready2 = Object.entries(avail2).filter(([, v]) => v !== "no").map(([n]) => n);
            if (ready2.length > 0) {
              const best = llm.selectBest(avail2);
              if (best) llm.provider = best;
              process.env.PHANTOM_PROVIDERS_READY = ready2.join(",");
            }
          }
        }
      }
    }
  } catch {}
})();
if (ENV.interactive) await __detection;

const ui = selectUI(am);
ui.start();

process.on("SIGINT", () => {
  if (ui && typeof ui.cancel === "function") {
    ui.cancel();
  } else {
    try { process.stdout.write(show); } catch {} process.exit(0);
  }
});
process.on("SIGTERM", () => { try { process.stdout.write(show); } catch {} process.exit(0); });
process.on("exit", () => {
  if (typeof raw !== "undefined") {
    try { process.stdout.write(show); raw(false); } catch {}
  }
});
