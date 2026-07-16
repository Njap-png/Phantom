import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import * as dns from "dns/promises";

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
        if (Array.isArray(val) && val.length) {
          if (label === "MX")
            results.push(
              `  MX: ${val
                .map((m: any) => `${m.exchange} (prio ${m.priority})`)
                .join(", ")}`
            );
          else if (label === "TXT")
            results.push(`  TXT: ${val.flat().join(", ")}`);
          else if (label === "SOA")
            results.push(
              `  SOA: ${val.nsname} (admin: ${val.hostmaster})`
            );
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
};
