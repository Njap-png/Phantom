// Phantom — Environment auto-detection
// Lazy singleton: fast checks on first access, cached in __r.ENV

import { execFileSync, spawn } from "child_process";

// ── Cache ──
let _populated = false;

// ── Quick binary check (which, cached) ──
const _binCache = {};
function hasBin(name) {
  if (name in _binCache) return _binCache[name];
  try { execFileSync("which", [name], { timeout: 2000, stdio: "pipe" }); _binCache[name] = true; }
  catch { _binCache[name] = false; }
  return _binCache[name];
}

// ── Security/network tool categories ──
const RECON_BINS   = ["nmap","masscan","subfinder","amass","whois","dig","nslookup","dnsx","shuffledns"];
const EXPLOIT_BINS = ["sqlmap","metasploit","searchsploit","hydra","john","hashcat","nuclei","ffuf","gobuster"];
const DEV_BINS     = ["python3","python","go","rustc","gcc","make","git","curl","wget","jq"];
const NET_BINS     = ["ping","traceroute","netstat","ss","iptables","ufw"];
const BROWSER_BINS = ["google-chrome","chromium","firefox","chromium-browser"];
const ALL_BINS = [...RECON_BINS, ...EXPLOIT_BINS, ...DEV_BINS, ...NET_BINS, ...BROWSER_BINS];

// Binary name → apt package name mapping
const PKG_MAP = {
  nmap:"nmap", masscan:"masscan", whois:"whois", dig:"dnsutils", hydra:"hydra",
  john:"john", hashcat:"hashcat", traceroute:"traceroute", netstat:"net-tools",
  ss:"iproute2", nikto:"nikto", dirb:"dirb", whatweb:"whatweb", wafw00f:"wafw00f",
  aircrack:"aircrack-ng", tshark:"tshark", sqlmap:"sqlmap", dnsrecon:"dnsrecon",
};
// Estimated installed size in KB (from apt-cache show). hashcat=145MB is excluded.
const PKG_SIZE = {
  nmap:4156, masscan:464, whois:300, dig:1200, hydra:1006, john:403,
  hashcat:148553, traceroute:216, netstat:1072, ss:3703, nikto:1862,
  dirb:1594, whatweb:19206, wafw00f:260, aircrack:2491, tshark:398,
  sqlmap:15000, dnsrecon:200,
};

function detectTools() {
  const tools = {};
  try {
    const script = ALL_BINS.map(t => `command -v ${t} 2>/dev/null && echo BIN:${t}`).join(";");
    let out;
    try {
      out = execFileSync("sh", ["-c", script], { timeout: 5000, stdio: ["pipe","pipe","pipe"] }).toString();
    } catch (e) {
      // Some commands fail (tools not found) — still read partial stdout
      out = e.stdout?.toString() || "";
    }
    const found = new Set(out.trim().split("\n").filter(l => l.startsWith("BIN:")).map(l => l.slice(4)));
    for (const t of ALL_BINS) tools[t] = found.has(t);
  } catch { for (const t of ALL_BINS) tools[t] = false; }
  return tools;
}

// ── Package manager ──
function detectPkgManager() {
  if (hasBin("apt")) return "apt";
  if (hasBin("apk")) return "apk";
  if (hasBin("yum")) return "yum";
  if (hasBin("dnf")) return "dnf";
  if (hasBin("pacman")) return "pacman";
  if (hasBin("brew")) return "brew";
  if (hasBin("pkg")) return "pkg";
  return null;
}

// ── Shell ──
function detectShell() { return process.env.SHELL?.split("/").pop() || "sh"; }

// ── Network ──
function detectNetwork() {
  const info = { online: false, publicIP: null, dns: null, proxy: null };
  try { execFileSync("sh", ["-c", "timeout 3 curl -s --max-time 3 https://1.1.1.1 >/dev/null 2>&1 || timeout 3 ping -c 1 -W 2 8.8.8.8 2>/dev/null"], { timeout: 5000 }); info.online = true; } catch {}
  try {
    const out = execFileSync("sh", ["-c", "timeout 3 dig +short myip.opendns.com @resolver1.opendns.com 2>/dev/null || timeout 3 curl -s --max-time 3 ifconfig.me 2>/dev/null || timeout 3 curl -s --max-time 3 icanhazip.com 2>/dev/null"], { timeout: 5000, stdio: ["pipe","pipe","pipe"] });
    const ip = out.toString().trim();
    if (ip) { info.publicIP = ip; info.online = true; }
  } catch {}
  if (process.env.HTTP_PROXY || process.env.https_proxy) info.proxy = process.env.HTTP_PROXY || process.env.https_proxy;
  if (process.env.HTTPS_PROXY || process.env.https_proxy) info.proxy = info.proxy || process.env.HTTPS_PROXY;
  try {
    const out = execFileSync("sh", ["-c", "grep '^nameserver' /etc/resolv.conf 2>/dev/null | head -1 | awk '{print $2}'"], { timeout: 2000 });
    const dns = out.toString().trim();
    if (dns) info.dns = dns;
  } catch {}
  return info;
}

// ── System resources ──
function detectResources() {
  const r = { cpu: 0, mem: 0, memFree: 0, diskFree: 0, arch: process.arch };
  try { r.cpu = parseInt(execFileSync("nproc",[],{timeout:2000}).toString().trim()) || 0; }
  catch {
    try { r.cpu = parseInt(execFileSync("sh",["-c","grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1"],{timeout:2000}).toString().trim()) || 1; }
    catch { r.cpu = 1; }
  }
  try {
    const out1 = execFileSync("sh",["-c","grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0"],{timeout:2000});
    r.mem = parseInt(out1.toString().trim()) || 0;
    const out2 = execFileSync("sh",["-c","grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}' || grep MemFree /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0"],{timeout:2000});
    r.memFree = parseInt(out2.toString().trim()) || 0;
  } catch {}
  try {
    const df = execFileSync("sh",["-c","df / 2>/dev/null | tail -1 | awk '{print $4}'"],{timeout:2000});
    const kb = parseInt(df.toString().trim());
    if (!isNaN(kb)) r.diskFree = kb;
  } catch {}
  return r;
}

const CORE_TOOLS = ["curl","wget","git","jq","python3"];

// Auto-install core missing tools (skips if disk < 50MB).
// Returns: >0 installed, 0 nothing needed, -1 install failed, -2 disk too low
export function autoInstallCore(envTools) {
  if (!envTools?.pkgMgr || envTools.pkgMgr !== "apt") return 0;
  if (envTools.resources?.diskFree < 50*1024) return -2;
  if (!envTools.tools) return 0;
  const missing = CORE_TOOLS.filter(t => envTools.tools[t] === false);
  if (!missing.length) return 0;
  try {
    execFileSync("apt",["install","-y",...missing],{timeout:120000,stdio:"pipe"});
    for (const t of missing) {
      try { execFileSync("which",[t],{timeout:2000,stdio:"pipe"}); envTools.tools[t] = true; } catch {}
    }
    return missing.length;
  } catch { return -1; }
}

// Auto-install missing security tools (background, non-blocking).
// Picks smallest tools first, skips hashcat (145MB). Runs at most once.
let _autoSecurityStarted = false;
export function autoInstallSecurity(envTools, logFn) {
  if (_autoSecurityStarted) return;
  if (!envTools?.pkgMgr || envTools.pkgMgr !== "apt") return;
  if (envTools.resources?.diskFree < 200*1024) return; // need 200MB+ free
  if (!envTools.tools) return;

  const missingBins = Object.entries(envTools.tools)
    .filter(([k,v]) => !v && PKG_MAP[k])
    .map(([k]) => k);

  // Skip hashcat (145MB), sort remaining by size (smallest first)
  const targets = missingBins
    .filter(t => t !== "hashcat" && t !== "sqlmap") // skip biggest
    .sort((a, b) => (PKG_SIZE[a] || 999999) - (PKG_SIZE[b] || 999999))
    .slice(0, 15); // max 15 packages

  if (!targets.length) return;
  _autoSecurityStarted = true;

  const pkgs = targets.map(t => PKG_MAP[t]);
  const totalEst = targets.reduce((s, t) => s + (PKG_SIZE[t] || 0), 0);
  const neededKb = totalEst + 50000; // +50MB margin for deps

  if (envTools.resources.diskFree < neededKb) {
    if (logFn) logFn(`[env] Need ~${Math.round(neededKb/1024)}MB for security tools, only ${Math.round(envTools.resources.diskFree/1024)}MB free — skipping auto-install`);
    _autoSecurityStarted = false;
    return;
  }

  if (logFn) logFn(`[env] Auto-installing ${targets.length} security tools (${Math.round(totalEst/1024)}MB)...`);

  const proc = spawn("apt", ["install", "-y", ...pkgs], { stdio: ["pipe", "pipe", "pipe"], timeout: 300000 });
  let output = "";
  proc.stdout.on("data", d => { output += d.toString(); });
  proc.stderr.on("data", d => { output += d.toString(); });

  proc.on("close", (code) => {
    if (code === 0 && logFn) {
      // Refresh tool detection
      const freshTools = detectTools();
      Object.assign(envTools.tools, freshTools);
      const now = Object.entries(freshTools).filter(([,v]) => v).length;
      if (logFn) logFn(`[env] ✓ ${targets.length} tools installed (${now}/${Object.keys(freshTools).length} available)`);
    } else {
      if (logFn) logFn(`[env] ✗ apt install exited code ${code} — will retry next startup`);
      _autoSecurityStarted = false; // allow retry
    }
  });
  proc.on("error", (e) => { if (logFn) logFn(`[env] ✗ apt install error: ${e.message}`); _autoSecurityStarted = false; });
}

// ── Public API ──
export function populateEnv(existingEnv = {}) {
  if (_populated) return;
  _populated = true;

  const tools = detectTools();
  const pkgMgr = detectPkgManager();
  const shell = detectShell();
  const network = detectNetwork();
  const resources = detectResources();

  // Auto-install core missing tools
  const installed = autoInstallCore({ pkgMgr, tools, resources });
  if (installed > 0) {
    const freshTools = detectTools();
    Object.assign(tools, freshTools);
  }

  const availableCount = Object.values(tools).filter(Boolean).length;
  const totalChecked = Object.keys(tools).length;

  Object.assign(existingEnv, { tools, pkgMgr, shell, network, resources, availableTools: availableCount, totalChecked });
}

export function getEnvSummary(env) {
  const lines = [];
  lines.push(`Platform: ${env.platform || "?"}`);
  lines.push(`Shell: ${env.shell || "?"}`);
  lines.push(`Terminal: ${env.terminal || "?"}`);
  lines.push(`Colors: ${env.hasTrueColor ? "truecolor" : env.has256 ? "256" : "16"}`);
  lines.push(`Screen: ${env.cols}x${env.rows} (${env.screenSize})`);
  lines.push(`Package manager: ${env.pkgMgr || "none"}`);
  lines.push(`Network: ${env.network?.online ? "online" : "offline"}${env.network?.publicIP ? " · IP: " + env.network.publicIP : ""}${env.network?.dns ? " · DNS: " + env.network.dns : ""}`);
  lines.push(`CPU: ${env.resources?.cpu || "?"} cores · RAM: ${Math.round((env.resources?.mem||0)/1024)}MB (${Math.round((env.resources?.memFree||0)/1024)}MB free) · Disk: ${Math.round((env.resources?.diskFree||0)/1024)}MB free`);

  const { tools } = env;
  if (tools) {
    const avail = Object.entries(tools).filter(([,v]) => v).map(([k]) => k);
    const missing = Object.entries(tools).filter(([,v]) => !v).map(([k]) => k);
    lines.push(`Tools: ${avail.length}/${Object.keys(tools).length} available`);
    lines.push(`  Present: ${avail.join(", ")}`);
    if (missing.length < 60) lines.push(`  Missing: ${missing.join(", ")}`);
  }
  return lines.join("\n");
}
