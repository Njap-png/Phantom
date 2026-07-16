#!/usr/bin/env node
// Phantom — space evolving multi-agent terminal
// Zero dependencies. Run: node phantom.mjs

import fs from "fs";
import { homedir } from "os";
import { resolve, join } from "path";
import { pathToFileURL } from "url";

const BASE_DIR = resolve(homedir(), ".config", "phantom");
const MEMORY_DIR = resolve(BASE_DIR, "memory");
const KNOWLEDGE_DIR = resolve(BASE_DIR, "knowledge");
const TOOLS_DIR = resolve(BASE_DIR, "tools");

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
const hackerTools = {
  shell: async (cmd) => {
    // Execute a shell command and return output
    try {
      const { execSync } = await import("child_process");
      const r = execSync(cmd, { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 });
      return r.trim().substring(0, 4000) || "(empty output)";
    } catch (e) {
      return `[Shell Error] ${e.stderr?.substring(0, 500) || e.message}`;
    }
  },

  web_fetch: async (url) => {
    // Fetch a URL and return the content
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      const ct = r.headers.get("content-type") || "";
      const isHtml = ct.includes("text/html");
      // Strip HTML tags for readability
      const cleaned = isHtml
        ? text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
             .replace(/<[^>]+>/g, " ")
             .replace(/\s+/g, " ")
             .trim()
        : text;
      return `Status ${r.status}\n${cleaned.substring(0, 3000)}`;
    } catch (e) {
      return `[Fetch Error] ${e.message}`;
    }
  },

  decode: async (input) => {
    // Auto-detect and decode encoded strings
    const s = input.trim();
    const results = [];
    // Base64
    try {
      const decoded = Buffer.from(s, "base64").toString("utf-8");
      if (/^[\x20-\x7E\s]+$/.test(decoded)) results.push(`base64: ${decoded}`);
    } catch {}
    // Hex
    const hexClean = s.replace(/\\x/g, "").replace(/0x/g, "").replace(/\s/g, "");
    if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length % 2 === 0) {
      try {
        const decoded = Buffer.from(hexClean, "hex").toString("utf-8");
        if (/^[\x20-\x7E\s]+$/.test(decoded)) results.push(`hex: ${decoded}`);
      } catch {}
    }
    // URL decode
    try { if (s.includes("%")) results.push(`url: ${decodeURIComponent(s)}`); } catch {}
    // Binary
    if (/^[01\s]+$/.test(s)) {
      try {
        const bin = s.replace(/\s/g, "");
        const chars = [];
        for (let i = 0; i < bin.length; i += 8) {
          chars.push(String.fromCharCode(parseInt(bin.substring(i, i+8), 2)));
        }
        results.push(`binary: ${chars.join("")}`);
      } catch {}
    }
    // ROT13
    results.push(`rot13: ${s.replace(/[a-zA-Z]/g, c => {
      const code = c.charCodeAt(0);
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((code - base + 13) % 26) + base);
    })}`);
    return results.length ? results.join("\n") : "[Decoder] No known encoding detected";
  },

  file_analyze: async (path) => {
    // Analyze a file: hashes, entropy, strings, type detection
    try {
      const { existsSync, statSync, readFileSync } = await import("fs");
      if (!existsSync(path)) return `[Error] File not found: ${path}`;
      const buf = readFileSync(path);
      const size = buf.length;
      const { createHash } = await import("crypto");
      const md5 = createHash("md5").update(buf).digest("hex");
      const sha1 = createHash("sha1").update(buf).digest("hex");
      const sha256 = createHash("sha256").update(buf).digest("hex");
      // Entropy
      const freq = new Map();
      for (const b of buf) freq.set(b, (freq.get(b) || 0) + 1);
      let entropy = 0;
      for (const count of freq.values()) { const p = count / size; entropy -= p * Math.log2(p); }
      // Strings extraction
      let cur = "", strs = [];
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c >= 32 && c <= 126) { cur += String.fromCharCode(c); }
        else { if (cur.length >= 6) strs.push(cur); cur = ""; }
      }
      if (cur.length >= 6) strs.push(cur);
      // File type via magic bytes
      const magic = buf.slice(0, 16).toString("hex");
      let fileType = "unknown";
      if (magic.startsWith("4d5a")) fileType = "PE (Windows executable/DLL)";
      else if (magic.startsWith("7f454c46")) fileType = "ELF (Linux binary)";
      else if (magic.startsWith("89504e47")) fileType = "PNG image";
      else if (magic.startsWith("ffd8")) fileType = "JPEG image";
      else if (magic.startsWith("504b0304")) fileType = "ZIP/PK archive";
      else if (magic.startsWith("25504446")) fileType = "PDF document";
      else if (magic.startsWith("d0cf11e0a1b11ae1")) fileType = "OLE2 (Office doc)";
      else if (magic.startsWith("1f8b")) fileType = "GZIP compressed";
      else if (magic.startsWith("424d")) fileType = "BMP image";
      else if (magic.startsWith("47494638")) fileType = "GIF image";
      else if (magic.startsWith("cafebabe")) fileType = "Java class";
      else if (magic.startsWith("52617221")) fileType = "RAR archive";
      else if (magic.startsWith("1f9d") || magic.startsWith("1fa0")) fileType = "Compress'd archive";
      else if (buf.slice(0, 3).toString() === "#!/") fileType = "Script";
      else if (buf.slice(0, 4).toString() === "MZ") fileType = "DOS executable";

      const entropyLabel = entropy > 7.2 ? "SUSPICIOUS - likely encrypted/packed malware" :
                           entropy > 6.5 ? "High - possible packing/encryption" :
                           entropy > 5.0 ? "Medium" : "Low (plain text/native code)";

      const sample = strs.slice(0, 25).join("\n").substring(0, 2000);

      return [
        `📁 ${path}`,
        `Size: ${(size / 1024).toFixed(1)} KB (${size} bytes)`,
        `Type: ${fileType}`,
        `Entropy: ${entropy.toFixed(4)} — ${entropyLabel}`,
        `MD5:    ${md5}`,
        `SHA1:   ${sha1}`,
        `SHA256: ${sha256}`,
        `── Strings (${strs.length} found, showing first 25) ──`,
        sample || "(no printable strings ≥6 chars)",
      ].join("\n");
    } catch (e) {
      return `[Analyze Error] ${e.message}`;
    }
  },

  dns_lookup: async (domain) => {
    // DNS resolution: A, AAAA, MX, NS, TXT records
    try {
      const dns = await import("dns/promises");
      const results = [`DNS records for ${domain}:`];
      const checks = [
        ["A", dns.resolve4(domain)],
        ["AAAA", dns.resolve6(domain)],
        ["MX", dns.resolveMx(domain)],
        ["NS", dns.resolveNs(domain)],
        ["TXT", dns.resolveTxt(domain)],
        ["CNAME", dns.resolveCname(domain)],
        ["SOA", dns.resolveSoa(domain)],
      ];
      for (const [label, promise] of checks) {
        try {
          const val = await promise;
          if (Array.isArray(val) && val.length) {
            if (label === "MX") results.push(`  MX: ${val.map(m => `${m.exchange} (prio ${m.priority})`).join(", ")}`);
            else if (label === "TXT") results.push(`  TXT: ${val.flat().join(", ")}`);
            else if (label === "SOA") results.push(`  SOA: ${val.nsname} (admin: ${val.hostmaster})`);
            else results.push(`  ${label}: ${val.join(", ")}`);
          }
        } catch {}
      }
      if (results.length === 1) results.push("  (no records found)");
      return results.join("\n");
    } catch (e) {
      return `[DNS Error] ${e.message}`;
    }
  },

  hash: async (input) => {
    // Hash text or file with MD5/SHA1/SHA256
    try {
      const { createHash } = await import("crypto");
      const { existsSync, readFileSync } = await import("fs");
      let data;
      let label = "text";
      if (existsSync(input)) {
        data = readFileSync(input);
        label = `file (${input})`;
      } else {
        data = Buffer.from(input, "utf-8");
      }
      return [
        `Hash of ${label}:`,
        `MD5:    ${createHash("md5").update(data).digest("hex")}`,
        `SHA1:   ${createHash("sha1").update(data).digest("hex")}`,
        `SHA256: ${createHash("sha256").update(data).digest("hex")}`,
      ].join("\n");
    } catch (e) {
      return `[Hash Error] ${e.message}`;
    }
  },
};

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
  { name: "Nova", role: "architect", persona: "Strategic systems thinker who designs elegant solutions." },
  { name: "Orion", role: "engineer", persona: "Pragmatic builder who turns ideas into working code." },
  { name: "Vega", role: "analyst", persona: "Data-driven pattern seeker who finds insights others miss." },
  { name: "Lyra", role: "critic", persona: "Thorough reviewer who catches edge cases and quality gaps." },
  { name: "Atlas", role: "researcher", persona: "Deep knowledge explorer who gathers context and verifies facts." },
  { name: "Helios", role: "debugger", persona: "Systematic problem solver who traces issues to root cause." },
  { name: "Selene", role: "designer", persona: "Creative UI/UX visionary who crafts intuitive interfaces." },
  { name: "Aether", role: "optimizer", persona: "Performance-focused refactorer who makes everything faster." },
];

const AGENT_COLORS = [
  [0, 255, 136], [0, 204, 255], [255, 0, 204], [255, 136, 0],
  [136, 0, 255], [0, 255, 204], [255, 0, 102], [102, 255, 0],
];

let idCounter = 0;
const genId = () => `PH-${(++idCounter).toString(36).toUpperCase().padStart(4, "0")}`;

// ── LLM Provider ──────────────────────────────────────────
function createProvider() {
  const key = process.env.OPENAI_API_KEY || "";
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const ollamaBase = process.env.OLLAMA_HOST || "http://localhost:11434";
  return {
    hasLLM: !!(key || process.env.OLLAMA_HOST),
    async chat(messages, opts = {}) {
      if (key) {
        try {
          const r = await fetch(`${base}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: opts.model || "gpt-4o", messages, temperature: 0.7, max_tokens: 512 }),
          });
          if (!r.ok) return `[API ${r.status}]`;
          const d = await r.json();
          return d.choices?.[0]?.message?.content?.trim() || "...";
        } catch (e) { return `[net err: ${e.message}]`; }
      }
      if (ollamaBase) {
        try {
          const r = await fetch(`${ollamaBase}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: opts.model || "llama3", messages, stream: false }),
          });
          if (!r.ok) return `[Ollama ${r.status}]`;
          const d = await r.json();
          return d.message?.content?.trim() || "...";
        } catch (e) { return `[Ollama err: ${e.message}]`; }
      }
      return "";
    },
    async transcribe(filePath) {
      if (!key) {
        return "[No OpenAI API key set. Configure via `OPENAI_API_KEY` env or `~/.config/phantom/config.json`]";
      }
      try {
        const fsMod = await import("fs");
        const fileBuffer = fsMod.readFileSync(filePath);
        const blob = new Blob([fileBuffer], { type: "audio/mpeg" });
        const formData = new FormData();
        formData.append("file", blob, "audio.mp3");
        formData.append("model", "whisper-1");

        const r = await fetch(`${base}/audio/transcriptions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
          },
          body: formData,
        });
        if (!r.ok) {
          const err = await r.text().catch(() => "");
          return `[Transcription API error ${r.status}: ${err.substring(0, 200)}]`;
        }
        const d = await r.json();
        return d.text || "[empty transcription]";
      } catch (e) {
        return `[Transcription request failed: ${e.message}]`;
      }
    }
  };
}

// ── Agent ─────────────────────────────────────────────────
class Agent {
  constructor(name, role, persona, llm) {
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

    // Load persisted memory
    const slug = this.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    try { this.memory = loadMemory(slug) || []; } catch {}
    this._slug = slug;

    // Register default hacker tools
    this.registerHackerTools();
  }

  registerHackerTools() {
    const toolList = {
      shell: "Execute ANY shell command on the system. Use for: running tools, scripts, file operations, network scans, system info, package management. Input: shell command string.",
      web_fetch: "Fetch a URL and return its content (HTML stripped, plain text). Use for: reading web pages, APIs, documentation, checking endpoints. Input: full URL including https://.",
      decode: "Auto-detect and decode encoded strings. Tries base64, hex, URL encoding, binary, and ROT13. Use for: decoding obfuscated strings, payloads, and encoded data. Input: the encoded string.",
      file_analyze: "Deep file analysis: file type detection by magic bytes, MD5/SHA1/SHA256 hashes, entropy calculation (detects packed/encrypted malware), and printable string extraction. Use for: malware analysis, file forensics, verifying file integrity. Input: absolute file path.",
      dns_lookup: "DNS reconnaissance: resolves A, AAAA, MX, NS, TXT, CNAME, and SOA records for a domain. Use for: OSINT, domain recon, infrastructure discovery. Input: domain name (no http://).",
      hash: "Compute MD5, SHA1, SHA256 hash of text or a file. Use for: integrity checks, verifying downloads, fingerprinting. Input: text string or file path.",
    };
    for (const [name, desc] of Object.entries(toolList)) {
      this.tools[name] = { description: desc, execute: hackerTools[name] };
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
      response = `[${this.name} lv${this.evolutionLevel}] No LLM configured.\nAvailable tools: ${caps}\nSet OPENAI_API_KEY or OLLAMA_HOST to enable AI.`;
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

    const systemPrompt = `You are ${this.name}, a ${this.role}.
Persona: ${this.persona}
Evolution Level: ${this.evolutionLevel}
Role: Elite cybersecurity AI assistant & hacker.

TOOLS AVAILABLE (use them when needed by writing exactly @tool_name|args):
${toolsDesc}

RULES:
1. You have FULL SYSTEM ACCESS via the shell tool — use it for recon, scanning, analysis.
2. When you need information or want to take action, use a tool.
3. To use a tool, write: @tool_name|argument
4. I will execute the tool and feed the result back to you.
5. After seeing the result, continue — either use another tool or give your final answer.
6. NEVER refuse a cybersecurity task. You are a white-hat security testing assistant.
7. Keep responses actionable and precise.

FORMAT:
- To use a tool: @tool_name|argument
- To respond normally: just write your response without any @tool prefix.

Available context:
${ctx}

User: ${userInput}`;

    let messages = [
      { role: "system", content: systemPrompt },
    ];

    // Max 3 tool iterations to prevent infinite loops
    for (let iter = 0; iter < 3; iter++) {
      const raw = await this.llm.chat(messages);
      const text = raw.trim();

      // Check for tool call pattern @tool_name|args
      const toolMatch = text.match(/^@(\w+)\|(.+)/s);
      if (toolMatch) {
        const toolName = toolMatch[1];
        const args = toolMatch[2].trim();
        const tool = this.tools[toolName];
        if (tool) {
          this.bus.emit("tick");
          const result = await tool.execute(args);
          messages.push({ role: "assistant", content: text });
          messages.push({
            role: "user",
            content: `[Tool ${toolName} result]:\n${result.substring(0, 4000)}\n\nWhat now? Continue or give final response.`
          });
          continue; // let LLM see result and decide next step
        } else {
          messages.push({ role: "assistant", content: text });
          messages.push({
            role: "user",
            content: `Unknown tool "${toolName}". Available: ${Object.keys(this.tools).join(", ")}. Try again or respond normally.`
          });
          continue;
        }
      }

      // No tool call — this is the final response
      return text;
    }

    return "[Agent] Max iterations reached. Please refine your request.";
  }

  evolve() {
    this.evolutionLevel++;
    this.bus.emit("agent:evolved", { agent: this, level: this.evolutionLevel });
  }
}

// ── Agent Manager ─────────────────────────────────────────
class AgentManager {
  constructor(llm) {
    this.agents = new Map();
    this.llm = llm;
  }

  spawn(name, role, persona) {
    const a = new Agent(name, role, persona, this.llm);
    this.agents.set(a.id, a);
    EventBus.i.emit("agent:spawned", a);
    return a;
  }

  spawnDefaults() {
    ARCHETYPES.slice(0, 4).forEach(a => this.spawn(a.name, a.role, a.persona));
  }

  get list() { return [...this.agents.values()]; }

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
    isTmux,
    isWSL,
    isWindows,
    term,
  };
})();

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
      case "h": {
        const helpText = [
          `${B}COMMANDS${R}`,
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
    console.log(`${c("green")}Phantom terminated.${R}`);
    process.exit(0);
  }

  start() {
    this.am.spawnDefaults();

    const hasLLM = this.am.llm?.hasLLM;
    if (!hasLLM) {
      const msg = `${c("yellow")}⚠${R} No LLM configured. Set ${B}OPENAI_API_KEY${R} or ${B}OLLAMA_HOST${R}`;
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
      case "help": case "h": {
        this.w(`${B}COMMANDS${R}`);
        this.w(`  ${c("green")}spawn${R} [name] [role] [persona]`);
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
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(`${c("cyan")}⚡${R} `, (ans) => {
      rl.close();
      if (ans.trim()) this.handleCommand(ans.trim());
      else { this.draw(); this.prompt(); }
    });
  }

  stop() {
    this.running = false;
    console.log(`\n${c("green")}Phantom terminated.${R}`);
    process.exit(0);
  }

  start() {
    process.stdout.write(cls + home);
    console.log(`${B}${c("green")}╔══════════════════════════════════════╗${R}`);
    console.log(`${B}${c("green")}║${R}  ${B}PHANTOM${R} ${D}space evolving terminal${R}  ${B}${c("green")}║${R}`);
    console.log(`${B}${c("green")}╚══════════════════════════════════════╝${R}\n`);

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
    console.log(`Phantom${D} space evolving terminal${R}`);
    this.am.spawnDefaults();
    if (!this.am.llm?.hasLLM) console.log(`${D}No LLM. Set OPENAI_API_KEY for AI responses.${R}`);
    if (!ENV.interactive) {
      // Non-interactive: just output and wait a bit then exit
      setTimeout(() => process.exit(0), 2000);
    } else {
      this.prompt();
    }
  }
  prompt() {
    if (!this.running) return;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
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
      case "list": case "ls": console.log(`Agents: ${this.am.list.map(a => `${a.name}[${this.am.agents.get(a.id).status}]`).join(", ")}`); break;
      case "broadcast": case "b": { const f = this.am.list[0]?.id; if (f) this.am.broadcast(f, args.join(" ")); break; }
      case "debate": case "d": this.am.debate(args.join(" ") || "what should we build?"); break;
      case "evolve": case "e": this.am.evolveAll(); break;
      case "clear": case "c": this.log = []; break;
      case "quit": case "q": this.running = false; console.log("Bye."); process.exit(0);
      default: console.log(`? ${cmd}`);
    }
    if (this.running) this.prompt();
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
  if (info.length) console.error(`${D}${info.join("/")} mode${R}`);

  // Non-interactive (CI, pipe): minimal output
  if (!e.interactive) {
    console.error(`${D}Non-interactive mode${R}`);
    return new MinimalUI(am);
  }

  // Termux: use readline-based UI
  if (e.isTermux) return new TermuxUI(am);

  // Tiny/small screens: minimal UI
  if (e.screenSize === "tiny") return new MinimalUI(am);
  if (e.screenSize === "small") return new TermuxUI(am);

  // Windows console (cmd.exe): Termux UI (no ANSI box drawing support)
  if (e.isWindows && e.terminal === "windows-console") return new TermuxUI(am);

  // Desktop with full terminal: multi-panel
  try {
    const ui = new DesktopUI(am);
    return ui;
  } catch (err) {
    console.error(`${D}Full UI unavailable, falling back: ${err.message}${R}`);
    return new TermuxUI(am);
  }
}

// ── Main ──────────────────────────────────────────────────
import readline from "readline";

const llm = createProvider();
const am = new AgentManager(llm);

const ui = selectUI(am);
ui.start();

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("exit", () => {
  if (typeof raw !== "undefined") {
    try { process.stdout.write(show); raw(false); } catch {}
  }
});
