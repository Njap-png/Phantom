import fs from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { createRequire } from "module";
const $r = createRequire(import.meta.url);
import { BASE_DIR, MEMORY_DIR, REPORTS_DIR, PLAYBOOKS_DIR } from "./config.mjs";
import { __r } from "./runtime.mjs";

export const hackerTools = {
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
      const provs = ["openai","anthropic","gemini","groq","deepseek","mistral","openrouter","ollama"];
      const envs = {openai:"OPENAI_API_KEY",anthropic:"ANTHROPIC_API_KEY",gemini:"GEMINI_API_KEY",groq:"GROQ_API_KEY",deepseek:"DEEPSEEK_API_KEY",mistral:"MISTRAL_API_KEY",openrouter:"OPENROUTER_API_KEY",ollama:""};
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
    const Db = [
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
      { id:"race-condition", t:"Race Condition", s:"Medium", d:"TOCTOU bugs where concurrent requests exploit gaps between check and use.", i:"Coupon abuse, ticket scalping, balance manipulation", test:["50 concurrent requests","Race password change","File upload race","Last-byte sync","Single-packet attack"], m:"Database transactions/locks, atomic operations, idempotency keys, rate limiting", tools:"Turbo Intruder (Burp), race-the-web" }
    ];
    if (q === "list") return `📚 PHANTOM HACKBOOK\n\nCategories (${Db.length}):\n${Db.map(e => `  ${e.t} — ${e.s}`).join("\n")}\n\nUsage: @hackbook|<category>\nExample: @hackbook|sql-injection`;
    const matches = Db.filter(e => e.id.includes(q) || e.t.toLowerCase().includes(q) || e.d.toLowerCase().includes(q));
    if (!matches.length) return `[hackbook] No results for "${q}". Try: ${Db.map(e=>e.id).join(", ")}`;
    if (matches.length > 1) return `[hackbook] Multiple: ${matches.map(e=>e.t).join(", ")}. Be specific.`;
    const e = matches[0];
    return `📚 ${e.t}\n${"=".repeat(40)}\nSeverity: ${e.s}\n\n📖 ${e.d}\n\n⚠️ Impact:\n${e.i}\n\n🔍 Testing:\n${e.test.map((s,i) => `  ${i+1}. ${s}`).join("\n")}\n\n🛡️ Mitigation:\n${e.m}\n\n🔧 Tools:\n${e.tools}\n${"=".repeat(40)}`;
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

  install: async (tool) => {
    const name = tool.trim().toLowerCase();
    if (!name) return "[install] Usage: @install|tool_name. Tools: nmap, sqlmap, metasploit, searchsploit, ffuf, hydra, john, gobuster, nikto, wireshark, subfinder, katana, amass, httpx, nuclei, dnsx, gau, gitleaks, s3scanner";
    const pmap = {
      nmap:"nmap", sqlmap:"sqlmap", metasploit:"metasploit-framework", searchsploit:"exploitdb",
      ffuf:"ffuf", hydra:"hydra", john:"john", gobuster:"gobuster", nikto:"nikto",
      wireshark:"tshark", dnsutils:"dnsutils", netcat:"netcat-openbsd", curl:"curl",
      wget:"wget", git:"git", python3:"python3", nodejs:"nodejs", ruby:"ruby",
      perl:"perl", masscan:"masscan", dirb:"dirb", whatweb:"whatweb", wafw00f:"wafw00f",
      subfinder:"subfinder", katana:"katana", amass:"amass", httpx:"httpx",
      nuclei:"nuclei", dnsx:"dnsx", gau:"gau", gitleaks:"gitleaks", s3scanner:"s3scanner",
    };
    const pkg = pmap[name] || name;
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
    if (parts.length < 3) return "[schedule] Usage: @schedule|interval|tool|target\nInterval: daily, hourly, 30m, 10m, or cron '0 9 * * *'\nExample: @schedule|daily|recon|example.com";
    const [interval, tool, ...targetParts] = parts;
    const target = targetParts.join("|");
    try {
      let ms = 0;
      if (interval === "daily") ms = 86400000;
      else if (interval === "hourly") ms = 3600000;
      else if (interval.match(/^(\d+)m$/)) ms = parseInt(interval) * 60000;
      else if (interval.match(/^(\d+)h$/)) ms = parseInt(interval) * 3600000;
      else return `[schedule] Unknown interval: "${interval}". Use: daily, hourly, 30m, 10m, 1h`;
      if (!hackerTools[tool]) return `[schedule] Unknown tool: "${tool}"`;
      const sid = setInterval(async () => {
        try { await hackerTools[tool](target); } catch {}
      }, ms);
      // Store for management
      if (!globalThis.__phantomSchedules) globalThis.__phantomSchedules = [];
      const id = globalThis.__phantomSchedules.length;
      globalThis.__phantomSchedules.push({ id, interval, tool, target, sid });
      const next = new Date(Date.now() + ms);
      return `⏰ Scheduled: ${tool} on ${target} every ${interval}\nNext run: ${next.toLocaleString()}\nID: ${id} (use @agent_memory to manage)`;
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

  katana: async (input) => {
    // External: katana — Fast web crawler by ProjectDiscovery
    try {
      const { execFileSync } = await import("child_process");
      const parts = input.trim().split(/\s+/);
      if (!parts.length || !parts[0]) return `[katana] Usage: @katana|<url> [options]
  Options (appended to args):
    @katana|https://example.com                         Basic crawl
    @katana|https://example.com -d 3                    Crawl depth 3
    @katana|https://example.com -rl 50                  Rate limit 50 req/s
    @katana|https://example.com -kf                     Keep original URL path fragments
    @katana|https://example.com -jc                     Extract JS endpoints
  Pipe to @web_links or use grep to filter results.`;
      const url = parts[0];
      const extra = parts.slice(1);
      // Check if katana is installed
      try { execFileSync("which", ["katana"], { encoding: "utf-8", timeout: 5000 }); }
      catch { return `[katana] NOT INSTALLED — install with:
  Go: go install github.com/projectdiscovery/katana/cmd/katana@latest
  Or via @install|katana (if available in your package manager)`.trim(); }
      const args = ["-u", url, "-silent", "-o", "/dev/stdout", ...extra];
      const out = execFileSync("katana", args, { encoding: "utf-8", timeout: 60000, maxBuffer: 2*1024*1024 });
      const lines = out.trim().split("\n").filter(Boolean);
      if (!lines.length) return `[katana] 0 URLs found for ${url}`;
      // Deduplicate and return
      const unique = [...new Set(lines)];
      const result = [`🔎 Katana Crawl: ${url}`, `URLs found: ${unique.length}`];
      // Show first 50, note if truncated
      const display = unique.slice(0, 50);
      result.push(...display.map(u => `  ${u}`));
      if (unique.length > 50) result.push(`  ... and ${unique.length - 50} more`);
      return result.join("\n");
    } catch (e) { return `[katana Error] ${e.message}`; }
  },

  subfinder: async (input) => {
    // External: subfinder — Passive subdomain discovery by ProjectDiscovery
    try {
      const { execFileSync } = await import("child_process");
      const parts = input.trim().split(/\s+/);
      if (!parts.length || !parts[0]) return `[subfinder] Usage: @subfinder|<domain> [options]
  Options:
    @subfinder|example.com                              Passive enumeration
    @subfinder|example.com -all                         Use all sources (slow but thorough)
    @subfinder|example.com -silent                      Minimal output (just subdomains)
  Sources: crt.sh, certspotter, dnsdumpster, hackertarget, threatcrowd, etc.
  Use @sub_enum for API-only mode (no external install needed).`;
      const domain = parts[0];
      const extra = parts.slice(1);
      // Check if subfinder is installed
      try { execFileSync("which", ["subfinder"], { encoding: "utf-8", timeout: 5000 }); }
      catch { return `[subfinder] NOT INSTALLED — install with:
  Go: go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
  Or via @install|subfinder (if available in your package manager)`.trim(); }
      const args = ["-d", domain, "-oJ", ...extra];
      const out = execFileSync("subfinder", args, { encoding: "utf-8", timeout: 120000, maxBuffer: 2*1024*1024 });
      const lines = out.trim().split("\n").filter(Boolean);
      if (!lines.length) return `[subfinder] 0 subdomains found for ${domain}`;
      // Parse JSON lines or plain text
      const subs = lines.map(l => { try { return JSON.parse(l).host || l; } catch { return l; } });
      const unique = [...new Set(subs)].sort();
      const result = [`🔎 Subfinder: ${domain}`, `Subdomains: ${unique.length}`];
      const display = unique.slice(0, 100);
      result.push(...display.map(s => `  ${s}`));
      if (unique.length > 100) result.push(`  ... and ${unique.length - 100} more`);
      return result.join("\n");
    } catch (e) { return `[subfinder Error] ${e.message}`; }
  },

  ffuf: async (input) => {
    // External: ffuf — Fast web fuzzer by Joohansson
    try {
      const { execFileSync, execSync } = await import("child_process");
      const parts = input.trim().split(/\s+/);
      if (!parts.length || !parts[0]) return `[ffuf] Usage: @ffuf|<args>
  Examples:
    @ffuf|-u https://example.com/FUZZ -w /usr/share/wordlists/dirb/common.txt
    @ffuf|-u https://example.com?file=FUZZ -w params.txt -mc 200,302
    @ffuf|-u https://example.com/FUZZ -w common -fc 404          (use built-in wordlists)
    @ffuf|-u https://example.com/FUZZ -w common -recursion       (recurse into dirs)
    @ffuf|-u https://example.com/FUZZ -w common -ac              (auto-calibrate)
  Built-in wordlists: common, admin, backup, params, php, asp, jsp
  Pipe results: @ffuf|-u https://URL/FUZZ -w common -o /dev/stdout -of json
  Bypass built-in list: use absolute path to custom wordlist`;
      try { execFileSync("which", ["ffuf"], { encoding: "utf-8", timeout: 5000 }); }
      catch { return `[ffuf] NOT INSTALLED — install with:
  Go: go install github.com/ffuf/ffuf/v2@latest
  Or: apt install ffuf (Kali/Parrot), brew install ffuf (macOS)`.trim(); }
      // Resolve built-in wordlist shortcuts
      const WORDLISTS = {
        common: "admin,backup,config,css,data,db,dev,dist,downloads,error,favicon.ico,fonts,images,img,includes,index.html,js,lib,login,logs,media,old,phpinfo.php,private,robots.txt,sitemap.xml,sql,src,static,status,test,tmp,upload,vendor,wp-admin,wp-content,wp-includes,xmlrpc.php",
        admin: "admin,administrator,cp,cpanel,dashboard,manager,panel,root,super,webadmin,wp-admin,admin.php,login,login.php,console,phpmyadmin,phpPgAdmin,adminer,mysql,pma,admin/,backend,api,management,control,sysadmin,webmaster,moderator,adm",
        backup: ".git/config,.env,backup.sql,backup.zip,backup.tar.gz,db.sql,dump.sql,config.php.bak,config.bak,composer.json,package.json,package-lock.json,yarn.lock,credentials.txt,password.txt,secret.txt,token.txt,key.pem,private.key,id_rsa,wp-config.php.bak,db_backup.sql,app.log,error.log,access.log,install.log,debug.log",
        params: "id,page,file,path,url,redirect,return,next,go,target,cmd,exec,command,action,do,method,type,option,debug,test,token,key,api_key,secret,auth,password,pass,user,username,name,email,search,q,query,s,folder,dir,include,require,template,theme,view,load,read,download,upload,img,image,src,callback,jsonp,format,lang,locale",
        php: "index.php,config.php,wp-config.php,db.php,login.php,admin.php,api.php,ajax.php,cron.php,setup.php,install.php,upload.php,download.php,search.php,logout.php,register.php,profile.php,settings.php,edit.php,delete.php,view.php,list.php,page.php,post.php,comment.php,user.php,export.php,import.php,backup.php,restore.php,test.php,info.php,phpinfo.php,status.php,health.php,ping.php,shell.php,cmd.php,exec.php,rce.php",
        asp: "default.asp,index.asp,login.asp,admin.asp,config.asp,global.asa,web.config,iisstart.asp",
        jsp: "index.jsp,login.jsp,admin.jsp,manager.jsp,examples/,jsp-examples/,servlets-examples/,web-inf/,WEB-INF/web.xml,WEB-INF/struts-config.xml",
      };
      const args = parts;
      const wIdx = args.indexOf("-w");
      if (wIdx >= 0 && wIdx + 1 < args.length && WORDLISTS[args[wIdx + 1].toLowerCase()]) {
        // Replace wordlist name with inline contents
        const wlName = args[wIdx + 1].toLowerCase();
        args[wIdx + 1] = WORDLISTS[wlName];
        args.push("-fc", "404");
      }
      // Run ffuf with default json output for parsing
      if (!args.includes("-o")) args.push("-o", "/dev/stdout", "-of", "json");
      args.push("-s"); // silent progress
      const out = execFileSync("ffuf", args, { encoding: "utf-8", timeout: 120000, maxBuffer: 2*1024*1024 });
      // Parse JSON output
      let parsed;
      try { parsed = JSON.parse(out); } catch { return `[ffuf] Raw output:\n${out.slice(0,2000)}`; }
      const results = parsed.results || [];
      if (!results.length) return `[ffuf] No results (try -fc, -fs filters, or adjust wordlist)`;
      const lines = [`⚡ FFUF Fuzz — ${results[0]?.input?.FUZZ || ""}`, `Total: ${parsed.total || results.length} results | Duration: ${((parsed.time || 0)/1000).toFixed(1)}s`];
      // Sort by status code, group
      const byStatus = {};
      for (const r of results) {
        const sc = r.status || 0;
        if (!byStatus[sc]) byStatus[sc] = [];
        if (byStatus[sc].length < 15) byStatus[sc].push(r);
      }
      for (const [sc, items] of Object.entries(byStatus).sort((a,b)=>a[0]-b[0])) {
        lines.push(`\n  ${sc} (${items.length}+):`);
        for (const r of items) {
          const len = r.content_length ? ` [${(r.content_length/1024).toFixed(1)}K]` : "";
          const redirect = r.redirect ? ` → ${r.redirect}` : "";
          lines.push(`    ${r.input?.FUZZ || r.url?.slice(0,80) || ""}${len}${redirect}`);
        }
      }
      return lines.join("\n");
    } catch (e) { return `[ffuf Error] ${e.message}`; }
  },
  // ── MORE EXTERNAL TOOLS ─────────────────────────────────

  httpx: async (input) => {
    // httpx — Probe for alive hosts (ProjectDiscovery)
    try {
      const { execFileSync } = await import("child_process");
      if (!input || !input.trim()) return `[httpx] Usage: @httpx|<domain_or_file> [options]
  Probes for alive web servers. Pipes subfinder output directly:
    @httpx|example.com                              Probe with default
    @httpx|example.com -mc 200,302                  Filter by status code
    @httpx|subs.txt -sc -title                      Check file and show status/title
    @httpx|example.com -path /admin                 Check specific path
    @httpx|example.com -threads 100 -rate-limit 50  Performance tuning
    @httpx|example.com -silent -o /dev/stdout       Machine-readable output`;
      try { execFileSync("which",["httpx"],{encoding:"utf-8",timeout:5000}); } catch { return `[httpx] NOT INSTALLED — install:
  Go: go install github.com/projectdiscovery/httpx/cmd/httpx@latest`; }
      const parts = input.trim().split(/\s+/);
      const target = parts[0];
      const extra = parts.slice(1);
      if (!extra.includes("-l") && !extra.includes("-list")) {
        const result = execFileSync("httpx", ["-l","/dev/stdin",...extra,"-o","/dev/stdout"], { input:target, encoding:"utf-8",timeout:60000,maxBuffer:1024*1024 });
        const lines = result.trim().split("\n").filter(Boolean);
        if (!lines.length) return `[httpx] No alive hosts for ${target}`;
        return [`🔎 Httpx: ${target}`,`Alive: ${lines.length}`,...lines.slice(0,50).map(l=>`  ${l}`),...(lines.length>50?[`  ... and ${lines.length-50} more`]:[])].join("\n");
      }
      const result = execFileSync("httpx", [...parts,...extra,"-o","/dev/stdout"], {encoding:"utf-8",timeout:120000,maxBuffer:2*1024*1024});
      return result.trim() || "[httpx] No results";
    } catch(e) { return `[httpx Error] ${e.message}`; }
  },

  nuclei: async (input) => {
    // nuclei — Template-based vulnerability scanner (ProjectDiscovery)
    try {
      const { execFileSync } = await import("child_process");
      if (!input || !input.trim()) return `[nuclei] Usage: @nuclei|<target_or_file> [options]
  Examples:
    @nuclei|https://example.com                         Scan single URL
    @nuclei|https://example.com -t cves/                Only CVE templates
    @nuclei|https://example.com -t exposures/           Exposure checks
    @nuclei|https://example.com -severity critical,high Critical+high only
    @nuclei|targets.txt -bulk-size 25                   Batch from file
    @nuclei|https://example.com -rl 50 -c 10            Rate-limit
    @nuclei|https://example.com -json -o results.json   JSON output`;
      try { execFileSync("which",["nuclei"],{encoding:"utf-8",timeout:5000}); } catch { return `[nuclei] NOT INSTALLED — install:
  Go: go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
  Or: brew install nuclei (macOS)`; }
      const parts = input.trim().split(/\s+/);
      const target = parts[0];
      const extra = parts.slice(1);
      try { execFileSync("nuclei",["-ut","-silent"],{encoding:"utf-8",timeout:30000}); } catch {}
      const out = execFileSync("nuclei", ["-u",target,"-o","/dev/stdout","-silent",...extra], {encoding:"utf-8",timeout:180000,maxBuffer:2*1024*1024});
      const lines = out.trim().split("\n").filter(Boolean);
      if (!lines.length) return `[nuclei] No findings for ${target} — try different template or severity filter`;
      const result = [`🔬 Nuclei: ${target}`, `Findings: ${lines.length}`];
      const display = lines.slice(0, 100);
      result.push(...display.map(l=>`  ${l}`));
      if (lines.length > 100) result.push(`  ... and ${lines.length - 100} more`);
      return result.join("\n");
    } catch(e) { return `[nuclei Error] ${e.message}`; }
  },

  amass: async (input) => {
    // amass — Subdomain enumeration (OWASP)
    try {
      const { execFileSync } = await import("child_process");
      if (!input || !input.trim()) return `[amass] Usage: @amass|<domain> [mode] [options]
  Modes: enum (default) | intel | db
  Examples:
    @amass|example.com                               Basic enumeration
    @amass|example.com enum -active                  Active enumeration (faster, more results)
    @amass|example.com enum -brute                   Brute-force subdomains (takes longer)
    @amass|example.com enum -passive                 Passive only (no direct DNS queries)
    @amass|example.com intel -whois                  Domain intel from WHOIS
    @amass|example.com enum -o subs.txt              Save results`;
      try { execFileSync("which",["amass"],{encoding:"utf-8",timeout:5000}); } catch { return `[amass] NOT INSTALLED — install:
  Go: go install github.com/owasp-amass/amass/v4/...@master
  Or: brew install amass (macOS)`; }
      const parts = input.trim().split(/\s+/);
      const domain = parts[0];
      const mode = parts.length > 1 && ["enum","intel","db"].includes(parts[1]) ? parts[1] : "enum";
      const extra = mode === "enum" ? parts.slice(1).filter((_,i)=>i!==0 && parts[i]!==mode) : parts.slice(2);
      const args = mode === "enum" ? ["enum","-d",domain,"-json","/dev/stdout","-silent",...extra]
                  : mode === "intel" ? ["intel","-d",domain,"-json","/dev/stdout","-silent",...extra]
                  : ["db","-d",domain,"-json","/dev/stdout","-silent",...extra];
      const out = execFileSync("amass", args, {encoding:"utf-8",timeout:180000,maxBuffer:2*1024*1024});
      const lines = out.trim().split("\n").filter(Boolean);
      if (!lines.length) return `[amass] 0 results for ${domain}`;
      const names = lines.map(l => { try { return JSON.parse(l).name||l; } catch { return l; } }).filter(Boolean);
      const unique = [...new Set(names)].sort();
      const display = unique.slice(0, 100);
      const result = [`🔎 Amass ${mode}: ${domain}`, `Results: ${unique.length}`];
      result.push(...display.map(s=>`  ${s}`));
      if (unique.length > 100) result.push(`  ... and ${unique.length - 100} more`);
      return result.join("\n");
    } catch(e) { return `[amass Error] ${e.message}`; }
  },

  gau: async (input) => {
    // gau — Get All URLs from Wayback Machine/AlienVault/CommonCrawl
    try {
      const { execFileSync } = await import("child_process");
      if (!input || !input.trim()) return `[gau] Usage: @gau|<domain> [options]
  Examples:
    @gau|example.com                                  Get all known URLs
    @gau|example.com -subs                            Include subdomains
    @gau|example.com --providers wayback               Only Wayback Machine
    @gau|example.com -o urls.txt                      Save to file
    @gau|example.com | grep -E '\\.js$|\\.json$'       Filter by extension
  Sources: Wayback Machine, AlienVault OTX, CommonCrawl, URLScan`;
      try { execFileSync("which",["gau"],{encoding:"utf-8",timeout:5000}); } catch { return `[gau] NOT INSTALLED — install:
  Go: go install github.com/lc/gau/v2/cmd/gau@latest
  Or: go install github.com/tomnomnom/waybackurls@latest (alternative: @wayback)`; }
      const parts = input.trim().split(/\s+/);
      const domain = parts[0].replace(/^https?:\/\//,"").replace(/\/.*$/,"");
      const extra = parts.slice(1);
      const out = execFileSync("gau", ["--o","/dev/stdout",domain,...extra], {encoding:"utf-8",timeout:120000,maxBuffer:5*1024*1024});
      const lines = out.trim().split("\n").filter(Boolean);
      if (!lines.length) return `[gau] 0 URLs for ${domain}`;
      const unique = [...new Set(lines)];
      const result = [`🔎 Gau: ${domain}`, `URLs: ${unique.length}`];
      const display = unique.slice(0, 80);
      result.push(...display.map(u=>`  ${u}`));
      if (unique.length > 80) result.push(`  ... and ${unique.length - 80} more`);
      return result.join("\n");
    } catch(e) { return `[gau Error] ${e.message}`; }
  },

  dnsx: async (input) => {
    // dnsx — DNS resolution toolkit (ProjectDiscovery)
    try {
      const { execFileSync } = await import("child_process");
      if (!input || !input.trim()) return `[dnsx] Usage: @dnsx|<domain_or_file> [options]
  Examples:
    @dnsx|example.com                                 Basic DNS resolution
    @dnsx|example.com -a -aaaa -cname                 Show all record types
    @dnsx|subs.txt -resp                              Resolve from file + show IPs
    @dnsx|example.com -silent -o /dev/stdout          Quiet output
    @dnsx|example.com -recon                          Full DNS recon`;
      try { execFileSync("which",["dnsx"],{encoding:"utf-8",timeout:5000}); } catch { return `[dnsx] NOT INSTALLED — install:
  Go: go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest`; }
      const parts = input.trim().split(/\s+/);
      const target = parts[0];
      const extra = parts.slice(1);
      const out = execFileSync("dnsx", ["-d",target,"-o","/dev/stdout",...extra], {encoding:"utf-8",timeout:60000,maxBuffer:1024*1024});
      const lines = out.trim().split("\n").filter(Boolean);
      if (!lines.length) return `[dnsx] 0 records for ${target}`;
      return [`🔎 Dnsx: ${target}`, `Records: ${lines.length}`,...lines.slice(0,50).map(l=>`  ${l}`)].join("\n");
    } catch(e) { return `[dnsx Error] ${e.message}`; }
  },

  gitleaks: async (input) => {
    // gitleaks — Git repository secret scanner
    try {
      const { execFileSync } = await import("child_process");
      if (!input || !input.trim()) return `[gitleaks] Usage: @gitleaks|<path_or_repo> [options]
  Examples:
    @gitleaks|.                                      Scan current directory
    @gitleaks|/path/to/repo                           Scan specific repo
    @gitleaks|https://github.com/user/repo.git        Scan remote repo
    @gitleaks|. --verbose                             Verbose output
    @gitleaks|. --no-git                              Scan files without git history
    @gitleaks|. -r report.json                        Save JSON report`;
      try { execFileSync("which",["gitleaks"],{encoding:"utf-8",timeout:5000}); } catch { return `[gitleaks] NOT INSTALLED — install:
  Go: go install github.com/gitleaks/gitleaks/v8@latest
  Or: brew install gitleaks (macOS)
  Or: apt install gitleaks (Kali)`; }
      const parts = input.trim().split(/\s+/);
      const path = parts[0];
      const extra = parts.slice(1);
      const out = execFileSync("gitleaks", ["detect","--source",path,"-v","--no-color",...extra], {encoding:"utf-8",timeout:180000,maxBuffer:2*1024*1024});
      const lines = out.trim().split("\n").filter(Boolean);
      if (!lines.length) return `[gitleaks] 0 secrets found in ${path}`;
      const result = [`🔐 Gitleaks: ${path}`, `Findings: ${lines.length}`];
      const display = lines.slice(0, 50);
      result.push(...display.map(l=>`  ${l}`));
      if (lines.length > 50) result.push(`  ... and ${lines.length - 50} more`);
      return result.join("\n");
    } catch(e) { return `[gitleaks Error] ${e.message}`; }
  },

  s3scanner: async (input) => {
    // s3scanner — Find S3 buckets and check permissions
    try {
      const { execFileSync } = await import("child_process");
      if (!input || !input.trim()) return `[s3scanner] Usage: @s3scanner|<bucket_or_file> [options]
  Examples:
    @s3scanner|bucket-name                            Check a single bucket
    @s3scanner|buckets.txt                            Check from file (one per line)
    @s3scanner|bucket-name --dump                     Dump bucket contents (if public)
    @s3scanner|bucket-name --infected                 Check for malware hosting
  Alternative: @s3scanner|find <keyword>              Find buckets by keyword`;
      try { execFileSync("which",["s3scanner"],{encoding:"utf-8",timeout:5000}); } catch { return `[s3scanner] NOT INSTALLED — install:
  Go: go install github.com/sa7mon/s3scanner@latest`; }
      const parts = input.trim().split(/\s+/);
      const cmd = parts[0];
      const extra = parts.slice(1);
      if (cmd === "find" && parts[1]) {
        const keyword = parts[1];
        const out = execFileSync("s3scanner", ["--find",keyword,"--o","/dev/stdout",...extra], {encoding:"utf-8",timeout:120000,maxBuffer:1024*1024});
        const lines = out.trim().split("\n").filter(Boolean);
        if (!lines.length) return `[s3scanner] 0 buckets found for "${keyword}"`;
        return [`🔎 S3 Scanner: ${keyword}`, `Buckets: ${lines.length}`,...lines.slice(0,50).map(l=>`  ${l}`)].join("\n");
      }
      const out = execFileSync("s3scanner", [cmd,...extra], {encoding:"utf-8",timeout:120000,maxBuffer:1024*1024});
      const lines = out.trim().split("\n").filter(Boolean);
      if (!lines.length) return `[s3scanner] 0 buckets found`;
      const result = [`🔎 S3 Scanner: ${cmd}`, `Results: ${lines.length}`];
      const display = lines.slice(0, 50);
      result.push(...display.map(l=>`  ${l}`));
      if (lines.length > 50) result.push(`  ... and ${lines.length - 50} more`);
      return result.join("\n");
    } catch(e) { return `[s3scanner Error] ${e.message}`; }
  },

  gobuster: async (input) => {
    // gobuster — Directory, DNS, and VHost busting
    try {
      const { execFileSync } = await import("child_process");
      if (!input || !input.trim()) return `[gobuster] Usage: @gobuster|<mode>|<target> [options]
  MODES: dir | dns | vhost | fuzz
  Examples:
    @gobuster|dir|-u https://example.com|-w /usr/share/wordlists/dirb/common.txt
    @gobuster|dir|-u https://example.com|-w dirb-common|-x php,txt,html          (built-in wordlist shortcut)
    @gobuster|dns|-d example.com|-w /usr/share/wordlists/dns/subdomains.txt
    @gobuster|vhost|-u https://example.com|-w vhosts.txt
    @gobuster|fuzz|-u https://example.com/FUZZ|-w custom.txt
  Built-in wordlist shortcuts: dirb-common, dirb-big, dirb-small, directory-list-2.3-medium
  (wordlist files expected in /usr/share/wordlists/ or /usr/share/seclists/)`;
      try { execFileSync("which",["gobuster"],{encoding:"utf-8",timeout:5000}); } catch { return `[gobuster] NOT INSTALLED — install:
  Go: go install github.com/OJ/gobuster/v3@latest
  Or: apt install gobuster (Kali/Parrot)
  Or: brew install gobuster (macOS)`; }
      const parts = input.trim().split("|").map(s=>s.trim());
      if (parts.length < 2) return `[gobuster] Usage: @gobuster|<mode>|<target> [options]\nModes: dir, dns, vhost, fuzz`;
      const mode = parts[0].toLowerCase();
      const rest = parts.slice(1).join(" ");
      const modeArgs = mode === "dir" ? ["dir",...rest.split(/\s+/)]
                    : mode === "dns" ? ["dns",...rest.split(/\s+/)]
                    : mode === "vhost" ? ["vhost",...rest.split(/\s+/)]
                    : ["fuzz",...rest.split(/\s+/)];
      const WORDLIST_SHORTCUTS = {
        "dirb-common": "/usr/share/wordlists/dirb/common.txt",
        "dirb-big": "/usr/share/wordlists/dirb/big.txt",
        "dirb-small": "/usr/share/wordlists/dirb/small.txt",
        "directory-list-2.3-medium": "/usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt",
        "seclists-discovery": "/usr/share/seclists/Discovery/Web-Content/common.txt",
        "dns-subdomains": "/usr/share/wordlists/amass/subdomains.lst",
      };
      const wIdx = modeArgs.indexOf("-w");
      if (wIdx >= 0 && wIdx + 1 < modeArgs.length && WORDLIST_SHORTCUTS[modeArgs[wIdx+1]]) {
        const resolved = WORDLIST_SHORTCUTS[modeArgs[wIdx+1]];
        const { existsSync } = await import("fs");
        if (existsSync(resolved)) modeArgs[wIdx+1] = resolved;
      }
      const out = execFileSync("gobuster", [...modeArgs,"-o","/dev/stdout","-q"], {encoding:"utf-8",timeout:180000,maxBuffer:2*1024*1024});
      const lines = out.trim().split("\n").filter(Boolean);
      if (!lines.length) return `[gobuster] No results`;
      return [`⚡ Gobuster ${mode}: ${rest}`, `Results: ${lines.length}`,...lines.slice(0,80).map(l=>`  ${l}`),...(lines.length>80?[`  ... and ${lines.length-80} more`]:[])].join("\n");
    } catch(e) { return `[gobuster Error] ${e.message}`; }
  },
};