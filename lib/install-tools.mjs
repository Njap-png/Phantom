// Phantom — self-provisioning of external binaries
// Detects missing tools and installs prebuilt releases automatically.
// Zero external deps: uses global fetch + python3 zipfile for extraction.

import fs from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";
import { BASE_DIR } from "./config.mjs";

export const BIN_DIR = resolve(BASE_DIR, "bin");

// ProjectDiscovery tools shipped as GitHub release zips.
export const PD_TOOLS = {
  subfinder: "projectdiscovery/subfinder",
  dnsx: "projectdiscovery/dnsx",
  httpx: "projectdiscovery/httpx",
  nuclei: "projectdiscovery/nuclei",
  katana: "projectdiscovery/katana",
};

const _resolved = {};

function archTag() {
  const a = process.arch;
  if (a === "x64") return "amd64";
  if (a === "arm64") return "arm64";
  if (a === "ia32") return "386";
  return a;
}

function platformTag() {
  const p = process.platform;
  if (p === "win32") return "windows";
  return p; // linux / darwin
}

function isExecutable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

// Validate that a binary is the ProjectDiscovery tool (not e.g. the Python httpx).
export function probeBinary(p) {
  try {
    const out = execFileSync(p, ["-version"], { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    const s = (out || "").toLowerCase();
    if (s.includes("no such option") || s.includes("usage: httpx")) return { ok: false, version: null };
    const m = s.match(/v?\d+\.\d+\.\d+/);
    return { ok: true, version: m ? m[0] : null };
  } catch (e) {
    const s = ((e.stdout || "") + (e.stderr || "")).toString().toLowerCase();
    if (s.includes("no such option") || s.includes("usage: httpx")) return { ok: false, version: null };
    // Some tools exit non-zero on -version but still print it
    const m = s.match(/v?\d+\.\d+\.\d+/);
    return { ok: !!m, version: m ? m[0] : null };
  }
}

function whichPath(name) {
  try {
    const out = execFileSync("which", [name], { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    return out || null;
  } catch { return null; }
}

// Resolve a usable binary path: prefer our self-installed bin dir, then PATH.
// For PD tools, validates the PATH binary is actually the PD tool.
export function resolveToolBin(name) {
  if (name in _resolved) return _resolved[name];
  const self = resolve(BIN_DIR, name);
  if (isExecutable(self)) { _resolved[name] = self; return self; }

  const onPath = whichPath(name);
  if (onPath) {
    if (name in PD_TOOLS) {
      if (probeBinary(onPath).ok) { _resolved[name] = onPath; return onPath; }
      // Wrong binary (e.g. Python httpx) — treat as missing
    } else {
      _resolved[name] = onPath; return onPath;
    }
  }
  _resolved[name] = null;
  return null;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Extract a zip using python3 (no unzip dependency).
function extractZip(zipPath, destDir) {
  execFileSync("python3", ["-c",
    "import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
    zipPath, destDir,
  ], { timeout: 120000, stdio: ["pipe", "pipe", "pipe"] });
}

async function latestAssetUrl(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "User-Agent": "Phantom/0.2.0", Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const rel = await res.json();
  const want = `_${platformTag()}_${archTag()}.zip`;
  const asset = (rel.assets || []).find(a => a.name.endsWith(want));
  if (!asset) throw new Error(`no asset matching ${want}`);
  return { url: asset.browser_download_url, name: asset.name, version: rel.tag_name };
}

// Install one PD tool into BIN_DIR. Returns the binary path.
export async function ensureBinary(name, logFn = () => {}) {
  const existing = resolveToolBin(name);
  if (existing) return existing;
  const repo = PD_TOOLS[name];
  if (!repo) throw new Error(`no installer for ${name}`);

  ensureDir(BIN_DIR);
  logFn(`[deps] installing ${name}...`);
  const { url, name: assetName, version } = await latestAssetUrl(repo);
  const zipPath = resolve(BIN_DIR, assetName);

  const res = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { "User-Agent": "Phantom/0.2.0" } });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

  const tmp = resolve(BIN_DIR, `.tmp-${name}`);
  ensureDir(tmp);
  extractZip(zipPath, tmp);
  // find the binary inside (may be at root or nested)
  let binSrc = resolve(tmp, name);
  if (!fs.existsSync(binSrc)) {
    const hit = fs.readdirSync(tmp, { recursive: true }).find(f => String(f).endsWith(`/${name}`) || f === name);
    if (hit) binSrc = resolve(tmp, String(hit));
  }
  if (!fs.existsSync(binSrc)) throw new Error(`binary ${name} not found in archive`);
  const dest = resolve(BIN_DIR, name);
  fs.copyFileSync(binSrc, dest);
  fs.chmodSync(dest, 0o755);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(zipPath); } catch {}

  delete _resolved[name];
  const installed = resolveToolBin(name);
  logFn(`[deps] ✓ ${name} ${version || ""} installed`);
  return installed;
}

// Ensure all PD recon tools are present (best-effort, sequential).
export async function ensureReconTools(logFn = () => {}) {
  const results = {};
  for (const name of ["subfinder", "dnsx", "httpx"]) {
    try { results[name] = await ensureBinary(name, logFn); }
    catch (e) { logFn(`[deps] ✗ ${name}: ${e.message}`); results[name] = null; }
  }
  return results;
}

export function listResolved() {
  return { ..._resolved };
}
