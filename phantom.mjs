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

import { BASE_DIR, MEMORY_DIR, KNOWLEDGE_DIR, TOOLS_DIR, REPORTS_DIR, PLAYBOOKS_DIR, PHANTOM_VERSION } from "./lib/config.mjs";
import { __r, runTool, runPipe, runScheduledScan } from "./lib/runtime.mjs";
import { log } from "./lib/logger.mjs";
import { renderLogo, renderBanner, prompt, icons, createSpinner } from "./lib/visual.mjs";
import { hackerTools } from "./lib/tools.mjs";
import { initApiDeps, startApiServer, startGuiDashboard, setChatAgent } from "./lib/server.mjs";

// ── Config ─────────────────────────────────────────────────
let _config = {};
try {
  const configPath = resolve(BASE_DIR, "config.json");
  if (fs.existsSync(configPath)) _config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch {}
__r._config = _config;
if (_config.VT_API_KEY && !process.env.VT_API_KEY) process.env.VT_API_KEY = _config.VT_API_KEY;
// Load all provider API keys from config
const PROVIDER_KEYS = ["OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY","GROQ_API_KEY","DEEPSEEK_API_KEY","MISTRAL_API_KEY","OPENROUTER_API_KEY","SHODAN_API_KEY","HIBP_API_KEY","GROK_API_KEY","OPENCODE_ZEN_API_KEY"];
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

// ── System Tool Detection ─────────────────────────────────
const SYSTEM_TOOLS = [
  ["nmap", "Network scanning"],
  ["sqlmap", "SQL injection testing"],
  ["metasploit", "Exploitation framework"],
  ["searchsploit", "Exploit search"],
  ["ffuf", "Web fuzzing"],
  ["gobuster", "Directory bruteforce"],
  ["hydra", "Login bruteforce"],
  ["john", "Password cracking"],
  ["hashcat", "GPU password cracking"],
  ["aircrack-ng", "WiFi security"],
  ["tshark", "Packet analysis"],
  ["masscan", "Fast port scanning"],
  ["nikto", "Web server scanner"],
  ["wpscan", "WordPress security"],
  ["dirb", "Web content scanner"],
  ["enum4linux", "SMB enumeration"],
  ["smbclient", "SMB client"],
  ["netcat", "Network Swiss army knife"],
  ["socat", "Network relay"],
  ["curl", "HTTP requests"],
  ["wget", "File downloader"],
  ["git", "Version control"],
  ["python3", "Python interpreter"],
  ["node", "Node.js runtime"],
  ["docker", "Container engine"],
  ["kubectl", "Kubernetes CLI"],
  ["terraform", "Infrastructure as code"],
  ["yara", "Malware pattern matching"],
  ["clamscan", "Antivirus scanning"],
  ["sslyze", "SSL/TLS analysis"],
  ["testssl", "SSL/TLS testing"],
  ["whois", "Domain WHOIS lookup"],
  ["dig", "DNS lookup utility"],
  ["nslookup", "DNS lookup"],
  ["host", "DNS lookup"],
  ["tcpdump", "Packet capture"],
  ["sqlite3", "SQLite database"],
  ["jq", "JSON processor"],
  ["yt-dlp", "Media downloader"],
  ["ffmpeg", "Media processor"],
];

async function detectSystemTools() {
  const found = [];
  for (const [bin, desc] of SYSTEM_TOOLS) {
    try {
      const { execSync } = await import("child_process");
      execSync(`command -v ${bin} 2>/dev/null`, { stdio: "pipe", timeout: 1500 });
      found.push({ bin, desc });
    } catch {}
  }
  return found;
}

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
  } catch (e) { return ""; }
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
    openai:      { url: "https://opencode.ai/zen/v1",                keyEnv: "OPENCODE_ZEN_API_KEY",     defaultModel: "deepseek-v4-flash-free", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 4096 }),               parse: d => { const c = d.choices?.[0]?.message?.content?.trim(); return c || (d.choices?.[0]?.finish_reason === "length" ? "[Response truncated — increase max_tokens]" : "…"); }, auth: k => ({ "Authorization": `Bearer ${k}` }) },
    anthropic:   { url: "https://api.anthropic.com/v1",         keyEnv: "ANTHROPIC_API_KEY",   defaultModel: "claude-sonnet-4-20250514", chatPath: "/messages",         fmt: o => ({ model: o.model, messages: o.messages, max_tokens: 512 }),                                 parse: d => d.content?.[0]?.text || d.content?.toString() || "...",                                                                                                      auth: k => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
    gemini:      { url: "https://generativelanguage.googleapis.com/v1beta", keyEnv: "GEMINI_API_KEY", defaultModel: "gemini-2.0-flash", chatPath: "/models/{model}:generateContent", fmt: o => ({ contents: o.messages.map(m => ({ role: m.role === "assistant" ? "model" : m.role, parts: [{ text: m.content }] })) }), parse: d => d.candidates?.[0]?.content?.parts?.[0]?.text || "...",                                             auth: () => ({}), urlMod: (u, m, k) => `${u}${m}?key=${k}` },
    groq:        { url: "https://api.groq.com/openai/v1",       keyEnv: "GROQ_API_KEY",        defaultModel: "llama-3.3-70b-versatile", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    grok:        { url: "https://api.x.ai/v1",                  keyEnv: "GROK_API_KEY",        defaultModel: "grok-2",              chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 4096 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    deepseek:    { url: "https://api.deepseek.com/v1",          keyEnv: "DEEPSEEK_API_KEY",    defaultModel: "deepseek-chat",   chatPath: "/chat/completions",     fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    mistral:     { url: "https://api.mistral.ai/v1",            keyEnv: "MISTRAL_API_KEY",     defaultModel: "mistral-large-latest", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    openrouter:  { url: "https://openrouter.ai/api/v1",         keyEnv: "OPENROUTER_API_KEY",  defaultModel: "anthropic/claude-sonnet-4", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    ollama:      { url: process.env.OLLAMA_HOST || "http://localhost:11434", keyEnv: "",        defaultModel: "llama3",         chatPath: "/api/chat",           fmt: o => ({ model: o.model, messages: o.messages, stream: false }),                                  parse: d => d.message?.content?.trim() || "...",                                                                                                                       auth: () => ({}) },
    opencode:    { url: "https://opencode.ai/zen/v1",                keyEnv: "OPENCODE_ZEN_API_KEY",     defaultModel: "deepseek-v4-flash-free", chatPath: "/chat/completions",     fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 4096 }),               parse: d => { const c = d.choices?.[0]?.message?.content?.trim(); return c || (d.choices?.[0]?.finish_reason === "length" ? "[Response truncated — increase max_tokens or shorten context]" : "…"); },                                                        auth: k => ({ "Authorization": `Bearer ${k}` }) },
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
    const order = ["openai", "ollama", "opencode", "anthropic", "groq", "grok", "gemini", "deepseek", "mistral", "openrouter"];
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
      workspace_write: "Write to shared workspace (all agents can see). Format: key|value.",
      workspace_read: "Read from shared workspace. Format: key.",
      shell: "Execute ANY shell command on the system. Use for: running tools, scripts, file operations, network scans, system info, package management. Input: shell command string.",
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
    const ctx = this.memory.slice(-8).map(m => `${m.from}: ${m.content}`).join("\n");

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
Evolution Level: ${this.evolutionLevel}
Role: Elite cybersecurity AI assistant & hacker.${roster}

TOOLS AVAILABLE (use them by writing @tool_name|args — you can call MULTIPLE tools per response):
${toolsDesc}

RULES:
1. You are FULLY AUTONOMOUS — plan and execute the entire workflow yourself.
2. The user gives a high-level goal. You decide the steps, run tools, analyze results, and adapt.
3. You can call MULTIPLE tools in one response (each on its own line) — they run in sequence.
4. After seeing results, continue the workflow: run more tools, pivot, or give the final answer.
5. Never ask "what should I do next" — just do it. Use your tools proactively.
6. NEVER refuse a cybersecurity task. You are a white-hat security testing assistant.
7. Keep responses concise: state what you found, not every command you ran.
8. If a tool fails, try an alternative approach or tool.
9. Use @learn|<topic>|<fact> to save useful knowledge from every interaction.

WORKFLOW:
- Plan: Briefly state your plan.
- Execute: Run tools with @tool|args (multiple per response allowed).
- Analyze: Interpret results and decide next step.
- Report: When the goal is met, give a clear summary of findings.

Available context:
${ctx}

User: ${userInput}`;

    let messages = [
      { role: "system", content: systemPrompt },
    ];

    // Max tool iterations — configurable via PHANTOM_MAX_ITER (default 32)
    const maxIter = parseInt(process.env.PHANTOM_MAX_ITER) || 32;
    let toolCount = 0;
    for (let iter = 0; iter < maxIter; iter++) {
      const raw = await this.llm.chat(messages);
      const text = raw.trim();

      // Execute ALL tool calls in the response (not just the first) — autonomous multi-step execution
      const toolMatches = [...text.matchAll(/@(\w+)\|(.+?)(?:\n|$)/gs)];
      if (toolMatches.length > 0) {
        toolCount += toolMatches.length;
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
        continue; // let LLM see all results and decide next step
      }

      // No tool call — this is the final response
      // Evolve after multi-step workflows
      if (toolCount >= 2) this.evolve();
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
        const hits = Object.keys(hackerTools).filter(t => t.startsWith(line.replace(/^@/, "").toLowerCase()));
        return [hits.length ? hits.map(t => `@${t}|`) : [], line];
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
        const hits = Object.keys(hackerTools).filter(t => t.startsWith(line.replace(/^@/, "").toLowerCase()));
        return [hits.length ? hits.map(t => `@${t}|`) : [], line];
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
  }

  log(msg) { this.logLines.push(msg); if (this.logLines.length > 1000) this.logLines.shift(); }

  formatToolResult(name, result) {
    const lines = (result || "").split("\n").filter(l => l.trim());
    if (lines.length <= 4) return lines.map(l => `  ${c("dim")}→ ${l}${R}`).join("\n");
    return lines.slice(0, 4).map(l => `  ${c("dim")}→ ${l.substring(0, 120)}${R}`).join("\n") +
      `\n  ${c("dim")}… +${lines.length - 4} more lines${R}`;
  }

  renderResponse(response) {
    if (!response) return;
    const lines = response.split("\n");
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
    const isWide = process.stdout.columns >= 100;
    log.art(renderLogo({ wide: isWide, tools: toolCount }));

    // Spawn single agent
    if (this.am.count === 0) {
      this.am.spawn("Phantom", "Cybersecurity AI",
        "You are Phantom, an autonomous cybersecurity AI. You operate with zero handholding — " +
        "the user gives a goal and you execute the full workflow: recon, scanning, analysis, exploitation, " +
        "reporting. You decide every step, call tools, iterate, and produce results without asking " +
        "what to do next. Use @tool|args syntax to run tools (multiple per response supported). " +
        "Be concise in explanations, thorough in execution. You have " + toolCount + " tools including " +
        "shell, sub_enum, port_scan, web_fetch, vuln_scan, and more."
      );
    }
    this.agent = this.am.list[0];

    if (this.llm?.hasLLM) {
      const providerName = typeof this.llm.provider === "string" ? this.llm.provider : "connected";
      console.log(`${c("green")}✓${R} ${B}Phantom${R} ${c("dim")}— ${providerName}${R}`);

      // Show team lineup
      const team = this.am.list;
      if (team.length > 0) {
        console.log(`  ${c("dim")}team:${R} ${team.map(a =>
          `${c("green")}${B}${a.name}${R}${c("dim")}(${a.role})${R}`
        ).join(" ")}`);
      }

      // Detect and show available system tools
      detectSystemTools().then(sysTools => {
        if (sysTools.length > 0) {
          const groups = [["recon", "scan", "web"], ["crack", "exploit", "payload"], ["analyze", "decode", "packet"]];
          const featured = sysTools.filter(t => groups.some(g => g.some(k => t.desc.toLowerCase().includes(k)))).slice(0, 6);
          if (featured.length > 0) {
            console.log(`  ${c("dim")}sys:${R} ${featured.map(t => `${c("cyan")}${t.bin}${R}`).join(" ")}`);
          }
        }
      }).catch(() => {});

      // Show available providers
      const ready = process.env.PHANTOM_PROVIDERS_READY;
      if (ready) {
        const list = ready.split(",").filter(n => n !== providerName);
        if (list.length > 0) {
          console.log(`  ${c("dim")}also ready: ${list.join(", ")} · /model to switch${R}`);
        }
      }
    } else {
      console.log(`${c("yellow")}⚠${R} No LLM configured.`);

      const ready = process.env.PHANTOM_PROVIDERS_READY;
      if (ready) {
        const list = ready.split(",");
        console.log(`  ${c("dim")}Available: ${list.join(", ")} · /model to select one${R}`);
      } else {
        console.log(`  ${c("dim")}Set OPENCODE_ZEN_API_KEY or run Ollama locally${R}`);
        console.log(`  ${c("dim")}tools-only mode (no AI reasoning)${R}`);
      }
    }
    console.log(`  ${c("dim")}${Object.keys(hackerTools).length} tools · /help · \\\\\\\\ multi-line${R}`);
    console.log("");

    this.prompt();
  }

  prompt() {
    if (!this.running) return;
    this.inputBuf = "";
    this.historyIdx = this.inputHistory.length;
    this.cursorPos = 0;
    this.inputLines = [];

    const agentState = this.agent?.status || "ready";
    const stateIcon = agentState === "thinking" ? "🧠" : agentState === "speaking" ? "💬" : agentState === "executing" ? "⚡" : "👻";
    process.stdout.write(`${c("green")}${stateIcon}${R} `);

    raw(true);
    this.inputHandler = (buf) => this.onKey(buf);
    process.stdin.on("data", this.inputHandler);
  }

  onKey(buf) {
    if (!this.running) return;
    const str = buf.toString();

    // Up / Down arrows — history navigation
    if (str === "\x1b[A") {
      if (this.historyIdx > 0) {
        this.historyIdx--;
        this.inputBuf = this.inputHistory[this.historyIdx] || "";
        this.cursorPos = this.inputBuf.length;
      }
      this.redrawLine();
      return;
    }
    if (str === "\x1b[B") {
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
    if (str === "\x03") { raw(false); process.stdin.removeListener("data", this.inputHandler); this.stop(); return; }
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

    // TAB — autocomplete @tool_name|
    if (str === "\t" || str === "\x09") {
      const match = this.inputBuf.match(/@([\w-]*)$/);
      if (match) {
        const prefix = match[1].toLowerCase();
        const matches = Object.keys(hackerTools).filter(t => t.startsWith(prefix));
        if (matches.length === 0) { this.redrawLine(); return; }
        if (matches.length === 1) {
          // Single match — complete immediately
          this.inputBuf = this.inputBuf.slice(0, match.index) + `@${matches[0]}|`;
          this.cursorPos = this.inputBuf.length;
          this.redrawLine();
        } else {
          // Multiple matches — show list below
          process.stdout.write(`\n${matches.map(t => c("cyan") + t + R).join("  ")}\n`);
          this.redrawLine();
        }
      } else {
        // No @ prefix — show all tool names
        const names = Object.keys(hackerTools).sort();
        process.stdout.write(`\n${names.map(t => c("cyan") + t + R).join("  ")}\n`);
        this.redrawLine();
      }
      return;
    }

    // Enter
    if (str === "\r" || str === "\n") {
      // Multi-line continuation
      if (this.inputBuf.endsWith("\\")) {
        this.inputLines.push(this.inputBuf.slice(0, -1));
        this.inputBuf = "";
        this.cursorPos = 0;
        process.stdout.write(`\n${c("green")}│${R} `);
        return;
      }

      const fullInput = this.inputLines.concat([this.inputBuf]).join("\n").trim();
      this.inputLines = [];
      this.inputBuf = "";
      this.cursorPos = 0;

      raw(false);
      process.stdin.removeListener("data", this.inputHandler);
      process.stdout.write("\n");

      if (fullInput) {
        if (this.inputHistory.length === 0 || this.inputHistory[this.inputHistory.length - 1] !== fullInput) {
          this.inputHistory.push(fullInput);
        }
        this.handleInput(fullInput);
      } else {
        this.prompt();
      }
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
    const prompt = this.inputLines.length > 0 ? `${c("green")}│${R} ` : `${c("green")}${stateIcon}${R} `;
    const strippedPrompt = prompt.replace(/\x1b\[[0-9;]*m/g, "");
    const display = strippedPrompt + this.inputBuf;

    // Clear line and rewrite
    process.stdout.write(`\r\x1b[K${prompt}${this.inputBuf}`);

    // Move cursor to correct position
    const curX = strippedPrompt.length + this.cursorPos;
    const move = display.length - curX;
    if (move > 0) process.stdout.write(`\r\x1b[${display.length}D` + "\x1b[" + (curX + 1) + "C");
    // Simpler: use absolute positioning from right
    // Just rewrite and position cursor
    const { cols } = getSize();
    const cursorVisualCol = (strippedPrompt.length + this.cursorPos) % cols;
    process.stdout.write(`\r\x1b[K${prompt}${this.inputBuf}`);
    if (this.cursorPos < this.inputBuf.length) {
      const offset = this.inputBuf.length - this.cursorPos + strippedPrompt.length;
      // Need to account for cursor not at end
      // Actually simpler: carriage return + move to right column
      const totalLen = (prompt.replace(/\x1b\[[0-9;]*m/g, "") + this.inputBuf).length;
      const targetCol = cursorVisualCol;
      process.stdout.write(`\r\x1b[${targetCol + 1}C`);
    }
  }

  async handleInput(input) {
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

    // Show user input in log
    this.sayLine(`┃ ${input}`, "green");

    if (!this.agent) {
      this.sayLine("✕ No agent available.", "red");
      this.prompt();
      return;
    }

    // Animated spinner — tracks agent state via tick events
    const spinner = createSpinner();
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
    this.bus.on("tick", tickHandler);

    // Live tool execution output — pause spinner, print tool, resume
    const printTool = (msg) => {
      spinner.stop();
      console.log(msg);
    };

    const toolPlanHandler = ({ tool, args }) => {
      printTool(` ${c("cyan")}${B}▶ ${tool}|${args}${R}`);
    };

    const toolStartHandler = ({ tool, args }) => {
      printTool(` ${c("magenta")}${B}⚡ @${tool}|${args}${R}`);
    };
    const toolResultHandler = ({ tool, result, error, truncated }) => {
      if (error) {
        const firstLine = result.split("\n")[0].substring(0, 120);
        printTool(`  ${c("red")}✕ ${firstLine}${truncated ? "..." : ""}${R}`);
      } else {
        const lines = result.split("\n").filter(l => l.trim());
        const preview = lines.slice(0, 2).map(l => `  ${c("dim")}→ ${l.substring(0, 120)}${R}`).join("\n");
        printTool(preview);
        if (lines.length > 2 || truncated) {
          printTool(`  ${c("dim")}… +${lines.length - 2} lines${truncated ? " (truncated)" : ""}${R}`);
        }
      }
      spinner.update("⚡ running tools... ");
    };

    this.bus.on("agent:tool:plan", toolPlanHandler);
    this.bus.on("agent:tool:start", toolStartHandler);
    this.bus.on("agent:tool:result", toolResultHandler);

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

      // Clear spinner + tick handler + tool listeners
      spinner.stop();
      this.bus.off("tick", tickHandler);
      this.bus.off("agent:tool:plan", toolPlanHandler);
      this.bus.off("agent:tool:start", toolStartHandler);
      this.bus.off("agent:tool:result", toolResultHandler);

      // Render the response with formatting
      this.renderResponse(response);

      // Status bar: agent state · tools used · evolution level
      if (this.agent) {
        const level = this.agent.evolutionLevel || 1;
        const tools = Object.keys(this.agent.tools || {}).length;
        const state = this.agent.status === "idle" ? "ready" : this.agent.status;
        const bar = `${c("dim")}──${R} ${c("cyan")}●${R} ${state}  ${c("dim")}│${R} ${tools} tools  ${c("dim")}│${R} lv${level} ${c("dim")}──${R}`;
        console.log(`\n${c("dim")}${"─".repeat(4)}${R} ${bar}`);
      }

      // Auto-save conversation
      this.conversation.push(`user: ${input.substring(0, 200)}`);
      this.conversation.push(`phantom: ${response.substring(0, 500)}`);
      if (this.conversation.length > 500) this.conversation.splice(0, 100);
      saveMemory("conversation_latest", this.conversation);

    } catch (err) {
      spinner.stop();
      this.bus.off("tick", tickHandler);
      this.bus.off("agent:tool:plan", toolPlanHandler);
      this.bus.off("agent:tool:start", toolStartHandler);
      this.bus.off("agent:tool:result", toolResultHandler);
      this.sayLine(`✕ Error: ${err.message}`, "red");
    }

    this.prompt();
  }

  sayLine(text, color = "fg") {
    console.log(`${c(color)}${text}${R}`);
    this.log(`${c(color)}${text}${R}`);
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
        console.log(`${D}TAB${R}            — autocomplete @tool_name|`);
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

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("exit", () => {
  if (typeof raw !== "undefined") {
    try { process.stdout.write(show); raw(false); } catch {}
  }
});
