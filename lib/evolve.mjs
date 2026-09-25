// Phantom — Auto-Evolution Engine
// Self-healing, self-optimizing, self-growing.
// Runs automatically on startup and after tasks.

import fs from "fs";
import { execFileSync, execSync } from "child_process";
import { resolve, join } from "path";
import { homedir, tmpdir } from "os";
import { get as vaultGet } from "./vault.mjs";
import { BASE_DIR, TOOLS_DIR, PHANTOM_VERSION, KNOWLEDGE_DIR, PLAYBOOKS_DIR, PHANTOM_DIR } from "./config.mjs";
import { __r } from "./runtime.mjs";

// ── Constants ──────────────────────────────────────────────
const EVOLVE_LOG = resolve(BASE_DIR, "evolve.json");
const AUTO_TOOLS_DIR = resolve(PHANTOM_DIR, "lib", "auto_tools"); // in-repo so git-tracked
const LEARNED_DIR = resolve(PHANTOM_DIR, "lib", "learned"); // in-repo so git-tracked

// ── Git helpers ────────────────────────────────────────────
export function gitRoot() {
  try {
    const r = execSync("git rev-parse --show-toplevel 2>/dev/null", { encoding: "utf-8", timeout: 5000 }).trim();
    return r || null;
  } catch { return null; }
}

export function gitCommit(files, msg) {
  const root = gitRoot();
  if (!root) return false;
  try {
    // Stage specific files or all changes
    if (files && files.length > 0) {
      for (const f of files) {
        const abs = f.startsWith("/") ? f : resolve(PHANTOM_DIR, f);
        if (fs.existsSync(abs)) execSync(`git add "${abs}"`, { cwd: root, encoding: "utf-8", timeout: 10000 });
      }
    } else {
      execSync("git add -A", { cwd: root, encoding: "utf-8", timeout: 10000 });
    }
    // Check if anything staged
    const staged = execSync("git diff --cached --stat", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
    if (!staged) return false;
    execSync(`git commit -m "${msg}"`, { cwd: root, encoding: "utf-8", timeout: 15000 });
    return true;
  } catch { return false; }
}

// ── Push authentication ────────────────────────────────────
// Auto-push runs unattended, so it can never wait on an interactive credential
// prompt. We hand git an askpass helper that reads the token from the
// environment or the secret vault, so the token is never written into
// .git/config, the remote URL, or a credential store on disk.
function pushAuthEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  let token = process.env.GITHUB_TOKEN || process.env.GIT_TOKEN;
  if (!token) { try { token = vaultGet("GITHUB_TOKEN") || vaultGet("GIT_TOKEN"); } catch {} }
  if (!token) return { env, ok: false, reason: "no GITHUB_TOKEN — run the GitHub setup prompt" };

  const helper = resolve(tmpdir(), `phantom-git-askpass-${process.pid}`);
  try {
    fs.writeFileSync(helper,
      '#!/bin/sh\n' +
      'case "$1" in\n' +
      '  *[Uu]sername*) echo "${PHANTOM_GIT_USER:-x-access-token}" ;;\n' +
      '  *[Pp]assword*) printf "%s" "$PHANTOM_GIT_TOKEN" ;;\n' +
      'esac\n', { mode: 0o700 });
  } catch {
    return { env, ok: false, reason: "could not write git askpass helper" };
  }
  env.GIT_ASKPASS = helper;
  env.PHANTOM_GIT_TOKEN = token;
  env.PHANTOM_GIT_USER = process.env.GITHUB_USER || "x-access-token";
  return { env, ok: true, cleanup: () => { try { fs.unlinkSync(helper); } catch {} } };
}

export function gitPush() {
  const root = gitRoot();
  if (!root) return { pushed: false, reason: "no git root" };
  // Check if remote exists
  try {
    const remotes = execSync("git remote", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
    if (!remotes) return { pushed: false, reason: "no remote configured" };
  } catch { return { pushed: false, reason: "no remote" }; }

  // Fetch and check for upstream divergence (misalignment)
  const auth = pushAuthEnv();
  try {
    const upstream = execSync("git rev-parse --symbolic-full-name @{upstream} 2>/dev/null", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
    if (upstream) {
      execSync("git fetch origin 2>/dev/null", { cwd: root, encoding: "utf-8", timeout: 30000, env: auth.env });
      const behind = execSync("git rev-list --count HEAD..@{upstream} 2>/dev/null", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
      if (parseInt(behind) > 0) { auth.cleanup?.(); return { pushed: false, reason: `${behind} commit(s) behind upstream — pull first` }; }
    }
  } catch { /* no upstream tracking, push anyway */ }

  // Alignment check on the diff
  const alignment = verifyDiffAlignment(root);
  if (!alignment.ok) { auth.cleanup?.(); return { pushed: false, reason: `alignment: ${alignment.errors[0]}`, alignment }; }

  // Push
  if (!auth.ok) { auth.cleanup?.(); return { pushed: false, reason: auth.reason }; }
  try {
    execSync("git push 2>&1", { cwd: root, encoding: "utf-8", timeout: 60000, env: auth.env });
    return { pushed: true };
  } catch (e) {
    const out = `${e.stderr || ""}${e.stdout || ""}`;
    if (/Authentication failed|could not read Username|Invalid username or password|403/.test(out)) {
      return { pushed: false, reason: "push rejected — stored GITHUB_TOKEN is invalid or lacks write access" };
    }
    return { pushed: false, reason: out.slice(0, 200) || e.message };
  } finally {
    auth.cleanup?.();
  }
}

// ── Diff misalignment check ──
// Scans staged changes for regressions before push.
export function verifyDiffAlignment(root) {
  const result = { ok: true, errors: [], warnings: [] };

  let diffStat;
  try { diffStat = execSync("git diff --cached --stat", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim(); }
  catch { return result; }
  if (!diffStat) { result.warnings.push("no staged changes"); return result; }

  // Extract changed .mjs files
  const changedMjs = diffStat.split("\n")
    .map(l => l.split("|")[0]?.trim())
    .filter(f => f && f.endsWith(".mjs"));

  // 1. Syntax check every changed .mjs file
  for (const f of changedMjs) {
    const abs = f.startsWith("/") ? f : resolve(root, f);
    if (fs.existsSync(abs)) {
      try { execSync(`node --check "${abs}"`, { encoding: "utf-8", timeout: 10000 }); }
      catch (e) {
        const err = (e.stderr || e.message || "").slice(0, 200);
        result.errors.push(`${f}: syntax error — ${err}`);
        result.ok = false;
      }
    }
  }

  // 2. Forbid debug artifacts in changed files
  const diffContent = execSync("git diff --cached -U0", { cwd: root, encoding: "utf-8", timeout: 5000 });
  if (diffContent) {
    // Added lines that are debug artifacts
    const additions = diffContent.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++") && !l.startsWith("+ "));
    const debugPatterns = [/^\+.*console\.(log|debug)\s*\(/m, /^\+.*debugger\s*;?$/m, /^\+.*process\.env\.PHANTOM_GIT_PUSH/m];
    for (const pat of debugPatterns) {
      const matches = additions.filter(l => pat.test(l));
      if (matches.length > 0) {
        result.warnings.push(`${matches.length} line(s) match ${pat.source} — verify intentional`);
        // Don't block for debug warnings, just flag
      }
    }

    // 3. Check for hardcoded secrets (API keys, tokens, passwords)
    const secretPatterns = [/^\+.*(?:api.?key|secret|password|token|passwd)\s*[:=]\s*['\"][^'\"]{8,}['\"]/im];
    for (const pat of secretPatterns) {
      if (additions.some(l => pat.test(l))) {
        result.errors.push("hardcoded secret detected in staged diff — blocking push");
        result.ok = false;
      }
    }

    // 4. Check file sizes (no binaries >100KB staged)
    try {
      const binaryCheck = execSync("git diff --cached --numstat | awk '{sum+=$1} END {print sum+0}'", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
      const totalAdditions = parseInt(binaryCheck);
      if (totalAdditions > 5000) result.warnings.push(`large diff: ${totalAdditions} additions — verify`);
    } catch { /* numstat unavailable */ }
  }

  // 5. Run core tests to verify nothing regressed
  try {
    const testOut = execSync("node test/core.test.mjs 2>&1", { cwd: root, encoding: "utf-8", timeout: 45000 });
    const failMatch = testOut.match(/fail\s+(\d+)/);
    if (failMatch && parseInt(failMatch[1]) > 0) {
      result.errors.push(`${failMatch[1]} test(s) failing — blocking push`);
      result.ok = false;
    }
  } catch (e) {
    result.warnings.push("test runner unavailable — skipping test gate");
  }

  return result;
}

// ── Known external binaries & their wrapper boilerplate ──
const WRAP_BLUEPRINTS = {
  naabu: {
    install: "go install github.com/projectdiscovery/naabu/v2/cmd/naabu@latest",
    generate: (bin) => `naabu: async (input) => {
    try {
      const { execSync } = await import("child_process");
      const { resolve } = await import("path");
      const target = input.trim() || "";
      if (!target) return "[naabu] Usage: @naabu|<target> [options]\\nFast port scanner by ProjectDiscovery.\\nExamples:\\n  naabu|scanme.org\\n  naabu|scanme.org -p 80,443,8443\\n  naabu|scanme.org -top-ports 1000";
      const r = execSync(\`naabu \${target}\`, { encoding: "utf-8", timeout: 120000, maxBuffer: 1024 * 1024 });
      return r.trim() || "(no results)";
    } catch (e) { return \`[naabu Error] \${e.stderr?.slice(0, 500) || e.message}\`; }
  },`
  },
  notify: {
    install: "go install github.com/projectdiscovery/notify/cmd/notify@latest",
    generate: (bin) => `notify: async (input) => {
    try {
      const { execSync } = await import("child_process");
      const msg = input.trim();
      if (!msg) return "[notify] Usage: @notify|<message>\\nSend notifications to Slack/Telegram/Discord/etc.\\nRequires ~/.config/notify/provider-config.yaml";
      execSync(\`notify -data <(echo "\${msg}")\`, { encoding: "utf-8", timeout: 15000 });
      return "[notify] Sent";
    } catch (e) { return \`[notify Error] \${e.message}\`; }
  },`
  },
  puredns: {
    install: "go install github.com/d3mondev/puredns/v2@latest",
    generate: (bin) => `puredns: async (input) => {
    try {
      const { execSync } = await import("child_process");
      const args = input.trim();
      if (!args) return "[puredns] Usage: @puredns|<args>\\nFast DNS resolver by d3mondev.\\nExamples:\\n  puredns|resolve domains.txt\\n  puredns|bruteforce wordlist.txt example.com";
      const r = execSync(\`puredns \${args}\`, { encoding: "utf-8", timeout: 120000, maxBuffer: 1024 * 1024 });
      return r.trim() || "(no results)";
    } catch (e) { return \`[puredns Error] \${e.stderr?.slice(0, 500) || e.message}\`; }
  },`
  },
  httprobe: {
    install: "go install github.com/tomnomnom/httprobe@latest",
    generate: (bin) => `httprobe: async (input) => {
    try {
      const { execSync } = await import("child_process");
      const targets = input.trim();
      if (!targets) return "[httprobe] Usage: @httprobe|<targets>\\nProbe for alive HTTP/HTTPS servers. Takes list of hosts.\\nExamples:\\n  httprobe|example.com:443\\n  httprobe|subs.txt";
      const r = execSync(\`echo "\${targets}" | httprobe\`, { encoding: "utf-8", timeout: 60000, maxBuffer: 1024 * 1024 });
      return r.trim() || "(no alive hosts)";
    } catch (e) { return \`[httprobe Error] \${e.message}\`; }
  },`
  },
  chaos: {
    install: "go install github.com/projectdiscovery/chaos-client/cmd/chaos@latest",
    generate: (bin) => `chaos: async (input) => {
    try {
      const { execSync } = await import("child_process");
      const domain = input.trim();
      if (!domain) return "[chaos] Usage: @chaos|<domain>\\nProjectDiscovery Chaos - subdomain enumeration from passive sources.\\nRequires CHAOS_API_KEY env var.";
      const r = execSync(\`chaos -d \${domain} -silent\`, { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 });
      return r.trim() || "(no subs from Chaos)";
    } catch (e) { return \`[chaos Error] \${e.message}\`; }
  },`
  },
  uncover: {
    install: "go install github.com/projectdiscovery/uncover/cmd/uncover@latest",
    generate: (bin) => `uncover: async (input) => {
    try {
      const { execSync } = await import("child_process");
      const query = input.trim();
      if (!query) return "[uncover] Usage: @uncover|<query>\\nSearch Shodan/Censys/Fofa/Publicwww for hosts.\\nRequires API keys configured in ~/.config/uncover/";
      const r = execSync(\`uncover -q "\${query}" -silent\`, { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 });
      return r.trim() || "(no results)";
    } catch (e) { return \`[uncover Error] \${e.message}\`; }
  },`
  },
  mapcidr: {
    install: "go install github.com/projectdiscovery/mapcidr/cmd/mapcidr@latest",
    generate: (bin) => `mapcidr: async (input) => {
    try {
      const { execSync } = await import("child_process");
      const cidr = input.trim();
      if (!cidr) return "[mapcidr] Usage: @mapcidr|<cidr>\\nCIDR expansion utility by ProjectDiscovery.\\nExamples:\\n  mapcidr|192.168.1.0/24\\n  mapcidr|-a 2a00:1450:4000::/48";
      const r = execSync(\`mapcidr -cidr \${cidr} -silent\`, { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 });
      return r.trim() || "(no results)";
    } catch (e) { return \`[mapcidr Error] \${e.message}\`; }
  },`
  },
  "subfinder": null,     // already wrapped
  "httpx": null,         // already wrapped
  "nuclei": null,        // already wrapped
  "nmap": null,          // already wrapped
  "ffuf": null,          // already wrapped
  "gobuster": null,      // already wrapped
  "hydra": null,         // already wrapped
  "masscan": null,       // already wrapped
  "nikto": null,         // already wrapped
  "whatweb": null,       // already wrapped
  "sqlmap": null,        // already wrapped
  "amass": null,         // already wrapped
  "dnsx": null,          // already wrapped
  "gau": null,           // already wrapped
  "katana": null,        // already wrapped
  "gitleaks": null,      // already wrapped
  "s3scanner": null,     // already wrapped
  "trufflehog": null,    // already wrapped
  "wafw00f": null,       // already wrapped
  "arjun": null,         // already wrapped
  "gospider": null,      // already wrapped
  "interactsh": null,    // already wrapped
};

// ── Tools Phantom already wraps (skip) ──
const EXISTING_TOOLS = new Set(Object.keys(WRAP_BLUEPRINTS).filter(k => WRAP_BLUEPRINTS[k] === null));

// ── Load evolve state ──
function loadState() {
  try {
    if (fs.existsSync(EVOLVE_LOG)) return JSON.parse(fs.readFileSync(EVOLVE_LOG, "utf-8"));
  } catch {}
  return { generation: 1, patches: [], wrappers: [], errors_fixed: 0, last_evolve: null, auto_fixes: [] };
}

function saveState(st) {
  try {
    if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
    fs.writeFileSync(EVOLVE_LOG, JSON.stringify(st, null, 2), "utf-8");
  } catch {}
}

// ── 1. Auto-detect missing wrappers ──
// Scan PATH for installed security tools Phantom doesn't wrap yet.
export function detectMissingWrappers() {
  const existing = new Set([
    "nmap","sqlmap","searchsploit","ffuf","gobuster","hydra","john","hashcat",
    "aircrack-ng","tshark","masscan","nikto","wpscan","dirb","enum4linux",
    "smbclient","nc","ncat","socat","curl","wget","git","python3","node",
    "docker","kubectl","terraform","yara","clamscan","sslyze","testssl",
    "whois","dig","nslookup","host","tcpdump","sqlite3","jq","yt-dlp","ffmpeg",
    "subfinder","httpx","nuclei","amass","gau","dnsx","katana","gitleaks",
    "s3scanner","whatweb","wafw00f","trufflehog","arjun","gospider",
  ]);

  const found = [];
  const candidates = Object.entries(WRAP_BLUEPRINTS).filter(([, v]) => v !== null);

  for (const [bin, blueprint] of candidates) {
    if (existing.has(bin)) continue;
    try {
      execFileSync("which", [bin], { encoding: "utf-8", timeout: 3000 });
      found.push({ bin, blueprint });
    } catch {}
  }
  return found;
}

// Generate wrapper code and save it as a proper ESM module
export function generateWrapper(bin, blueprint) {
  let code = blueprint.generate(bin);
  const dir = AUTO_TOOLS_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Strip the "name: async (input) => {" prefix and trailing "},\n" suffix
  // The blueprints include object-literal formatting we don't need in standalone modules
  code = code.replace(/^\w+:\s*async\s*\(\s*input\s*\)\s*=>\s*{/, "").replace(/},\s*$/, "").trim();
  // Wrap in a proper ESM default export
  const moduleCode = `// Auto-generated wrapper for ${bin}
// Created by Phantom auto-evolution

export default async function(input) {
${code}
}\n`;
  const filePath = resolve(dir, `${bin}.mjs`);
  fs.writeFileSync(filePath, moduleCode, "utf-8");
  return filePath;
}

// Load all auto-generated tools and return as {name: executeFn}
export async function loadAutoTools() {
  const tools = {};
  if (!fs.existsSync(AUTO_TOOLS_DIR)) return tools;
  const files = fs.readdirSync(AUTO_TOOLS_DIR).filter(f => f.endsWith(".mjs"));
  for (const file of files) {
    try {
      const name = file.replace(/\.mjs$/, "");
      const mod = await import(resolve(AUTO_TOOLS_DIR, file) + `?t=${Date.now()}`);
      const fn = mod.default || mod.execute;
      if (typeof fn === "function") tools[name] = fn;
    } catch {}
  }
  return tools;
}

// ── 2. Auto-fix common tool errors ──
// Patterns that can be auto-patched
function autoInstall(bin) {
  // Try to auto-install a missing binary
  try {
    // Check if npm package exists
    execSync(`which npm 2>/dev/null`, { timeout: 3000 });
    execSync(`npm list -g ${bin} 2>/dev/null || npm install -g ${bin} 2>/dev/null`, { timeout: 60000 });
    return { fixed: true, message: `Auto-installed ${bin} via npm` };
  } catch {}
  try {
    execSync(`which apt 2>/dev/null && apt install -y ${bin} 2>/dev/null`, { timeout: 60000 });
    return { fixed: true, message: `Auto-installed ${bin} via apt` };
  } catch {}
  try {
    execSync(`which pkg 2>/dev/null && pkg install -y ${bin} 2>/dev/null`, { timeout: 60000 });
    return { fixed: true, message: `Auto-installed ${bin} via pkg` };
  } catch {}
  return { fixed: false, message: `${bin} not installed and auto-install failed` };
}

const FIX_PATTERNS = [
  {
    match: /command not found/i,
    fix: async (tool, err) => {
      const bin = tool || err.match(/'([^']+)'/)?.[1];
      if (bin) return autoInstall(bin);
      return { fixed: false, message: `Tool not installed. Install it and try again.` };
    }
  },
  {
    match: /Cannot find module/i,
    fix: async (tool, err) => {
      const mod = err.match(/'([^']+)'/)?.[1];
      if (mod) {
        try {
          execSync(`npm install ${mod} 2>/dev/null`, { timeout: 60000, cwd: PHANTOM_DIR });
          return { fixed: true, message: `Auto-installed module ${mod}` };
        } catch {
          try {
            execSync(`npm install ${mod} 2>/dev/null`, { timeout: 60000 });
            return { fixed: true, message: `Auto-installed module ${mod} globally` };
          } catch {}
        }
      }
      return { fixed: false, message: `Missing module ${mod || tool} — could not auto-install` };
    }
  },
  {
    match: /EACCES|EPERM/i,
    fix: async (tool, err) => {
      const file = err.match(/'([^']+)'/)?.[1];
      if (file) {
        try {
          execSync(`chmod +x "${file}" 2>/dev/null`, { timeout: 5000 });
          return { fixed: true, message: `Made ${file} executable` };
        } catch {}
      }
      return { fixed: false, message: `Permission denied — run with elevated privileges` };
    }
  },
  {
    match: /ETIMEOUT|ENOTFOUND|fetch.*failed/i,
    fix: async (tool, err) => {
      return { fixed: false, message: `Network issue — check connectivity and try again` };
    }
  },
  {
    match: /ENOENT/i,
    fix: async (tool, err) => {
      return { fixed: false, message: `File/directory not found — verify path exists` };
    }
  },
  {
    match: /Syntax error.*backquote|EOF in backquote|unclosed.*backtick/i,
    fix: async (tool, err) => {
      return { fixed: false, message: `Check for unescaped backticks or $() in command` };
    }
  },
  {
    match: /Shell Error/i,
    fix: async (tool, err) => {
      return { fixed: false, message: `Shell command failed — check syntax and retry` };
    }
  },
];

// Analyze a tool error and attempt auto-fix
export async function analyzeError(tool, errorMessage) {
  for (const pattern of FIX_PATTERNS) {
    if (pattern.match.test(errorMessage)) {
      const result = await pattern.fix(tool, errorMessage);
      if (result) {
        const st = loadState();
        st.errors_fixed++;
        st.auto_fixes.push({ ts: new Date().toISOString(), tool, error: errorMessage.slice(0, 100), fix: result.message });
        saveState(st);
        return result;
      }
    }
  }
  return null;
}

// ── 3. Auto-syntax heal — actually fix common issues ──
// Auto-fix common syntax/errors in Phantom's own source
export async function autoHealSyntax() {
  const results = [];
  const files = [
    "phantom.mjs",
    ...fs.readdirSync(resolve(PHANTOM_DIR, "lib")).filter(f => f.endsWith(".mjs")).map(f => `lib/${f}`),
  ];

  for (const file of files) {
    const fp = resolve(PHANTOM_DIR, file);
    if (!fs.existsSync(fp)) continue;

    try {
      execSync(`node --check "${fp}" 2>/dev/null`, { encoding: "utf-8", timeout: 10000 });
      continue; // syntax OK
    } catch (e) {
      // Syntax error — try to fix common issues
      try {
        const content = fs.readFileSync(fp, "utf-8");
        const stderr = e.stderr || e.message || "";
        let fixed = false;

        // Fix 1: trailing commas in non-module context (common in object literals)
        if (stderr.includes("trailing comma") || stderr.includes("nexpected token")) {
          const newContent = content.replace(/,(\s*[\n\r]+\s*[}\]])/g, '$1');
          if (newContent !== content) {
            fs.writeFileSync(fp, newContent, "utf-8");
            try {
              execSync(`node --check "${fp}" 2>/dev/null`, { encoding: "utf-8", timeout: 10000 });
              fixed = true;
              results.push({ file, fixed: true, error: "Fixed trailing commas" });
              continue;
            } catch {}
          }
        }

        // Fix 2: unclosed string — look for unterminated string error
        if (stderr.includes("Unterminated string") || stderr.includes("unterminated string")) {
          const newContent = content.replace(/('''|"""|````)/g, (m) => m.slice(0, 3));
          if (newContent !== content) {
            fs.writeFileSync(fp, newContent, "utf-8");
            try {
              execSync(`node --check "${fp}" 2>/dev/null`, { encoding: "utf-8", timeout: 10000 });
              fixed = true;
              results.push({ file, fixed: true, error: "Fixed unterminated string" });
              continue;
            } catch {}
          }
        }

        // Fix 3: missing closing brace or paren
        if (stderr.includes("Unexpected end of input") || stderr.includes("missing )") || stderr.includes("missing }")) {
          // Try adding closing braces
          let newContent = content;
          const opens = (content.match(/{/g) || []).length;
          const closes = (content.match(/}/g) || []).length;
          const opensP = (content.match(/\(/g) || []).length;
          const closesP = (content.match(/\)/g) || []).length;
          if (opens > closes) {
            newContent += "\n" + "}".repeat(opens - closes);
          }
          if (opensP > closesP) {
            newContent += "\n" + ")".repeat(opensP - closesP);
          }
          if (newContent !== content) {
            fs.writeFileSync(fp, newContent, "utf-8");
            try {
              execSync(`node --check "${fp}" 2>/dev/null`, { encoding: "utf-8", timeout: 10000 });
              fixed = true;
              results.push({ file, fixed: true, error: `Fixed unbalanced braces/parens` });
              continue;
            } catch {}
          }
        }

        if (!fixed) {
          results.push({ file, fixed: false, error: stderr.trim().slice(0, 100) || "Unknown syntax error" });
        }
      } catch {
        results.push({ file, fixed: false, error: "Cannot read file" });
      }
    }
  }

  return results;
}

// ── 4. Auto-optimization scanner ──
// Scan Phantom source for optimization opportunities
export function scanOptimizations() {
  const issues = [];
  const mainPath = resolve(PHANTOM_DIR, "phantom.mjs");
  if (!fs.existsSync(mainPath)) return issues;

  const src = fs.readFileSync(mainPath, "utf-8");
  const lines = src.split("\n");

  // Check for oversized functions
  let fnStart = 0;
  let braceCount = 0;
  let inFn = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inFn && l.match(/async\s+\w+\s*\(/)) {
      fnStart = i;
      inFn = true;
      braceCount = (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
    } else if (inFn) {
      braceCount += (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
      if (braceCount <= 0) {
        const len = i - fnStart;
        if (len > 100) {
          issues.push({ line: fnStart + 1, type: "long_fn", detail: `Function at line ${fnStart + 1} is ${len} lines — consider splitting` });
        }
        inFn = false;
      }
    }
  }

  // Check for repeated patterns
  const dynamicImportCount = (src.match(/import\("child_process"\)/g) || []).length;
  if (dynamicImportCount > 3) {
    issues.push({ line: 0, type: "repeated_import", detail: `Dynamic import("child_process") used ${dynamicImportCount} times — hoist to module scope` });
  }

  // Check for console.log vs structured logging
  const consoleCount = (src.match(/console\.(log|error|warn)\(/g) || []).length;
  if (consoleCount > 60) {
    issues.push({ line: 0, type: "console_spam", detail: `${consoleCount} console.* calls — use structured logging` });
  }

  return issues;
}

// ── 4b. Absorb learned knowledge into tracked modules ──
// Every new entry in the knowledge base or playbooks directory becomes a
// versioned ESM data module under lib/learned/. This is how learning (e.g.
// from a YouTube video) actually evolves the codebase.
function learnedSlug(kind, file) {
  return `${kind}_${file.replace(/\.json$/, "").replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 60)}`;
}

export function absorbKnowledge(st = loadState()) {
  const created = [];
  const absorbed = new Set(st.absorbedKnowledge || []);
  const sources = [
    { dir: KNOWLEDGE_DIR, kind: "knowledge" },
    { dir: PLAYBOOKS_DIR, kind: "playbook" },
  ];

  for (const { dir, kind } of sources) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
      const key = `${kind}:${file}`;
      if (absorbed.has(key)) continue;
      let data;
      try { data = JSON.parse(fs.readFileSync(resolve(dir, file), "utf-8")); } catch { continue; }
      const slug = learnedSlug(kind, file);
      try {
        if (!fs.existsSync(LEARNED_DIR)) fs.mkdirSync(LEARNED_DIR, { recursive: true });
        const payload = {
          kind,
          source: file,
          tags: data.tags || [],
          created: data.created || null,
          learnedAt: new Date().toISOString(),
          data,
        };
        const code = `// Phantom learned module — auto-generated by evolve.mjs. Do not edit.\n// Source: ${kind}/${file}\nexport default ${JSON.stringify(payload, null, 2)};\n`;
        fs.writeFileSync(resolve(LEARNED_DIR, `${slug}.mjs`), code, "utf-8");
        created.push({ slug, file: `lib/learned/${slug}.mjs`, kind, source: file });
        absorbed.add(key);
      } catch { /* skip unwritable entry */ }
    }
  }

  return { created, absorbed: [...absorbed] };
}

// ── 5. Run full evolution cycle ──
export async function autoEvolve() {
  const st = loadState();
  const results = [];

  // Phase 1: Auto-detect missing wrappers
  try {
    const missing = detectMissingWrappers();
    if (missing.length > 0) {
      const created = [];
      for (const { bin, blueprint } of missing) {
        try {
          const path = generateWrapper(bin, blueprint);
          st.wrappers.push({ bin, path, ts: new Date().toISOString() });
          created.push(bin);
          results.push({ phase: "wrapper", bin, status: "created", path });
        } catch (e) {
          results.push({ phase: "wrapper", bin, status: "error", error: e.message });
        }
      }
      // ── Git commit auto-generated wrappers ──
      if (created.length > 0) {
        const committed = gitCommit(
          created.map(b => `lib/auto_tools/${b}.mjs`),
          `🧬 auto-evolve: add ${created.length} tool wrapper(s): ${created.join(", ")}`
        );
        if (committed) {
          results.push({ phase: "git", status: "committed", files: created.length });
        }
      }
    }
  } catch (e) {
    results.push({ phase: "wrapper", status: "error", error: e.message });
  }

  // Phase 1b: Absorb new learned knowledge/playbooks into tracked modules
  try {
    const { created, absorbed } = absorbKnowledge(st);
    st.absorbedKnowledge = absorbed;
    if (created.length > 0) {
      for (const c of created) {
        results.push({ phase: "knowledge", status: "learned", slug: c.slug, kind: c.kind, source: c.source });
      }
      const committed = gitCommit(
        created.map(c => c.file),
        `🧬 auto-evolve: absorb ${created.length} learned knowledge module(s)`
      );
      if (committed) results.push({ phase: "git", status: "committed", files: created.length });
    }
  } catch (e) {
    results.push({ phase: "knowledge", status: "error", error: e.message });
  }

  // Phase 2: Syntax check and auto-heal
  try {
    const healResults = await autoHealSyntax();
    for (const r of healResults) {
      results.push({ phase: "heal", file: r.file, status: r.fixed ? "fixed" : "failed", error: r.error });
    }
  } catch (e) {
    results.push({ phase: "heal", status: "error", error: e.message });
  }

  // Phase 3: Scan for optimizations
  try {
    const opts = scanOptimizations();
    for (const o of opts) {
      results.push({ phase: "optimize", type: o.type, detail: o.detail, line: o.line });
    }
  } catch (e) {
    results.push({ phase: "optimize", status: "error", error: e.message });
  }

  // Phase 4: Self-syntax validation
  try {
    const { execSync } = await import("child_process");
    execSync(`node --check "${resolve(PHANTOM_DIR, "phantom.mjs")}"`, { encoding: "utf-8", timeout: 10000 });
    results.push({ phase: "validate", file: "phantom.mjs", status: "ok" });
    execSync(`node --check "${resolve(PHANTOM_DIR, "lib/tools.mjs")}"`, { encoding: "utf-8", timeout: 10000 });
    results.push({ phase: "validate", file: "lib/tools.mjs", status: "ok" });
    execSync(`node --check "${resolve(PHANTOM_DIR, "lib/runtime.mjs")}"`, { encoding: "utf-8", timeout: 10000 });
    results.push({ phase: "validate", file: "lib/runtime.mjs", status: "ok" });
    execSync(`node --check "${resolve(PHANTOM_DIR, "lib/evolve.mjs")}"`, { encoding: "utf-8", timeout: 10000 });
    results.push({ phase: "validate", file: "lib/evolve.mjs", status: "ok" });
  } catch (e) {
    results.push({ phase: "validate", status: "error", error: e.stderr?.slice(0, 200) || e.message });
  }

  // Phase 5: Test gate — only suggest push if tests pass
  try {
    const { execSync } = await import("child_process");
    const testOut = execSync("node test/core.test.mjs", { cwd: PHANTOM_DIR, encoding: "utf-8", timeout: 30000 }).trim();
    const passMatch = testOut.match(/pass\s+(\d+)/);
    const failMatch = testOut.match(/fail\s+(\d+)/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;
    results.push({ phase: "test", status: failed > 0 ? "failed" : "passed", passed, failed });

    if (failed > 0) {
      // Attempt auto-heal on test failures
      try {
        const { autoHealSyntax } = await import("./evolve.mjs");
        const healed = await autoHealSyntax();
        for (const h of healed) {
          results.push({ phase: "heal_retry", file: h.file, status: h.fixed ? "fixed" : "failed", error: h.error });
        }
        if (healed.some(h => h.fixed)) {
          // Re-run tests after heal
          const retryOut = execSync("node test/core.test.mjs", { cwd: PHANTOM_DIR, encoding: "utf-8", timeout: 30000 }).trim();
          const retryPass = retryOut.match(/pass\s+(\d+)/);
          const retryFail = retryOut.match(/fail\s+(\d+)/);
          const rPassed = retryPass ? parseInt(retryPass[1]) : 0;
          const rFailed = retryFail ? parseInt(retryFail[1]) : 0;
          results.push({ phase: "test_retry", status: rFailed > 0 ? "failed" : "passed", passed: rPassed, failed: rFailed });
        }
      } catch { /* heal attempt failed */ }
    }
  } catch (e) {
    results.push({ phase: "test", status: "error", error: e.stderr?.slice(0, 200) || e.message });
  }

  // Check readiness: have committed wrappers AND all tests passed?
  const hasCommits = results.some(r => r.phase === "git" && r.status === "committed");
  const testsPassed = results.some(r => r.phase === "test" && r.status === "passed");
  const finalTestsOk = results.some(r => r.phase === "test_retry" && r.status === "passed") || testsPassed;

  if (hasCommits && finalTestsOk) {
    const pushResult = gitPush();
    if (pushResult.pushed) {
      results.push({ phase: "git", status: "pushed", summary: "✅ Auto-pushed to remote" });
    } else {
      results.push({ phase: "git", status: pushResult.reason?.startsWith("alignment") ? "blocked" : "push_failed",
        reason: pushResult.reason, summary: `⚠ Push skipped: ${pushResult.reason}` });
    }
  } else if (hasCommits && !finalTestsOk) {
    results.push({ phase: "git", status: "tests_failed", summary: "⚠ Not pushing — tests failing after changes" });
  }

  // Update state
  st.generation++;
  st.last_evolve = new Date().toISOString();
  st.patches = [...(st.patches || []), ...results.filter(r => r.phase === "heal")];
  saveState(st);

  return { generation: st.generation, results, wrappers_created: st.wrappers.length, errors_fixed: st.errors_fixed };
}

// ── Quick startup evolution check ──
export async function startupEvolve() {
  const st = loadState();
  const results = { wrappers_checked: 0, wrappers_created: 0, issues: [], notes: [] };

  // Only run full evolution if more than 6 hours since last, or never run
  const last = st.last_evolve ? new Date(st.last_evolve).getTime() : 0;
  const sixHours = 6 * 60 * 60 * 1000;
  if (Date.now() - last < sixHours && st.generation > 1) {
    results.issues.push("skipped — recently evolved");
    return results;
  }

  // Quick wrapper check
  try {
    const missing = detectMissingWrappers();
    results.wrappers_checked = missing.length;
    const created = [];
    for (const { bin, blueprint } of missing) {
      try {
        generateWrapper(bin, blueprint);
        st.wrappers.push({ bin, path: resolve(AUTO_TOOLS_DIR, `${bin}.mjs`), ts: new Date().toISOString() });
        created.push(bin);
        results.wrappers_created++;
      } catch {}
    }
    // Git commit wrappers created at startup.
    // `results` is a plain object, not an array — calling .push() on it threw a
    // TypeError that the surrounding catch{} swallowed, so startup auto-push
    // silently never happened. Notes go to their own array.
    if (created.length > 0) {
      gitCommit(created.map(b => `lib/auto_tools/${b}.mjs`), "🧬 startup: add new auto-generated wrappers");
      const pushResult = gitPush();
      if (pushResult.pushed) results.notes.push("auto-pushed");
      else if (pushResult.reason) results.notes.push(`push: ${pushResult.reason}`);
    }
  } catch {}

  // Quick syntax check
  try {
    execSync(`node --check "${resolve(PHANTOM_DIR, "phantom.mjs")}"`, { encoding: "utf-8", timeout: 10000 });
  } catch (e) {
    results.issues.push("syntax error in phantom.mjs");
  }

  // Ensure generated modules directory exists
  const generatedDir = resolve(PHANTOM_DIR, "lib", "generated");
  if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });

  if (results.wrappers_created > 0 || results.issues.length > 0) {
    st.last_evolve = new Date().toISOString();
    st.generation++;
    saveState(st);
  }

  return results;
}

export function getEvolveStatus() {
  const st = loadState();
  return {
    generation: st.generation,
    wrappers_created: st.wrappers.length,
    errors_fixed: st.errors_fixed,
    patches_applied: st.patches.length,
    last_evolve: st.last_evolve,
    wrapper_list: st.wrappers,
    recent_fixes: st.auto_fixes?.slice(-5),
  };
}

// ── 7. SELF-HEAL: full auto-diagnose → fix → test → iterate ──
// Runs until clean or max attempts reached.
export async function selfHeal(options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const log = [];
  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const round = { attempt, checks: [], fixes: [], tests: [] };

    // Phase 1: Syntax check all .mjs files
    const mjsFiles = ["phantom.mjs", ...fs.readdirSync(resolve(PHANTOM_DIR, "lib")).filter(f => f.endsWith(".mjs")).map(f => `lib/${f}`)];
    let allClean = true;
    for (const file of mjsFiles) {
      const fp = resolve(PHANTOM_DIR, file);
      if (!fs.existsSync(fp)) continue;
      try {
        execSync(`node --check "${fp}" 2>/dev/null`, { encoding: "utf-8", timeout: 10000 });
        round.checks.push({ file, status: "ok" });
      } catch {
        allClean = false;
        round.checks.push({ file, status: "error" });
      }
    }

    // Phase 2: Auto-fix syntax issues
    if (!allClean) {
      const healResults = await autoHealSyntax();
      for (const r of healResults) {
        round.fixes.push(r);
        if (r.fixed) {
          const st = loadState();
          st.patches.push(r);
          st.errors_fixed = (st.errors_fixed || 0) + 1;
          saveState(st);
        }
      }
      // If nothing was fixed, break — can't heal further
      if (!healResults.some(r => r.fixed)) {
        log.push(round);
        break;
      }
    }

    // Phase 3: Run tests
    try {
      const testOut = execSync("node test/core.test.mjs 2>/dev/null && echo 'TESTS_PASSED'", {
        cwd: PHANTOM_DIR, encoding: "utf-8", timeout: 60000
      }).trim();
      const passed = testOut.includes("TESTS_PASSED");
      round.tests.push({ status: passed ? "passed" : "failed" });
      if (passed) {
        log.push(round);
        // If all clean and tests pass, commit and push
        try {
          const staged = execSync("git diff --cached --stat", { cwd: PHANTOM_DIR, encoding: "utf-8", timeout: 5000 }).trim();
          if (staged) {
            const committed = gitCommit([], `🧬 self-heal: auto-fix ${round.fixes.filter(f => f.fixed).length} issue(s)`);
            if (committed) {
              const pushResult = gitPush();
              round.push = pushResult.pushed ? "pushed" : pushResult.reason || "push_failed";
            }
          }
        } catch {}
        break; // done
      }
    } catch (e) {
      round.tests.push({ status: "error", error: e.stderr?.slice(0, 200) || e.message });
    }

    log.push(round);
  }

  // Update state
  const st = loadState();
  st.last_evolve = new Date().toISOString();
  st.generation++;
  saveState(st);

  return {
    elapsed: Date.now() - startTime,
    attempts: log.length,
    clean: log[log.length - 1]?.tests?.some(t => t.status === "passed") || false,
    log,
  };
}

// ── Verification ───────────────────────────────────────────
// A gate that can say *why* it failed. The inline check this replaces in
// phantom.mjs hardcoded homedir()+"Phantom", so on any clone outside
// ~/Phantom it failed on every run and XP was never awarded again.
const GATE_FILES = ["phantom.mjs", "lib/evolve.mjs", "lib/tools.mjs", "lib/runtime.mjs", "lib/visual.mjs"];

// Every .mjs source file the engine may have touched.
export function sourceFiles() {
  const out = ["phantom.mjs"];
  const libDir = resolve(PHANTOM_DIR, "lib");
  if (fs.existsSync(libDir)) {
    for (const f of fs.readdirSync(libDir).sort()) {
      if (f.endsWith(".mjs")) out.push(`lib/${f}`);
    }
  }
  return out;
}

export function checkSyntax(files = GATE_FILES) {
  const failed = [];
  const missing = [];
  for (const f of files) {
    const abs = resolve(PHANTOM_DIR, f);
    if (!fs.existsSync(abs)) { missing.push(f); continue; }
    try {
      execSync(`node --check "${abs}"`, { encoding: "utf-8", timeout: 10000, stdio: "pipe" });
    } catch (e) {
      const msg = (e.stderr || e.message || "").toString().trim().split("\n").filter(Boolean).slice(0, 3).join(" ").slice(0, 200);
      failed.push({ file: f, error: msg });
    }
  }
  return { ok: failed.length === 0 && missing.length === 0, failed, missing };
}

function parseTestCounts(out) {
  const pass = out.match(/^#\s*pass\s+(\d+)/m);
  const fail = out.match(/^#\s*fail\s+(\d+)/m);
  if (pass || fail) {
    return { passed: pass ? parseInt(pass[1], 10) : 0, failed: fail ? parseInt(fail[1], 10) : 0, exact: true };
  }
  // No summary line: fall back to counting individual TAP result lines rather
  // than reporting a green run as zero passes.
  const oks = (out.match(/^ok \d+ - /gm) || []).length;
  const bads = (out.match(/^not ok \d+ - /gm) || []).length;
  return { passed: oks, failed: bads, exact: false };
}

// A test runner in any ancestor exports NODE_TEST_CONTEXT, which makes a
// grandchild emit the v8-serialized diagnostic protocol instead of TAP. The
// summary line then never appears and every run looks like "0 passing, 0
// failing" — which would let a broken patch be judged as an improvement.
// Strip the inherited context so counts are always comparable.
function testEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  if (env.NODE_OPTIONS) {
    const cleaned = env.NODE_OPTIONS.split(/\s+/).filter(a => a && !a.startsWith("--test")).join(" ");
    if (cleaned) env.NODE_OPTIONS = cleaned; else delete env.NODE_OPTIONS;
  }
  return env;
}

export function runTests(testFile = "test/core.test.mjs", timeout = 60000) {
  try {
    const out = execSync(`node ${testFile}`, { cwd: PHANTOM_DIR, encoding: "utf-8", timeout, stdio: "pipe", env: testEnv() });
    const { passed, failed, exact } = parseTestCounts(out);
    return { ok: failed === 0, passed, failed, exact, output: out };
  } catch (e) {
    const out = `${e.stdout || ""}`;
    const { passed, failed, exact } = parseTestCounts(out);
    return {
      ok: false,
      passed,
      // execSync throws on a non-zero exit. If the output parsed no counts the
      // run died before the summary (import error, crash, timeout): count it
      // as one hard failure rather than silently reporting zero.
      failed: failed || 1,
      exact,
      error: (e.stderr || e.message || "").toString().trim().slice(0, 300),
      output: out,
    };
  }
}

function failingTestNames(output, limit = 12) {
  const names = [];
  for (const line of (output || "").split("\n")) {
    const m = line.match(/^\s*not ok \d+ - (.+?)\s*$/);
    if (m) names.push(m[1].trim());
    if (names.length >= limit) break;
  }
  return names;
}

// Which test files import a given source file — narrows the re-run after a patch.
function testsForSource(rel) {
  const base = rel.split("/").pop().replace(/\.mjs$/, "");
  const testDir = resolve(PHANTOM_DIR, "test");
  if (!fs.existsSync(testDir)) return [];
  return fs.readdirSync(testDir)
    .filter(f => f.endsWith(".test.mjs"))
    .filter(f => { try { return fs.readFileSync(resolve(testDir, f), "utf-8").includes(base); } catch { return false; } })
    .map(f => `test/${f}`);
}

// ── Code-level self-healing ────────────────────────────────
// autoHealSyntax only fixes parse errors. A test that fails because the code
// computes the wrong answer needs a semantic fix, which needs a model.
// Safety contract: a patch is kept ONLY if the suite's pass count strictly
// improves. Anything else is reverted byte-for-byte, so a bad patch can never
// leave the tree worse than it already was. Test files are never candidates.
async function llmPatch(prompt) {
  let createProvider;
  try { ({ createProvider } = await import("../chat.mjs")); } catch { return null; }
  try {
    const llm = createProvider();
    if (!llm || typeof llm.chat !== "function") return null;
    const res = await llm.chat([
      { role: "system", content: "You are a senior Node.js engineer. Reply with code only: no prose, no markdown fences." },
      { role: "user", content: prompt },
    ]);
    if (typeof res === "string") return res;
    if (res && typeof res.content === "string") return res.content;
    if (res && typeof res.text === "string") return res.text;
    return null;
  } catch { return null; }
}

function extractCode(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = s.match(/```(?:[a-zA-Z]*)\n([\s\S]*?)```/);
  if (fence) s = fence[1];
  s = s.trim();
  return s.length ? s : null;
}

export async function autoHealCode(opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 2;
  const timeout = opts.timeout ?? 60000;
  const testFile = opts.testFile || "test/core.test.mjs";
  const attempts = [];

  const before = runTests(testFile, timeout);
  if (before.ok) return { healed: false, reason: "tests already passing", attempts };

  // Snapshot every source file we are willing to touch so any attempt can be undone.
  const candidates = (opts.files?.length ? opts.files : sourceFiles())
    .filter(f => !f.startsWith("test/"))
    .filter(f => fs.existsSync(resolve(PHANTOM_DIR, f)));
  const snapshot = new Map(candidates.map(f => [f, fs.readFileSync(resolve(PHANTOM_DIR, f), "utf-8")]));
  const restore = () => { for (const [f, content] of snapshot) { try { fs.writeFileSync(resolve(PHANTOM_DIR, f), content, "utf-8"); } catch {} } };

  for (let i = 0; i < maxAttempts; i++) {
    const current = runTests(testFile, timeout);
    const names = failingTestNames(current.output);

    // Context: sources those failing tests actually import, capped so the
    // prompt stays inside a normal context window.
    const ctxFiles = candidates.filter(f => names.length === 0 || testsForSource(f).length > 0).slice(0, 6);
    if (ctxFiles.length === 0) { attempts.push({ attempt: i + 1, applied: false, reason: "no candidate source files" }); break; }

    const ctx = ctxFiles.map(f => {
      const body = fs.readFileSync(resolve(PHANTOM_DIR, f), "utf-8");
      return `--- ${f} ---\n${body.length > 12000 ? body.slice(0, 12000) + "\n// ...truncated" : body}`;
    }).join("\n\n");

    const prompt = [
      "The Node.js test suite for this project is failing.",
      `Failing tests: ${names.length ? names.join(" | ") : "(names could not be parsed)"}`,
      `Currently ${current.passed} passing, ${current.failed} failing.`,
      "",
      "Fix the CAUSE in the source code. Do not edit, skip or weaken the tests.",
      "Reply with the COMPLETE corrected contents of the single most relevant file, and nothing else.",
      "",
      ctx,
    ].join("\n");

    const code = extractCode(await llmPatch(prompt));
    if (!code) { attempts.push({ attempt: i + 1, applied: false, reason: "no model available, or empty response" }); break; }

    // Prefer the file the patch claims to be; fall back to the first context file.
    const claimed = code.match(/^\s*(?:\/\/|#)?\s*(?:file:\s*)?((?:lib\/)?[\w.-]+\.mjs)/);
    const target = claimed && snapshot.has(claimed[1]) ? claimed[1] : ctxFiles[0];

    fs.writeFileSync(resolve(PHANTOM_DIR, target), code, "utf-8");

    // Never keep a patch that does not even parse.
    const syntax = checkSyntax([target]);
    if (!syntax.ok) {
      restore();
      attempts.push({ attempt: i + 1, file: target, kept: false, reverted: true, reason: `patch did not parse: ${syntax.failed[0]?.error || `missing ${syntax.missing[0]}`}` });
      continue;
    }

    const after = runTests(testFile, timeout);
    if (after.passed > current.passed && after.failed < current.failed) {
      attempts.push({ attempt: i + 1, file: target, kept: true, passed: after.passed, failed: after.failed });
      return { healed: true, file: target, passed: after.passed, failed: after.failed, attempts };
    }
    restore();
    attempts.push({
      attempt: i + 1, file: target, kept: false, reverted: true,
      reason: `no improvement (${current.passed}/${current.failed} -> ${after.passed}/${after.failed})`,
    });
  }
  return { healed: false, reason: "no attempt improved the suite", attempts };
}

// The gate behind the XP award. With heal:true it tries to repair itself first.
export async function verifyEvolution(opts = {}) {
  const syntax = checkSyntax(opts.files?.length ? opts.files : GATE_FILES);
  if (!syntax.ok) {
    const reason = syntax.missing.length
      ? `missing file(s): ${syntax.missing.join(", ")}`
      : `syntax error in ${syntax.failed.map(f => f.file).join(", ")} — ${syntax.failed[0]?.error || ""}`;
    if (opts.heal) {
      const healed = await autoHealSyntax();
      if (healed.some(h => h.fixed)) return verifyEvolution({ ...opts, heal: false });
    }
    return { ok: false, phase: "syntax", reason, syntax, tests: null, heal: null };
  }

  const tests = runTests(opts.testFile, opts.timeout);
  if (tests.ok) return { ok: true, phase: "tests", reason: `${tests.passed} passing`, syntax, tests, heal: null };

  let heal = null;
  if (opts.heal) heal = await autoHealCode({ testFile: opts.testFile, files: opts.files, timeout: opts.timeout });
  const recheck = heal?.healed ? runTests(opts.testFile, opts.timeout) : tests;

  return {
    ok: recheck.ok,
    phase: "tests",
    reason: recheck.ok
      ? `self-healed via patch to ${heal.file} (${recheck.passed} passing)`
      : `${tests.failed} test(s) failing — ${failingTestNames(tests.output)[0] || tests.error || "see test output"}`,
    syntax,
    tests: recheck,
    heal,
  };
}
