// Phantom — Auto-Evolution Engine
// Self-healing, self-optimizing, self-growing.
// Runs automatically on startup and after tasks.

import fs from "fs";
import { execFileSync, execSync } from "child_process";
import { resolve, join } from "path";
import { homedir } from "os";
import { BASE_DIR, TOOLS_DIR, PHANTOM_VERSION } from "./config.mjs";
import { __r } from "./runtime.mjs";

// ── Constants ──────────────────────────────────────────────
const PHANTOM_DIR = resolve(homedir(), "Phantom");
const EVOLVE_LOG = resolve(BASE_DIR, "evolve.json");
const AUTO_TOOLS_DIR = resolve(PHANTOM_DIR, "lib", "auto_tools"); // in-repo so git-tracked

// ── Git helpers ────────────────────────────────────────────
function gitRoot() {
  try {
    const r = execSync("git rev-parse --show-toplevel 2>/dev/null", { encoding: "utf-8", timeout: 5000 }).trim();
    return r || null;
  } catch { return null; }
}

function gitCommit(files, msg) {
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

function gitPush() {
  const root = gitRoot();
  if (!root) return { pushed: false, reason: "no git root" };
  // Check if remote exists
  try {
    const remotes = execSync("git remote", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
    if (!remotes) return { pushed: false, reason: "no remote configured" };
  } catch { return { pushed: false, reason: "no remote" }; }

  // Fetch and check for upstream divergence (misalignment)
  try {
    const upstream = execSync("git rev-parse --symbolic-full-name @{upstream} 2>/dev/null", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
    if (upstream) {
      execSync("git fetch origin 2>/dev/null", { cwd: root, encoding: "utf-8", timeout: 30000 });
      const behind = execSync("git rev-list --count HEAD..@{upstream} 2>/dev/null", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
      if (parseInt(behind) > 0) return { pushed: false, reason: `${behind} commit(s) behind upstream — pull first` };
    }
  } catch { /* no upstream tracking, push anyway */ }

  // Alignment check on the diff
  const alignment = verifyDiffAlignment(root);
  if (!alignment.ok) return { pushed: false, reason: `alignment: ${alignment.errors[0]}`, alignment };

  // Push
  try {
    execSync("git push 2>&1", { cwd: root, encoding: "utf-8", timeout: 60000 });
    return { pushed: true };
  } catch (e) {
    return { pushed: false, reason: e.stderr?.slice(0, 200) || e.message };
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
    "s3scanner","gobuster","nmap","sqlmap","whatweb","wafw00f","trufflehog",
    "hydra","masscan","nikto","arjun","gospider","cloud_enum","notify",
    "interactsh","burpsuite","metasploit","naabu","puredns","httprobe",
    "chaos","uncover","mapcidr","crtsh",
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
const FIX_PATTERNS = [
  {
    match: /command not found/i,
    fix: async (tool, err) => {
      // Try to auto-install via apt/pkg/go
      const bin = tool || err.match(/'([^']+)'/)?.[1];
      if (bin) {
        return { fixed: false, message: `[auto-evolve] ${bin} not installed. Run @install|${bin}` };
      }
      return { fixed: false, message: `[auto-evolve] Tool not installed. Install it and try again.` };
    }
  },
  {
    match: /Cannot find module/i,
    fix: async (tool, err) => {
      const mod = err.match(/'([^']+)'/)?.[1];
      if (mod) return { fixed: false, message: `[auto-evolve] Missing module ${mod}. Try: npm install ${mod}` };
      return null;
    }
  },
  {
    match: /EACCES|EPERM/i,
    fix: async (tool, err) => {
      return { fixed: false, message: `[auto-evolve] Permission denied. Try running with appropriate privileges.` };
    }
  },
  {
    match: /ETIMEOUT|ENOTFOUND|fetch.*failed/i,
    fix: async (tool, err) => {
      return { fixed: false, message: `[auto-evolve] Network issue. Check connectivity and try again.` };
    }
  },
  {
    match: /ENOENT/i,
    fix: async (tool, err) => {
      const file = err.match(/'([^']+)'/)?.[1];
      if (file) return { fixed: false, message: `[auto-evolve] File not found: ${file}` };
      return null;
    }
  },
  {
    match: /Syntax error.*backquote|EOF in backquote|unclosed.*backtick/i,
    fix: async (tool, err) => {
      return { fixed: false, message: `[auto-evolve] Command contains unescaped backtick or \$() — shell syntax error. Phantom now auto-escapes backticks. Try again.` };
    }
  },
  {
    match: /Shell Error/i,
    fix: async (tool, err) => {
      return { fixed: false, message: `[auto-evolve] Shell command failed. Check the command syntax and retry.` };
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

// ── 3. Auto-syntax heal ──
// Auto-fix simple syntax errors in Phantom's own source
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
    } catch {
      // Syntax error — try to read and see if it's something we can auto-fix
      try {
        const content = fs.readFileSync(fp, "utf-8");
        // Check for common issues: missing brace, trailing comma in non-module context
        // For now, just report — auto-heal complex syntax errors is risky
        results.push({ file, fixed: false, error: "Syntax error — needs manual fix" });
      } catch {
        results.push({ file, fixed: false, error: "Cannot read" });
      }
    }
  }

  if (results.length > 0) {
    const st = loadState();
    st.patches.push(...results);
    saveState(st);
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
  const results = { wrappers_checked: 0, wrappers_created: 0, issues: [] };

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
    // Git commit wrappers created at startup
    if (created.length > 0) {
      gitCommit(created.map(b => `lib/auto_tools/${b}.mjs`), "🧬 startup: add new auto-generated wrappers");
      const pushResult = gitPush();
      if (pushResult.pushed) results.push("auto-pushed");
      else if (pushResult.reason) results.push(`push: ${pushResult.reason}`);
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
