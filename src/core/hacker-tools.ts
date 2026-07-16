import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import * as dns from "dns/promises";
import tls from "tls";
import net from "net";

export interface HackerTool {
  description: string;
  execute: (input: string) => Promise<string>;
}

async function shell(cmd: string): Promise<string> {
  try {
    const r = execSync(cmd, { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 });
    return r.trim().substring(0, 4000) || "(empty output)";
  } catch (e: any) {
    return `[Shell Error] ${e.stderr?.substring(0, 500) || e.message}`;
  }
}

async function webFetch(url: string): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    const ct = r.headers.get("content-type") || "";
    const isHtml = ct.includes("text/html");
    const cleaned = isHtml
      ? text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : text;
    return `Status ${r.status}\n${cleaned.substring(0, 3000)}`;
  } catch (e: any) {
    return `[Fetch Error] ${e.message}`;
  }
}

async function decode(input: string): Promise<string> {
  const s = input.trim();
  const results: string[] = [];

  try {
    const decoded = Buffer.from(s, "base64").toString("utf-8");
    if (/^[\x20-\x7E\s]+$/.test(decoded)) results.push(`base64: ${decoded}`);
  } catch {}

  const hexClean = s.replace(/\\x/g, "").replace(/0x/g, "").replace(/\s/g, "");
  if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length % 2 === 0) {
    try {
      const decoded = Buffer.from(hexClean, "hex").toString("utf-8");
      if (/^[\x20-\x7E\s]+$/.test(decoded)) results.push(`hex: ${decoded}`);
    } catch {}
  }

  try {
    if (s.includes("%")) results.push(`url: ${decodeURIComponent(s)}`);
  } catch {}

  if (/^[01\s]+$/.test(s)) {
    try {
      const bin = s.replace(/\s/g, "");
      const chars: string[] = [];
      for (let i = 0; i < bin.length; i += 8) {
        chars.push(String.fromCharCode(parseInt(bin.substring(i, i + 8), 2)));
      }
      results.push(`binary: ${chars.join("")}`);
    } catch {}
  }

  results.push(
    `rot13: ${s.replace(/[a-zA-Z]/g, (c) => {
      const code = c.charCodeAt(0);
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((code - base + 13) % 26) + base);
    })}`
  );

  return results.length
    ? results.join("\n")
    : "[Decoder] No known encoding detected";
}

async function fileAnalyze(path: string): Promise<string> {
  try {
    if (!existsSync(path)) return `[Error] File not found: ${path}`;
    const buf = readFileSync(path);
    const size = buf.length;

    const md5 = createHash("md5").update(buf).digest("hex");
    const sha1 = createHash("sha1").update(buf).digest("hex");
    const sha256 = createHash("sha256").update(buf).digest("hex");

    const freq = new Map<number, number>();
    for (let i = 0; i < buf.length; i++) freq.set(buf[i], (freq.get(buf[i]) || 0) + 1);
    let entropy = 0;
    for (const count of Array.from(freq.values())) {
      const p = count / size;
      entropy -= p * Math.log2(p);
    }

    let cur = "";
    const strs: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c >= 32 && c <= 126) {
        cur += String.fromCharCode(c);
      } else {
        if (cur.length >= 6) strs.push(cur);
        cur = "";
      }
    }
    if (cur.length >= 6) strs.push(cur);

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
    else if (buf.slice(0, 3).toString() === "#!/") fileType = "Script";

    const entropyLabel =
      entropy > 7.2
        ? "SUSPICIOUS - likely encrypted/packed malware"
        : entropy > 6.5
        ? "High - possible packing/encryption"
        : entropy > 5.0
        ? "Medium"
        : "Low (plain text/native code)";

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
  } catch (e: any) {
    return `[Analyze Error] ${e.message}`;
  }
}

async function dnsLookup(domain: string): Promise<string> {
  try {
    const results = [`DNS records for ${domain}:`];
    const checks: [string, Promise<any>][] = [
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
        if (label === "SOA" && val && typeof val === "object" && !Array.isArray(val)) {
          const soa = val as any;
          results.push(
            `  SOA: ${soa.nsname} (admin: ${soa.hostmaster})`
          );
        } else if (Array.isArray(val) && val.length) {
          if (label === "MX")
            results.push(
              `  MX: ${val
                .map((m: any) => `${m.exchange} (prio ${m.priority})`)
                .join(", ")}`
            );
          else if (label === "TXT")
            results.push(`  TXT: ${val.flat().join(", ")}`);
          else results.push(`  ${label}: ${val.join(", ")}`);
        }
      } catch {}
    }
    if (results.length === 1) results.push("  (no records found)");
    return results.join("\n");
  } catch (e: any) {
    return `[DNS Error] ${e.message}`;
  }
}

async function hash(input: string): Promise<string> {
  try {
    let data: Buffer;
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
  } catch (e: any) {
    return `[Hash Error] ${e.message}`;
  }
}

// ── NEW TOOLS ─────────────────────────────────────────────

async function whois(domain: string): Promise<string> {
  try {
    const r = execSync(`whois ${domain}`, { encoding: "utf-8", timeout: 15000, maxBuffer: 1024 * 1024 });
    const out = r.trim();
    if (!out) return "(empty whois result)";
    // Trim to most useful sections
    const lines = out.split("\n").filter(l => !l.startsWith("%") && !l.startsWith("#"));
    return lines.slice(0, 60).join("\n").substring(0, 4000);
  } catch (e: any) {
    return `[WHOIS Error] ${e.stderr?.substring(0, 500) || e.message}`;
  }
}

async function portScan(target: string): Promise<string> {
  const COMMON_PORTS: Record<number, string> = {
    21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
    80: "HTTP", 110: "POP3", 111: "RPC", 135: "MSRPC", 139: "NetBIOS",
    143: "IMAP", 443: "HTTPS", 445: "SMB", 993: "IMAPS", 995: "POP3S",
    1433: "MSSQL", 1521: "Oracle", 2049: "NFS", 3306: "MySQL",
    3389: "RDP", 5432: "PostgreSQL", 5900: "VNC", 5985: "WinRM HTTP",
    5986: "WinRM HTTPS", 6379: "Redis", 8080: "HTTP-Proxy", 8443: "HTTPS-Alt",
    9000: "PHP-FPM", 27017: "MongoDB",
  };

  const parts = target.split(":");
  const host = parts[0];
  let ports: number[] = [];

  if (parts.length > 1 && parts[1]) {
    if (parts[1].includes("-")) {
      const [s, e] = parts[1].split("-").map(Number);
      if (!isNaN(s) && !isNaN(e)) for (let i = s; i <= e; i++) ports.push(i);
    } else {
      ports = parts[1].split(",").map(Number).filter(n => !isNaN(n));
    }
  }
  if (ports.length === 0) ports = Object.keys(COMMON_PORTS).map(Number);

  const results = [`Port scan: ${host} (${ports.length} ports)`];
  const concurrency = 20;

  for (let i = 0; i < ports.length; i += concurrency) {
    const batch = ports.slice(i, i + concurrency);
    const scans = batch.map(port =>
      new Promise<void>(resolve => {
        const sock = new net.Socket();
        sock.setTimeout(2000);
        sock.on("connect", () => {
          const svc = COMMON_PORTS[port] || "unknown";
          results.push(`  ${port}/tcp  open  ${svc}`);
          sock.destroy();
          resolve();
        });
        sock.on("error", () => resolve());
        sock.on("timeout", () => { sock.destroy(); resolve(); });
        sock.connect(port, host);
      })
    );
    await Promise.all(scans);
  }

  if (results.length === 1) results.push("  (all filtered/closed)");
  return results.join("\n");
}

async function httpHeaders(url: string): Promise<string> {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000), redirect: "manual" });
    const headers: string[] = [];
    r.headers.forEach((v, k) => headers.push(`  ${k}: ${v}`));
    return `URL: ${url}\nStatus: ${r.status} ${r.statusText}\n── Response Headers ──\n${headers.join("\n")}`;
  } catch (e: any) {
    return `[HTTP Header Error] ${e.message}`;
  }
}

async function sslCheck(host: string): Promise<string> {
  const [hostname, portStr] = host.includes(":") ? host.split(":") : [host, "443"];
  const port = parseInt(portStr, 10) || 443;

  return new Promise(resolve => {
    const socket = tls.connect(port, hostname, { servername: hostname, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      const lines: string[] = [
        `SSL Certificate for ${hostname}:${port}`,
        `Subject: ${cert.subject ? Object.entries(cert.subject).map(([k, v]) => `${k}=${v}`).join(", ") : "N/A"}`,
        `Issuer: ${cert.issuer ? Object.entries(cert.issuer).map(([k, v]) => `${k}=${v}`).join(", ") : "N/A"}`,
        `Valid From: ${cert.valid_from || "N/A"}`,
        `Valid To: ${cert.valid_to || "N/A"}`,
        `Serial: ${cert.serialNumber || "N/A"}`,
        `Fingerprint (SHA256): ${cert.fingerprint256 || "N/A"}`,
        `Subject Alt Names: ${(cert.subjectaltname || "").replace(/DNS:/g, "").split(", ").join(", ")}`,
        `Bits: ${cert.bits || "N/A"}`,
      ];

      const daysLeft = cert.valid_to ? Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000) : null;
      if (daysLeft !== null) {
        const warn = daysLeft < 0 ? "EXPIRED" : daysLeft < 30 ? "⚠ EXPIRING SOON" : "OK";
        lines.push(`Days Remaining: ${daysLeft} (${warn})`);
      }

      const cipher = socket.getCipher();
      if (cipher) {
        lines.push(`Cipher: ${cipher.name} (${cipher.version})`);
      }

      socket.end();
      resolve(lines.join("\n"));
    });

    socket.on("error", (e: Error) => resolve(`[SSL Error] ${e.message}`));
    socket.setTimeout(10000, () => { socket.destroy(); resolve("[SSL Error] Timeout"); });
  });
}

async function subdomainEnum(domain: string): Promise<string> {
  try {
    const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const r = await fetch(`https://crt.sh/?q=%25.${clean}&output=json`, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Phantom/1.0" },
    });
    if (!r.ok) return `[crt.sh Error] HTTP ${r.status}`;
    const data = await r.json() as any[];
    if (!Array.isArray(data) || data.length === 0) return `(no subdomains found for ${clean})`;

    const subs = [...new Set(data.flatMap(d => (d.name_value || "").split("\n")))]
      .filter(s => s.endsWith(`.${clean}`) || s === clean)
      .sort();
    return subs.length ? subs.join("\n") : `(no subdomains found for ${clean})`;
  } catch (e: any) {
    return `[Subdomain Error] ${e.message}`;
  }
}

async function webCrawl(url: string): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const html = await r.text();
    const base = url.replace(/\/[^/]*$/, "");

    // Extract links
    const links = new Set<string>();
    const linkRe = /<a[^>]+href\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      let href = m[1].split("#")[0].split("?")[0]; // strip hash and query
      if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
      if (href.startsWith("//")) href = `https:${href}`;
      else if (href.startsWith("/")) href = new URL(href, url).href;
      else if (!href.startsWith("http")) href = `${base}/${href}`;
      try { links.add(new URL(href).href); } catch {}
    }

    // Extract forms
    const forms: string[] = [];
    const formRe = /<form[^>]+action\s*=\s*["']([^"']*)["'][^>]*>/gi;
    while ((m = formRe.exec(html)) !== null) {
      forms.push(m[1]);
    }

    // Extract scripts
    const scripts: string[] = [];
    const scriptRe = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
    while ((m = scriptRe.exec(html)) !== null) {
      scripts.push(m[1]);
    }

    const lines = [
      `🌐 Crawl: ${url}`,
      `Status: ${r.status}`,
      `Content-Type: ${r.headers.get("content-type") || "N/A"}`,
      `Content-Length: ${r.headers.get("content-length") || "N/A"}`,
      `Links found: ${links.size}`,
      ...Array.from(links).slice(0, 30).map(l => `  ${l}`),
    ];
    if (forms.length) {
      lines.push(`Forms: ${forms.length}`);
      forms.slice(0, 5).forEach(f => lines.push(`  action="${f}"`));
    }
    if (scripts.length) {
      lines.push(`Scripts: ${scripts.length}`);
      scripts.slice(0, 10).forEach(s => lines.push(`  ${s}`));
    }
    return lines.join("\n");
  } catch (e: any) {
    return `[Crawl Error] ${e.message}`;
  }
}

async function vtCheck(hash: string): Promise<string> {
  const key = process.env.VT_API_KEY || "";
  if (!key) return "[VT] Set VT_API_KEY env var (free: https://virustotal.com)";
  try {
    const r = await fetch(`https://www.virustotal.com/api/v3/files/${hash.trim()}`, {
      headers: { "x-apikey": key, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 404) return `[VT] Hash "${hash}" not found in VirusTotal database`;
    if (!r.ok) return `[VT Error] HTTP ${r.status}`;
    const data = (await r.json()) as any;
    const attrs = data?.data?.attributes || {};
    const stats = attrs.last_analysis_stats || {};
    const results = attrs.last_analysis_results || {};
    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;
    const harmless = stats.harmless || 0;
    const undetected = stats.undetected || 0;

    const lines = [
      `🔬 VirusTotal Report for ${hash}`,
      `File: ${attrs.meaningful_name || "N/A"}`,
      `Type: ${attrs.type_description || attrs.type || "N/A"}`,
      `Size: ${attrs.size || "N/A"} bytes`,
      `First Seen: ${attrs.first_submission_date ? new Date(attrs.first_submission_date * 1000).toISOString().split("T")[0] : "N/A"}`,
      `Last Seen: ${attrs.last_analysis_date ? new Date(attrs.last_analysis_date * 1000).toISOString().split("T")[0] : "N/A"}`,
      `Times Submitted: ${attrs.times_submitted || "N/A"}`,
      "",
      `Detection: ${malicious} malicious / ${suspicious} suspicious / ${harmless} harmless / ${undetected} undetected`,
      `Total engines: ${malicious + suspicious + harmless + undetected}`,
      "",
      `── Top Malicious Detections ──`,
    ];

    for (const [engine, res] of Object.entries(results)) {
      const r = res as any;
      if (r.category === "malicious") {
        lines.push(`  ${engine}: ${r.result}`);
      }
    }

    if (attrs.names) {
      lines.push(`\n── Known As ──`);
      (attrs.names as string[]).slice(0, 10).forEach(n => lines.push(`  ${n}`));
    }

    return lines.join("\n");
  } catch (e: any) {
    return `[VT Error] ${e.message}`;
  }
}

async function yaraScan(input: string): Promise<string> {
  // input format: "rules_file|target_path" or "target_path" (uses default rules)
  const parts = input.split("|").map(s => s.trim());
  let rules: string, target: string;
  if (parts.length >= 2) {
    [rules, target] = parts;
  } else {
    target = parts[0];
    rules = "";
  }

  try {
    const cmd = rules ? `yara ${rules} ${target}` : `yara ${target}`;
    const r = execSync(cmd, { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 });
    const out = r.trim();
    if (!out) return "(no YARA matches)";
    return `YARA scan: ${target}\n${out}`;
  } catch (e: any) {
    const stderr = e.stderr?.toString() || "";
    if (stderr.includes("command not found") || e.message.includes("command not found")) {
      return "[YARA] Not installed. Install with: apt install yara or brew install yara";
    }
    if (e.status === 0) return "(no YARA matches)";
    return `[YARA Error] ${stderr.substring(0, 500) || e.message}`;
  }
}

// ── Config ─────────────────────────────────────────────────
interface PhantomConfig {
  VT_API_KEY?: string;
  SHODAN_API_KEY?: string;
  report_dir?: string;
}

function loadConfig(): PhantomConfig {
  try {
    const configPath = resolve(homedir(), ".config", "phantom", "config.json");
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, "utf-8"));
    }
  } catch {}
  return {};
}

const _config = loadConfig();
if (_config.VT_API_KEY && !process.env.VT_API_KEY) {
  process.env.VT_API_KEY = _config.VT_API_KEY;
}

// ── AUTO RECON ────────────────────────────────────────────
async function recon(target: string): Promise<string> {
  const domain = target.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const lines: string[] = [
    `╔══════════════════════════════════════╗`,
    `║  PHANTOM AUTOMATED RECON            ║`,
    `║  Target: ${domain.padEnd(32)}║`,
    `║  Date:   ${ts.slice(0, 19).padEnd(27)}║`,
    `╚══════════════════════════════════════╝`,
    "",
  ];

  // 1. WHOIS
  lines.push(`── [1/7] WHOIS ──`);
  lines.push(await whois(domain));

  // 2. DNS
  lines.push(`\n── [2/7] DNS ──`);
  lines.push(await dnsLookup(domain));

  // 3. Subdomains
  lines.push(`\n── [3/7] SUBDOMAINS ──`);
  lines.push(await subdomainEnum(domain));

  // 4. HTTP headers
  lines.push(`\n── [4/7] HTTP HEADERS ──`);
  lines.push(await httpHeaders(`https://${domain}`));

  // 5. SSL
  lines.push(`\n── [5/7] SSL ──`);
  lines.push(await sslCheck(domain));

  // 6. Port scan common ports
  lines.push(`\n── [6/7] PORTS ──`);
  lines.push(await portScan(domain));

  // 7. Crawl
  lines.push(`\n── [7/7] CRAWL ──`);
  lines.push(await webCrawl(`https://${domain}`));

  // Save report
  const reportDir = _config.report_dir || resolve(homedir(), ".config", "phantom", "reports");
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, `recon_${domain}_${ts}.md`);
  writeFileSync(reportPath, lines.join("\n"), "utf-8");
  lines.push(`\n📄 Report saved: ${reportPath}`);

  return lines.join("\n");
}

// ── CVE SEARCH ────────────────────────────────────────────
async function cveSearch(query: string): Promise<string> {
  try {
    const r = await fetch(
      `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(query)}&resultsPerPage=12`,
      { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Phantom/1.0" } }
    );
    if (!r.ok) return `[NVD Error] HTTP ${r.status}`;
    const data = await r.json() as any;
    const vulns = data?.vulnerabilities || [];
    if (!vulns.length) return `(no CVEs found for "${query}")`;

    const lines: string[] = [`🔍 CVEs for "${query}": ${vulns.length} found\n`];
    for (const v of vulns.slice(0, 15)) {
      const c = v.cve || {};
      const id = c.id || "N/A";
      const desc = c.descriptions?.find((d: any) => d.lang === "en")?.value || "";
      const cvss = c.metrics?.cvssMetricV31?.[0]?.cvssData;
      const cvss2 = c.metrics?.cvssMetricV2?.[0]?.cvssData;
      const score = cvss?.baseScore ?? cvss2?.baseScore ?? "?";
      const sev = cvss?.baseSeverity ?? cvss2?.baseSeverity ?? "?";
      const pub = (c.published || "").split("T")[0] || "?";
      const exploit = c.metrics?.cvssMetricV31?.[0]?.exploitabilityScore ?? "";
      lines.push(`[${id}] ${sev} (${score}) — ${pub}`);
      if (desc) lines.push(`  ${desc.substring(0, 180)}`);
      lines.push(`  https://nvd.nist.gov/vuln/detail/${id}`);
      lines.push("");
    }
    return lines.join("\n");
  } catch (e: any) {
    return `[CVE Search Error] ${e.message}`;
  }
}

// ── SEARCHSPLOIT ──────────────────────────────────────────
async function searchsploit(query: string): Promise<string> {
  // Try local searchsploit CLI first
  try {
    const r = execSync(`searchsploit ${query} 2>/dev/null`, {
      encoding: "utf-8", timeout: 15000, maxBuffer: 1024 * 1024,
    });
    const out = r.trim();
    if (out) return `🔧 Exploit-DB results:\n${out.substring(0, 4000)}`;
  } catch {}

  // Fallback: search packetstorm
  try {
    const r = await fetch(
      `https://packetstormsecurity.com/search/?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const html = await r.text();
    const results: string[] = [`🔧 Exploit search results for "${query}":`];
    const matches = html.match(/<a[^>]+href="\/files\/[^"]+"[^>]*>[\s\S]{0,150}?<\/a>/gi) || [];
    let count = 0;
    for (const m of matches.slice(0, 15)) {
      const url = m.match(/href="([^"]+)"/)?.[1] || "";
      const text = m.replace(/<[^>]+>/g, "").trim().substring(0, 100);
      if (url && text) {
        results.push(`  ${text} → https://packetstormsecurity.com${url}`);
        count++;
      }
    }
    if (count === 0) {
      results.push(`  Try: https://www.exploit-db.com/search?q=${encodeURIComponent(query)}`);
    }
    return results.join("\n");
  } catch (e: any) {
    return `[Search Error] ${e.message}`;
  }
}

// ── BRUTEFORCE ────────────────────────────────────────────
async function bruteforceFn(input: string): Promise<string> {
  // Format: protocol|target|user|pass1,pass2,pass3
  //   or:   protocol|target|user:wordlist_path
  const parts = input.split("|").map(s => s.trim());
  if (parts.length < 4) {
    return `[Brute] Usage: protocol|target|user|pass1,pass2,...
Protocols: ssh, ftp, http, mysql
Examples:
  ssh|192.168.1.1|root|admin,toor,123456
  ftp|ftp.example.com|admin|password,secret
  http|https://site.com/login|admin|admin123,test
  mysql|db.example.com|root|root,toor,password`;
  }

  const [protocol, target, user, passStr] = parts;
  const passwords = passStr.includes("\n") || passStr.length > 200
    ? passStr.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    : passStr.split(",").map(s => s.trim()).filter(Boolean);

  const results: string[] = [
    `🔑 Brute force: ${protocol}://${target}`,
    `   User: ${user}`,
    `   Passwords: ${passwords.length}`,
    "",
  ];

  const pad = `${user}:`.padEnd(25);

  for (const pass of passwords) {
    const result = await tryLogin(protocol, target, user, pass);
    results.push(`  ${pad} ${pass.padEnd(20)} → ${result}`);
    if (result.startsWith("✅") || result.startsWith("⚠")) {
      results.push(`\n🎯 CREDENTIALS FOUND: ${user}:${pass}`);
      break;
    }
  }

  return results.join("\n");
}

async function tryLogin(protocol: string, target: string, user: string, pass: string): Promise<string> {
  switch (protocol) {
    case "ssh": {
      try {
        execSync(
          `sshpass -p '${pass.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=no ${user}@${target} 'id' 2>/dev/null`,
          { encoding: "utf-8", timeout: 10000 }
        );
        return "✅ SUCCESS";
      } catch {
        return "❌ failed";
      }
    }
    case "ftp": {
      return new Promise(resolve => {
        const sock = new net.Socket();
        let buf = "";
        sock.setTimeout(5000);
        sock.on("data", d => {
          buf += d.toString();
          if (buf.includes("220 ") || buf.includes("ready")) {
            sock.write(`USER ${user}\r\n`);
          } else if (buf.includes("331 ") || buf.includes("User")) {
            sock.write(`PASS ${pass}\r\n`);
          } else if (buf.includes("230 ") || buf.includes("Logged") || buf.includes("Welcome")) {
            sock.destroy();
            resolve("✅ SUCCESS");
          } else if (buf.includes("530 ") || buf.includes("Login") || buf.includes("incorrect")) {
            sock.destroy();
            resolve("❌ failed");
          }
        });
        sock.on("error", () => resolve("❌ error"));
        sock.on("timeout", () => { sock.destroy(); resolve("❌ timeout"); });
        const [h, p] = target.includes(":") ? target.split(":") : [target, "21"];
        sock.connect(parseInt(p) || 21, h);
      });
    }
    case "http": {
      try {
        const url = target;
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ username: user, password: pass, log: user, pwd: pass, user_login: user }).toString(),
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        const text = await r.text().catch(() => "");
        if (r.status === 302 || r.status === 301) return "✅ SUCCESS (redirect)";
        if (r.status === 200 && !text.includes("incorrect") && !text.includes("Invalid") && !text.includes("error") && !text.includes("failed")) {
          return !text.includes("password") && !text.includes("login") ? "⚠ maybe" : "❌ failed";
        }
        if (r.status === 401 || r.status === 403) return "❌ denied";
        return "❌ failed";
      } catch {
        return "❌ error";
      }
    }
    case "mysql": {
      try {
        const r = execSync(
          `mysql -u '${user}' -p'${pass.replace(/'/g, "'\\''")}' -h '${target}' -e 'SELECT 1' --connect-timeout=5 2>/dev/null`,
          { encoding: "utf-8", timeout: 10000 }
        );
        return r.includes("1") ? "✅ SUCCESS" : "❌ failed";
      } catch {
        return "❌ failed";
      }
    }
    default:
      return `❌ unknown protocol "${protocol}"`;
  }
}

// ── FILE TOOLS ────────────────────────────────────────────
const PHANTOM_DIR = resolve(import.meta.dirname || __dirname || ".", "..", "..");

async function fileRead(path: string): Promise<string> {
  try {
    const resolved = resolve(path);
    if (!existsSync(resolved)) return `[File Error] Not found: ${path}`;
    const content = readFileSync(resolved, "utf-8");
    if (content.length > 100000) return `[File Error] Too large (>100KB): ${path} (${content.length} chars)`;
    return content;
  } catch (e: any) {
    if (e.code === "EISDIR") return `[File Error] Is a directory: ${path}`;
    return `[File Error] ${e.message}`;
  }
}

async function fileWrite(input: string): Promise<string> {
  const idx = input.indexOf("|");
  if (idx === -1) return "[File Write] Usage: path|content\nSeparate path and content with |";
  const path = input.substring(0, idx).trim();
  const content = input.substring(idx + 1).trimStart();
  if (!path || !content) return "[File Write] Usage: path|content";
  try {
    const resolved = resolve(path);
    const dir = resolve(resolved, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(resolved, content, "utf-8");
    return `✅ Wrote ${content.length} bytes to ${resolved}`;
  } catch (e: any) {
    return `[File Write Error] ${e.message}`;
  }
}

async function fileEdit(input: string): Promise<string> {
  const parts = input.split("|");
  if (parts.length < 3) return "[File Edit] Usage: path|old_string|new_string";
  const [path, oldStr, ...rest] = parts;
  const newStr = rest.join("|");
  try {
    const resolved = resolve(path);
    if (!existsSync(resolved)) return `[File Edit] Not found: ${path}`;
    let content = readFileSync(resolved, "utf-8");
    if (!content.includes(oldStr)) return `[File Edit] String not found in ${path}`;
    content = content.replace(oldStr, newStr);
    writeFileSync(resolved, content, "utf-8");
    return `✅ Edited ${path} — replaced "${oldStr.substring(0, 60)}..."`;
  } catch (e: any) {
    return `[File Edit Error] ${e.message}`;
  }
}

async function fileSearch(input: string): Promise<string> {
  const parts = input.split("|").map(s => s.trim());
  const searchPath = parts.length >= 2 ? parts[0] : ".";
  const pattern = parts.length >= 2 ? parts[1] : parts[0];
  if (!pattern) return "[File Search] Usage: [path|]pattern";
  try {
    const r = execSync(
      `rg -rn '${pattern.replace(/'/g, "'\\''")}' '${searchPath}' 2>/dev/null | head -40`,
      { encoding: "utf-8", timeout: 15000, maxBuffer: 1024 * 1024 }
    );
    if (!r.trim()) return `(no matches for "${pattern}" in ${searchPath})`;
    const lines = r.trim().split("\n");
    return `🔍 "${pattern}" in ${searchPath}: ${lines.length} matches\n${lines.slice(0, 40).join("\n")}`;
  } catch {
    return `(no matches or rg not available for "${pattern}" in ${searchPath})`;
  }
}

async function fileList(path: string): Promise<string> {
  try {
    const resolved = resolve(path || ".");
    if (!existsSync(resolved)) return `[File List] Not found: ${path}`;
    const entries = readdirSync(resolved, { withFileTypes: true });
    const lines: string[] = [`📁 ${resolved}:`];
    const dirs: string[] = [], files: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) dirs.push(e.name);
      else files.push(e.name);
    }
    dirs.sort().forEach(d => lines.push(`  📁 ${d}/`));
    files.sort().forEach(f => {
      try {
        const s = statSync(resolve(resolved, f));
        lines.push(`  📄 ${f} (${s.size.toLocaleString()}b)`);
      } catch { lines.push(`  📄 ${f}`); }
    });
    lines.push(`\n${dirs.length} dirs, ${files.length} files`);
    return lines.join("\n");
  } catch (e: any) {
    return `[File List Error] ${e.message}`;
  }
}

// ── SELF TOOLS ────────────────────────────────────────────
async function selfInfo(): Promise<string> {
  try {
    const pkg: any = existsSync(resolve(PHANTOM_DIR, "package.json"))
      ? JSON.parse(readFileSync(resolve(PHANTOM_DIR, "package.json"), "utf-8"))
      : {};
    const toolNames = Object.keys(hackerTools).sort();
    const srcFiles: string[] = [];
    function walk(dir: string) {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const e of entries) {
        if (e === "node_modules" || e.startsWith(".")) continue;
        const full = resolve(dir, e);
        try {
          if (statSync(full).isDirectory()) walk(full);
          else if (e.endsWith(".ts") || e.endsWith(".mjs") || e.endsWith(".json")) srcFiles.push(full.replace(PHANTOM_DIR, "."));
        } catch {}
      }
    }
    walk(PHANTOM_DIR);

    const lines: string[] = [
      `╔══════════════════════════════════════╗`,
      `║  PHANTOM — Cybersecurity Assistant   ║`,
      `╚══════════════════════════════════════╝`,
      ``,
      `Version:  ${pkg.version || "dev"}`,
      `Runtime:  Node.js ${process.version}`,
      `Platform: ${process.platform} ${process.arch}`,
      `Project:  ${PHANTOM_DIR}`,
      `Config:   ${resolve(homedir(), ".config", "phantom", "config.json")}`,
      ``,
      `📦 ${toolNames.length} Tools:`,
      `  ${toolNames.join(", ")}`,
      ``,
      `📁 ${srcFiles.length} Source Files:`,
      ...srcFiles.map(f => `  ${f}`),
      ``,
      `🤖 ReAct Loop: Active`,
      `   LLM: ${process.env.OPENAI_API_KEY ? "Connected (OpenAI)" : process.env.OLLAMA_HOST ? "Ollama" : "Not connected (demo mode)"}`,
      `   Memory: ~/.config/phantom/memory/`,
      `   Reports: ~/.config/phantom/reports/`,
    ];
    return lines.join("\n");
  } catch (e: any) {
    return `[Self Info Error] ${e.message}`;
  }
}

async function selfRead(path: string): Promise<string> {
  try {
    const resolved = resolve(PHANTOM_DIR, path.replace(/^\.\//, ""));
    if (!resolved.startsWith(PHANTOM_DIR)) return `[Self Read] Access denied: path outside project`;
    if (!existsSync(resolved)) return `[Self Read] Not found: ${path}`;
    const content = readFileSync(resolved, "utf-8");
    if (content.length > 50000) {
      return content.substring(0, 50000) + `\n... (truncated, ${content.length} chars total)`;
    }
    return content;
  } catch (e: any) {
    return `[Self Read Error] ${e.message}`;
  }
}

async function selfEdit(input: string): Promise<string> {
  const parts = input.split("|");
  if (parts.length < 3) return "[Self Edit] Usage: relative_path|old_string|new_string";
  const [relPath, oldStr, ...rest] = parts;
  const newStr = rest.join("|");
  try {
    const resolved = resolve(PHANTOM_DIR, relPath.replace(/^\.\//, ""));
    if (!resolved.startsWith(PHANTOM_DIR)) return `[Self Edit] Access denied: path outside project`;
    if (!existsSync(resolved)) return `[Self Edit] Not found: ${relPath}`;
    let content = readFileSync(resolved, "utf-8");
    if (!content.includes(oldStr)) return `[Self Edit] String not found in ${relPath}`;
    content = content.replace(oldStr, newStr);
    writeFileSync(resolved, content, "utf-8");
    return `✅ Self-edited ${relPath} — replaced "${oldStr.substring(0, 60)}..."`;
  } catch (e: any) {
    return `[Self Edit Error] ${e.message}`;
  }
}

// ── VULN SCAN ────────────────────────────────────────────
async function vulnScan(target: string): Promise<string> {
  const domain = target.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const lines: string[] = [
    `# Phantom Vulnerability Scan Report`,
    `**Target:** ${domain}`,
    `**Date:** ${new Date().toUTCString()}`,
    `---`, ``
  ];
  // Phase 1: Recon
  lines.push(`## Phase 1: Reconnaissance\n`);
  try { lines.push(`### WHOIS\n\`\`\`\n${await whois(domain)}\n\`\`\``); } catch {}
  try { lines.push(`### DNS\n\`\`\`\n${await dnsLookup(domain)}\n\`\`\``); } catch {}
  try { lines.push(`### Subdomains\n\`\`\`\n${await subdomainEnum(domain)}\n\`\`\``); } catch {}
  try { lines.push(`### HTTP Headers\n\`\`\`\n${await httpHeaders(`https://${domain}`)}\n\`\`\``); } catch {}
  try { lines.push(`### SSL/TLS\n\`\`\`\n${await sslCheck(domain)}\n\`\`\``); } catch {}
  const ports = await portScan(domain);
  lines.push(`### Open Ports\n\`\`\`\n${ports}\n\`\`\``);
  // Phase 2: CVEs
  lines.push(`\n## Phase 2: Vulnerability Search\n`);
  try { lines.push(`### CVEs\n\`\`\`\n${await cveSearch(domain)}\n\`\`\``); } catch {}
  // Phase 3: Exploits
  lines.push(`\n## Phase 3: Exploit Search\n`);
  try { lines.push(`### Exploits\n\`\`\`\n${await searchsploit(domain)}\n\`\`\``); } catch {}
  // Phase 4: Brute force
  lines.push(`\n## Phase 4: Brute Force Testing\n`);
  const openPorts = [...ports.matchAll(/(\d+)\/tcp\s+open/gi)].map(m => parseInt(m[1]));
  if (openPorts.includes(22)) {
    lines.push(`- Port 22 (SSH) open — attempting brute force`);
    try { lines.push(`  \`\`\`\n${await bruteforceFn(`ssh|${domain}|root|admin,root,toor,123456,password`)}\n\`\`\``); } catch {}
  }
  if (openPorts.includes(21)) {
    lines.push(`- Port 21 (FTP) open — attempting brute force`);
    try { lines.push(`  \`\`\`\n${await bruteforceFn(`ftp|${domain}|admin|admin,password,ftp`)}\n\`\`\``); } catch {}
  }
  if (openPorts.some(p => [80, 443, 8080, 8443].includes(p))) {
    lines.push(`- Web server detected — attempting brute force`);
    try { lines.push(`  \`\`\`\n${await bruteforceFn(`http|https://${domain}/login|admin|admin,password,admin123`)}\n\`\`\``); } catch {}
  }
  // Save report
  const reportDir = _config.report_dir || resolve(homedir(), ".config", "phantom", "reports");
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, `vulnscan_${domain}_${ts}.md`);
  writeFileSync(reportPath, lines.join("\n"), "utf-8");
  lines.push(`\n---\n📄 Full report saved: ${reportPath}`);
  return lines.join("\n");
}

// ── REPORT SAVE ──────────────────────────────────────────
async function reportSave(input: string): Promise<string> {
  const parts = input.split("|");
  const name = (parts[0] || `report_${Date.now()}`).replace(/[^a-z0-9_-]/gi, "_");
  const content = parts.slice(1).join("|") || input;
  const reportDir = _config.report_dir || resolve(homedir(), ".config", "phantom", "reports");
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const fp = resolve(reportDir, `${name}.md`);
  writeFileSync(fp, content, "utf-8");
  return `📄 Report saved: ${fp}`;
}

// ── SESSIONS ─────────────────────────────────────────────
const SESSIONS_DIR = resolve(homedir(), ".config", "phantom", "sessions");

async function sessionSave(name: string): Promise<string> {
  try {
    if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
    const slug = name.replace(/[^a-z0-9_-]/gi, "_");
    const data = { name, created: new Date().toISOString(), tools: Object.keys(hackerTools).length };
    writeFileSync(resolve(SESSIONS_DIR, `${slug}.json`), JSON.stringify(data, null, 2), "utf-8");
    return `✅ Session saved: ${slug}`;
  } catch (e: any) { return `[Session Error] ${e.message}`; }
}

async function sessionLoad(name: string): Promise<string> {
  try {
    const slug = name.replace(/[^a-z0-9_-]/gi, "_");
    const fp = resolve(SESSIONS_DIR, `${slug}.json`);
    if (!existsSync(fp)) return `[Session] Not found: ${name}`;
    const data = JSON.parse(readFileSync(fp, "utf-8"));
    return `📂 Session: ${data.name}\nCreated: ${data.created}\nTools: ${data.tools}`;
  } catch (e: any) { return `[Session Error] ${e.message}`; }
}

// ── CODE GEN ─────────────────────────────────────────────
async function codeGen(input: string): Promise<string> {
  const parts = input.split("|");
  const prompt = parts[0];
  const lang = parts[1] || "javascript";
  const outPath = parts[2] || "";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const stub = `// ${prompt}\n// Language: ${lang}\nfunction ${prompt.replace(/[^a-z]/gi, "")}() {\n  // TODO: implement\n  return null;\n}\n`;
    if (outPath) { writeFileSync(resolve(outPath), stub, "utf-8"); return `✅ Stub written to ${outPath}`; }
    return stub;
  }
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: `You generate only ${lang} code. No explanations.` }, { role: "user", content: prompt }], max_tokens: 2000 }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json() as any;
    const code = data?.choices?.[0]?.message?.content || "// Generation failed";
    if (outPath) { writeFileSync(resolve(outPath), code, "utf-8"); return `✅ Generated ${code.length} chars → ${outPath}`; }
    return code;
  } catch (e: any) { return `[Code Gen Error] ${e.message}`; }
}

// ── SELF ADD TOOL ────────────────────────────────────────
async function selfAddTool(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "[Self Add Tool] Requires OPENAI_API_KEY";
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: `Generate a Node.js async function that takes a single string input and returns Promise<string>. Name it after the tool purpose. Include a one-line description comment. No imports, no markdown.` }, { role: "user", content: `Tool that: ${prompt}` }],
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json() as any;
    const result = data?.choices?.[0]?.message?.content || "// Failed";
    const toolName = result.match(/async function\s+(\w+)/)?.[1] || "newTool";
    const descMatch = result.match(/\/\/\s*(.+)/);
    const desc = descMatch?.[1] || prompt.substring(0, 80);
    const stageDir = resolve(homedir(), ".config", "phantom", "generated");
    if (!existsSync(stageDir)) mkdirSync(stageDir, { recursive: true });
    writeFileSync(resolve(stageDir, `${toolName}.ts`), result, "utf-8");
    return [
      `🎯 Generated: ${toolName}`,
      `Description: ${desc}`,
      `Code: ~/.config/phantom/generated/${toolName}.ts`,
      ``,
      `To integrate:`,
      `1. src/core/hacker-tools.ts — paste function before 'export const hackerTools'`,
      `2. Add to registry: ${toolName}: { description: "${desc.substring(0, 60)}", execute: ${toolName} },`,
      `3. phantom.mjs — paste into hackerTools object + registerHackerTools()`,
      `4. npm run build`,
      ``,
      result.substring(0, 600),
    ].join("\n");
  } catch (e: any) { return `[Self Add Error] ${e.message}`; }
}

// ── KNOWLEDGE BASE ───────────────────────────────────────
const KNOWLEDGE_DIR = resolve(homedir(), ".config", "phantom", "knowledge");

async function knowledgeAdd(input: string): Promise<string> {
  try {
    const parts = input.split("|");
    const tags = (parts[0] || "general").split(",").map(t => t.trim()).filter(Boolean);
    const content = parts.slice(1).join("|").trim();
    if (!content) return "[Knowledge] Usage: tags|content";
    if (!existsSync(KNOWLEDGE_DIR)) mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    const slug = tags[0].replace(/[^a-z0-9_-]/gi, "_") + "_" + Date.now();
    const entry = { tags, content, created: new Date().toISOString() };
    writeFileSync(resolve(KNOWLEDGE_DIR, `${slug}.json`), JSON.stringify(entry, null, 2), "utf-8");
    return `📚 Knowledge saved (tags: ${tags.join(", ")})`;
  } catch (e: any) { return `[Knowledge Error] ${e.message}`; }
}

async function knowledgeSearch(input: string): Promise<string> {
  try {
    if (!existsSync(KNOWLEDGE_DIR)) return "[Knowledge] Empty — add entries with knowledge_add";
    const q = input.toLowerCase().trim();
    const files = readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".json"));
    const results: string[] = [];
    for (const f of files) {
      const data = JSON.parse(readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8"));
      if (!q || data.tags.some((t: string) => t.toLowerCase().includes(q)) || data.content.toLowerCase().includes(q)) {
        results.push(`[${data.tags.join(", ")}] ${data.content.substring(0, 200)}`);
      }
    }
    if (results.length === 0) return `[Knowledge] No results for "${q}"`;
    return `📚 Knowledge (${results.length}):\n${results.join("\n")}`;
  } catch (e: any) { return `[Knowledge Error] ${e.message}`; }
}

// ── PLAYBOOKS ────────────────────────────────────────────
const PLAYBOOKS_DIR = resolve(homedir(), ".config", "phantom", "playbooks");

type PlaybookStep = { tool: string; args: string; desc: string };
type Playbook = { name: string; description: string; variables: string[]; steps: PlaybookStep[] };

const BUILTIN_PLAYBOOKS: Playbook[] = [
  { name: "quick_web_recon", description: "Full recon on a web target: WHOIS, DNS, subdomains, ports, headers, SSL", variables: ["target"], steps: [
    { tool: "whois", args: "{{target}}", desc: "WHOIS lookup for registration details" },
    { tool: "dns_lookup", args: "{{target}}", desc: "DNS records (A, MX, NS, TXT, etc.)" },
    { tool: "sub_enum", args: "{{target}}", desc: "Subdomain enumeration via crt.sh" },
    { tool: "port_scan", args: "{{target}}", desc: "TCP port scan of common ports" },
    { tool: "http_headers", args: "https://{{target}}", desc: "HTTP response headers" },
    { tool: "ssl_check", args: "{{target}}", desc: "SSL certificate analysis" },
  ]},
  { name: "vuln_assessment", description: "Full vulnerability assessment: recon + CVE + exploit search", variables: ["target"], steps: [
    { tool: "recon", args: "{{target}}", desc: "Full recon sweep" },
    { tool: "cve_search", args: "{{target}}", desc: "Search known CVEs" },
    { tool: "searchsploit", args: "{{target}}", desc: "Search public exploits" },
    { tool: "bruteforce", args: "ssh|{{target}}|root|admin,root,password", desc: "SSH brute force test" },
  ]},
  { name: "network_footprint", description: "Map a target's network footprint: DNS, whois, geo, ports", variables: ["target"], steps: [
    { tool: "dns_lookup", args: "{{target}}", desc: "DNS records" },
    { tool: "whois", args: "{{target}}", desc: "WHOIS registration" },
    { tool: "geoip", args: "{{target}}", desc: "GeoIP location" },
    { tool: "port_scan", args: "{{target}}", desc: "Open port discovery" },
    { tool: "crawl", args: "https://{{target}}", desc: "Web crawling" },
  ]},
  { name: "full_vulnscan_report", description: "Auto vuln_scan + save report + save session", variables: ["target"], steps: [
    { tool: "vuln_scan", args: "{{target}}", desc: "Full 4-phase vulnerability scan" },
    { tool: "session_save", args: "scan_{{target}}", desc: "Save session state" },
  ]},
];

async function ensureBuiltinPlaybooks(): Promise<void> {
  if (!existsSync(PLAYBOOKS_DIR)) mkdirSync(PLAYBOOKS_DIR, { recursive: true });
  for (const pb of BUILTIN_PLAYBOOKS) {
    const fp = resolve(PLAYBOOKS_DIR, `${pb.name}.json`);
    if (!existsSync(fp)) writeFileSync(fp, JSON.stringify(pb, null, 2), "utf-8");
  }
}

async function playbookCreate(input: string): Promise<string> {
  try {
    await ensureBuiltinPlaybooks();
    const parts = input.split("|");
    const name = (parts[0] || `pb_${Date.now()}`).replace(/[^a-z0-9_-]/gi, "_");
    const desc = parts[1] || "Auto-generated playbook";
    const stepsRaw = parts.slice(2).join("|") || `shell|echo "step 1"`;
    // Try LLM-powered generation
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && !stepsRaw.startsWith("shell")) {
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [
            { role: "system", content: "Generate a JSON playbook. Format: {name, description, variables: [\"target\"], steps: [{tool, args, desc}]}. Only reply with valid JSON." },
            { role: "user", content: `Create a playbook: ${desc}` }
          ], max_tokens: 1000 }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await r.json() as any;
        try { const pb = JSON.parse(data?.choices?.[0]?.message?.content || "{}"); if (pb.steps) { pb.name = name; pb.description = desc; writeFileSync(resolve(PLAYBOOKS_DIR, `${name}.json`), JSON.stringify(pb, null, 2), "utf-8"); return `✅ LLM-created playbook: ${name} (${pb.steps.length} steps)`; } } catch {}
      } catch {}
    }
    // Manual stub
    const steps = stepsRaw.split(",").map(s => ({ tool: "shell", args: s.trim(), desc: s.trim() }));
    const pb: Playbook = { name, description: desc, variables: ["target"], steps };
    writeFileSync(resolve(PLAYBOOKS_DIR, `${name}.json`), JSON.stringify(pb, null, 2), "utf-8");
    return `📋 Playbook created: ${name} (${steps.length} steps)`;
  } catch (e: any) { return `[Playbook Error] ${e.message}`; }
}

async function playbookList(): Promise<string> {
  try {
    await ensureBuiltinPlaybooks();
    const files = readdirSync(PLAYBOOKS_DIR).filter(f => f.endsWith(".json"));
    if (files.length === 0) return "[Playbook] No playbooks found";
    const lines = files.map(f => {
      const pb = JSON.parse(readFileSync(resolve(PLAYBOOKS_DIR, f), "utf-8"));
      return `📋 ${pb.name} — ${pb.description?.substring(0, 80)} (${pb.steps?.length || 0} steps)`;
    });
    return `Available playbooks (${files.length}):\n${lines.join("\n")}`;
  } catch (e: any) { return `[Playbook Error] ${e.message}`; }
}

async function playbookRun(input: string): Promise<string> {
  try {
    await ensureBuiltinPlaybooks();
    const parts = input.split("|");
    const name = parts[0]?.trim();
    if (!name) return "[Playbook] Usage: playbook_run|name|var1=val1,var2=val2";
    const fp = resolve(PLAYBOOKS_DIR, `${name.replace(/[^a-z0-9_-]/gi, "_")}.json`);
    if (!existsSync(fp)) return `[Playbook] Not found: ${name}`;
    const pb: Playbook = JSON.parse(readFileSync(fp, "utf-8"));
    // Parse variable assignments
    const vars: Record<string, string> = {};
    if (parts[1]) {
      parts[1].split(",").forEach(p => { const [k, v] = p.split("="); if (k && v) vars[k.trim()] = v.trim(); });
    }
    const log: string[] = [`Executing playbook: ${pb.name}`, `Description: ${pb.description}`, `---`, ``];
    for (let i = 0; i < pb.steps.length; i++) {
      const step = pb.steps[i];
      let args = step.args;
      for (const [k, v] of Object.entries(vars)) args = args.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
      log.push(`Step ${i + 1}/${pb.steps.length}: @${step.tool}|${args} — ${step.desc}`);
      try {
        const tool = hackerTools[step.tool];
        if (!tool) { log.push(`  ⚠ Unknown tool: ${step.tool}`); continue; }
        const result = await tool.execute(args);
        log.push(`  ${result.substring(0, 1000)}`);
        if (result.length > 1000) log.push(`  … (${result.length} total chars)`);
      } catch (e: any) { log.push(`  ⚠ Error: ${e.message}`); }
      log.push(``);
    }
    log.push(`---\n✅ Playbook "${pb.name}" complete (${pb.steps.length} steps)`);
    return log.join("\n");
  } catch (e: any) { return `[Playbook Error] ${e.message}`; }
}

async function playbookEdit(input: string): Promise<string> {
  try {
    const parts = input.split("|");
    const name = parts[0]?.trim();
    if (!name) return "[Playbook] Usage: playbook_edit|name|step_index|new_tool|new_args|new_desc";
    const fp = resolve(PLAYBOOKS_DIR, `${name.replace(/[^a-z0-9_-]/gi, "_")}.json`);
    if (!existsSync(fp)) return `[Playbook] Not found: ${name}`;
    const pb: Playbook = JSON.parse(readFileSync(fp, "utf-8"));
    if (parts[1] === "desc" && parts[2]) { pb.description = parts[2]; writeFileSync(fp, JSON.stringify(pb, null, 2), "utf-8"); return `✅ Description updated`; }
    if (parts[1] === "add" && parts[2]) { pb.steps.push({ tool: parts[2], args: parts[3] || "", desc: parts[4] || parts[2] }); writeFileSync(fp, JSON.stringify(pb, null, 2), "utf-8"); return `✅ Step added`; }
    const idx = parseInt(parts[1]) - 1;
    if (isNaN(idx) || idx < 0 || idx >= pb.steps.length) return `[Playbook] Invalid step index. Steps: 1-${pb.steps.length}`;
    if (parts[2]) pb.steps[idx].tool = parts[2];
    if (parts[3]) pb.steps[idx].args = parts[3];
    if (parts[4]) pb.steps[idx].desc = parts[4];
    writeFileSync(fp, JSON.stringify(pb, null, 2), "utf-8");
    return `✅ Playbook "${name}" step ${idx+1} updated: @${pb.steps[idx].tool}|${pb.steps[idx].args}`;
  } catch (e: any) { return `[Playbook Error] ${e.message}`; }
}

// ── NEW RECON TOOLS ──────────────────────────────────────
async function geoip(input: string): Promise<string> {
  try {
    const ip = input.trim();
    // Try ip-api.com free tier
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,zip,lat,lon,isp,org,as,query`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json() as any;
    if (d.status === "fail") return `[GeoIP] ${d.message || "Unknown"}`;
    return [
      `🌍 GeoIP: ${d.query}`,
      `Country: ${d.country}`,
      `Region: ${d.regionName}`,
      `City: ${d.city}`,
      `ZIP: ${d.zip}`,
      `Coordinates: ${d.lat}, ${d.lon}`,
      `ISP: ${d.isp}`,
      `Org: ${d.org}`,
      `ASN: ${d.as}`,
    ].join("\n");
  } catch (e: any) { return `[GeoIP Error] ${e.message}`; }
}

async function dnsZoneTransfer(input: string): Promise<string> {
  try {
    const domain = input.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    // Get NS records
    const nsResp = await fetch(`https://dns.google/resolve?name=${domain}&type=NS`, { signal: AbortSignal.timeout(8000) });
    const nsData = await nsResp.json() as any;
    const nsList = nsData?.Answer?.map((a: any) => a.data.replace(/\.$/, "")) || [];
    if (nsList.length === 0) return "[DNS Zone] No NS records found";
    const results: string[] = [`Testing ${nsList.length} name servers for zone transfer on ${domain}:`, ``];
    for (const ns of nsList) {
      try {
        const r = await fetch(`https://dns.google/resolve?name=${domain}&type=AXFR&nameserver=${ns}`, { signal: AbortSignal.timeout(10000) });
        const data = await r.json() as any;
        if (data?.Answer?.length > 0) { results.push(`⚠ VULNERABLE: ${ns} returned ${data.Answer.length} records!`); data.Answer.forEach((a: any) => results.push(`  ${a.name} ${a.type} ${a.data}`)); }
        else results.push(`✅ ${ns} — zone transfer denied`);
      } catch { results.push(`⏰ ${ns} — timeout/error`); }
    }
    return results.join("\n");
  } catch (e: any) { return `[DNS Zone Error] ${e.message}`; }
}

async function httpMethods(input: string): Promise<string> {
  try {
    const url = input.startsWith("http") ? input : `https://${input}`;
    const methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD", "TRACE", "CONNECT"];
    const results: string[] = [`Testing HTTP methods on ${url}:`, ``];
    for (const method of methods) {
      try {
        const r = await fetch(url, { method, signal: AbortSignal.timeout(5000) });
        const allow = r.headers.get("allow") || r.headers.get("access-control-allow-methods") || "";
        results.push(`  ${method} → ${r.status}${allow ? ` (Allow: ${allow})` : ""}`);
      } catch (e: any) { results.push(`  ${method} → Error: ${e.message.substring(0, 60)}`); }
    }
    return results.join("\n");
  } catch (e: any) { return `[HTTP Methods Error] ${e.message}`; }
}

async function robotsTxt(input: string): Promise<string> {
  try {
    const baseUrl = input.startsWith("http") ? input : `https://${input}`;
    const url = `${baseUrl.replace(/\/+$/, "")}/robots.txt`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.status === 404) return `[robots.txt] Not found at ${url}`;
    const text = await r.text();
    // Parse interesting entries
    const disallowed = text.match(/Disallow:\s*(.+)/gi) || [];
    const sitemaps = text.match(/Sitemap:\s*(.+)/gi) || [];
    const comments = text.match(/#.*/g) || [];
    return [
      `🤖 robots.txt from ${url}:`,
      `---`,
      text.substring(0, 2000),
      ...(disallowed.length > 0 ? [`\n🚫 Disallowed paths (${disallowed.length}):`, ...disallowed] : []),
      ...(sitemaps.length > 0 ? [`\n🗺 Sitemaps (${sitemaps.length}):`, ...sitemaps] : []),
    ].join("\n");
  } catch (e: any) { return `[robots.txt Error] ${e.message}`; }
}

async function emailVerify(input: string): Promise<string> {
  try {
    const email = input.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return `[Email] Invalid format: ${email}`;
    const domain = email.split("@")[1];
    // Check MX records via DNS Google
    const r = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`, { signal: AbortSignal.timeout(8000) });
    const data = await r.json() as any;
    const mxRecords = data?.Answer?.filter((a: any) => a.type === 15) || [];
    if (mxRecords.length === 0) return `[Email] ✅ Format valid, but no MX records for ${domain} — domain may not accept mail`;
    const mxList = mxRecords.map((a: any) => a.data.replace(/\.$/, "")).join(", ");
    return `✅ ${email}\nDomain: ${domain}\nMX servers: ${mxList}\nMail delivery likely: YES`;
  } catch (e: any) { return `[Email Error] ${e.message}`; }
}

export const hackerTools: Record<string, HackerTool> = {
  shell: {
    description:
      "Execute ANY shell command on the system. Use for: running tools, scripts, file operations, network scans, system info, package management. Input: shell command string.",
    execute: shell,
  },
  web_fetch: {
    description:
      "Fetch a URL and return its content (HTML stripped, plain text). Use for: reading web pages, APIs, documentation, checking endpoints. Input: full URL including https://.",
    execute: webFetch,
  },
  decode: {
    description:
      "Auto-detect and decode encoded strings. Tries base64, hex, URL encoding, binary, and ROT13. Use for: decoding obfuscated strings, payloads, and encoded data. Input: the encoded string.",
    execute: decode,
  },
  file_analyze: {
    description:
      "Deep file analysis: file type detection by magic bytes, MD5/SHA1/SHA256 hashes, entropy calculation (detects packed/encrypted malware), and printable string extraction. Use for: malware analysis, file forensics, verifying file integrity. Input: absolute file path.",
    execute: fileAnalyze,
  },
  dns_lookup: {
    description:
      "DNS reconnaissance: resolves A, AAAA, MX, NS, TXT, CNAME, and SOA records for a domain. Use for: OSINT, domain recon, infrastructure discovery. Input: domain name (no http://).",
    execute: dnsLookup,
  },
  hash: {
    description:
      "Compute MD5, SHA1, SHA256 hash of text or a file. Use for: integrity checks, verifying downloads, fingerprinting. Input: text string or file path.",
    execute: hash,
  },

  // ── NEW TOOLS ──
  whois: {
    description:
      "WHOIS lookup for a domain. Returns registrar, dates, name servers, and contact info. Use for: OSINT, domain investigation, ownership discovery. Input: domain name (no http://).",
    execute: whois,
  },
  port_scan: {
    description:
      "TCP port scan a host. Scans common ports (FTP, SSH, HTTP, etc.) by default. Custom: host:port1,port2 or host:start-end. Use for: network recon, vulnerability assessment. Input: hostname or IP, optionally with port range.",
    execute: portScan,
  },
  http_headers: {
    description:
      "Fetch HTTP response headers from a URL using HEAD request. Shows status, security headers, server info, content-type. Use for: web recon, security header audit. Input: full URL including https://.",
    execute: httpHeaders,
  },
  ssl_check: {
    description:
      "Check SSL/TLS certificate details for a host. Shows issuer, validity, cipher, SANs, days remaining. Use for: certificate expiry monitoring, TLS security audit. Input: hostname (optionally :port, default 443).",
    execute: sslCheck,
  },
  sub_enum: {
    description:
      "Enumerate subdomains via certificate transparency logs (crt.sh). Use for: OSINT, attack surface mapping, discovering hidden assets. Input: domain name (no http://).",
    execute: subdomainEnum,
  },
  crawl: {
    description:
      "Crawl a web page: fetch HTML, extract all links, forms, and script sources. Use for: web recon, asset discovery, spidering. Input: full URL including https://.",
    execute: webCrawl,
  },
  vt_check: {
    description:
      "Check a file hash against VirusTotal. Shows detection ratio, file type, names, and top malicious engine results. Requires VT_API_KEY env var. Input: MD5/SHA1/SHA256 hash.",
    execute: vtCheck,
  },
  yara: {
    description:
      "Scan a file with YARA rules. Format: rules_file|target_path, or just target_path. Use for: malware pattern matching, IOC scanning. Requires yara CLI installed. Input: rules_and_target.",
    execute: yaraScan,
  },

  // ── AUTO WORKFLOWS ──
  recon: {
    description:
      "FULL AUTOMATED RECON: runs WHOIS → DNS → subdomains → HTTP headers → SSL → port scan → crawl. Saves timestamped report to disk. Use for: one-shot surface mapping, asset discovery, target profiling. Input: domain or URL.",
    execute: recon,
  },
  cve_search: {
    description:
      "Search NVD (National Vulnerability Database) for CVEs matching a query. Shows CVE ID, CVSS score, severity, description, and NVD link. Use for: finding known vulns for software/version. Input: search query (e.g. 'apache 2.4.49' or 'nginx 1.20').",
    execute: cveSearch,
  },
  searchsploit: {
    description:
      "Search for public exploits. Tries local searchsploit CLI first, falls back to packetstorm. Use for: finding PoC exploits for a vulnerability or software. Input: search query (e.g. 'WordPress 5.8' or 'CVE-2024-XXXX').",
    execute: searchsploit,
  },
  bruteforce: {
    description:
      "Multi-protocol brute force login. Supports SSH, FTP, HTTP POST, and MySQL. Format: protocol|target|user|pass1,pass2,pass3. Use for: password testing, credential auditing. Input: protocol|target|username|comma-separated-passwords.",
    execute: bruteforceFn,
  },

  // ── FILE TOOLS ──
  file_read: {
    description:
      "Read the contents of any file on the system. Use for: viewing source code, configs, logs, data files. Shows full content (max 100KB). Input: absolute or relative file path.",
    execute: fileRead,
  },
  file_write: {
    description:
      "Write content to a file (creates or overwrites). Creates parent directories automatically. Use for: saving generated code, writing scripts, creating config files. Format: path|content — separate path and content with pipe.",
    execute: fileWrite,
  },
  file_edit: {
    description:
      "Find and replace text in an existing file. Uses exact string matching (not regex). Use for: patching code, modifying configs, fixing errors. Format: path|old_string|new_string — pipe-separated.",
    execute: fileEdit,
  },
  file_search: {
    description:
      "Search file contents for a text pattern across a directory. Uses ripgrep if available. Use for: finding code references, error messages, configuration values. Format: [directory|]pattern — defaults to current dir.",
    execute: fileSearch,
  },
  file_list: {
    description:
      "List files and directories in a path. Shows file sizes, dir count. Use for: exploring project structure, finding files, directory recon. Input: directory path (defaults to current dir).",
    execute: fileList,
  },

  // ── SELF TOOLS ──
  self_info: {
    description:
      "Show Phantom's own information: version, runtime, platform, all available tools, source file tree, LLM connection status, config paths. Use for: self-awareness, capability discovery, debugging.",
    execute: selfInfo,
  },
  self_read: {
    description:
      "Read Phantom's own source files (locked to project directory). Use for: code review, understanding architecture, self-modification planning. Input: relative path from project root (e.g. 'phantom.mjs' or 'src/core/hacker-tools.ts').",
    execute: selfRead,
  },
  self_edit: {
    description:
      "Edit Phantom's own source code (locked to project directory). Use for: self-improvement, adding tools, fixing bugs, evolving capabilities. Format: relative_path|old_string|new_string — pipe-separated.",
    execute: selfEdit,
  },

  // ── AUTO SCAN ──
  vuln_scan: {
    description:
      "FULL AUTOMATED VULNERABILITY SCAN: runs Phase 1 recon (WHOIS/DNS/subdomains/headers/SSL/ports) → Phase 2 CVE search → Phase 3 exploit search → Phase 4 brute force. Saves comprehensive markdown report with all findings. Input: domain or URL.",
    execute: vulnScan,
  },
  report_save: {
    description:
      "Save text content as a timestamped markdown report file. Use for: documenting findings, saving scan results, creating evidence. Format: name|content — name is the report filename (saved to ~/.config/phantom/reports/).",
    execute: reportSave,
  },
  session_save: {
    description:
      "Save current Phantom session state to a named session file. Use for: bookmarking work, preserving findings between runs. Input: session name (alphanumeric, underscores/hyphens).",
    execute: sessionSave,
  },
  session_load: {
    description:
      "Load a previously saved Phantom session. Use for: resuming work, reviewing past findings. Input: session name.",
    execute: sessionLoad,
  },
  code_gen: {
    description:
      "Generate code using OpenAI LLM (requires OPENAI_API_KEY). Falls back to a stub template. Format: prompt|language|output_path. Use for: writing functions, scripts, exploits, tools autonomously.",
    execute: codeGen,
  },
  self_add_tool: {
    description:
      "Generate a new Phantom tool using LLM and save it for integration. Requires OPENAI_API_KEY. Input: natural language description of the tool (e.g. 'check if a site uses HSTS header'). Saves generated code to ~/.config/phantom/generated/.",
    execute: selfAddTool,
  },

  // ── KNOWLEDGE BASE ──
  knowledge_add: {
    description:
      "Add an entry to Phantom's persistent knowledge base. Use for: saving findings, techniques, commands for future reference. Format: tag1,tag2|content. Searchable with knowledge_search.",
    execute: knowledgeAdd,
  },
  knowledge_search: {
    description:
      "Search Phantom's knowledge base by keyword or tag. Use for: retrieving past findings, techniques, learned information. Input: search query.",
    execute: knowledgeSearch,
  },

  // ── PLAYBOOK SYSTEM ──
  playbook_create: {
    description:
      "Create a new executable playbook (multi-step automation script). Uses LLM if OPENAI_API_KEY set. Format: name|description|step1,step2,... or just name|description for LLM generation.",
    execute: playbookCreate,
  },
  playbook_list: {
    description:
      "List all available playbooks with descriptions and step counts. Includes 4 built-in playbooks: quick_web_recon, vuln_assessment, network_footprint, full_vulnscan_report.",
    execute: playbookList,
  },
  playbook_run: {
    description:
      "Execute a playbook against a target. Steps run sequentially with variable substitution ({{target}}). Input: playbook_name|target=example.com,port=80. Returns full execution log.",
    execute: playbookRun,
  },
  playbook_edit: {
    description:
      "Modify a playbook: edit steps, change description, or append new steps. Format: name|step_num|tool|args|desc or name|desc|new_description or name|add|tool|args|desc.",
    execute: playbookEdit,
  },

  // ── RECON TOOLS ──
  geoip: {
    description:
      "IP geolocation lookup via ip-api.com (free, no key). Shows country, region, city, coordinates, ISP, ASN. Use for: locating target servers, tracing attack origins. Input: IP address or domain.",
    execute: geoip,
  },
  dns_zone: {
    description:
      "Test DNS zone transfer (AXFR) on all authoritative name servers. Use for: finding DNS misconfigurations that leak internal network structure. Input: domain name.",
    execute: dnsZoneTransfer,
  },
  http_methods: {
    description:
      "Fuzz HTTP methods on a target URL. Tests GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD, TRACE, CONNECT. Shows status codes and Allow headers. Input: URL.",
    execute: httpMethods,
  },
  robots_txt: {
    description:
      "Fetch and analyze robots.txt from a target. Shows all rules, disallowed paths, sitemaps, and comments. Use for: discovering hidden/disallowed endpoints. Input: domain or URL.",
    execute: robotsTxt,
  },
  email_verify: {
    description:
      "Validate email format and check domain MX records. Use for: verifying email deliverability, recon on email infrastructure. Input: email address.",
    execute: emailVerify,
  },
};
