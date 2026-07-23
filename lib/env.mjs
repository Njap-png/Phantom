// Phantom — Environment auto-detection
// Lazy singleton: fast checks on first access, cached in __r.ENV

import { execFileSync } from "child_process";
import { accessSync, constants } from "fs";

// ── Cache ──
let _populated = false;

// ── Quick binary check (which, cached) ──
const _binCache = {};
function hasBin(name) {
  if (name in _binCache) return _binCache[name];
  try {
    execFileSync("which", [name], { timeout: 2000, stdio: "pipe" });
    _binCache[name] = true;
  } catch { _binCache[name] = false; }
  return _binCache[name];
}

// ── Security/network tool categories ──
const RECON_BINS   = ["nmap", "masscan", "subfinder", "amass", "whois", "dig", "nslookup", "dnsx", "shuffledns"];
const EXPLOIT_BINS = ["sqlmap", "metasploit", "searchsploit", "hydra", "john", "hashcat", "nuclei", "ffuf", "gobuster"];
const DEV_BINS     = ["python3", "python", "go", "rustc", "gcc", "make", "git", "curl", "wget", "jq"];
const NET_BINS     = ["ping", "traceroute", "netstat", "ss", "iptables", "ufw"];
const BROWSER_BINS = ["google-chrome", "chromium", "firefox", "chromium-browser"];

function detectTools() {
  const tools = {};
  for (const t of [...RECON_BINS, ...EXPLOIT_BINS, ...DEV_BINS, ...NET_BINS, ...BROWSER_BINS]) {
    tools[t] = hasBin(t);
  }
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
function detectShell() {
  return process.env.SHELL?.split("/").pop() || "sh";
}

// ── Network ──
function detectNetwork() {
  const info = { online: false, publicIP: null, dns: null, proxy: null };
  try {
    // Quick localhost check: can we resolve google.com?
    execFileSync("sh", ["-c", "timeout 3 ping -c 1 -W 2 8.8.8.8 2>/dev/null || timeout 3 curl -s --max-time 3 https://1.1.1.1 >/dev/null 2>&1"], { timeout: 4000 });
    info.online = true;
  } catch {}
  try {
    const out = execFileSync("sh", ["-c", "timeout 3 dig +short myip.opendns.com @resolver1.opendns.com 2>/dev/null || timeout 3 curl -s --max-time 3 ifconfig.me 2>/dev/null || timeout 3 curl -s --max-time 3 icanhazip.com 2>/dev/null"], { timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
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
  const r = { cpu: 0, mem: 0, memFree: 0, arch: process.arch };
  try {
    const out = execFileSync("nproc", [], { timeout: 2000 });
    r.cpu = parseInt(out.toString().trim()) || 0;
  } catch {
    try {
      const out = execFileSync("sh", ["-c", "grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1"], { timeout: 2000 });
      r.cpu = parseInt(out.toString().trim()) || 1;
    } catch { r.cpu = 1; }
  }
  try {
    const out = execFileSync("sh", ["-c", "grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0"], { timeout: 2000 });
    r.mem = parseInt(out.toString().trim()) || 0;
    const out2 = execFileSync("sh", ["-c", "grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}' || grep MemFree /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0"], { timeout: 2000 });
    r.memFree = parseInt(out2.toString().trim()) || 0;
  } catch {}
  return r;
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

  // Count available tools
  const availableCount = Object.values(tools).filter(Boolean).length;
  const totalChecked = Object.keys(tools).length;

  // Merge into existing ENV
  Object.assign(existingEnv, {
    tools,
    pkgMgr,
    shell,
    network,
    resources,
    availableTools: availableCount,
    totalChecked,
  });
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
  lines.push(`CPU: ${env.resources?.cpu || "?"} cores · RAM: ${Math.round((env.resources?.mem || 0) / 1024)}MB (${Math.round((env.resources?.memFree || 0) / 1024)}MB free)`);
  
  // Tool availability
  const { tools } = env;
  if (tools) {
    const avail = Object.entries(tools).filter(([,v]) => v).map(([k]) => k);
    const missing = Object.entries(tools).filter(([,v]) => !v).map(([k]) => k);
    lines.push(`Tools: ${avail.length}/${Object.keys(tools).length} available`);
    lines.push(`  Present: ${avail.join(", ")}`);
    if (missing.length > 0 && missing.length < 60) {
      lines.push(`  Missing: ${missing.join(", ")}`);
    }
  }

  return lines.join("\n");
}
