import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { pathToFileURL } from "url";
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

// ── SANDBOX (Isolated Binary Execution) ─────────────────────
async function sandboxExec(input: string): Promise<string> {
  // Format: path|args|timeout(seconds) — or just path
  const parts = input.split("|").map(s => s.trim());
  const binaryPath = parts[0];
  const binaryArgs = parts[1] || "";
  const timeoutSec = parseInt(parts[2]) || 15;

  try {
    if (!existsSync(binaryPath)) return `[Sandbox] File not found: ${binaryPath}`;

    // Check file type
    const buf = readFileSync(binaryPath);
    const magic = buf.slice(0, 4).toString("hex");
    const isElf = magic.startsWith("7f454c46");
    const isScript = buf.slice(0, 3).toString() === "#!/";
    const isPe = magic.startsWith("4d5a");

    const report: string[] = [
      `🧪 Sandbox Execution Report`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Binary: ${binaryPath}`,
      `Size: ${buf.length} bytes (${(buf.length / 1024).toFixed(1)} KB)`,
      `Type: ${isElf ? "ELF (Linux)" : isScript ? "Script" : isPe ? "PE (Windows — cannot execute on Linux)" : "Unknown"}`,
      `SHA256: ${createHash("sha256").update(buf).digest("hex")}`,
      ``,
    ];

    if (isPe) {
      report.push("⚠ PE files require Windows/Wine to execute. Static analysis only.");
      report.push("→ Use @pe_analyze|" + binaryPath + " for deeper PE analysis.");
      return report.join("\n");
    }

    if (!isElf && !isScript) {
      report.push("⚠ Not an ELF or script — cannot execute directly.");
      return report.join("\n");
    }

    // Create sandbox directory
    const sandboxDir = resolve(homedir(), ".config", "phantom", "sandbox", `run_${Date.now()}`);
    mkdirSync(sandboxDir, { recursive: true });
    const sandboxPath = resolve(sandboxDir, "target");

    // Copy file to sandbox
    writeFileSync(sandboxPath, buf);
    try { execSync(`chmod +x '${sandboxPath}'`, { timeout: 3000 }); } catch {}

    const tmpDir = resolve(sandboxDir, "tmp");
    mkdirSync(tmpDir, { recursive: true });

    report.push(`🔒 Sandbox: ${sandboxDir}`);
    report.push(`⏱  Timeout: ${timeoutSec}s`);
    report.push(``);

    // Try strace first for deeper analysis
    let hasStrace = false;
    try { execSync("which strace", { encoding: "utf-8", timeout: 3000 }); hasStrace = true; } catch {}

    if (hasStrace) {
      const straceLog = resolve(sandboxDir, "strace.log");
      try {
        const straceCmd = `strace -f -e trace=process,network,file,ipc -o '${straceLog}' timeout ${timeoutSec} '${sandboxPath}' ${binaryArgs} 2>&1`;
        const r = execSync(straceCmd, { encoding: "utf-8", timeout: (timeoutSec + 10) * 1000, maxBuffer: 1024 * 1024, cwd: tmpDir });
        const stdout = r.substring(0, 3000);
        if (stdout.trim()) report.push(`📤 stdout/stderr:\n${stdout}`);
      } catch (e: any) {
        const out = e.stdout?.substring(0, 2000) || "";
        if (out.trim()) report.push(`📤 stdout:\n${out}`);
      }

      // Parse strace log for interesting syscalls
      if (existsSync(straceLog)) {
        const strace = readFileSync(straceLog, "utf-8");
        const lines = strace.split("\n").filter(Boolean);
        report.push(`\n📋 Syscalls: ${lines.length} total`);

        // Extract key behaviors
        const netCalls = lines.filter(l => l.includes("connect(") || l.includes("socket(") || l.includes("bind("));
        const fileCalls = lines.filter(l => l.includes("open(") || l.includes("openat("));
        const procCalls = lines.filter(l => l.includes("clone(") || l.includes("fork(") || l.includes("execve("));
        const ipcCalls = lines.filter(l => l.includes("shmget") || l.includes("semop") || l.includes("msgget"));

        if (netCalls.length) report.push(`🌐 Network: ${netCalls.length} call(s) — possible C2 or beaconing`);
        if (fileCalls.length) report.push(`📁 File I/O: ${fileCalls.length} call(s)`);
        if (procCalls.length) report.push(`🔧 Process: ${procCalls.length} fork/execve(s)`);
        if (ipcCalls.length) report.push(`🔗 IPC: ${ipcCalls.length} call(s)`);

        // Show first 5 interesting lines of each category
        for (const [cat, arr] of Object.entries({ "Network": netCalls, "File": fileCalls, "Process": procCalls })) {
          if (arr.length) {
            const sample = arr.slice(0, 5).map(l => "  " + l.substring(0, 160)).join("\n");
            report.push(`\n${cat} (sample):\n${sample}`);
          }
        }
      }
    } else {
      // Run without strace
      try {
        const r = execSync(`timeout ${timeoutSec} '${sandboxPath}' ${binaryArgs} 2>&1`, {
          encoding: "utf-8", timeout: (timeoutSec + 5) * 1000, maxBuffer: 1024 * 1024, cwd: tmpDir,
        });
        const out = r.substring(0, 3000);
        if (out.trim()) report.push(`📤 Output:\n${out}`);
        else report.push("📤 (no stdout output)");
      } catch (e: any) {
        const out = e.stdout?.substring(0, 2000) || "";
        const err = e.stderr?.substring(0, 1000) || e.message || "";
        if (out.trim()) report.push(`📤 stdout:\n${out}`);
        if (err.trim()) report.push(`📤 stderr:\n${err}`);
        if (e.status !== null) report.push(`🚦 Exit code: ${e.status}`);
      }
    }

    // Cleanup on success
    report.push(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    report.push(`✅ Sandbox completed. Cleanup: rm -rf ${sandboxDir}`);

    return report.join("\n");
  } catch (e: any) {
    return `[Sandbox Error] ${e.message}`;
  }
}

// ── PE ANALYZER ────────────────────────────────────────────
async function peAnalyze(path: string): Promise<string> {
  try {
    if (!existsSync(path)) return `[PE] File not found: ${path}`;
    const buf = readFileSync(path);
    const magic = buf.slice(0, 2).toString();
    if (magic !== "MZ") return `[PE] Not a PE file (no MZ magic): ${path}`;

    const lines: string[] = [`📦 PE Analysis: ${path}`, `Size: ${buf.length} bytes`, ``];

    // DOS Header
    const e_lfanew = buf.readUInt32LE(0x3c); // offset to PE signature
    lines.push(`DOS Header:`);
    lines.push(`  e_lfanew (PE offset): 0x${e_lfanew.toString(16)}`);

    // PE Signature
    const peSig = buf.slice(e_lfanew, e_lfanew + 4).toString();
    if (peSig !== "PE\0\0") return `[PE] Invalid PE signature at offset 0x${e_lfanew.toString(16)}: ${peSig}`;
    lines.push(`PE Signature: ${peSig}`);

    // COFF Header
    const coffOff = e_lfanew + 4;
    const machine = buf.readUInt16LE(coffOff);
    const sections = buf.readUInt16LE(coffOff + 2);
    const timestamp = buf.readUInt32LE(coffOff + 8);
    const characteristics = buf.readUInt16LE(coffOff + 20);

    const machines: Record<number, string> = {
      0x14c: "I386", 0x8664: "AMD64", 0x1c0: "ARM", 0xaa64: "ARM64",
      0x200: "IA64", 0x1c4: "ARMNT", 0x4c: "MIPS", 0x162: "MIPS16",
    };

    const compileDate = timestamp ? new Date(timestamp * 1000).toISOString() : "N/A";

    lines.push(`\nCOFF Header:`);
    lines.push(`  Machine: ${machines[machine] || `0x${machine.toString(16)}`}`);
    lines.push(`  Sections: ${sections}`);
    lines.push(`  Compile Timestamp: ${compileDate} ${timestamp ? `(0x${timestamp.toString(16)})` : ""}`);
    lines.push(`  Characteristics: 0x${characteristics.toString(16)}`);
    if (characteristics & 0x2000) lines.push(`  → DLL`);

    // Optional Header
    const optHdrOff = coffOff + 24;
    const optMagic = buf.readUInt16LE(optHdrOff);

    if (optMagic === 0x10b || optMagic === 0x20b) {
      const isPE32Plus = optMagic === 0x20b;
      const entryPoint = isPE32Plus ? buf.readUInt32LE(optHdrOff + 16) : buf.readUInt32LE(optHdrOff + 16);
      const imageBase = isPE32Plus ? buf.readBigUInt64LE(optHdrOff + 24).toString() : `0x${buf.readUInt32LE(optHdrOff + 28).toString(16)}`;
      const sectionAlign = isPE32Plus ? buf.readUInt32LE(optHdrOff + 32) : buf.readUInt32LE(optHdrOff + 32);
      const fileAlign = isPE32Plus ? buf.readUInt32LE(optHdrOff + 36) : buf.readUInt32LE(optHdrOff + 36);
      const imageSize = isPE32Plus ? buf.readUInt32LE(optHdrOff + 56) : buf.readUInt32LE(optHdrOff + 52);
      const subsystems: Record<number, string> = { 1: "NATIVE", 2: "WINDOWS_GUI", 3: "WINDOWS_CUI", 5: "OS2", 7: "POSIX" };
      const subsystem = isPE32Plus ? buf.readUInt16LE(optHdrOff + 68) : buf.readUInt16LE(optHdrOff + 68);
      const dllChars = isPE32Plus ? buf.readUInt16LE(optHdrOff + 70) : buf.readUInt16LE(optHdrOff + 70);

      lines.push(`\nOptional Header (PE${isPE32Plus ? "32+" : "32"}):`);
      lines.push(`  Entry Point: 0x${entryPoint.toString(16)}`);
      lines.push(`  Image Base: ${imageBase}`);
      lines.push(`  Section Align: 0x${sectionAlign.toString(16)}`);
      lines.push(`  File Align: 0x${fileAlign.toString(16)}`);
      lines.push(`  Image Size: ${(imageSize / 1024).toFixed(1)} KB (0x${imageSize.toString(16)})`);
      lines.push(`  Subsystem: ${subsystems[subsystem] || `0x${subsystem.toString(16)}`}`);
      if (dllChars & 0x40) lines.push(`  ⚠ DLL has TLS callbacks (malware indicator)`);

      // ── Section Table ──
      const sectionOff = optHdrOff + (isPE32Plus ? 108 : 96);
      lines.push(`\nSection Table (${sections} sections):`);

      let allSections: string[] = [];
      const suspiciousSections = [".text", ".data", ".rdata", ".idata", ".rsrc", ".reloc"];
      for (let i = 0; i < sections; i++) {
        const sOff = sectionOff + i * 40;
        const name = buf.slice(sOff, sOff + 8).toString().replace(/\0/g, "");
        const vsize = buf.readUInt32LE(sOff + 8);
        const vaddr = buf.readUInt32LE(sOff + 12);
        const rsize = buf.readUInt32LE(sOff + 16);
        const roff = buf.readUInt32LE(sOff + 20);
        const chars = buf.readUInt32LE(sOff + 36);

        const charFlags: string[] = [];
        if (chars & 0x20) charFlags.push("CODE");
        if (chars & 0x40) charFlags.push("INIT_DATA");
        if (chars & 0x80) charFlags.push("UNINIT_DATA");
        if (chars & 0x20000000) charFlags.push("EXECUTE");
        if (chars & 0x40000000) charFlags.push("READ");
        if (chars & 0x80000000) charFlags.push("WRITE");

        const isSuspicious = !suspiciousSections.includes(name) && !name.startsWith(".") && name.length > 0;
        const hasWriteAndExec = (chars & 0x20000000) && (chars & 0x80000000);
        const marker = isSuspicious ? " ⚠ non-standard" : hasWriteAndExec ? " ⚠ W+X" : "";

        allSections.push(`  [${i}] ${name.padEnd(10)} VSize: ${(vsize/1024).toFixed(1)}K  VAddr: 0x${vaddr.toString(16).padStart(8, "0")}  Raw: ${(rsize/1024).toFixed(1)}K  Flags: ${charFlags.join("|")}${marker}`);
      }
      lines.push(...allSections);

      // ── Data Directories (check for import/export) ──
      const dataDirOff = optHdrOff + (isPE32Plus ? 112 : 96) + sections * 40;
      const numDataDirs = isPE32Plus ? buf.readUInt32LE(optHdrOff + 108) : buf.readUInt32LE(optHdrOff + 92);

      if (numDataDirs > 0) {
        lines.push(`\nData Directories (first 8):`);
        const dirNames = ["Export", "Import", "Resource", "Exception", "Security", "Relocation", "Debug", "TLS"];
        for (let i = 0; i < Math.min(8, numDataDirs); i++) {
          const dOff = dataDirOff + i * 8;
          const va = buf.readUInt32LE(dOff);
          const sz = buf.readUInt32LE(dOff + 4);
          if (va || sz) lines.push(`  ${dirNames[i]?.padEnd(12)} VA: 0x${va.toString(16).padStart(8,"0")}  Size: ${sz}`);
        }
      }

      // ── Import Table (basic parse) ──
      if (numDataDirs > 1) {
        const importDirRVA = buf.readUInt32LE(dataDirOff + 8);
        const importDirSize = buf.readUInt32LE(dataDirOff + 12);
        if (importDirRVA && importDirSize > 0) {
          lines.push(`\nImport Table (${importDirSize} bytes at RVA 0x${importDirRVA.toString(16)}):`);
          lines.push(`  (Use a PE parser tool for full import listing)`);
        }
      }

    } else {
      lines.push(`\n⚠ Unknown Optional Header magic: 0x${optMagic.toString(16)}`);
    }

    // ── Entropy / Suspicious Indicators ──
    let freq = new Map<number, number>();
    for (let i = 0; i < buf.length; i++) freq.set(buf[i], (freq.get(buf[i]) || 0) + 1);
    let entropy = 0;
    for (const count of freq.values()) { const p = count / buf.length; entropy -= p * Math.log2(p); }
    lines.push(`\nEntropy: ${entropy.toFixed(4)} ${entropy > 7.2 ? "⚠ SUSPICIOUS (packed/encrypted)" : entropy > 6.5 ? "⚠ High" : "— Normal"}`);

    // Check for suspicious section names
    const knownBad = [".upx", ".packed", ".themida", ".vmp"];
    // check all section names
    const sectionNames: string[] = [];
    // re-parse section names from section table
    const optHdrSz = (optMagic === 0x20b) ? 108 : 96;
    const secOff = optHdrOff + optHdrSz;
    for (let i = 0; i < sections; i++) {
      const sOff = secOff + i * 40;
      const n = buf.slice(sOff, sOff + 8).toString().replace(/\0/g, "");
      sectionNames.push(n);
    }
    const packerMatches = knownBad.filter(b => sectionNames.some(sn => sn.toLowerCase().includes(b)));
    if (packerMatches.length) lines.push(`⚠ Packer detected: ${packerMatches.join(", ")}`);

    return lines.join("\n");
  } catch (e: any) {
    return `[PE Error] ${e.message}`;
  }
}

// ── ELF ANALYZER ───────────────────────────────────────────
async function elfAnalyze(path: string): Promise<string> {
  try {
    if (!existsSync(path)) return `[ELF] File not found: ${path}`;
    const buf = readFileSync(path);
    if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46)
      return `[ELF] Not an ELF file`;

    const is64 = buf[4] === 2; // EI_CLASS
    const endian = buf[5] === 1 ? "Little Endian" : "Big Endian";
    const osabi = buf[7];
    const osabiNames: Record<number, string> = { 0: "UNIX System V", 3: "GNU/Linux", 9: "FreeBSD", 12: "OpenBSD" };
    const etype = is64 ? buf.readUInt16LE(16) : buf.readUInt16LE(16);
    const typeNames: Record<number, string> = { 0: "NONE", 1: "REL (Relocatable)", 2: "EXEC (Executable)", 3: "DYN (Shared Object)", 4: "CORE" };
    const emachine = is64 ? buf.readUInt16LE(18) : buf.readUInt16LE(18);
    const machineNames: Record<number, string> = { 3: "i386", 62: "x86-64", 40: "ARM", 183: "AArch64", 50: "IA-64", 20: "PowerPC", 21: "PowerPC64", 8: "MIPS", 243: "RISC-V" };
    const entry = is64 ? buf.readBigUInt64LE(24) : buf.readUInt32LE(24);
    const phoff = is64 ? Number(buf.readBigUInt64LE(32)) : buf.readUInt32LE(28);
    const shoff = is64 ? Number(buf.readBigUInt64LE(40)) : buf.readUInt32LE(32);
    const phnum = is64 ? buf.readUInt16LE(56) : buf.readUInt16LE(44);
    const shnum = is64 ? buf.readUInt16LE(60) : buf.readUInt16LE(48);
    const shstrndx = is64 ? buf.readUInt16LE(62) : buf.readUInt16LE(50);

    const lines: string[] = [
      `🐧 ELF Analysis: ${path}`,
      `Size: ${buf.length} bytes`,
      `Class: ${is64 ? "ELF64" : "ELF32"}`,
      `Byte Order: ${endian}`,
      `OS/ABI: ${osabiNames[osabi] || `0x${osabi.toString(16)}`}`,
      `Type: ${typeNames[etype] || `0x${etype.toString(16)}`}`,
      `Machine: ${machineNames[emachine] || `0x${emachine.toString(16)}`}`,
      `Entry Point: 0x${entry.toString(16)}`,
      `Section Headers: ${shnum} (offset 0x${shoff.toString(16)})`,
      `Program Headers: ${phnum} (offset 0x${phoff.toString(16)})`,
      ``,
    ];

    // Program Headers
    if (phnum > 0 && phoff > 0) {
      const phent = is64 ? 56 : 32;
      lines.push(`Program Headers (${phnum}):`);
      const ptNames: Record<number, string> = { 0: "NULL", 1: "LOAD", 2: "DYNAMIC", 3: "INTERP", 4: "NOTE", 5: "SHLIB", 6: "PHDR", 7: "TLS", 0x6474e550: "GNU_EH_FRAME", 0x6474e551: "GNU_STACK", 0x6474e552: "GNU_RELRO", 0x6474e553: "GNU_PROPERTY" };
      for (let i = 0; i < phnum; i++) {
        const off = phoff + i * phent;
        const ptype = is64 ? buf.readUInt32LE(off) : buf.readUInt32LE(off);
        const ptypeName = ptNames[ptype] || `0x${ptype.toString(16)}`;
        const pflags = is64 ? buf.readUInt32LE(off + 4) : buf.readUInt32LE(off + 24);
        const pvaddr = is64 ? Number(buf.readBigUInt64LE(off + 16)) : buf.readUInt32LE(off + 8);
        const pmemsz = is64 ? Number(buf.readBigUInt64LE(off + 40)) : buf.readUInt32LE(off + 20);
        const flagStr = ((pflags & 4) ? "R" : "") + ((pflags & 2) ? "W" : "") + ((pflags & 1) ? "X" : "");

        const isWX = (pflags & 2) && (pflags & 1); // W+X
        lines.push(`  [${i}] ${ptypeName.padEnd(18)} 0x${pvaddr.toString(16).padStart(8, "0")} memsz=${pmemsz} ${flagStr}${isWX ? " ⚠ W+X" : ""}`);
      }
    }

    // ── Dynamic Symbols (imported functions) ──
    // We look for .dynsym section via section headers
    if (shnum > 0 && shoff > 0) {
      const shent = is64 ? 64 : 40;
      let dynsymOff = 0, dynsymEntSize = 0, dynsymCount = 0;
      let strtabOff = 0, dynstrOff = 0;

      for (let i = 0; i < shnum; i++) {
        const sOff = shoff + i * shent;
        const shName = is64 ? buf.readUInt32LE(sOff) : buf.readUInt32LE(sOff);
        const shType = is64 ? buf.readUInt32LE(sOff + 4) : buf.readUInt32LE(sOff + 4);
        const shFlags = is64 ? Number(buf.readBigUInt64LE(sOff + 8)) : buf.readUInt32LE(sOff + 8);
        const shAddr = is64 ? Number(buf.readBigUInt64LE(sOff + 16)) : buf.readUInt32LE(sOff + 12);
        const shOffset = is64 ? Number(buf.readBigUInt64LE(sOff + 24)) : buf.readUInt32LE(sOff + 16);
        const shSize = is64 ? Number(buf.readBigUInt64LE(sOff + 32)) : buf.readUInt32LE(sOff + 20);

        if (shType === 11) { // SHT_DYNSYM
          dynsymOff = shOffset;
          dynsymEntSize = is64 ? 24 : 16; // actually from section header
          dynsymCount = Math.floor(Math.min(shSize, dynsymOff ? 500 : 0) / 24); // rough
        }
        if (shType === 3) { // SHT_STRTAB — find .dynstr
          if (i !== shstrndx) dynstrOff = shOffset;
        }
      }

      if (dynsymOff > 0 && dynstrOff > 0) {
        const symEnt = is64 ? 24 : 16;
        const count = Math.min(200, Math.floor((buf.length - dynsymOff) / symEnt));
        lines.push(`\nDynamic Symbols (imported functions, first ${count}):`);
        let imports = 0;
        for (let i = 0; i < count; i++) {
          const sOff = dynsymOff + i * symEnt;
          const strIdx = is64 ? buf.readUInt32LE(sOff) : buf.readUInt32LE(sOff);
          const symVal = is64 ? Number(buf.readBigUInt64LE(sOff + 8)) : buf.readUInt32LE(sOff + 4);
          const symSize = is64 ? Number(buf.readBigUInt64LE(sOff + 16)) : buf.readUInt32LE(sOff + 8);

          if (strIdx > 0 && strIdx < buf.length - dynstrOff) {
            let name = "";
            for (let j = dynstrOff + strIdx; j < buf.length && buf[j] !== 0; j++) name += String.fromCharCode(buf[j]);
            if (name && !name.startsWith("_") && name.length > 1) {
              if (!name.startsWith("__")) {
                lines.push(`  ${name}`);
                imports++;
              }
            }
          }
        }
        if (imports === 0) lines.push("  (none or stripped)");
      }
    }

    // ── Entropy ──
    let freq = new Map<number, number>();
    for (let i = 0; i < buf.length; i++) freq.set(buf[i], (freq.get(buf[i]) || 0) + 1);
    let entropy = 0;
    for (const count of freq.values()) { const p = count / buf.length; entropy -= p * Math.log2(p); }
    lines.push(`\nEntropy: ${entropy.toFixed(4)} ${entropy > 7.2 ? "⚠ SUSPICIOUS (packed/encrypted)" : entropy > 6.5 ? "⚠ High" : "— Normal"}`);

    // Suspicious: INTERP missing for executable, or stack is W+X
    if (etype === 2) {
      // Check for stack executability
      for (let i = 0; i < phnum; i++) {
        const off = phoff + i * (is64 ? 56 : 32);
        if ((is64 ? buf.readUInt32LE(off) : buf.readUInt32LE(off)) === 0x6474e551) { // GNU_STACK
          const flags = is64 ? buf.readUInt32LE(off + 4) : buf.readUInt32LE(off + 24);
          if (flags & 1) lines.push("⚠ W+X Stack (GNU_STACK executable) — suspicious");
        }
      }
    }

    return lines.join("\n");
  } catch (e: any) {
    return `[ELF Error] ${e.message}`;
  }
}

// ── MACRO SCAN (Office Documents) ─────────────────────────
async function macroScan(path: string): Promise<string> {
  try {
    if (!existsSync(path)) return `[MacroScan] File not found: ${path}`;
    const buf = readFileSync(path);
    const magic = buf.slice(0, 8).toString("hex");

    const isOLE2 = magic.startsWith("d0cf11e0a1b11ae1");
    const isOOXML = magic.startsWith("504b0304") && (path.endsWith(".docx") || path.endsWith(".xlsx") || path.endsWith(".pptx") || path.endsWith(".xlsm") || path.endsWith(".docm"));

    const lines: string[] = [
      `📋 Macro Analysis: ${path}`,
      `Size: ${buf.length} bytes (${(buf.length/1024).toFixed(1)} KB)`,
    ];

    if (isOLE2) {
      lines.push(`Format: OLE2 (binary Office document — .doc/.xls/.ppt/.dot)`);
      // Scan for VBA magic bytes: "VBA" / "Attribut" / "Macro" / "Auto_"
      let vbaStrings: string[] = [];
      let suspiciousPatterns: string[] = [];

      // Extract printable strings from the binary
      let cur = "";
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c >= 32 && c <= 126) { cur += String.fromCharCode(c); }
        else {
          if (cur.length >= 4) {
            const lower = cur.toLowerCase();
            if (lower.includes("vba") || lower.includes("macro") || lower.includes("auto_") ||
                lower.includes("attribut") || lower.includes("module")) {
              vbaStrings.push(cur.substring(0, 200));
            }
            if (lower.includes("shell(") || lower.includes("createobject") || lower.includes("wscript") ||
                lower.includes("exec(") || lower.includes("run(") || lower.includes("eval(") ||
                lower.includes("mshta") || lower.includes("powershell") || lower.includes("cmd.exe")) {
              suspiciousPatterns.push(cur.substring(0, 200));
            }
          }
          cur = "";
        }
      }
      if (cur.length >= 4) {
        const lower = cur.toLowerCase();
        if (lower.includes("vba") || lower.includes("macro") || lower.includes("auto_")) vbaStrings.push(cur.substring(0, 200));
        if (lower.includes("shell(") || lower.includes("createobject")) suspiciousPatterns.push(cur.substring(0, 200));
      }

      if (vbaStrings.length) {
        lines.push(`\n✅ VBA/Macros detected! (${vbaStrings.length} string(s))`);
        lines.push(...vbaStrings.slice(0, 20).map(s => `  📝 ${s}`));
      } else {
        lines.push(`\nℹ️ No obvious VBA macros found (may be encrypted/stored differently)`);
      }

      if (suspiciousPatterns.length) {
        lines.push(`\n🚨 Suspicious patterns detected! (${suspiciousPatterns.length}):`);
        lines.push(...suspiciousPatterns.slice(0, 15).map(s => `  ⚠ ${s}`));
      } else {
        lines.push(`\n✅ No suspicious macro patterns detected.`);
      }

      // Check for Auto macros
      const autoMacros = ["auto_open", "auto_close", "document_open", "autoexec", "autonew"];
      const foundAuto = autoMacros.filter(a => {
        const lc = buf.toString("latin1").toLowerCase();
        return lc.includes(a);
      });
      if (foundAuto.length) {
        lines.push(`\n⚠ Auto-executing macros found: ${foundAuto.join(", ")}`);
      }

    } else if (isOOXML) {
      lines.push(`Format: OOXML (ZIP-based — .docx/.xlsx/.pptx)`);
      // Try to find vbaProject.bin inside the ZIP
      const zipMagic = "PK";
      // Simple ZIP central directory scan for vbaProject.bin
      const haystack = buf.toString("latin1");
      if (haystack.includes("vbaProject.bin")) {
        lines.push(`\n✅ VBA project found (vbaProject.bin embedded)`);
        // Scan for suspicious patterns in the vba stream
        const cur = haystack.substring(haystack.indexOf("vbaProject.bin") - 200, Math.min(haystack.length, haystack.indexOf("vbaProject.bin") + 500));
        const suspicious = ["Auto_Open", "Shell(", "CreateObject", "WScript", "PowerShell", "cmd.exe", "MSHTA", "Eval(", "Exec("];
        const hits = suspicious.filter(s => haystack.toLowerCase().includes(s.toLowerCase()));
        if (hits.length) {
          lines.push(`\n🚨 Suspicious VBA patterns: ${hits.join(", ")}`);
        }
      } else {
        lines.push(`ℹ️ No embedded VBA project found`);
      }
    } else if (path.endsWith(".vba") || path.endsWith(".vbs") || path.endsWith(".bas")) {
      lines.push(`Format: Raw VBA/VBS script`);
      const content = buf.toString("latin1");
      const suspicious = ["Shell(", "CreateObject(\"WScript.Shell\")", "CreateObject(\"Shell.Application\")", "PowerShell", "cmd.exe", "MSHTA", "Eval(", "Exec(", "WScript.Run", "FileSystemObject", "RegWrite", "HTTPRequest"];
      const hits = suspicious.filter(s => content.includes(s));
      lines.push(`\nLength: ${content.length} chars`);
      if (hits.length) {
        lines.push(`\n🚨 ${hits.length} suspicious patterns:`);
        hits.forEach(h => {
          const idx = content.indexOf(h);
          const ctx = content.substring(Math.max(0, idx - 30), idx + h.length + 60).replace(/\n/g, "\\n").substring(0, 150);
          lines.push(`  ⚠ ${h}: ...${ctx}...`);
        });
      } else {
        lines.push(`✅ No suspicious patterns`);
      }
      lines.push(`\n── Source (first 30 lines) ──`);
      lines.push(content.split("\n").slice(0, 30).join("\n"));
    } else {
      lines.push(`\nℹ️ Unknown format. Supported: .doc, .xls, .ppt (OLE2), .docx, .xlsm, .docm (OOXML), .vba, .vbs, .bas`);
    }

    return lines.join("\n");
  } catch (e: any) {
    return `[MacroScan Error] ${e.message}`;
  }
}

// ── DEEP STRINGS (Categorized) ────────────────────────────
async function stringsDeep(path: string): Promise<string> {
  try {
    if (!existsSync(path)) return `[StringsDeep] File not found: ${path}`;
    const buf = readFileSync(path);
    const size = buf.length;

    // Extract all printable strings >= 4 chars
    const allStrings: string[] = [];
    let cur = "";
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c >= 32 && c <= 126) { cur += String.fromCharCode(c); }
      else {
        if (cur.length >= 4) allStrings.push(cur);
        cur = "";
      }
    }
    if (cur.length >= 4) allStrings.push(cur);

    // Classify
    const ipv4Re = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
    const domainRe = /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/;
    const urlRe = /https?:\/\/[^\s"']+/;
    const emailRe = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
    const filepathRe = /(?:[a-zA-Z]:\\[^\s"<>|:]+|\/[^\s"<>|:]+)/;
    const cryptoKeyRe = /(?:key|secret|token|cert|private).{0,20}=.{0,80}/i;

    const ips = new Set<string>();
    const domains = new Set<string>();
    const urls = new Set<string>();
    const emails = new Set<string>();
    const paths = new Set<string>();
    const cryptos: string[] = [];
    const others: string[] = [];

    for (const s of allStrings) {
      const trimmed = s.trim();
      if (trimmed.length > 200) { others.push(trimmed.substring(0, 200) + "..."); continue; }
      if (trimmed.startsWith("http") && urlRe.test(trimmed)) {
        try { urls.add(new URL(trimmed).href); } catch { urls.add(trimmed); }
      } else if (emailRe.test(trimmed)) emails.add(trimmed);
      else if (ipv4Re.test(trimmed) && !trimmed.startsWith("0.")) {
        const ip = trimmed.match(ipv4Re)![0];
        if (!ip.startsWith("127.") && !ip.startsWith("0.")) ips.add(ip);
      } else if (domainRe.test(trimmed) && !trimmed.includes("/")) {
        const d = trimmed.match(domainRe)![0];
        if (!d.endsWith(".local") && !d.endsWith(".lan") && !d.endsWith(".localhost")) domains.add(d);
      } else if (filepathRe.test(trimmed)) paths.add(trimmed);
      else if (cryptoKeyRe.test(trimmed)) cryptos.push(trimmed.substring(0, 150));
      else if (trimmed.length >= 8 && trimmed.length <= 64) others.push(trimmed);
    }

    const lines: string[] = [
      `🔍 Deep String Analysis: ${path}`,
      `Total strings (≥4 chars): ${allStrings.length}`,
      `Total file size: ${(size/1024).toFixed(1)} KB`,
      ``,
    ];

    if (urls.size) lines.push(`🌐 URLs (${urls.size}):`, ...Array.from(urls).slice(0, 15).map(u => `  ${u}`), "");
    if (emails.size) lines.push(`📧 Emails (${emails.size}):`, ...Array.from(emails).slice(0, 10).map(e => `  ${e}`), "");
    if (ips.size) lines.push(`🌍 IP Addresses (${ips.size}):`, ...Array.from(ips).slice(0, 15).map(i => `  ${i}`), "");
    if (domains.size) lines.push(`🌐 Domains (${domains.size}):`, ...Array.from(domains).slice(0, 15).map(d => `  ${d}`), "");
    if (paths.size) lines.push(`📁 File Paths (${paths.size}):`, ...Array.from(paths).slice(0, 10).map(p => `  ${p}`), "");
    if (cryptos.length) lines.push(`🔑 Potential Secrets (${cryptos.length}):`, ...cryptos.slice(0, 10).map(c => `  ⚠ ${c}`), "");

    // Entropy
    let freq = new Map<number, number>();
    for (let i = 0; i < buf.length; i++) freq.set(buf[i], (freq.get(buf[i]) || 0) + 1);
    let entropy = 0;
    for (const count of freq.values()) { const p = count / buf.length; entropy -= p * Math.log2(p); }
    lines.push(`\nEntropy: ${entropy.toFixed(4)} ${entropy > 7.2 ? "⚠ PACKED" : entropy > 6.5 ? "⚠ High" : "— Normal"}`);

    return lines.join("\n");
  } catch (e: any) {
    return `[StringsDeep Error] ${e.message}`;
  }
}

// ── HEX DUMP ───────────────────────────────────────────────
async function hexDump(input: string): Promise<string> {
  try {
    const parts = input.split("|").map(s => s.trim());
    const path = parts[0];
    const offset = parseInt(parts[1]) || 0;
    const limit = Math.min(parseInt(parts[2]) || 512, 4096);

    if (!existsSync(path)) return `[HexDump] File not found: ${path}`;
    const buf = readFileSync(path);
    const size = buf.length;

    const lines: string[] = [
      `⎔ Hex Dump: ${path}`,
      `Size: ${size} bytes (${(size/1024).toFixed(1)} KB)`,
      `Range: 0x${offset.toString(16)} — 0x${Math.min(offset + limit, size).toString(16)} (${limit} bytes)`,
      `───┬──────────┬──────────────────────────────┬────────────────────`,
      `OFF│ 0  1  2  3   4  5  6  7   8  9  A  B   C  D  E  F │ ASCII`,
      `───┴──────────┴──────────────────────────────┴────────────────────`,
    ];

    const end = Math.min(offset + limit, size);
    for (let i = offset; i < end; i += 16) {
      const addr = `0x${i.toString(16).padStart(8, "0")}`;
      const hexParts: string[] = [];
      const asciiParts: string[] = [];
      for (let j = 0; j < 16 && i + j < end; j++) {
        const byte = buf[i + j];
        hexParts.push(byte.toString(16).padStart(2, "0"));
        if (j === 7) hexParts.push(" ");
        asciiParts.push(byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".");
      }
      const hexStr = hexParts.join(" ").padEnd(51);
      const asciiStr = asciiParts.join("");
      lines.push(`${addr}│ ${hexStr}│ ${asciiStr}`);
    }

    lines.push(`───┴──────────┴──────────────────────────────┴────────────────────`);
    lines.push(`Use: @hex_dump|path|offset|length (default: offset=0, length=512)`);

    return lines.join("\n");
  } catch (e: any) {
    return `[HexDump Error] ${e.message}`;
  }
}

// ── IOC EXTRACTOR ──────────────────────────────────────────
async function extractIoc(input: string): Promise<string> {
  try {
    const parts = input.split("|").map(s => s.trim());
    const source = parts[0];

    let text: string;
    let sourceName = "text";

    if (existsSync(source)) {
      text = readFileSync(source, "utf-8");
      sourceName = source;
    } else {
      text = input;
      sourceName = "inline text";
    }

    // Extract IOCs with regex
    const ipv4Re = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    const domainRe = /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g;
    const urlRe = /https?:\/\/[^\s<>"')\]]+/g;
    const emailRe = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    const md5Re = /\b[a-fA-F0-9]{32}\b/g;
    const sha1Re = /\b[a-fA-F0-9]{40}\b/g;
    const sha256Re = /\b[a-fA-F0-9]{64}\b/g;
    const filePathRe = /(?:[a-zA-Z]:\\[^\s<>"|:]+|\/[^\s<>"|:]+)/g;

    const results: Record<string, string[]> = {
      "IPv4": [...new Set((text.match(ipv4Re) || []).filter(ip => !ip.startsWith("127.") && !ip.startsWith("0.") && !ip.startsWith("10.") && !ip.startsWith("192.168.") && !ip.startsWith("172.1")))],
      "URLs": [...new Set(text.match(urlRe) || []).values()].map(u => u.replace(/[.,;:!?)]+$/, "")),
      "Domains": [...new Set((text.match(domainRe) || []).filter(d => !d.startsWith("http") && !d.includes("/") && !d.startsWith("www.")))],
      "Emails": [...new Set(text.match(emailRe) || [])],
      "MD5": [...new Set(text.match(md5Re) || [])],
      "SHA1": [...new Set(text.match(sha1Re) || [])],
      "SHA256": [...new Set(text.match(sha256Re) || [])],
    };

    // Filter URLs to valid
    results["URLs"] = results["URLs"].filter(u => {
      try { new URL(u); return true; } catch { return false; }
    });

    // Filter domains to exclude IPs and URLs
    const ipSet = new Set(results["IPv4"]);
    results["Domains"] = results["Domains"].filter(d =>
      !ipSet.has(d) && d.includes(".") && !d.match(/^\d/) && d.length > 3
    );

    const totalIocs = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

    const lines: string[] = [
      `🎯 IOC Extraction from ${sourceName}`,
      `Total IOCs found: ${totalIocs}`,
      `Text length: ${text.length} chars`,
      ``,
    ];

    for (const [type, iocs] of Object.entries(results)) {
      if (iocs.length) {
        lines.push(`${type} (${iocs.length}):`);
        lines.push(...iocs.slice(0, 20).map(ioc => `  ${ioc}`));
        if (iocs.length > 20) lines.push(`  ... and ${iocs.length - 20} more`);
        lines.push(``);
      }
    }

    // Dedup all IOCs for summary
    if (totalIocs === 0) lines.push("(no IOCs found)");

    return lines.join("\n");
  } catch (e: any) {
    return `[IOC Error] ${e.message}`;
  }
}

// ── PROCESS FORENSICS ─────────────────────────────────────
async function procAnalyze(input: string): Promise<string> {
  try {
    const pid = parseInt(input.trim());
    if (isNaN(pid)) return `[ProcAnalyze] Usage: proc_analyze|PID\nExample: @proc_analyze|1234`;
    const procDir = `/proc/${pid}`;
    if (!existsSync(procDir)) return `[ProcAnalyze] Process ${pid} not found`;

    const lines: string[] = [
      `🔍 Process Analysis: PID ${pid}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ];

    // ── Basic Info ──
    try {
      const status = readFileSync(`${procDir}/status`, "utf-8");
      const name = status.match(/Name:\s*(.+)/)?.[1] || "?";
      const state = status.match(/State:\s*(.+)/)?.[1] || "?";
      const ppid = status.match(/PPid:\s*(.+)/)?.[1] || "?";
      const uid = status.match(/Uid:\s*(.+)/)?.[1] || "?";
      const threads = status.match(/Threads:\s*(.+)/)?.[1] || "?";
      const vmRSS = status.match(/VmRSS:\s*(.+)/)?.[1] || "?";
      const vmSize = status.match(/VmSize:\s*(.+)/)?.[1] || "?";
      lines.push(`  Name: ${name}`);
      lines.push(`  State: ${state}`);
      lines.push(`  PPID: ${ppid}`);
      lines.push(`  UID: ${uid}`);
      lines.push(`  Threads: ${threads}`);
      lines.push(`  RSS: ${vmRSS}`);
      lines.push(`  VM: ${vmSize}`);
    } catch {}

    // ── Command Line ──
    try {
      const cmdline = readFileSync(`${procDir}/cmdline`, "utf-8").replace(/\0/g, " ");
      if (cmdline.trim()) lines.push(`  Cmdline: ${cmdline.substring(0, 500)}`);
    } catch {}

    // ── CWD ──
    try {
      const cwd = execSync(`readlink -f ${procDir}/cwd 2>/dev/null`, { encoding: "utf-8", timeout: 3000 }).trim();
      if (cwd) lines.push(`  CWD: ${cwd}`);
    } catch {}
    try {
      const exe = execSync(`readlink -f ${procDir}/exe 2>/dev/null`, { encoding: "utf-8", timeout: 3000 }).trim();
      if (exe) lines.push(`  Exe: ${exe}`);
    } catch {}

    // ── Environment ──
    try {
      const env = readFileSync(`${procDir}/environ`, "utf-8").replace(/\0/g, "\n").trim();
      const envLines = env.split("\n").filter(Boolean);
      const sensitive = envLines.filter(e =>
        /key|secret|token|pass|cert|credential|api_key|auth/i.test(e)
      );
      lines.push(`  Env vars: ${envLines.length} total`);
      if (sensitive.length) {
        lines.push(`  ⚠ Sensitive env vars (${sensitive.length}):`);
        sensitive.forEach(s => lines.push(`    ⚠ ${s.substring(0, 120)}`));
      }
    } catch {}

    // ── Open File Descriptors ──
    try {
      const fds = readdirSync(`${procDir}/fd`);
      const sockets: string[] = [];
      const pipes: string[] = [];
      const regFiles: string[] = [];
      for (const fd of fds) {
        try {
          const link = execSync(`readlink ${procDir}/fd/${fd} 2>/dev/null`, { encoding: "utf-8", timeout: 2000 }).trim();
          if (link.includes("socket:")) sockets.push(link);
          else if (link.includes("pipe:")) pipes.push(link);
          else if (link) regFiles.push(link);
        } catch {}
      }
      lines.push(`  Open FDs: ${fds.length} (${sockets.length} sockets, ${pipes.length} pipes, ${regFiles.length} files)`);
      if (sockets.length) lines.push(...sockets.slice(0, 10).map(s => `    🔌 ${s}`));
      if (regFiles.length) lines.push(...regFiles.slice(0, 8).map(f => `    📄 ${f}`));
    } catch {}

    // ── Network Connections ──
    try {
      for (const proto of ["tcp", "tcp6", "udp", "udp6"]) {
        const netPath = `${procDir}/net/${proto}`;
        if (existsSync(netPath)) {
          const content = readFileSync(netPath, "utf-8");
          const conns = content.split("\n").slice(1).filter(Boolean);
          if (conns.length) {
            lines.push(`  Net/${proto}: ${conns.length} connection(s)`);
            for (const conn of conns.slice(0, 8)) {
              const parts2 = conn.trim().split(/\\s+/);
              if (parts2.length >= 4) {
                const localHex = parts2[1]?.split(":")?.[0] || "?";
                const localPort = parseInt(parts2[1]?.split(":")?.[1] || "0", 16);
                const remHex = parts2[2]?.split(":")?.[0] || "?";
                const remPort = parseInt(parts2[2]?.split(":")?.[1] || "0", 16);
                const state = parts2[3] || "?";
                const stateNames: Record<string, string> = { "01":"ESTAB","02":"SYN_SENT","03":"SYN_RECV","04":"FIN_WAIT","05":"TIMEWAIT","06":"CLOSE","07":"CLOSE_WAIT","0A":"LISTEN","0B":"CLOSING"};
                const stateName = stateNames[state] || state;
                lines.push(`    ${localHex}:${localPort} → ${remHex}:${remPort} [${stateName}]`);
              }
            }
          }
        }
      }
    } catch {}

    // ── Memory Maps ──
    try {
      const maps = readFileSync(`${procDir}/maps`, "utf-8");
      const mapLines = maps.split("\n").filter(Boolean);
      lines.push(`  Memory maps: ${mapLines.length} regions`);

      // Check for suspicious mappings (rwx)
      const rwxMaps = mapLines.filter(l => l.includes("rwx"));
      if (rwxMaps.length) {
        lines.push(`  ⚠ RWX memory regions (${rwxMaps.length}):`);
        rwxMaps.slice(0, 5).forEach(m => lines.push(`    ⚠ ${m.substring(0, 120)}`));
      }
    } catch {}

    return lines.join("\n");
  } catch (e: any) {
    return `[ProcAnalyze Error] ${e.message}`;
  }
}

// ── WEB CLICKERS ──────────────────────────────────────────

async function webClick(input: string): Promise<string> {
  try {
    const parts = input.split("|").map(s=>s.trim());
    const url = parts[0];
    if (!url) return `[Web Click] Usage: url|selector|method. method: index (click Nth link), text (by link text), selector (URL)`;
    const r = await fetch(url, {signal: AbortSignal.timeout(15000)});
    const html = await r.text();
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
    const links = [...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const clean = links.map(([,h,t]:any)=>[h,t.replace(/<[^>]+>/g,"").trim()]).filter(([h]:any)=>h&&!h.startsWith("#")&&!h.startsWith("javascript:"));
    const selector = parts[1]||"0"; const method = parts[2]||"index";
    if (method==="index") {
      const idx = parseInt(selector)||0;
      if (idx<0||idx>=clean.length) return `[Web Click] Index ${idx} out of range (0-${clean.length-1})`;
      const [href,text] = clean[idx]; const fullUrl = href.startsWith("http")?href:new URL(href,url).href;
      const r2 = await fetch(fullUrl,{signal:AbortSignal.timeout(15000)}); const h2 = await r2.text();
      const t2 = (h2.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
      const body = h2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
      return [`🌐 Web Click: ${url}`,`Title: ${title}`,`Click [${idx}]: ${text||href} → ${fullUrl}`,`→ Title: ${t2}`,`→ Content: ${body.substring(0,2000)}`].join("\n");
    } else if (method==="text") {
      const m = clean.filter(([,t]:any)=>t.toLowerCase().includes(selector.toLowerCase()));
      if (!m.length) return `[Web Click] No links with text: "${selector}"`;
      const [href,text] = m[0]; const fullUrl = href.startsWith("http")?href:new URL(href,url).href;
      const r2 = await fetch(fullUrl,{signal:AbortSignal.timeout(15000)}); const h2 = await r2.text();
      const t2 = (h2.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
      const body = h2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
      return [`🌐 Web Click: ${url}`,`Title: ${title}`,`Click "${text}" → ${fullUrl}`,`→ Title: ${t2}`,`→ Content: ${body.substring(0,2000)}`].join("\n");
    } else {
      const r2 = await fetch(selector,{signal:AbortSignal.timeout(15000)}); const h2 = await r2.text();
      const t2 = (h2.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
      const body = h2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
      return [`🌐 Web Click: ${url} → ${selector}`,`→ Title: ${t2}`,`→ Content: ${body.substring(0,2000)}`].join("\n");
    }
  } catch(e: any) { return `[Web Click Error] ${e.message}`; }
}

async function webLinks(url: string): Promise<string> {
  try {
    if (!url) return `[Web Links] Usage: url`;
    const r = await fetch(url,{signal:AbortSignal.timeout(15000)}); const html = await r.text();
    const base = (html.match(/<base[^>]*href=["']([^"']+)/i)||[])[1]||url;
    const links = [...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const imgs = [...html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi)];
    const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi)];
    const res = (l:string)=>l.startsWith("http")?l:l.startsWith("//")?"https:"+l:new URL(l,base).href;
    const all = links.map(([,h,t]:any)=>[res(h),t.replace(/<[^>]+>/g,"").trim()]).filter(([h]:any)=>h);
    const internal = all.filter(([h]:any)=>h.startsWith(url.replace(/\/$/,"")));
    const external = all.filter(([h]:any)=>!h.startsWith(url.replace(/\/$/,"")));
    const resources = [...imgs.map(m=>res(m[1])),...scripts.map(m=>res(m[1]))].filter(Boolean);
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
    return [`🔗 Web Links: ${url}`,`Title: ${title}`,
      `\nLinks: ${all.length} (int=${internal.length}, ext=${external.length})`,
      internal.length?`\nInternal:\n${internal.slice(0,20).map(([h,t]:any)=>`  · ${t||h}`).join("\n")}`:"",
      external.length?`\nExternal:\n${external.slice(0,20).map(([h,t]:any)=>`  · ${t||h}`).join("\n")}`:"",
      resources.length?`\n📦 Resources:\n${resources.slice(0,15).join("\n")}`:"",
    ].filter(Boolean).join("\n");
  } catch(e: any) { return `[Web Links Error] ${e.message}`; }
}

async function webForm(input: string): Promise<string> {
  try {
    const parts = input.split("|").map(s=>s.trim()); const url = parts[0];
    if (!url) return `[Web Form] Usage: url|field1=val1`;
    const r = await fetch(url,{signal:AbortSignal.timeout(15000)}); const html = await r.text();
    const forms = [...html.matchAll(/<form[^>]*action=["']([^"']*)["'][^>]*(?:method=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/form>/gi)];
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
    if (!forms.length) return `📋 Web Form: ${url}\nTitle: ${title}\n(no forms found)`;
    const res = [`📋 Web Form: ${url}`,`Title: ${title}`,`Forms: ${forms.length}`];
    for (const [action,method,inner] of forms) {
      const fields = [...inner.matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*(?:value=["']([^"']*)["'])?[^>]*>/gi)];
      res.push(`\nForm: "${action||url}" ${(method||"GET").toUpperCase()}`);
      fields.forEach(([,n,v]:any)=>res.push(`  ${n}=${v||""}`));
      const userFields = parts.slice(1).filter(p=>p.includes("="));
      if (userFields.length>0) {
        const params = new URLSearchParams(); userFields.forEach(p=>{const[k,v]=p.split("=",2);if(k)params.set(k,v||"")});
        const isPost = (method||"GET").toUpperCase()==="POST";
        const submitUrl = isPost?url:`${action||url}?${params.toString()}`;
        const r2 = await fetch(submitUrl,{method:isPost?"POST":"GET",body:isPost?params:undefined,headers:isPost?{"Content-Type":"application/x-www-form-urlencoded"}:{},signal:AbortSignal.timeout(15000)});
        const h2 = await r2.text(); const t2 = (h2.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
        const body = h2.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
        res.push(`→ ${r2.status} ${t2} ${body.substring(0,1000)}`);
      }
    }
    return res.join("\n");
  } catch(e: any) { return `[Web Form Error] ${e.message}`; }
}

async function webSnapshot(url: string): Promise<string> {
  try {
    if (!url) return `[Web Snapshot] Usage: url`;
    const r = await fetch(url,{signal:AbortSignal.timeout(15000)}); const html = await r.text();
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||"";
    const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>m[1].replace(/<[^>]+>/g,"").trim());
    const bodyText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
    return `📸 Web Snapshot: ${url}\nTitle: ${title}\nH1: ${h1.slice(0,5).join(" | ")}\n\nPreview:\n${bodyText.substring(0,3000)}`;
  } catch(e: any) { return `[Web Snapshot Error] ${e.message}`; }
}

// ── WORKSPACE (Project Management) ─────────────────────────

async function projectCreate(name: string): Promise<string> {
  if (!name) return `[Project] Usage: project_create <name>`;
  try {
    const {mkdirSync,writeFileSync,existsSync} = await import("fs");
    const dir = `${process.env.HOME||"/root"}/.config/phantom/projects/${name.replace(/[^a-z0-9_-]/gi,"_")}`;
    if (existsSync(dir)) return `[Project] "${name}" exists.`;
    mkdirSync(dir,{recursive:true});
    writeFileSync(`${dir}/project.json`,JSON.stringify({name,created:new Date().toISOString(),updated:new Date().toISOString(),files:[],notes:[],toolCount:0},null,2));
    return `✅ Project "${name}" created.\n  ${dir}/`;
  } catch(e: any) { return `[Project Error] ${e.message}`; }
}

async function projectList(): Promise<string> {
  try {
    const {readdirSync,existsSync,readFileSync} = await import("fs");
    const dir = `${process.env.HOME||"/root"}/.config/phantom/projects`;
    if (!existsSync(dir)) return `[Projects] None yet.`;
    const dirs = readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
    if (!dirs.length) return `[Projects] None yet.`;
    const lines = [`📁 PROJECTS (${dirs.length})`];
    for (const d of dirs.sort()) {
      try {
        const m = JSON.parse(readFileSync(`${dir}/${d}/project.json`,"utf-8"));
        lines.push(`  ${d}  ${m.files?.length||0} files · ${m.notes?.length||0} notes · ${Math.floor((Date.now()-new Date(m.created).getTime())/86400000)}d`);
      } catch { lines.push(`  ${d}`); }
    }
    return lines.join("\n");
  } catch(e: any) { return `[Projects Error] ${e.message}`; }
}

async function projectInfo(name: string): Promise<string> {
  try {
    const {readFileSync,existsSync,readdirSync} = await import("fs");
    if (!name) return `[Project] Usage: project_info <name>`;
    const dir = `${process.env.HOME||"/root"}/.config/phantom/projects/${name.replace(/[^a-z0-9_-]/gi,"_")}`;
    if (!existsSync(dir)) return `[Project] "${name}" not found.`;
    const meta = JSON.parse(readFileSync(`${dir}/project.json`,"utf-8"));
    const files = existsSync(`${dir}/files`)?readdirSync(`${dir}/files`):[];
    const lines = [`📁 Project: ${meta.name||name}`,`  Created: ${new Date(meta.created).toLocaleString()}`,`  Files: ${files.length}`];
    if (meta.notes?.length) meta.notes.slice(-5).forEach((n:string,i:number)=>lines.push(`  Note ${i+1}: ${n.substring(0,120)}`));
    return lines.join("\n");
  } catch(e: any) { return `[Project Error] ${e.message}`; }
}

async function projectFileAdd(input: string): Promise<string> {
  try {
    const {existsSync,copyFileSync,mkdirSync,readFileSync,writeFileSync} = await import("fs");
    const [name,filePath] = input.split("|").map(s=>s.trim());
    if (!name||!filePath) return `[Project File] Usage: project_file_add <project>|<filepath>`;
    const dir = `${process.env.HOME||"/root"}/.config/phantom/projects/${name.replace(/[^a-z0-9_-]/gi,"_")}`;
    if (!existsSync(dir)) return `[Project File] Not found: "${name}"`;
    const meta = JSON.parse(readFileSync(`${dir}/project.json`,"utf-8"));
    if (!existsSync(`${dir}/files`)) mkdirSync(`${dir}/files`,{recursive:true});
    const base = filePath.split("/").pop()||filePath;
    copyFileSync(filePath,`${dir}/files/${base}`);
    meta.files = meta.files||[]; meta.files.push({name:base,source:filePath,added:new Date().toISOString()});
    meta.updated = new Date().toISOString();
    writeFileSync(`${dir}/project.json`,JSON.stringify(meta,null,2));
    return `✅ Added ${base} to "${name}".`;
  } catch(e: any) { return `[Project File Error] ${e.message}`; }
}

async function projectNote(input: string): Promise<string> {
  try {
    const {existsSync,readFileSync,writeFileSync} = await import("fs");
    const parts = input.split("|").map(s=>s.trim()); const name = parts[0]; const note = parts.slice(1).join("|").trim();
    if (!name) return `[Project Note] Usage: project_note <project>|<text>`;
    const dir = `${process.env.HOME||"/root"}/.config/phantom/projects/${name.replace(/[^a-z0-9_-]/gi,"_")}`;
    if (!existsSync(dir)) return `[Project Note] Not found: "${name}"`;
    const meta = JSON.parse(readFileSync(`${dir}/project.json`,"utf-8"));
    if (!note) { return `📝 Notes: ${(meta.notes||[]).map((n:string,i:number)=>`\n  ${i+1}. ${n.substring(0,200)}`).join("")||"(none)"}`; }
    meta.notes = meta.notes||[]; meta.notes.push(`[${new Date().toISOString().substring(0,10)}] ${note}`);
    writeFileSync(`${dir}/project.json`,JSON.stringify(meta,null,2));
    return `✅ Note added to "${name}".`;
  } catch(e: any) { return `[Project Note Error] ${e.message}`; }
}

async function projectSwitch(name: string): Promise<string> {
  if (!name) return `[Project] Usage: project_switch <name>`;
  try {
    const {existsSync,readFileSync,writeFileSync} = await import("fs");
    const dir = `${process.env.HOME||"/root"}/.config/phantom/projects/${name.replace(/[^a-z0-9_-]/gi,"_")}`;
    if (!existsSync(dir)) return `[Project] "${name}" not found.`;
    const meta = JSON.parse(readFileSync(`${dir}/project.json`,"utf-8"));
    writeFileSync(`${process.env.HOME||"/root"}/.config/phantom/projects/.active`,name.replace(/[^a-z0-9_-]/gi,"_"));
    return `🔀 Active: ${meta.name||name} (${meta.files?.length||0} files, ${meta.notes?.length||0} notes)`;
  } catch(e: any) { return `[Project Error] ${e.message}`; }
}

// ── END NEW TOOLS ─────────────────────────────────────────

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

// ── SELF ADD TOOL (Auto-Integrate) ─────────────────────────
async function selfAddTool(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "[Self Add Tool] Requires OPENAI_API_KEY";
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: `Generate ONLY a Node.js async function taking one string input returning Promise<string>. Name after the tool purpose. Start with: // description: one-liner. No imports, no markdown, no backticks.` }, { role: "user", content: `Tool that: ${prompt}` }],
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json() as any;
    const result = data?.choices?.[0]?.message?.content || "// description: Generated tool\nasync function newTool(input) { return 'TODO'; }";
    const toolName = result.match(/async function\s+(\w+)/)?.[1] || "newTool";
    const desc = result.match(/\/\/\s*description:\s*(.+)/i)?.[1] || prompt.substring(0, 100);
    const registryLine = `  ${toolName}: {\n    description: "${desc.substring(0, 150)}",\n    execute: ${toolName},\n  },`;

    // ── Auto-integrate into hacker-tools.ts ──
    const tsPath = resolve(process.cwd(), "src/core/hacker-tools.ts");
    let ts = readFileSync(tsPath, "utf-8");
    if (ts.includes(`async function ${toolName}(`)) return `[Self Add] "${toolName}" already exists in TS source`;

    const exportPos = ts.indexOf("export const hackerTools: Record<string, HackerTool> = {");
    if (exportPos === -1) return "[Self Add] Cannot find TS insertion point";
    ts = ts.slice(0, exportPos) + "\n" + result.trim() + "\n\n" + ts.slice(exportPos);

    const closePos = ts.lastIndexOf("\n};");
    if (closePos === -1) return "[Self Add] Cannot find TS closing";
    ts = ts.slice(0, closePos + 1) + registryLine + "\n" + ts.slice(closePos + 1);
    writeFileSync(tsPath, ts, "utf-8");

    // ── Auto-integrate into phantom.mjs ──
    const mjsPath = resolve(process.cwd(), "phantom.mjs");
    let mjs = readFileSync(mjsPath, "utf-8");
    if (mjs.includes(`  ${toolName}: async`)) return `[Self Add] "${toolName}" already exists in MJS source`;

    // Convert async function to arrow function for hackerTools object
    const body = result.replace(/async function\s+\w+\s*\(input\)\s*\{/, "").trim();
    const lastBrace = body.lastIndexOf("}");
    const cleanBody = body.substring(0, lastBrace).trim();
    const mjsEntry = `  ${toolName}: async (input) => {\n${cleanBody}\n  },`;

    const mjsClose = mjs.lastIndexOf("\n};\n\n// ── EventBus");
    if (mjsClose === -1) return "[Self Add] Cannot find MJS insertion point";
    mjs = mjs.slice(0, mjsClose) + "\n" + mjsEntry + "\n" + mjs.slice(mjsClose);
    writeFileSync(mjsPath, mjs, "utf-8");

    // ── Rebuild ──
    try {
      execSync("npm run build 2>&1", { cwd: process.cwd(), timeout: 30000, encoding: "utf-8", stdio: "pipe" });
    } catch (e: any) {
      // Rollback both files
      writeFileSync(tsPath, readFileSync(tsPath, "utf-8").replace("\n" + result.trim() + "\n\n", "").replace(registryLine + "\n", ""), "utf-8");
      writeFileSync(mjsPath, readFileSync(mjsPath, "utf-8").replace("\n" + mjsEntry + "\n", ""), "utf-8");
      return `[Self Add] Build failed — rolled back.\n${(e.message || "").substring(0, 400)}`;
    }

    return [
      `✅ Tool "${toolName}" auto-integrated!`,
      `📄 src/core/hacker-tools.ts → function + registry`,
      `📄 phantom.mjs → function + registry`,
      `🔨 npm run build → passed`,
      ``,
      `Use: @${toolName}|your_input`,
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

// ── REVERSE DNS ──
async function reverseDns(input: string): Promise<string> {
  try {
    const ip = input.trim();
    const r = await fetch(`https://dns.google/resolve?name=${ip}&type=PTR`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json() as any;
    const ptrs = d?.Answer?.filter((a: any) => a.type === 12).map((a: any) => a.data) || [];
    return ptrs.length ? `🔁 PTR for ${ip}:\n${ptrs.join("\n")}` : `[Reverse DNS] No PTR for ${ip}`;
  } catch (e: any) { return `[Reverse DNS Error] ${e.message}`; }
}

// ── WAYBACK MACHINE ──
async function wayback(input: string): Promise<string> {
  try {
    const domain = input.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const r = await fetch(`https://web.archive.org/cdx/search/cdx?url=${domain}/*&output=json&limit=20&fl=timestamp,original,statuscode`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json() as any;
    if (!Array.isArray(d) || d.length < 2) return `[Wayback] No snapshots for ${domain}`;
    return `🗄 Wayback: ${domain} (${d.length - 1} snapshots)\n${d.slice(1).map((row: string[]) => `  ${row[0].substring(0, 8)} ${row[2] || "—"} ${row[1]}`).join("\n")}`;
  } catch (e: any) { return `[Wayback Error] ${e.message}`; }
}

// ── CERT EXPIRY ──
async function certExpiry(input: string): Promise<string> {
  try {
    const domain = input.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const raw = execSync(`openssl s_client -connect ${domain}:443 -servername ${domain} </dev/null 2>/dev/null | openssl x509 -noout -dates`, { timeout: 10000, encoding: "utf-8" });
    if (!raw.trim()) return `[Cert Expiry] No cert for ${domain}`;
    const nb = raw.match(/notBefore=(.+)/)?.[1] || "?";
    const na = raw.match(/notAfter=(.+)/)?.[1] || "?";
    const days = na !== "?" ? Math.round((new Date(na).getTime() - Date.now()) / 86400000) : NaN;
    return `🔒 ${domain}\nIssued: ${nb}\nExpires: ${na}${!isNaN(days) ? `\nDays left: ${days}` : ""}`;
  } catch (e: any) { return `[Cert Expiry Error] ${e.message}`; }
}

// ── CORS TEST ──
async function corsTest(input: string): Promise<string> {
  try {
    const url = input.startsWith("http") ? input : `https://${input}`;
    const origins = ["https://evil.com", "null", "https://attacker.org", "https://example.com", ""];
    const r: string[] = [`🔓 CORS test: ${url}\n`];
    for (const origin of origins) {
      try {
        const resp = await fetch(url, { method: "GET", headers: origin ? { Origin: origin } : {}, signal: AbortSignal.timeout(5000) });
        const acao = resp.headers.get("access-control-allow-origin") || "—";
        const creds = resp.headers.get("access-control-allow-credentials") || "";
        r.push(`  Origin: ${origin || "(none)"} → ACAO: ${acao}${creds ? `, Credentials: ${creds}` : ""}`);
      } catch (e: any) { r.push(`  Origin: ${origin} → ${(e.message || "").substring(0, 50)}`); }
    }
    if (r.some(l => l.includes("*") || (l.includes("evil.com") && l.includes("https://evil.com")))) r.push(`\n⚠ Vulnerable to CORS attacks!`);
    return r.join("\n");
  } catch (e: any) { return `[CORS Error] ${e.message}`; }
}

// ── JWT DECODE ──
async function jwtDecode(input: string): Promise<string> {
  try {
    const parts = input.trim().split(".");
    if (parts.length !== 3) return `[JWT] Expected 3 parts, got ${parts.length}`;
    const b64u = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/");
    const decode = (s: string) => {
      try { return JSON.stringify(JSON.parse(Buffer.from(b64u(s), "base64").toString()), null, 2); }
      catch { return Buffer.from(b64u(s), "base64").toString(); }
    };
    return `🔐 JWT\n── Header ──\n${decode(parts[0])}\n── Payload ──\n${decode(parts[1])}\n── Signature ──\n${parts[2].substring(0, 40)}…`;
  } catch (e: any) { return `[JWT Error] ${e.message}`; }
}

// ── HASH CRACK ──
async function hashCrack(input: string): Promise<string> {
  try {
    const hash = input.trim();
    if (/^[a-f0-9]{32}$/i.test(hash)) {
      const r = await fetch(`https://www.nitrxgen.net/api/md5/${hash}`, { signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      if (text?.trim()) return `🔓 MD5 cracked: ${hash} → ${text.trim()}`;
    }
    if (/^[a-f0-9]{40}$/i.test(hash)) {
      const r = await fetch(`https://www.nitrxgen.net/api/md5/${hash}`, { signal: AbortSignal.timeout(10000) }); // nitrxgen might not support SHA1
      const text = await r.text();
      if (text?.trim()) return `🔓 Hash cracked: ${hash} → ${text.trim()}`;
    }
    return `[Hash Crack] Not found: ${hash}. Supports MD5 (32 hex) hashes.`;
  } catch (e: any) { return `[Hash Crack Error] ${e.message}`; }
}

// ── WEB APP SECURITY ──────────────────────────────────────

/** Directory Bruteforce — probes 30+ common web paths */
async function dirBruteforce(input: string): Promise<string> {
  try {
    const url = input.startsWith("http") ? input.replace(/\/+$/, "") : `https://${input.replace(/\/+$/, "")}`;
    const paths = ["/admin","/api","/.git","/.env","/backup","/wp-admin","/login","/config","/robots.txt","/.htaccess","/phpinfo.php","/test","/uploads","/debug","/graphql","/swagger","/api/v1","/health","/actuator","/console","/jenkins","/phpmyadmin","/cgi-bin","/server-status","/shell","/crossdomain.xml","/.well-known/security.txt","/metrics","/dump","/logs"];
    const results = (await Promise.allSettled(paths.map(async p => {
      try {
        const r = await fetch(url + p, { signal: AbortSignal.timeout(5000) });
        if (r.status !== 404) return `  ${r.status} ${url}${p}`;
      } catch {}
      return null;
    }))).flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
    if (!results.length) return `[DirBrute] No interesting paths at ${url}`;
    return `🔍 Dir Bruteforce — ${results.length} hits on ${url}\n${results.join("\n")}`;
  } catch (e: any) { return `[DirBrute Error] ${e.message}`; }
}

/** XSS Scanner — injects payloads, checks for reflection */
async function xssScan(input: string): Promise<string> {
  try {
    const url = input.startsWith("http") ? input : `https://${input}`;
    const payloads = ["<script>alert(1)</script>", "\"><script>alert(1)</script>", "'\"><img src=x onerror=alert(1)>", "{{constructor.constructor('alert(1)')()}}", "'';!--\"<XSS>=&{()}"];
    const results = (await Promise.allSettled(payloads.map(async p => {
      try {
        const testUrl = url.includes("?") ? `${url}&q=${encodeURIComponent(p)}` : `${url}?q=${encodeURIComponent(p)}`;
        const r = await fetch(testUrl, { signal: AbortSignal.timeout(5000) });
        const text = await r.text();
        if (text.includes(p.substring(0, 15))) return `  ⚠ ${p.substring(0, 25)} reflected at ${testUrl.substring(0, 60)}`;
      } catch {}
      return null;
    }))).flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
    if (!results.length) return `[XSS] No obvious reflection at ${url}`;
    return `🚨 XSS — ${results.length} reflection(s) on ${url}\n${results.join("\n")}`;
  } catch (e: any) { return `[XSS Error] ${e.message}`; }
}

/** SQLi Detection — sends SQLi payloads, checks error signatures */
async function sqlDetect(input: string): Promise<string> {
  try {
    const url = input.startsWith("http") ? input : `https://${input}`;
    const payloads = ["' OR '1'='1", "' OR 1=1--", "' UNION SELECT 1--", "' AND 1=1--", "' AND SLEEP(3)--", "'; DROP TABLE users--", "' OR '1'='1' /*", "' OR 1=2--"];
    const results = (await Promise.allSettled(payloads.map(async p => {
      try {
        const testUrl = url.includes("?") ? url.replace(/([=?&])[^=&]+$/, `$1${encodeURIComponent(p)}`) : `${url}?id=${encodeURIComponent(p)}`;
        const r = await fetch(testUrl, { signal: AbortSignal.timeout(8000) });
        const text = await r.text().catch(() => "");
        const sigs = ["sql", "mysql", "sqlite", "ora-", "syntax", "unclosed", "quotation", "mysql_fetch", "pg_", "odbc_", "jdbc", "driver"];
        if (sigs.some(s => text.toLowerCase().includes(s))) return `  ⚠ ${p.substring(0, 20)} → SQL error at ${testUrl.substring(0, 50)}`;
      } catch {}
      return null;
    }))).flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
    if (!results.length) return `[SQLi] No SQL errors at ${url}`;
    return `⚠️ SQLi — ${results.length} potential injection(s) on ${url}\n${results.join("\n")}`;
  } catch (e: any) { return `[SQLi Error] ${e.message}`; }
}

/** Open Redirect — tests common redirect params for external redirects */
async function openRedirect(input: string): Promise<string> {
  try {
    const url = input.startsWith("http") ? input : `https://${input}`;
    const params = ["url","redirect","redirect_uri","return","return_to","r","next","target","redir","dest","out","to","go","callback","ref"];
    const ext = "https://evil.com";
    const results = (await Promise.allSettled(params.map(async p => {
      try {
        const testUrl = url.includes("?") ? `${url}&${p}=${encodeURIComponent(ext)}` : `${url}?${p}=${encodeURIComponent(ext)}`;
        const r = await fetch(testUrl, { redirect: "manual", signal: AbortSignal.timeout(5000) });
        if ((r.headers.get("location") || "").includes("evil.com")) return `  ⚠ ${p}= → external redirect`;
      } catch {}
      return null;
    }))).flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
    if (!results.length) return `[OpenRedirect] No vulnerable params at ${url}`;
    return `🔀 Redirect Check — ${results.length} open redirect(s)\n${results.join("\n")}`;
  } catch (e: any) { return `[OpenRedirect Error] ${e.message}`; }
}

// ── OSINT TOOLS ───────────────────────────────────────────

/** Shodan Search — requires SHODAN_API_KEY */
async function shodanSearch(input: string): Promise<string> {
  const key = process.env.SHODAN_API_KEY;
  if (!key) return `[Shodan] Set SHODAN_API_KEY env var. Get one at https://account.shodan.io`;
  try {
    const q = encodeURIComponent(input.trim());
    const r = await fetch(`https://api.shodan.io/shodan/host/search?key=${key}&query=${q}&limit=10`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json() as any;
    if (!d.matches?.length) return `[Shodan] No results for "${input}"`;
    const lines = d.matches.slice(0, 10).map((m: any) => `  ${m.ip_str}:${m.port} ${m.transport||""} ${(m.product||m.data||"").substring(0, 50)}`);
    return `🌐 Shodan — ${d.total} result(s) for "${input}"\n${lines.join("\n")}`;
  } catch (e: any) { return `[Shodan Error] ${e.message}`; }
}

/** Email Breach Check — tries HIBP API (needs HIBP_API_KEY) */
async function emailBreach(input: string): Promise<string> {
  try {
    const email = input.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `[EmailBreach] Invalid email`;
    const key = process.env.HIBP_API_KEY;
    if (!key) return `[EmailBreach] Set HIBP_API_KEY for breach lookups. Get one at haveibeenpwned.com/API/Key`;
    const r = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`, {
      headers: { "hibp-api-key": key, "User-Agent": "Phantom-Security-Agent" },
      signal: AbortSignal.timeout(10000)
    });
    if (r.status === 404) return `🔒 ${email} — No known breaches ✅`;
    if (r.status === 200) {
      const breaches = await r.json() as any[];
      return `⚠️ ${email} — ${breaches.length} breach(es)\n${breaches.slice(0, 10).map((b: any) => `  🔴 ${b.Name} (${b.BreachDate||"?"})`).join("\n")}`;
    }
    return `[EmailBreach] HTTP ${r.status}`;
  } catch (e: any) { return `[EmailBreach Error] ${e.message}`; }
}

/** GitHub Dork — searches code for secrets/keys */
async function githubDork(input: string): Promise<string> {
  try {
    const query = encodeURIComponent(input.trim());
    const r = await fetch(`https://api.github.com/search/code?q=${query}&per_page=10`, {
      headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "Phantom-Cyber-Tool" },
      signal: AbortSignal.timeout(15000)
    });
    if (r.status === 403) return `[GitHubDork] Rate limited. Authenticated: 30 req/min, unauthenticated: 10. Try again.`;
    const d = await r.json() as any;
    if (!d.items?.length) return `[GitHubDork] No results for "${input}"`;
    return `🔍 GitHub Dork — ${d.total_count} result(s) for "${input}"\n${d.items.slice(0, 10).map((i: any) => `  📄 ${i.repository?.full_name||"?"}/${i.name}`).join("\n")}`;
  } catch (e: any) { return `[GitHubDork Error] ${e.message}`; }
}

/** Subdomain Takeover Check — tests CNAME for unclaimed cloud services */
async function subTakeover(input: string): Promise<string> {
  try {
    const domain = input.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const r = await fetch(`https://dns.google/resolve?name=${domain}&type=CNAME`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json() as any;
    const cnames = d?.Answer?.filter((a: any) => a.type === 5).map((a: any) => a.data) || [];
    if (!cnames.length) return `[SubTakeover] No CNAME records for ${domain}`;
    const svcs: Record<string, string> = {
      "cloudfront.net":"AWS CloudFront","s3.amazonaws.com":"AWS S3","github.io":"GitHub Pages",
      "herokuapp.com":"Heroku","azurewebsites.net":"Azure App Service","trafficmanager.net":"Azure TM",
      "pantheonsite.io":"Pantheon","squarespace.com":"Squarespace","zendesk.com":"Zendesk",
      "freshdesk.com":"Freshdesk","helpscout.net":"Help Scout","readme.io":"ReadMe",
      "unbounce.com":"Unbounce","statuspage.io":"Statuspage",
    };
    const lines = cnames.map((c: string) => {
      const svc = Object.entries(svcs).find(([s]: [string, string]) => c.includes(s));
      return svc ? `  ⚠ → ${c.trim()} — ${svc[1]} takeover possible!` : `  ℹ → ${c.trim()}`;
    });
    return `🔍 Subdomain Takeover — ${domain}\n${lines.join("\n")}`;
  } catch (e: any) { return `[SubTakeover Error] ${e.message}`; }
}

// ── PLUGIN SYSTEM ─────────────────────────────────────────

/** Load external plugins from ~/.config/phantom/plugins/ */
async function pluginLoad(input: string): Promise<string> {
  try {
    const pluginDir = (input || "").trim() || resolve(homedir(), ".config", "phantom", "plugins");
    if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });
    const files = readdirSync(pluginDir).filter((f: string) => f.endsWith(".mjs") || f.endsWith(".js"));
    if (!files.length) return `[Plugin] No plugins in ${pluginDir}. Use @plugin_create to make one.`;
    let loaded = 0;
    for (const f of files) {
      try {
        const mod = await import(pathToFileURL(resolve(pluginDir, f)).href) as any;
        if (mod.name && typeof mod.execute === "function") {
          hackerTools[mod.name] = hackerTools[mod.name] || { description: mod.description || f, execute: mod.execute };
          loaded++;
        }
      } catch (e: any) { /* skip broken */ }
    }
    return loaded ? `🔌 Loaded ${loaded} plugin(s) from ${pluginDir}` : `[Plugin] No valid modules in ${pluginDir}`;
  } catch (e: any) { return `[Plugin Error] ${e.message}`; }
}

/** Create a new plugin skeleton */
async function pluginCreate(input: string): Promise<string> {
  try {
    const [name, ...rest] = input.split("|");
    const n = (name || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const desc = (rest[0] || "Custom Phantom plugin").trim();
    if (!n) return `[Plugin] Format: tool_name|description`;
    const pluginDir = resolve(homedir(), ".config", "phantom", "plugins");
    if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });
    const code = `// Phantom Plugin: ${n}\n// ${desc}\nexport const name = "${n}";\nexport const description = "${desc}";\nexport async function execute(input) {\n  try {\n    return \`[${n}] Processed: \${input}\`;\n  } catch (e) { return \`[\${name} Error] \${e.message}\`; }\n}\n`;
    const fp = resolve(pluginDir, `${n}.mjs`);
    writeFileSync(fp, code, "utf-8");
    try {
      const mod = await import(pathToFileURL(fp).href) as any;
      hackerTools[mod.name] = { description: mod.description, execute: mod.execute };
      return `🔌 Plugin created + loaded: @${n}\n  ${fp}`;
    } catch {
      return `🔌 Plugin created: @${n}\n  ${fp}\n  Run @plugin_load to activate.`;
    }
  } catch (e: any) { return `[Plugin Error] ${e.message}`; }
}

// ── REPORTING ─────────────────────────────────────────────

/** Export report to styled HTML (browser → Ctrl+P = PDF) */
async function reportExport(input: string): Promise<string> {
  try {
    const reportsDir = resolve(homedir(), ".config", "phantom", "reports");
    const name = input.trim();
    if (!name && existsSync(reportsDir)) {
      const all = readdirSync(reportsDir).filter((f: string) => f.endsWith(".md"));
      if (!all.length) return `[ReportExport] No .md reports found in ${reportsDir}`;
      return `[ReportExport] Usage: @report_export|report_name\nAvailable: ${all.join(", ")}`;
    }
    const fp = resolve(reportsDir, name.includes(".") ? name : `${name}.md`);
    if (!existsSync(fp)) return `[ReportExport] Not found: ${name}`;
    const content = readFileSync(fp, "utf-8");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Phantom — ${name}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:20px auto;padding:20px;background:#1a1a2e;color:#c8d6e5}h1{color:#00ff88}h2{color:#ffaa00}h3{color:#5a7aff}code,pre{background:#0a0a0f;color:#44ff88;padding:2px 6px;border-radius:3px}pre{padding:12px}hr{border-color:#333}</style></head><body>${
      content.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        .replace(/^#### (.+)$/gm,"<h4>$1</h4>").replace(/^### (.+)$/gm,"<h3>$1</h3>")
        .replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/`{3}([\s\S]*?)`{3}/g,"<pre>$1</pre>")
        .replace(/`(.+?)`/g,"<code>$1</code>").replace(/\n/g,"<br>")
    }</body></html>`;
    const htmlPath = fp.replace(/\.\w+$/, ".html");
    writeFileSync(htmlPath, html, "utf-8");
    return `📄 Report exported: ${htmlPath}\n  Open in browser → Ctrl+P → Save as PDF.`;
  } catch (e: any) { return `[ReportExport Error] ${e.message}`; }
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
      "List all available playbooks with descriptions and step counts. Includes 4 built-in playbooks plus custom. Playbooks can chain other playbooks via playbook_run steps.",
    execute: playbookList,
  },
  playbook_run: {
    description:
      "Execute a playbook against a target. Steps run sequentially with variable substitution ({{target}}). Supports chaining: use playbook_run step to call another playbook. Input: playbook_name|target=example.com,port=80. Returns full execution log.",
    execute: playbookRun,
  },
  playbook_edit: {
    description:
      "Modify a playbook: edit steps, change description, or append new steps. Format: name|step_num|tool|args|desc or name|desc|new_description or name|add|tool|args|desc.",
    execute: playbookEdit,
  },
  // ── NEW TOOLS ──
  sandbox: {
    description:
      "SAFELY RUN a suspicious binary in an isolated sandbox environment. Creates temp directory, strace-monitor if available, captures syscalls (network/file/process), stdout/stderr, exit code, and SHA256 hash. Detects PE vs ELF vs script. Use for: malware dynamic analysis, behavioral testing, I/O monitoring. Format: path|args|timeout(seconds). Example: @sandbox|/tmp/suspicious.bin||30",
    execute: sandboxExec,
  },
  pe_analyze: {
    description:
      "Deep PE (Portable Executable) format analysis: DOS header, COFF header (machine/compile time/sections), optional header (entry point/image base/subsystem), section table with W+X detection, data directories, entropy calculation, packer detection (UPX/Themida/VMP). Use for: static malware analysis of Windows binaries, unpacking detection. Input: absolute path to PE file.",
    execute: peAnalyze,
  },
  elf_analyze: {
    description:
      "Deep ELF format analysis: class (32/64-bit), byte order, OS/ABI, type (EXEC/DYN/REL), machine arch, entry point, program headers with W+X detection, dynamic symbols (imported functions), entropy calculation, GNU_STACK checks. Use for: static analysis of Linux binaries, packer/reverse engineering. Input: absolute path to ELF file.",
    execute: elfAnalyze,
  },
  macro_scan: {
    description:
      "Analyze Office documents for malicious macros/VBA code. Scans OLE2 (.doc/.xls/.ppt), OOXML (.docx/.xlsm/.docm), and raw VBA/VBS scripts. Detects Auto-executing macros (Auto_Open, Document_Open), suspicious patterns (Shell, CreateObject, WScript, PowerShell, cmd.exe). Use for: phishing analysis, malware document triage. Input: path to document or script.",
    execute: macroScan,
  },
  strings_deep: {
    description:
      "Advanced string extraction with AI-style categorization. Extracts all printable strings (≥4 chars) and classifies into: URLs, email addresses, IP addresses, domains, file paths, potential secrets/keys, and other strings. Includes entropy calculation for packed file detection. Use for: malware string analysis, IOC discovery, binary triage. Input: absolute file path.",
    execute: stringsDeep,
  },
  hex_dump: {
    description:
      "Classic hex dump viewer with ASCII sidebar. Shows offset (hex), 16 bytes per row in hex format, and ASCII representation. Configurable offset and length. Use for: manual binary analysis, file header inspection, pattern matching. Format: path|offset|length. Default: offset=0, length=512 bytes (max 4096).",
    execute: hexDump,
  },
  extract_ioc: {
    description:
      "Extract Indicators of Compromise (IOCs) from text or files. Detects: IPv4 addresses, domains, URLs, email addresses, MD5/SHA1/SHA256 hashes, file paths. Filters private/local IPs and deduplicates. Use for: threat intelligence, log analysis, malware report parsing. Input: file path (auto-detected) or raw text.",
    execute: extractIoc,
  },
  proc_analyze: {
    description:
      "Deep process forensics inspection. Shows: process name/state/PPID/UID/threads, command line, working directory, executable, environment variables (with secrets detection), open file descriptors (sockets/pipes/files), network connections (TCP/UDP with state), memory regions (with RWX detection). Use for: live malware analysis, process investigation, incident response. Input: PID number.",
    execute: procAnalyze,
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

  // ── UTILITY TOOLS ──
  reverse_dns: {
    description:
      "Reverse DNS lookup (PTR record) for an IP address. Shows the domain names associated with the IP. Use for: identifying hosts, email server validation. Input: IP address.",
    execute: reverseDns,
  },
  wayback: {
    description:
      "Query Wayback Machine for historical URL snapshots of a domain. Shows timestamps, status codes, and URLs. Use for: recon on old endpoints, content discovery. Input: domain or URL.",
    execute: wayback,
  },
  cert_expiry: {
    description:
      "Check SSL certificate expiry date and days remaining. Uses openssl to fetch and parse cert dates. Use for: monitoring cert expiration, security audits. Input: domain name.",
    execute: certExpiry,
  },
  cors_test: {
    description:
      "Test for CORS misconfigurations by sending requests with various Origin headers. Detects wildcard origins, null origin acceptance, and credential leakage. Input: URL.",
    execute: corsTest,
  },
  jwt_decode: {
    description:
      "Decode a JWT token header and payload without verification. Shows the JSON content of each part. Use for: analyzing auth tokens, testing JWT implementations. Input: full JWT string.",
    execute: jwtDecode,
  },
  hash_crack: {
    description:
      "Look up MD5 hash in online rainbow tables (nitrxgen API). Use for: cracking password hashes, identifying plaintext. Input: MD5 hash (32 hex chars).",
    execute: hashCrack,
  },

  // ── WEB APP SECURITY ──
  dir_bruteforce: {
    description:
      "Web directory brute force: probes 30+ common paths (admin, api, .git, .env, uploads, etc.). Uses parallel requests. Use for: finding hidden endpoints, admin panels, exposed files. Input: URL or domain.",
    execute: dirBruteforce,
  },
  xss_scan: {
    description:
      "Cross-Site Scripting scanner: injects multiple XSS payloads via query params and checks if they reflect. Use for: detecting XSS vulnerabilities. Input: URL (with or without params).",
    execute: xssScan,
  },
  sql_detect: {
    description:
      "SQL Injection detection: sends common SQLi payloads (' OR 1=1--, UNION SELECT, etc.) and scans for SQL error signatures. Use for: finding SQLi entry points. Input: URL with parameter.",
    execute: sqlDetect,
  },
  open_redirect: {
    description:
      "Open redirect scanner: tests 15 common redirect parameters (url, redirect, next, etc.) for external redirects. Use for: finding unvalidated redirects. Input: URL.",
    execute: openRedirect,
  },

  // ── OSINT ──
  shodan_search: {
    description:
      "Search Shodan for internet-connected devices, open ports, and banners. Requires SHODAN_API_KEY. Use for: OSINT, exposed devices, infrastructure discovery. Input: search query.",
    execute: shodanSearch,
  },
  email_breach: {
    description:
      "Check if an email appears in known data breaches via HIBP API (requires HIBP_API_KEY). Shows breach names and dates. Use for: OSINT, compromise investigation. Input: email address.",
    execute: emailBreach,
  },
  github_dork: {
    description:
      "Search GitHub source code for secrets, keys, and sensitive data via GitHub Code Search. Use for: finding exposed credentials, API keys, and configs. Input: search query.",
    execute: githubDork,
  },
  sub_takeover: {
    description:
      "Check subdomain for potential takeover via unclaimed CNAME records. Checks 15+ cloud services (AWS S3, CloudFront, GitHub Pages, Heroku, Azure, etc.). Use for: identifying dangling DNS. Input: domain.",
    execute: subTakeover,
  },

  // ── PLUGIN SYSTEM ──
  plugin_load: {
    description:
      "Load external plugin tools from ~/.config/phantom/plugins/. Imports .mjs/.js modules with name/description/execute exports. Use for: extending Phantom without modifying core. Input: optional plugin directory path.",
    execute: pluginLoad,
  },
  plugin_create: {
    description:
      "Create a new Phantom plugin skeleton. Format: name|description. Saves to ~/.config/phantom/plugins/ and attempts auto-load. Use for: quickly extending toolset. Input: tool_name|description.",
    execute: pluginCreate,
  },

  // ── REPORTING ──
  report_export: {
    description:
      "Export a saved markdown report to styled dark-themed HTML. Open in browser → Ctrl+P → Save as PDF. Use for: sharing findings, report formatting. Input: report name (without .md).",
    execute: reportExport,
  },

  // ── WEB CLICKERS ──
  web_click: {
    description: "Navigate and click web page elements by index, link text, or URL. method: index (click Nth link), text (by link text), selector (URL). Input: url|selector|method.",
    execute: webClick,
  },
  web_links: {
    description: "Extract and categorize all links from a page (internal/external/resources). Input: URL.",
    execute: webLinks,
  },
  web_form: {
    description: "Extract HTML forms and submit with custom field values. Input: url|field1=val1|field2=val2.",
    execute: webForm,
  },
  web_snapshot: {
    description: "Get structured text snapshot of a page: headings, meta, links, content. Input: URL.",
    execute: webSnapshot,
  },

  // ── WORKSPACE (Project Management) ──
  project_create: {
    description: "Create a new project workspace. Stores metadata in ~/.config/phantom/projects/. Input: project name.",
    execute: projectCreate,
  },
  project_list: {
    description: "List all projects with file/note counts and age. Input: none.",
    execute: projectList,
  },
  project_info: {
    description: "Show project details: created date, files, notes, tools used. Input: project name.",
    execute: projectInfo,
  },
  project_file_add: {
    description: "Add a file to a project by copying it into the project directory. Input: project|filepath.",
    execute: projectFileAdd,
  },
  project_note: {
    description: "Add or list project notes. Format: project|note_text (or just project name to list). Input: project|note.",
    execute: projectNote,
  },
  project_switch: {
    description: "Set active project for context. Input: project name.",
    execute: projectSwitch,
  },
};
