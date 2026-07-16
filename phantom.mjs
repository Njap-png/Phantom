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
const REPORTS_DIR = resolve(BASE_DIR, "reports");

// ── Config ─────────────────────────────────────────────────
let _config = {};
try {
  const configPath = resolve(BASE_DIR, "config.json");
  if (fs.existsSync(configPath)) _config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch {}
if (_config.VT_API_KEY && !process.env.VT_API_KEY) process.env.VT_API_KEY = _config.VT_API_KEY;

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
      const needsLLM = !process.env.OPENAI_API_KEY && !process.env.OLLAMA_HOST;
      return [
        `╔══════════════════════════════════════╗`,
        `║  PHANTOM — Cybersecurity Assistant   ║`,
        `╚══════════════════════════════════════╝`,
        ``,
        `Version:  ${pkg.version || "dev"}`,
        `Runtime:  Node.js ${process.version}`,
        `Platform: ${process.platform} ${process.arch}`,
        `Project:  ${phantomDir}`,
        ``,
        `📦 ${names.length} Tools:`,
        `  ${names.join(", ")}`,
        ``,
        `🤖 ${needsLLM ? "LLM: Not connected (demo mode)" : process.env.OPENAI_API_KEY ? "LLM: OpenAI" : "LLM: Ollama"}`,
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

// ── CLI One-Shot Mode ─────────────────────────────────────
const args = process.argv.slice(2);
if (args.length > 0 && !args[0].startsWith("--")) {
  // No --flag: pass as interactive input to phantom
} else if (args.length > 0) {
  const flag = args[0].replace("--", "");
  const input = args.slice(1).join(" ") || "";

  if (flag === "help" || flag === "h") {
    console.log(`Phantom — Cybersecurity AI Assistant

Usage:
  node phantom.mjs                          Interactive mode
  node phantom.mjs --recon <domain>         Full recon (7 steps + report)
  node phantom.mjs --tool <name> <input>    Run one tool directly
  node phantom.mjs --list                   List all tools
  node phantom.mjs --help                   This help

Examples:
  node phantom.mjs --recon example.com
  node phantom.mjs --tool port_scan scanme.org
  node phantom.mjs --tool cve_search "apache 2.4.49"
  node phantom.mjs --tool bruteforce "ssh|192.168.1.1|root|admin,toor,123"`);
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
