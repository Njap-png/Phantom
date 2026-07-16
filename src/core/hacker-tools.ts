import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
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

// ── Tool Registry ─────────────────────────────────────────

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
};
