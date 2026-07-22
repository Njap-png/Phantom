// Phantom — Self-Improvement Engine
// Reads other projects' source code, analyzes what Phantom lacks,
// and generates code to fill those gaps autonomously.
//
// Capabilities:
// 1. Project Scanner    — Clone/read any git repo, parse file structure
// 2. Feature Extractor  — Discover what features other projects have
// 3. Gap Analyzer       — Compare features against Phantom's own tools
// 4. Pattern Learner    — Extract architectural patterns from other projects
// 5. Code Generator     — Generate new Phantom modules from learned patterns
// 6. Auto-Applier       — Write, validate, test, and commit improvements

import fs from "fs";
import { execFileSync, execSync } from "child_process";
import { resolve, join, dirname, basename, extname, relative } from "path";
import { homedir } from "os";
import { BASE_DIR, TOOLS_DIR, PHANTOM_VERSION } from "./config.mjs";
import { __r } from "./runtime.mjs";

// ── Constants ──────────────────────────────────────────────
const PHANTOM_DIR = resolve(homedir(), "Phantom");
const LEARN_DIR = resolve(BASE_DIR, "learned");
const BLUEPRINTS_DIR = resolve(BASE_DIR, "blueprints");
const EVOLVE_LOG = resolve(BASE_DIR, "evolve.json");
const GENERATED_DIR = resolve(PHANTOM_DIR, "lib", "generated");
const LEARNED_MODULES_DIR = resolve(PHANTOM_DIR, "lib", "learned");

// ── Helpers ────────────────────────────────────────────────

function loadState() {
  const defaults = { generation: 1, self_improve: [], imported_features: [], learned_patterns: [], patches: [], wrappers: [], errors_fixed: 0, last_evolve: null, auto_fixes: [] };
  try {
    if (fs.existsSync(EVOLVE_LOG)) {
      const existing = JSON.parse(fs.readFileSync(EVOLVE_LOG, "utf-8"));
      // Merge with defaults so new keys are present even on old state files
      for (const [k, v] of Object.entries(defaults)) {
        if (!(k in existing)) existing[k] = v;
      }
      return existing;
    }
  } catch {}
  return { ...defaults };
}

function saveState(st) {
  try {
    if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
    fs.writeFileSync(EVOLVE_LOG, JSON.stringify(st, null, 2), "utf-8");
  } catch {}
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function gitRoot() {
  try {
    const r = execSync("git rev-parse --show-toplevel 2>/dev/null", { encoding: "utf-8", timeout: 5000 }).trim();
    return r || null;
  } catch { return null; }
}

function safeReadFile(path) {
  try {
    if (!fs.existsSync(path)) return null;
    const stat = fs.statSync(path);
    if (stat.size > 500000) return null; // skip >500KB files
    return fs.readFileSync(path, "utf-8");
  } catch { return null; }
}

// ── 1. PROJECT SCANNER ────────────────────────────────────
// Given a local path or remote git URL, scan and return project structure.

/**
 * Clone a remote git repo to a temp dir, or validate a local path.
 * Returns { path, name, isRemote, tempDir }
 */
export function cloneOrLocate(target) {
  const cleaned = target.trim();

  // Already a local directory?
  if (fs.existsSync(cleaned) && fs.statSync(cleaned).isDirectory()) {
    return { path: resolve(cleaned), name: basename(resolve(cleaned)), isRemote: false, tempDir: null };
  }

  // Try git clone
  if (cleaned.match(/^https?:\/\/.+\.git$/) || cleaned.match(/^git@/)) {
    const name = cleaned.split("/").pop().replace(/\.git$/, "") || `repo_${Date.now()}`;
    const dest = resolve(BASE_DIR, "cloned", name);
    ensureDir(dirname(dest));
    if (!fs.existsSync(dest)) {
      try {
        execSync(`git clone --depth 1 "${cleaned}" "${dest}"`, { encoding: "utf-8", timeout: 60000 });
      } catch (e) {
        throw new Error(`Git clone failed: ${e.stderr?.slice(0, 200) || e.message}`);
      }
    }
    return { path: dest, name, isRemote: true, tempDir: dest };
  }

  // Could be a repo URL without .git — try to clone anyway
  if (cleaned.startsWith("http") || cleaned.startsWith("git@")) {
    const url = cleaned.endsWith(".git") ? cleaned : `${cleaned}.git`;
    const name = url.split("/").pop().replace(/\.git$/, "") || `repo_${Date.now()}`;
    const dest = resolve(BASE_DIR, "cloned", name);
    ensureDir(dirname(dest));
    if (!fs.existsSync(dest)) {
      try {
        execSync(`git clone --depth 1 "${url}" "${dest}"`, { encoding: "utf-8", timeout: 60000 });
      } catch (e) {
        throw new Error(`Git clone failed: ${e.stderr?.slice(0, 200) || e.message}`);
      }
    }
    return { path: dest, name, isRemote: true, tempDir: dest };
  }

  throw new Error(`Cannot locate project: ${cleaned}. Provide a local path or git URL.`);
}

/**
 * Scan a project directory and return a structured summary:
 * { name, fileCount, languages, entryPoints, exports, tools, features, structure }
 */
export function scanProject(projectPath) {
  const result = {
    name: basename(projectPath),
    path: projectPath,
    fileCount: 0,
    languages: {},
    fileTree: [],
    entryPoints: [],
    exports: [],
    features: [],
    tools: [],
    patterns: {
      moduleSystem: "unknown",
      hasTests: false,
      hasCli: false,
      hasHttpServer: false,
      hasConfig: false,
      hasPluginSystem: false,
    },
    structure: {},
  };

  if (!fs.existsSync(projectPath)) return result;

  const entries = fs.readdirSync(projectPath, { withFileTypes: true });

  // Quick file tree (depth 1)
  const dirs = [];
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) dirs.push(e.name);
    else files.push(e.name);
  }

  result.structure = { dirs, files };

  // Detect entry points
  for (const f of ["package.json", "index.mjs", "index.js", "app.mjs", "app.js", "main.mjs", "main.js", "cli.mjs", "cli.js"]) {
    if (files.includes(f)) result.entryPoints.push(f);
  }

  // Parse package.json if present
  let pkg = null;
  const pkgPath = resolve(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.name) result.name = pkg.name;
      if (pkg.bin) {
        result.patterns.hasCli = true;
        const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin);
        result.entryPoints.push(...bins.filter(b => !result.entryPoints.includes(b)));
      }
    } catch {}
  }

  // Recursively walk JS files to extract patterns
  walkProjectFiles(projectPath, result);

  // Detect module system
  if (result.languages["mjs"] || pkg?.type === "module") {
    result.patterns.moduleSystem = "esm";
  } else if (result.languages["cjs"] || result.languages["js"]) {
    result.patterns.moduleSystem = "cjs";
  }

  // Test detection
  result.patterns.hasTests = result.languages["test.mjs"] > 0 ||
    result.languages["spec.mjs"] > 0 ||
    result.languages["test.js"] > 0 ||
    result.features.some(f => f.includes("test"));

  // HTTP server detection
  result.patterns.hasHttpServer = result.features.some(f =>
    f.includes("http") || f.includes("server") || f.includes("express") || f.includes("fastify")
  );

  // Config detection
  result.patterns.hasConfig = files.some(f =>
    f.includes("config") || f.endsWith("rc") || f === ".env"
  );

  // Plugin detection
  result.patterns.hasPluginSystem = result.features.some(f =>
    f.includes("plugin") || f.includes("extension") || f.includes("module")
  );

  return result;
}

function walkProjectFiles(basePath, result) {
  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.name === "node_modules") continue;
      if (e.name === "dist") continue;
      if (e.name === "build") continue;
      if (e.name === ".git") continue;

      const fullPath = resolve(basePath, e.name);

      if (e.isDirectory()) {
        walkProjectFiles(fullPath, result);
      } else if (e.isFile()) {
        result.fileCount++;

        // Track languages
        const ext = extname(e.name).replace(/^\./, "");
        if (ext) {
          result.languages[ext] = (result.languages[ext] || 0) + 1;
        }

        // Analyze JS/TS source files
        if (e.name.endsWith(".mjs") || e.name.endsWith(".js") || e.name.endsWith(".ts")) {
          analyzeJSFile(fullPath, result);
        }

        // Analyze Python source
        if (e.name.endsWith(".py")) {
          analyzePythonFile(fullPath, result);
        }

        // Analyze Go source
        if (e.name.endsWith(".go")) {
          analyzeGoFile(fullPath, result);
        }
      }
    }
  } catch {}
}

// ── Language-specific file analyzers ─────────────────────────

function analyzeJSFile(fullPath, result) {
  const content = safeReadFile(fullPath);
  if (!content) return;

  const exports = content.match(/(?:export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)|export\s+default\s+(?:async\s+)?function\s*[*(]\s*[^)]*\s*\)(?:.*{)?|module\.exports\s*=\s*{(?:[\s\S]*?)}|module\.exports\s*=\s*{)/g);
  if (exports) {
    for (const ex of exports) {
      const name = ex.match(/(?:function\s+|const\s+)(\w+)/)?.[1];
      if (name) result.exports.push({ name, file: relative(result.path, fullPath) });
    }
  }

  const toolPatterns = content.matchAll(/(\w+):\s*(?:async\s*)?\(?\s*(input|args|cmd|query|target|url|domain|path|text|data|name)\s*\)?\s*=>\s*{/g);
  for (const m of toolPatterns) {
    result.tools.push({ name: m[1], param: m[2], file: relative(result.path, fullPath) });
  }

  const imports = content.matchAll(/from\s+["']([^"']+)["']/g);
  for (const m of imports) {
    const module = m[1];
    if (module.startsWith("http") || module.startsWith("express") || module.startsWith("fastify")) {
      result.patterns.hasHttpServer = true;
    }
    if (!result.features.includes(module)) result.features.push(module);
  }

  if (content.includes("commander") || content.includes("yargs") || content.includes("arg parse") ||
      content.includes("process.argv") || (content.includes("command") && content.includes("description"))) {
    result.patterns.hasCli = true;
  }

  for (const feature of [
    ["websocket", /websocket|ws:\/\/|wss:\/\//i],
    ["database", /sqlite|mongo|postgres|mysql|knex|prisma|typeorm/i],
    ["graphql", /graphql|gql`/i],
    ["auth", /jwt|oauth|bcrypt|passport|session/i],
    ["cache", /redis|memcached|cache/i],
    ["logging", /winston|pino|log4js|bunyan/i],
    ["sse", /EventSource|Server-Sent Events|text\/event-stream/i],
    ["streaming", /pipe|stream|Transform|Readable|Writable/i],
    ["ipc", /child_process|fork|spawn|Worker|parentPort/i],
  ]) {
    if (feature[1].test(content) && !result.features.includes(feature[0])) {
      result.features.push(feature[0]);
    }
  }
}

function analyzePythonFile(fullPath, result) {
  const content = safeReadFile(fullPath);
  if (!content) return;

  // Detect module system
  result.patterns.moduleSystem = "python";

  // Extract function definitions as exports
  const funcs = content.matchAll(/^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*:/gm);
  for (const m of funcs) {
    const name = m[1];
    const params = m[2].trim();
    result.exports.push({ name, file: relative(result.path, fullPath) });

    // Classify as tool if param matches known patterns
    const toolParams = ["query", "target", "url", "domain", "path", "text", "data", "name", "input", "args", "cmd", "username", "email", "host", "port"];
    const hasToolParam = toolParams.some(p => params.includes(p));
    if (hasToolParam || !params) {
      result.tools.push({ name, param: params.split(",")[0]?.trim() || "input", file: relative(result.path, fullPath) });
    }
  }

  // Extract class definitions
  const classes = content.matchAll(/^\s*class\s+(\w+)\s*[:\(]/gm);
  for (const m of classes) {
    result.exports.push({ name: m[1], file: relative(result.path, fullPath), type: "class" });
  }

  // Extract imports as features
  const imports = content.matchAll(/(?:from\s+(\S+)\s+import|import\s+(\S+))/g);
  for (const m of imports) {
    const mod = m[1] || m[2];
    if (mod && !result.features.includes(mod)) {
      result.features.push(mod.startsWith(".") ? mod.slice(1) : mod);
    }
  }

  // Detect CLI frameworks
  if (content.includes("argparse") || content.includes("click") || content.includes("typer") ||
      content.includes("fire.Fire") || content.includes("def main")) {
    result.patterns.hasCli = true;
  }

  // Detect HTTP
  if (content.includes("from flask") || content.includes("from fastapi") || content.includes("import requests") ||
      content.includes("aiohttp") || content.includes("django")) {
    result.patterns.hasHttpServer = true;
  }

  // Feature detection
  if (/(sqlite|mongo(engine|db)?|postgres|mysql|psycopg|sqlalchemy)/i.test(content) && !result.features.includes("database"))
    result.features.push("database");
  if (/(jwt|oauth|bcrypt|passlib|hashlib)/i.test(content) && !result.features.includes("auth"))
    result.features.push("auth");
  if (/(redis|memcached|cache)/i.test(content) && !result.features.includes("cache"))
    result.features.push("cache");
  if (/(websocket|wss?:\/\/)/i.test(content) && !result.features.includes("websocket"))
    result.features.push("websocket");
  if (/(thread|multiprocess|subprocess|concurrent)/i.test(content) && !result.features.includes("ipc"))
    result.features.push("ipc");
  if (/(logging|loguru)/i.test(content) && !result.features.includes("logging"))
    result.features.push("logging");
}

function analyzeGoFile(fullPath, result) {
  const content = safeReadFile(fullPath);
  if (!content) return;

  // Detect module system
  result.patterns.moduleSystem = "go";

  // Extract function definitions
  const funcs = content.matchAll(/^\s*func\s+(?:\([^)]*\)\s+)?([A-Z]\w+)\s*\(([^)]*)\)(?:\s*\(?[^)]*\)?)?\s*\{/gm);
  for (const m of funcs) {
    const name = m[1];
    const params = m[2].trim();
    result.exports.push({ name, file: relative(result.path, fullPath) });

    const toolParams = ["query", "target", "url", "domain", "path", "text", "data", "name", "input", "args", "cmd", "host", "port", "addr"];
    const hasToolParam = toolParams.some(p => params.includes(p));
    if (hasToolParam && name[0] >= 'A' && name[0] <= 'Z') {
      result.tools.push({ name, param: params.split(",")[0]?.trim() || "input", file: relative(result.path, fullPath) });
    }
  }

  // Detect main function
  if (content.includes("func main()")) result.patterns.hasCli = true;

  // Detect HTTP
  if (/(http\.ListenAndServe|gin\.|fiber\.|echo\.|chi\.|net\/http)/.test(content)) {
    result.patterns.hasHttpServer = true;
  }

  // Imports
  const imports = content.matchAll(/(?:"([^"]+)"|`([^`]+)`)/g);
  for (const m of imports) {
    const imp = (m[1] || m[2]).trim();
    if (imp.includes("/") && !result.features.includes(imp)) {
      result.features.push(imp);
    }
  }

  // Feature detection
  if (/(sqlite|mongo|postgres|mysql|database\/sql)/i.test(content) && !result.features.includes("database"))
    result.features.push("database");
  if (/(jwt|oauth|bcrypt|golang-jwt)/i.test(content) && !result.features.includes("auth"))
    result.features.push("auth");
  if (/(websocket|gorilla\/websocket|nhooyr\.io\/websocket)/i.test(content) && !result.features.includes("websocket"))
    result.features.push("websocket");
  if (/(redis|memcached)/i.test(content) && !result.features.includes("cache"))
    result.features.push("cache");
}

// ── 2. SELF-ANALYSIS ──────────────────────────────────────
// Analyze Phantom's own codebase to understand current capabilities.

export function analyzeSelf() {
  const toolsPath = resolve(PHANTOM_DIR, "lib", "tools.mjs");
  const configPath = resolve(PHANTOM_DIR, "lib", "config.mjs");
  const runtimePath = resolve(PHANTOM_DIR, "lib", "runtime.mjs");
  const evolvePath = resolve(PHANTOM_DIR, "lib", "evolve.mjs");
  const dashboardPath = resolve(PHANTOM_DIR, "lib", "dashboard.mjs");
  const serverPath = resolve(PHANTOM_DIR, "lib", "server.mjs");

  const self = {
    version: PHANTOM_VERSION,
    files: [],
    tools: [],
    exports: [],
    features: [],
    gaps: [],
    architecture: {
      moduleCount: 0,
      hasMultiAgent: false,
      hasRepl: false,
      hasApi: false,
      hasGui: false,
      hasPluginSystem: false,
      hasTestSuite: false,
      hasConfigManagement: false,
    },
  };

  // Analyze each source file
  for (const [label, fp] of [
    ["phantom.mjs", resolve(PHANTOM_DIR, "phantom.mjs")],
    ["lib/tools.mjs", toolsPath],
    ["lib/config.mjs", configPath],
    ["lib/runtime.mjs", runtimePath],
    ["lib/evolve.mjs", evolvePath],
    ["lib/dashboard.mjs", dashboardPath],
    ["lib/server.mjs", serverPath],
  ]) {
    const content = safeReadFile(fp);
    if (!content) continue;
    self.files.push({ name: label, size: content.length, lines: content.split("\n").length });

    // Extract exports
    const exports = content.match(/(?:export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+))/g);
    if (exports) {
      for (const ex of exports) {
        const name = ex.match(/(?:function\s+|const\s+)(\w+)/)?.[1];
        if (name) self.exports.push(name);
      }
    }
  }

  // Extract tools from tools.mjs
  const toolsContent = safeReadFile(toolsPath);
  if (toolsContent) {
    const toolNames = toolsContent.matchAll(/(\w+):\s*async\s*\(/g);
    for (const m of toolNames) {
      if (m[1] !== "export") self.tools.push(m[1]);
    }
  }

  // Detect architecture features
  const mainSrc = safeReadFile(resolve(PHANTOM_DIR, "phantom.mjs")) || "";
  self.architecture.hasMultiAgent = mainSrc.includes("AgentManager") && mainSrc.includes("spawn");
  self.architecture.hasRepl = mainSrc.includes("readline") || mainSrc.includes("REPL");
  self.architecture.hasApi = mainSrc.includes("startApiServer") || mainSrc.includes("REST");
  self.architecture.hasGui = mainSrc.includes("startGuiDashboard") || mainSrc.includes("Dashboard");
  self.architecture.hasTestSuite = fs.existsSync(resolve(PHANTOM_DIR, "test")) &&
    fs.readdirSync(resolve(PHANTOM_DIR, "test")).length > 0;
  self.architecture.hasConfigManagement = mainSrc.includes("config") || mainSrc.includes("_config");

  // Detect plugin system
  const allSrc = (safeReadFile(toolsPath) || "") + (safeReadFile(evolvePath) || "") + mainSrc;
  self.architecture.hasPluginSystem = allSrc.includes("plugin") && allSrc.includes("load");

  // Identify categories of tools Phantom has
  self.features = [
    { name: "dns_lookup", present: self.tools.includes("dns_lookup") },
    { name: "port_scanning", present: self.tools.includes("port_scan") },
    { name: "subdomain_enum", present: self.tools.includes("sub_enum") },
    { name: "http_requests", present: self.tools.includes("web_fetch") },
    { name: "ssl_check", present: self.tools.includes("ssl_check") },
    { name: "whois", present: self.tools.includes("whois") },
    { name: "cve_search", present: self.tools.includes("cve_search") },
    { name: "exploit_search", present: self.tools.includes("searchsploit") },
    { name: "vuln_scan", present: self.tools.includes("vuln_scan") },
    { name: "bruteforce", present: self.tools.includes("bruteforce") },
    { name: "file_analysis", present: self.tools.includes("file_analyze") },
    { name: "hash", present: self.tools.includes("hash") },
    { name: "encoding/decoding", present: self.tools.includes("decode") },
    { name: "crawler", present: self.tools.includes("crawl") },
    { name: "http_headers", present: self.tools.includes("http_headers") },
    { name: "yara", present: self.tools.includes("yara") },
    { name: "virustotal", present: self.tools.includes("vt_check") },
    { name: "shell_execution", present: self.tools.includes("shell") },
    { name: "code_generation", present: self.tools.includes("code_gen") },
    { name: "self_modification", present: self.tools.includes("self_edit") },
    { name: "knowledge_base", present: self.tools.includes("knowledge_add") },
    { name: "playbooks", present: self.tools.includes("playbook_list") },
    { name: "scheduling", present: self.tools.includes("schedule") || allSrc.includes("@schedule") },
    { name: "scope_management", present: self.tools.includes("scope") },
    { name: "pipeline/pipe", present: mainSrc.includes("runPipe") },
    { name: "dashboard/gui", present: self.architecture.hasGui },
    { name: "rest_api", present: self.architecture.hasApi },
    { name: "multi_agent", present: self.architecture.hasMultiAgent },
  ];

  return self;
}

// ── 3. GAP ANALYSIS ───────────────────────────────────────
// Compare a scanned project against Phantom to find missing features.

/**
 * Compare project scan against Phantom's current capabilities.
 * Returns an array of gaps: { priority, category, feature, description, source, suggestedApproach }
 */
export function gapAnalysis(projectScan, selfScan) {
  const gaps = [];
  const selfTools = new Set(selfScan.tools);
  const projectTools = projectScan.tools || [];
  const projectFeatures = projectScan.features || [];

  // 1. Missing external tool wrappers
  const projectToolNames = new Set(projectTools.map(t => t.name));
  for (const tool of projectTools) {
    if (!selfTools.has(tool.name) && !tool.name.match(/^[A-Z]/)) {
      gaps.push({
        priority: "medium",
        category: "missing_tool",
        feature: tool.name,
        description: `Project has a tool/function "${tool.name}" that Phantom doesn't wrap`,
        source: `${projectScan.name}/${tool.file}`,
        suggestedApproach: "generate_wrapper",
      });
    }
  }

  // 2. Missing feature categories
  const selfFeaturesSet = new Set(selfScan.features.filter(f => f.present).map(f => f.name));
  const featureMapping = {
    "websocket": { priority: "high", category: "protocol", description: "WebSocket client for real-time communication" },
    "database": { priority: "high", category: "data", description: "Database integration (SQLite, PostgreSQL, etc.)" },
    "graphql": { priority: "medium", category: "api", description: "GraphQL queries and schema introspection" },
    "auth": { priority: "high", category: "security", description: "Authentication/authorization tools" },
    "cache": { priority: "low", category: "performance", description: "Caching layer for repeated queries" },
    "logging": { priority: "low", category: "devops", description: "Structured logging" },
    "sse": { priority: "medium", category: "protocol", description: "Server-Sent Events streaming" },
    "streaming": { priority: "medium", category: "protocol", description: "Stream processing for large data" },
    "ipc": { priority: "medium", category: "system", description: "Inter-process communication" },
  };

  for (const [featureName, mapping] of Object.entries(featureMapping)) {
    if (projectFeatures.includes(featureName) && !selfFeaturesSet.has(featureName)) {
      gaps.push({
        priority: mapping.priority,
        category: mapping.category,
        feature: featureName,
        description: `${mapping.description} — present in ${projectScan.name} but missing from Phantom`,
        source: projectScan.name,
        suggestedApproach: "generate_module",
      });
    }
  }

  // 3. Architecture gaps
  const proj = projectScan.patterns;
  const arch = selfScan.architecture;

  if (proj.hasPluginSystem && !arch.hasPluginSystem) {
    gaps.push({
      priority: "high",
      category: "architecture",
      feature: "plugin_system",
      description: `${projectScan.name} uses a plugin system — Phantom could support hot-loadable plugins`,
      source: projectScan.name,
      suggestedApproach: "generate_module",
    });
  }

  // 4. File structure patterns worth adopting
  if (projectScan.languages["mjs"] && projectScan.languages["mjs"] > 3) {
    // Another ESM project may have useful patterns
    gaps.push({
      priority: "low",
      category: "pattern",
      feature: "esm_patterns",
      description: `${projectScan.name} uses modular ESM patterns worth studying`,
      source: projectScan.name,
      suggestedApproach: "learn_pattern",
    });
  }

  // 5. Detect if project has a README/docs system Phantom lacks
  const hasDocs = projectScan.fileTree.some(f =>
    f.toLowerCase().includes("readme") || f.toLowerCase().includes("docs") || f.endsWith(".md")
  );
  // Phantom already has --help, but structured docs are worth checking

  return gaps;
}

// ── 4. PATTERN LEARNER ────────────────────────────────────
// Extract reusable patterns from other projects.

/**
 * Extract coding patterns from a project's source files.
 * Returns { modulePattern, errorHandling, toolPattern, cliPattern, middlewarePattern, ... }
 */
export function extractPatterns(projectPath) {
  const patterns = {
    moduleExports: "named",
    errorStyle: "catch_return",
    toolInterface: "async_single_param",
    configStyle: "flat_object",
    eventStyle: "none",
    validatedBy: null,
    samples: [],
  };

  // Count export styles
  let namedExports = 0, defaultExports = 0, moduleExports = 0;

  // Walk all JS/MJS files
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".") || e.isDirectory()) continue;
      if (!e.name.endsWith(".mjs") && !e.name.endsWith(".js")) continue;

      const content = safeReadFile(resolve(projectPath, e.name));
      if (!content) continue;

      if ((content.match(/^export\s+(async\s+)?function/gm) || []).length > 0) namedExports++;
      if ((content.match(/export\s+default/g) || []).length > 0) defaultExports++;
      if ((content.match(/module\.exports/g) || []).length > 0) moduleExports++;

      // Error handling pattern
      if (content.includes("try {") && content.includes("catch (e)")) {
        if (content.match(/catch\s*\([^)]*\)\s*{[\s\S]{0,100}return\s/)) {
          patterns.errorStyle = "catch_return";
        } else if (content.match(/catch\s*\([^)]*\)\s*{[\s\S]{0,100}(?:reject|throw)/)) {
          patterns.errorStyle = "catch_throw";
        } else if (content.match(/catch\s*\([^)]*\)\s*{[\s\S]{0,100}(?:console|log|warn)/)) {
          patterns.errorStyle = "catch_log";
        }
      }

      // Tool interface pattern
      if (content.match(/(\w+):\s*async\s*\(\s*(input|args|cmd)\s*\)/)) {
        patterns.toolInterface = "async_single_param";
      } else if (content.match(/(\w+):\s*async\s*\(\s*\)/)) {
        patterns.toolInterface = "async_no_param";
      }

      // Config pattern
      if (content.includes("config") && content.includes("from")) {
        patterns.configStyle = "module_import";
      }

      // Extract a sample module as reference
      if (namedExports + defaultExports + moduleExports > 0 && !patterns.samples.length) {
        const lines = content.split("\n");
        const sample = lines.slice(0, 40).map(l => l.trim()).filter(Boolean).slice(0, 20).join("\n");
        if (sample.length > 80) {
          patterns.samples.push({ file: e.name, code: sample });
        }
      }
    }
  } catch {}

  return patterns;
}

/**
 * Save learned patterns to disk for reference during code generation.
 */
export function savePatterns(projectName, patterns) {
  ensureDir(LEARN_DIR);
  const fp = resolve(LEARN_DIR, `${projectName.replace(/[^a-z0-9_-]/gi, "_")}_patterns.json`);
  const data = {
    project: projectName,
    learned: new Date().toISOString(),
    patterns,
  };
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
  return fp;
}

/**
 * Load all saved patterns for use in code generation.
 */
export function loadAllPatterns() {
  const results = {};
  ensureDir(LEARN_DIR);
  const files = fs.readdirSync(LEARN_DIR).filter(f => f.endsWith("_patterns.json"));
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(resolve(LEARN_DIR, f), "utf-8"));
      results[data.project] = data.patterns;
    } catch {}
  }
  return results;
}

// ── 5. CODE GENERATOR ─────────────────────────────────────
// Generate new Phantom code based on gaps and learned patterns.

/**
 * Generate a new tool wrapper for Phantom.
 * Takes a gap description and produces { filePath, code }
 */
export function generateTool(feature, description) {
  const toolName = camelCase(feature);
  const ext = ".mjs";

  const code = `// Auto-generated tool: ${toolName}
// Source: Learned from "${feature}" — ${description}
// Generated by Phantom self-improvement engine

export default async function(input) {
  try {
    const { execSync } = await import("child_process");
    const { resolve } = await import("path");
    const args = (input || "").trim();
    if (!args) {
      return \`[${toolName}] Usage: @${toolName}|<args>
Feature: ${description}
Examples:
  ${toolName}|--help
  ${toolName}|<target>\`;
    }
    const result = execSync(\`${toolName} \${args}\`, {
      encoding: "utf-8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    return result.trim() || "(no output)";
  } catch (e) {
    return \`[${toolName} Error] \${e.stderr?.slice(0, 500) || e.message}\`;
  }
}
`;

  ensureDir(GENERATED_DIR);
  const filePath = resolve(GENERATED_DIR, `${toolName}${ext}`);
  fs.writeFileSync(filePath, code, "utf-8");

  return { filePath, toolName, code };
}

/**
 * Generate a full new module based on a gap analysis result.
 * Can generate: tool wrappers, utility modules, feature modules, middleware
 */
export function generateModule(gap, patterns) {
  const category = gap.category;
  const feature = gap.feature;

  switch (gap.suggestedApproach) {
    case "generate_wrapper":
      return generateTool(feature, gap.description);

    case "generate_module": {
      return generateFeatureModule(feature, gap.description, patterns);
    }

    case "learn_pattern":
      return { note: `Pattern learning queued for ${feature}`, filePath: null };

    default:
      return { note: `No generator for ${feature} (${gap.suggestedApproach})`, filePath: null };
  }
}

/**
 * Generate a new feature module (e.g., websocket client, database layer).
 */
function generateFeatureModule(feature, description, patterns) {
  const moduleName = camelCase(feature);
  const ext = ".mjs";
  const toolStyle = patterns?.toolInterface === "async_no_param" ? "async ()" : "async (input)";

  // Generate appropriate module based on feature type
  let code = "";

  switch (feature) {
    case "websocket":
      code = generateWebSocketModule(moduleName, description);
      break;
    case "database":
      code = generateDatabaseModule(moduleName, description);
      break;
    case "plugin_system":
      code = generatePluginModule(moduleName, description);
      break;
    case "graphql":
      code = generateGraphQLModule(moduleName, description);
      break;
    case "sse":
      code = generateSSEModule(moduleName, description);
      break;
    case "streaming":
      code = generateStreamingModule(moduleName, description);
      break;
    case "auth":
      code = generateAuthModule(moduleName, description);
      break;
    case "cache":
      code = generateCacheModule(moduleName, description);
      break;
    case "ipc":
      code = generateIPCModule(moduleName, description);
      break;
    default:
      // Generic module template
      code = `// Auto-generated module: ${moduleName}
// Feature: ${feature} — ${description}
// Generated by Phantom self-improvement engine

/**
 * ${description}
 * @param {string} input - Command/query input
 * @returns {Promise<string>} Formatted result
 */
export default ${toolStyle} {
  try {
    const args = (input || "").trim();
    if (!args) {
      return \`[${moduleName}] Usage: @${moduleName}|<args>
Feature: ${description}
This module was auto-generated from pattern analysis.
Examples:
  ${moduleName}|--help\`;
    }

    // TODO: Implement ${feature} logic
    // This module was auto-generated as a placeholder from gap analysis
    return \`[${moduleName}] Module scaffold generated for: \${args}
Feature "${feature}" requires implementation.
Pattern source: ${description}\`;
  } catch (e) {
    return \`[${moduleName} Error] \${e.message}\`;
  }
};
`;
      break;
  }

  ensureDir(GENERATED_DIR);
  const filePath = resolve(GENERATED_DIR, `${moduleName}${ext}`);
  fs.writeFileSync(filePath, code, "utf-8");

  return { filePath, moduleName, code };
}

function generateWebSocketModule(name, description) {
  return `// Auto-generated module: ${name}
// Feature: WebSocket client for real-time communication
// Generated by Phantom self-improvement engine

/**
 * WebSocket client tool.
 * Usage: @${name}|<url> [--send=<message>] [--listen=<timeout_ms>]
 */
export default async function(input) {
  try {
    const args = (input || "").trim();
    if (!args) {
      return \`[${name}] WebSocket Client
Usage: @${name}|<url> [--send=<message>]
Examples:
  ${name}|wss://echo.websocket.org --send=hello
  ${name}|wss://stream.binance.com:9443/ws/btcusdt --listen=5000

Sends an optional message and prints responses.
Requires Node.js native WebSocket (Node 22+) or 'ws' package.\`;
    }

    const urlMatch = args.match(/https?:\\/\\/[^\\s]+|wss?:\\/\\/[^\\s]+/);
    if (!urlMatch) return \`[${name}] No WebSocket URL found in: \${args}\`;

    const url = urlMatch[0];
    const sendMatch = args.match(/--send=([^\\s]+)/);
    const listenMatch = args.match(/--listen=(\\d+)/);
    const listenMs = listenMatch ? parseInt(listenMatch[1]) : 3000;

    // Try native WebSocket (Node 22+)
    if (typeof WebSocket !== "undefined") {
      return await new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const messages = [];
        const timeout = setTimeout(() => {
          ws.close();
          if (messages.length === 0) resolve(\`[${name}] Connected to \${url} (no messages in \${listenMs}ms)\`);
          else resolve(\`[${name}] \${url}\\nMessages (\${messages.length}):\\n\${messages.join("\\n")}\`);
        }, listenMs);

        ws.onopen = () => {
          if (sendMatch) ws.send(sendMatch[1]);
        };
        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            messages.push(typeof parsed === "object" ? JSON.stringify(parsed, null, 2).slice(0, 500) : event.data);
          } catch {
            messages.push(event.data.slice(0, 500));
          }
        };
        ws.onerror = (err) => { clearTimeout(timeout); resolve(\`[${name} Error] \${err.message || "Connection failed"}\`); };
        ws.onclose = () => clearTimeout(timeout);
      });
    }

    return \`[${name}] WebSocket not available in this Node.js version. Install 'ws' package or upgrade to Node 22+.\`;
  } catch (e) {
    return \`[${name} Error] \${e.message}\`;
  }
};
`;
}

function generateDatabaseModule(name, description) {
  return `// Auto-generated module: ${name}
// Feature: Database integration (SQLite)
// Generated by Phantom self-improvement engine

import { execSync } from "child_process";
import { resolve } from "path";

/**
 * SQLite database query tool.
 * Usage: @${name}|<path>|<query>
 * Uses sqlite3 CLI. Install: apt install sqlite3
 */
export default async function(input) {
  try {
    const parts = (input || "").split("|").map(s => s.trim());
    if (parts.length < 2) {
      return \`[${name}] SQLite Database Tool
Usage: @${name}|<db_path>|<sql_query>
Examples:
  ${name}|test.db|SELECT * FROM users LIMIT 10;
  ${name}|/tmp/data.db|.tables
  ${name}|--tables|test.db                  List tables

Requires: sqlite3 CLI (apt install sqlite3)\`;
    }

    const dbPath = parts[0];
    const query = parts.slice(1).join("|");

    // Check sqlite3 availability
    try {
      execSync("which sqlite3", { encoding: "utf-8", timeout: 3000 });
    } catch {
      return \`[${name}] sqlite3 not found. Install: apt install sqlite3\`;
    }

    const escapedQuery = query.replace(/'/g, "'\\\\''");
    const result = execSync(\`sqlite3 -header -column "\${dbPath}" '\${escapedQuery}'\`, {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }).trim();

    return result || "(empty result)";
  } catch (e) {
    return \`[${name} Error] \${e.stderr?.slice(0, 500) || e.message}\`;
  }
};
`;
}

function generatePluginModule(name, description) {
  return `// Auto-generated module: ${name}
// Feature: Hot-loadable plugin system for Phantom
// Generated by Phantom self-improvement engine

import fs from "fs";
import { resolve } from "path";
import { homedir } from "os";

const PLUGIN_DIRS = [
  resolve(homedir(), ".config", "phantom", "plugins"),
  resolve(homedir(), "Phantom", "plugins"),
];

/**
 * Plugin system — load, list, enable, disable plugins at runtime.
 * Usage: @${name}|list
 *        @${name}|load|<path>
 *        @${name}|enable|<name>
 *        @${name}|disable|<name>
 */
export default async function(input) {
  try {
    const args = (input || "").trim().split("|").map(s => s.trim());
    const command = args[0] || "";

    if (!command || command === "--help") {
      return \`[${name}] Plugin System
Commands:
  @${name}|list                        List registered plugins
  @${name}|load|<path>                 Load a plugin from file
  @${name}|enable|<name>               Enable a plugin
  @${name}|disable|<name>              Disable a plugin
  @${name}|reload                      Reload all plugins
  @${name}|scan                        Scan PLUGIN_DIRS for plugins\`;
    }

    // Ensure plugin dirs exist
    for (const d of PLUGIN_DIRS) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }

    const registryPath = resolve(PLUGIN_DIRS[0], "registry.json");
    let registry = { enabled: {}, disabled: {}, manifest: {} };
    try {
      if (fs.existsSync(registryPath)) registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    } catch {}

    switch (command) {
      case "list": {
        const enabled = Object.keys(registry.enabled);
        const disabled = Object.keys(registry.disabled);
        const lines = [\`[${name}] Plugin Registry (\${enabled.length} enabled, \${disabled.length} disabled)\`];
        for (const p of enabled) {
          const info = registry.manifest[p] || {};
          lines.push(\`  ✅ \${p} — \${info.description || "no description"}\`);
        }
        for (const p of disabled) {
          const info = registry.manifest[p] || {};
          lines.push(\`  ⏸ \${p} — \${info.description || "no description"} [disabled]\`);
        }
        if (!enabled.length && !disabled.length) lines.push("  (no plugins registered)");
        return lines.join("\\n");
      }

      case "load": {
        const pluginPath = args[1];
        if (!pluginPath) return \`[${name}] Usage: @${name}|load|<path>\`;
        if (!fs.existsSync(pluginPath)) return \`[${name}] Plugin not found: \${pluginPath}\`;
        try {
          const mod = await import(resolve(pluginPath) + \`?t=\${Date.now()}\`);
          const name = mod.name || basename(pluginPath).replace(/\\.mjs$/, "");
          const description = mod.description || "";
          const version = mod.version || "1.0.0";
          registry.enabled[name] = { path: pluginPath, loaded: new Date().toISOString(), version };
          registry.manifest[name] = { description, version, path: pluginPath };
          fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
          return \`[${name}] ✅ Loaded plugin: \${name} v\${version}\`;
        } catch (e) {
          return \`[${name}] Failed to load plugin: \${e.message}\`;
        }
      }

      case "enable": {
        const pname = args[1];
        if (!pname || !registry.disabled[pname]) return \`[${name}] Plugin not found in disabled list: \${pname}\`;
        registry.enabled[pname] = registry.disabled[pname];
        delete registry.disabled[pname];
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
        return \`[${name}] ✅ Enabled plugin: \${pname}\`;
      }

      case "disable": {
        const dname = args[1];
        if (!dname || !registry.enabled[dname]) return \`[${name}] Plugin not found in enabled list: \${dname}\`;
        registry.disabled[dname] = registry.enabled[dname];
        delete registry.enabled[dname];
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
        return \`[${name}] ⏸ Disabled plugin: \${dname}\`;
      }

      case "scan": {
        let found = 0;
        for (const dir of PLUGIN_DIRS) {
          if (!fs.existsSync(dir)) continue;
          const files = fs.readdirSync(dir).filter(f => f.endsWith(".mjs"));
          for (const file of files) {
            const fullPath = resolve(dir, file);
            if (!registry.enabled[file.replace(/\\.mjs$/, "")]) {
              try {
                const mod = await import(fullPath + \`?t=\${Date.now()}\`);
                const pname = mod.name || file.replace(/\\.mjs$/, "");
                registry.enabled[pname] = { path: fullPath, loaded: new Date().toISOString(), version: mod.version || "1.0.0" };
                registry.manifest[pname] = { description: mod.description || "", version: mod.version || "1.0.0", path: fullPath };
                found++;
              } catch {}
            }
          }
        }
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
        return \`[${name}] Scan complete: loaded \${found} new plugin(s)\`;
      }

      default:
        return \`[${name}] Unknown command: \${command}. Use @${name}|--help for usage.\`;
    }
  } catch (e) {
    return \`[${name} Error] \${e.message}\`;
  }
};
`;
}

function generateGraphQLModule(name, description) {
  return `// Auto-generated module: ${name}
// Feature: GraphQL queries and introspection
// Generated by Phantom self-improvement engine

/**
 * GraphQL query tool.
 * Usage: @${name}|<endpoint>|<query> [--variables=<json>]
 */
export default async function(input) {
  try {
    const args = (input || "").trim();
    if (!args) {
      return \`[${name}] GraphQL Client
Usage: @${name}|<url>|<query> [--variables=<json>]
Examples:
  ${name}|https://api.example.com/graphql|{ __schema { types { name } } }
  ${name}|https://api.github.com/graphql|query{viewer{login}} --variables={}

Sends a GraphQL query to the endpoint and returns the response.\`;
    }

    const parts = args.split("|");
    let url = parts[0]?.trim();
    let query = parts.slice(1).join("|").trim();

    // Extract --variables
    const varMatch = query.match(/--variables=(\\{[^}]+\\})/);
    const variables = varMatch ? JSON.parse(varMatch[1]) : {};
    query = query.replace(/--variables=\\{[^}]+\\}/, "").trim();

    if (!url || !query) return \`[${name}] Usage: @${name}|<endpoint>|<query>\`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Phantom/1.0" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await response.json();
    const formatted = JSON.stringify(data, null, 2);
    return formatted.slice(0, 8000);
  } catch (e) {
    return \`[${name} Error] \${e.message}\`;
  }
};
`;
}

function generateSSEModule(name, description) {
  return `// Auto-generated module: ${name}
// Feature: Server-Sent Events streaming
// Generated by Phantom self-improvement engine

/**
 * SSE (Server-Sent Events) stream reader.
 * Usage: @${name}|<url> [--events=<count>] [--timeout=<ms>]
 */
export default async function(input) {
  try {
    const args = (input || "").trim();
    if (!args) {
      return \`[${name}] SSE Stream Reader
Usage: @${name}|<url> [--events=5] [--timeout=10000]
Examples:
  ${name}|https://api.example.com/events --events=3
  ${name}|https://stream.example.com/data --timeout=5000

Connects to an SSE endpoint and captures events.
Outputs event data as they arrive.\`;
    }

    const urlMatch = args.match(/https?:\\/\\/[^\\s]+/);
    if (!urlMatch) return \`[${name}] No URL found in: \${args}\`;

    const url = urlMatch[0];
    const eventMatch = args.match(/--events=(\\d+)/);
    const timeoutMatch = args.match(/--timeout=(\\d+)/);
    const maxEvents = eventMatch ? parseInt(eventMatch[1]) : 10;
    const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1]) : 10000;

    const response = await fetch(url, {
      headers: { Accept: "text/event-stream", "User-Agent": "Phantom/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return \`[${name}] HTTP \${response.status} from \${url}\`;
    if (!response.body) return \`[${name}] No response body\`;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = "";

    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          events.push(line.slice(6));
        } else if (line.startsWith("event: ")) {
          // track event type if needed
        }
      }
    }

    if (events.length === 0) return \`[${name}] Connected to \${url} (no events received)\`;
    return \`[${name}] \${url} — \${events.length} events\\n\${events.slice(0, maxEvents).join("\\n")}\`;
  } catch (e) {
    return \`[${name} Error] \${e.message}\`;
  }
};
`;
}

function generateStreamingModule(name, description) {
  return `// Auto-generated module: ${name}
// Feature: Stream processing for large data
// Generated by Phantom self-improvement engine

import { createReadStream, createWriteStream, existsSync } from "fs";
import { resolve } from "path";
import { Transform } from "stream";

/**
 * Stream processing tool — process large files line-by-line.
 * Usage: @${name}|<input>|<transform> [--output=<path>]
 * Transforms: upper, lower, reverse, base64, count, grep:<pattern>
 */
export default async function(input) {
  try {
    const args = (input || "").trim();
    if (!args) {
      return \`[${name}] Stream Processor
Process large files line-by-line without loading into memory.
Usage: @${name}|<file>|<transform> [--output=<outfile>]
Transforms:
  upper          Convert to uppercase
  lower          Convert to lowercase
  reverse        Reverse each line
  base64         Base64 encode each line
  count          Count lines/words/bytes
  grep:<pat>     Filter lines matching pattern
  sed:s/find/replace  Search and replace

Examples:
  ${name}|large.log|grep:ERROR --output=errors.log
  ${name}|data.txt|upper
  ${name}|bigfile.csv|count\`;
    }

    const parts = args.split("|").map(s => s.trim());
    const inputPath = parts[0] ? resolve(parts[0]) : null;
    const transform = parts[1] || "";
    const outMatch = args.match(/--output=([^\\s]+)/);
    const outputPath = outMatch ? resolve(outMatch[1]) : null;

    if (!inputPath || !existsSync(inputPath)) return \`[${name}] Input file not found: \${parts[0]}\`;
    if (!transform) return \`[${name}] No transform specified\`;

    const stat = existsSync(inputPath);
    const size = stat ? fs.statSync(inputPath).size : 0;

    // Simple counter mode
    if (transform === "count") {
      return new Promise((resolvePromise) => {
        let lines = 0, words = 0, bytes = 0;
        const rs = createReadStream(inputPath, { encoding: "utf-8" });
        rs.on("data", chunk => {
          bytes += Buffer.byteLength(chunk, "utf-8");
          lines += (chunk.match(/\\n/g) || []).length;
          words += chunk.split(/\\s+/).filter(Boolean).length;
        });
        rs.on("end", () => resolvePromise(\`[${name}] \${inputPath}\\n  Lines: \${lines}\\n  Words: \${words}\\n  Bytes: \${bytes}\\n  Size: \${(size / 1024).toFixed(1)} KB\`));
        rs.on("error", e => resolvePromise(\`[${name} Error] \${e.message}\`));
      });
    }

    // Line-by-line transform mode
    return new Promise((resolvePromise) => {
      const outputs = [];
      const rs = createReadStream(inputPath, { encoding: "utf-8" });
      const rl = require("readline").createInterface({ input: rs });

      rl.on("line", line => {
        let result = line;
        switch (transform) {
          case "upper": result = line.toUpperCase(); break;
          case "lower": result = line.toLowerCase(); break;
          case "reverse": result = line.split("").reverse().join(""); break;
          case "base64": result = Buffer.from(line, "utf-8").toString("base64"); break;
          default:
            if (transform.startsWith("grep:")) {
              const pat = transform.slice(5);
              if (!line.includes(pat) && !new RegExp(pat).test(line)) return;
            } else if (transform.startsWith("sed:")) {
              const m = transform.match(/^sed:(.+?)\\/(.+?)\\/(.*)$/);
              if (m) result = line.replace(new RegExp(m[1], "g"), m[2]);
            }
        }
        outputs.push(result);
      });

      rl.on("close", () => {
        const text = outputs.join("\\n");
        if (outputPath) {
          fs.writeFileSync(outputPath, text, "utf-8");
          resolvePromise(\`[${name}] Processed \${outputs.length} lines → \${outputPath} (\${text.length} chars)\`);
        } else {
          const preview = text.slice(0, 3000);
          const truncated = text.length > 3000 ? \`\\n... (truncated, \${text.length} total chars)\` : "";
          resolvePromise(\`[${name}] \${inputPath} → \${outputs.length} lines\\n\${preview}\${truncated}\`);
        }
      });

      rl.on("error", e => resolvePromise(\`[${name} Error] \${e.message}\`));
    });
  } catch (e) {
    return \`[${name} Error] \${e.message}\`;
  }
};
`;
}

function generateAuthModule(name, description) {
  return `// Auto-generated module: ${name}
// Feature: Authentication/Authorization tools
// Generated by Phantom self-improvement engine

import { createHash, randomBytes } from "crypto";

/**
 * Auth tools — JWT decode, hash verify, token analysis.
 * Usage: @${name}|decode|<jwt_token>
 *        @${name}|hash|<password> [--algorithm=<sha256|sha512|md5>]
 *        @${name}|random|<length>
 */
export default async function(input) {
  try {
    const args = (input || "").trim();
    if (!args) {
      return \`[${name}] Authentication Tools
Usage:
  @${name}|decode|<jwt_token>        Decode a JWT (no signature verify)
  @${name}|hash|<password>           Hash a password (default: sha256)
  @${name}|hash|<password> --algo=sha512
  @${name}|random|32                  Generate random hex string (N bytes)
  @${name}|basic|user:pass            Encode Basic auth header

Examples:
  ${name}|decode|eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHx0I
  ${name}|hash|mypassword --algo=sha512
  ${name}|random|16\`;
    }

    const parts = args.split("|").map(s => s.trim());
    const command = parts[0];
    const data = parts.slice(1).join("|");

    switch (command) {
      case "decode": {
        const token = data;
        if (!token || !token.includes(".")) return \`[${name}] Invalid JWT format\`;
        const segments = token.split(".");
        if (segments.length < 2) return \`[${name}] Invalid JWT format\`;
        const decode = (s) => {
          try {
            return JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"));
          } catch { return { error: "Cannot decode" }; }
        };
        const header = decode(segments[0]);
        const payload = decode(segments[1]);
        const lines = [
          \`[${name}] JWT Decoded\`,
          \`── Header ──\`,
          JSON.stringify(header, null, 2),
          \`── Payload ──\`,
          JSON.stringify(payload, null, 2),
        ];
        if (segments[2]) lines.push(\`── Signature ──\${segments[2].slice(0, 32)}...\`);
        return lines.join("\\n");
      }

      case "hash": {
        const algoMatch = args.match(/--algo=(\\w+)/);
        const algo = algoMatch ? algoMatch[1] : "sha256";
        if (!["sha256", "sha512", "md5", "sha1"].includes(algo)) return \`[${name}] Unsupported algorithm: \${algo}. Use sha256, sha512, md5, or sha1.\`;
        const hash = createHash(algo).update(data).digest("hex");
        return \`[${name}] \${algo} hash of "\${data.slice(0, 50)}":\n\${hash}\`;
      }

      case "random": {
        const len = parseInt(data) || 16;
        const hex = randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
        return \`[${name}] Random hex (\${len} chars): \${hex}\`;
      }

      case "basic": {
        // Encode Basic auth header value
        const encoded = Buffer.from(data).toString("base64");
        return \`[${name}] Basic Auth:\n  Header: Authorization: Basic \${encoded}\n  Value: \${data}\`;
      }

      default:
        return \`[${name}] Unknown command: \${command}. Use @${name}|--help for usage.\`;
    }
  } catch (e) {
    return \`[${name} Error] \${e.message}\`;
  }
};
`;
}

function generateCacheModule(name, description) {
  return `// Auto-generated module: ${name}
// Feature: Caching layer for tool outputs
// Generated by Phantom self-improvement engine

import fs from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

const CACHE_DIR = resolve(homedir(), ".config", "phantom", "cache");
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Cache layer — store and retrieve cached tool outputs.
 * Usage: @${name}|get|<key>
 *        @${name}|set|<key>|<value> [--ttl=<ms>]
 *        @${name}|del|<key>
 *        @${name}|clear
 *        @${name}|stats
 */
export default async function(input) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

    const args = (input || "").trim();

    if (!args) {
      return \`[${name}] Cache System
Usage:
  @${name}|get|<key>                  Get cached value
  @${name}|set|<key>|<value>          Set cached value (default TTL: 5min)
  @${name}|del|<key>                  Delete cached entry
  @${name}|clear                      Clear entire cache
  @${name}|stats                      Show cache statistics

Used internally by Phantom to cache repeated tool outputs.\`;
    }

    const cacheFile = resolve(CACHE_DIR, "registry.json");
    let registry = {};
    try {
      if (fs.existsSync(cacheFile)) registry = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    } catch {}

    const parts = args.split("|").map(s => s.trim());
    const command = parts[0];

    switch (command) {
      case "get": {
        const key = parts.slice(1).join("|");
        if (!key) return \`[${name}] Usage: @${name}|get|<key>\`;
        const hashKey = createHash("md5").update(key).digest("hex");
        const entry = registry[hashKey];
        if (!entry) return \`[${name}] Cache miss for: \${key.slice(0, 60)}\`;
        if (Date.now() - entry.ts > (entry.ttl || DEFAULT_TTL)) {
          delete registry[hashKey];
          fs.writeFileSync(cacheFile, JSON.stringify(registry, null, 2), "utf-8");
          return \`[${name}] Cache expired for: \${key.slice(0, 60)}\`;
        }
        return \`[${name}] Cache hit for: \${key.slice(0, 60)}\\n\${entry.value.slice(0, 3000)}\`;
      }

      case "set": {
        const separatorIdx = args.indexOf("|", args.indexOf("|") + 1);
        if (separatorIdx === -1) return \`[${name}] Usage: @${name}|set|<key>|<value>\`;
        const key = args.slice(4, separatorIdx).trim();
        const value = args.slice(separatorIdx + 1).trim();
        const ttlMatch = args.match(/--ttl=(\\d+)/);
        const ttl = ttlMatch ? parseInt(ttlMatch[1]) * 1000 : DEFAULT_TTL;
        const hashKey = createHash("md5").update(key).digest("hex");
        registry[hashKey] = { key, ts: Date.now(), ttl, length: value.length };
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(resolve(CACHE_DIR, \`\${hashKey}.cache\`), value, "utf-8");
        fs.writeFileSync(cacheFile, JSON.stringify(registry, null, 2), "utf-8");
        return \`[${name}] Cached (\${value.length} chars, TTL: \${ttl / 1000}s)\`;
      }

      case "del": {
        const dkey = parts.slice(1).join("|");
        const dhash = createHash("md5").update(dkey).digest("hex");
        if (registry[dhash]) {
          delete registry[dhash];
          const cachePath = resolve(CACHE_DIR, \`\${dhash}.cache\`);
          if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
          fs.writeFileSync(cacheFile, JSON.stringify(registry, null, 2), "utf-8");
          return \`[${name}] Deleted: \${dkey.slice(0, 60)}\`;
        }
        return \`[${name}] Not found: \${dkey.slice(0, 60)}\`;
      }

      case "clear": {
        const count = Object.keys(registry).length;
        if (fs.existsSync(CACHE_DIR)) {
          const files = fs.readdirSync(CACHE_DIR);
          for (const f of files) fs.unlinkSync(resolve(CACHE_DIR, f));
        }
        fs.writeFileSync(cacheFile, "{}", "utf-8");
        return \`[${name}] Cache cleared (\${count} entries removed)\`;
      }

      case "stats": {
        const count = Object.keys(registry).length;
        let totalSize = 0, validEntries = 0, expiredEntries = 0;
        for (const [k, v] of Object.entries(registry)) {
          const cachePath = resolve(CACHE_DIR, \`\${k}.cache\`);
          if (fs.existsSync(cachePath)) totalSize += fs.statSync(cachePath).size;
          if (Date.now() - v.ts > (v.ttl || DEFAULT_TTL)) expiredEntries++;
          else validEntries++;
        }
        return \`[${name}] Cache Stats:
  Total entries: \${count}
  Valid: \${validEntries}
  Expired: \${expiredEntries}
  Disk size: \${(totalSize / 1024).toFixed(1)} KB
  Cache dir: \${CACHE_DIR}\`;
      }

      default:
        return \`[${name}] Unknown command: \${command}. Use @${name}|--help for usage.\`;
    }
  } catch (e) {
    return \`[${name} Error] \${e.message}\`;
  }
};
`;
}

function generateIPCModule(name, description) {
  return `// Auto-generated module: ${name}
// Feature: Inter-process communication utilities
// Generated by Phantom self-improvement engine

import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { isMainThread, parentPort, Worker } from "worker_threads";

/**
 * IPC tools — spawn processes, communicate via workers.
 * Usage: @${name}|exec|<command>
 *        @${name}|bg|<command>          Start background process
 *        @${name}|ps                    List child processes
 */
export default async function(input) {
  try {
    const args = (input || "").trim();

    if (!args) {
      return \`[${name}] IPC Utilities
Usage:
  @${name}|exec|<command>            Execute and capture output
  @${name}|bg|<command>              Start background process
  @${name}|ps                        List Phantom child processes

For multi-process coordination and long-running tasks.\`;
    }

    const parts = args.split("|").map(s => s.trim());
    const command = parts[0];
    const rest = parts.slice(1).join("|");

    switch (command) {
      case "exec": {
        if (!rest) return \`[${name}] Usage: @${name}|exec|<shell command>\`;
        // Use shell for full command support
        const result = execSync(rest, {
          encoding: "utf-8",
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        });
        return \`[${name}] Executed:\n\${rest}\n── Output ──\n\${result.trim().slice(0, 4000) || "(empty)"}\`;
      }

      case "bg": {
        if (!rest) return \`[${name}] Usage: @${name}|bg|<command>\`;
        const proc = spawn("sh", ["-c", rest], {
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        });
        let out = "";
        proc.stdout.on("data", d => { out += d.toString(); });
        proc.stderr.on("data", d => { out += d.toString(); });
        // Don't await — let it run in background
        return \`[${name}] Started background process (PID: \${proc.pid})\nCommand: \${rest}\`;
      }

      case "ps": {
        // List phantom-related processes
        const result = execSync("ps aux | grep -E 'node|phantom' | grep -v grep", {
          encoding: "utf-8",
          timeout: 5000,
        }).trim();
        if (!result) return \`[${name}] No Phantom child processes found\`;
        const lines = result.split("\\n");
        return \`[${name}] Child Processes (\${lines.length}):\n\${lines.join("\\n")}\`;
      }

      default:
        return \`[${name}] Unknown command: \${command}. Use @${name}|--help for usage.\`;
    }
  } catch (e) {
    return \`[${name} Error] \${e.message}\`;
  }
};
`;
}

// ── 6. FULL IMPROVEMENT CYCLE ──────────────────────────────

/**
 * Full self-improvement pipeline:
 * 1. Take a project URL/path
 * 2. Clone/scan it
 * 3. Analyze Phantom's own capabilities
 * 4. Gap analysis
 * 5. Pattern extraction
 * 6. Code generation for each gap
 * 7. Apply changes
 * 8. Test and commit
 *
 * Returns detailed results report.
 */
export async function fullImprovementCycle(target) {
  const startTime = Date.now();
  const report = {
    target,
    started: new Date().toISOString(),
    elapsed: null,
    project: null,
    selfAnalysis: null,
    gaps: [],
    generated: [],
    applied: [],
    errors: [],
  };

  try {
    // Step 1: Clone/scan the project
    const project = cloneOrLocate(target);
    report.project = { name: project.name, path: project.path, isRemote: project.isRemote };
    report.project.scan = scanProject(project.path);

    // Step 2: Analyze self
    const self = analyzeSelf();
    report.selfAnalysis = {
      tools: self.tools.length,
      exports: self.exports.length,
      architecture: self.architecture,
      featureCount: self.features.filter(f => f.present).length,
    };

    // Step 3: Gap analysis
    const gaps = gapAnalysis(report.project.scan, self);
    report.gaps = gaps;

    // Step 4: Extract patterns
    const patterns = extractPatterns(project.path);
    const patternPath = savePatterns(project.name, patterns);
    report.patternsSaved = patternPath;

    // Step 5: Generate code for each gap (up to 8 per cycle)
    const maxGens = Math.min(gaps.length, 8);
    for (let i = 0; i < maxGens; i++) {
      try {
        const gap = gaps[i];
        const generated = generateModule(gap, patterns);
        if (generated.filePath) {
          report.generated.push({
            gap: gap.feature,
            file: generated.filePath,
            toolName: generated.toolName || generated.moduleName,
          });
        }
      } catch (e) {
        report.errors.push({ phase: "generate", feature: gaps[i].feature, error: e.message });
      }
    }

    // Step 6: Validate generated code
    for (const gen of report.generated) {
      try {
        if (gen.file && fs.existsSync(gen.file)) {
          execSync(`node --check "${gen.file}"`, { encoding: "utf-8", timeout: 10000 });
          report.applied.push({ file: gen.file, status: "valid" });
        }
      } catch (e) {
        report.errors.push({ phase: "validate", file: gen.file, error: e.stderr?.slice(0, 200) || e.message });
      }
    }

    // Step 7: Auto-apply validated modules — copy to learned + register
    if (report.applied.length > 0) {
      try {
        const applyResults = autoApplyGenerated();
        report.autoApplied = applyResults;
      } catch (e) {
        report.errors.push({ phase: "auto-apply", error: e.message });
      }
    }

    // Save full report to disk
    report.elapsed = Date.now() - startTime;
    const st = loadState();
    st.self_improve.push({
      target,
      ts: report.started,
      elapsed: report.elapsed,
      gaps: gaps.length,
      generated: report.generated.length,
      validated: report.applied.length,
      errors: report.errors.length,
    });
    st.imported_features.push(...report.generated.map(g => g.toolName));
    // Trim history
    if (st.self_improve.length > 20) st.self_improve = st.self_improve.slice(-20);
    if (st.imported_features.length > 100) st.imported_features = st.imported_features.slice(-100);
    saveState(st);

    return report;
  } catch (e) {
    report.elapsed = Date.now() - startTime;
    report.errors.push({ phase: "overall", error: e.message });
    const st = loadState();
    st.self_improve.push({ target, ts: report.started, elapsed: report.elapsed, error: e.message });
    saveState(st);
    return report;
  }
}

/**
 * Quick self-scan: show what Phantom knows about itself and any pending gaps.
 */
export function selfImproveStatus() {
  const st = loadState();
  const self = analyzeSelf();
  const patterns = loadAllPatterns();
  const learnedModulesDir = GENERATED_DIR;

  return {
    generation: st.generation,
    cyclesRun: st.self_improve?.length || 0,
    featuresImported: st.imported_features || [],
    patternsLearned: Object.keys(patterns),
    pendingImprovements: st.self_improve?.filter(s => s.error)?.length || 0,
    selfOverview: {
      tools: self.tools.length,
      exports: self.exports.length,
      features: self.features.filter(f => f.present).length,
      gaps: self.features.filter(f => !f.present).map(f => f.name),
      architecture: self.architecture,
    },
    generatedFiles: (() => {
      if (!fs.existsSync(learnedModulesDir)) return [];
      return fs.readdirSync(learnedModulesDir).filter(f => f.endsWith(".mjs"));
    })(),
  };
}

// ── Utility ───────────────────────────────────────────────

function camelCase(str) {
  return str
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : "")
    .replace(/^(.)/, (c) => c.toLowerCase());
}

// ── 8. AUTO-APPLY — register generated modules at runtime ──
// Copies generated → learned, then hot-loads into hackerTools

export function autoApplyGenerated() {
  const results = [];
  if (!fs.existsSync(GENERATED_DIR)) return results;
  const files = fs.readdirSync(GENERATED_DIR).filter(f => f.endsWith(".mjs"));
  ensureDir(LEARNED_MODULES_DIR);

  for (const f of files) {
    const src = resolve(GENERATED_DIR, f);
    const dst = resolve(LEARNED_MODULES_DIR, f);
    const toolName = f.replace(/\.mjs$/, "");

    // Validate before applying
    try {
      execSync(`node --check "${src}"`, { encoding: "utf-8", timeout: 10000 });
    } catch (e) {
      results.push({ file: f, status: "syntax_error", error: e.stderr?.slice(0, 100) });
      try { fs.unlinkSync(src); } catch {}
      continue;
    }

    // Copy to learned
    fs.copyFileSync(src, dst);
    results.push({ file: f, status: "applied", toolName });
  }

  // Update evolution state
  const st = loadState();
  st.generation++;
  st.last_evolve = new Date().toISOString();
  saveState(st);

  return results;
}

// ── 10. SELF-EVOLVE — run improvement cycles against Phantom itself ──

export function analyzeSelfGaps() {
  const self = analyzeSelf();
  const gaps = [];

  // Architecture gaps
  if (!self.architecture.moduleCount) gaps.push({ area: "architecture", issue: "Module count unknown", priority: "low" });

  // Check what Phantom might want from its own patterns
  const ownDir = PHANTOM_DIR;
  if (fs.existsSync(ownDir)) {
    const srcFiles = fs.readdirSync(ownDir).filter(f => f.endsWith(".mjs"));
    for (const f of srcFiles) {
      try {
        const content = fs.readFileSync(resolve(ownDir, f), "utf-8");
        // Detect external tool mentions
        const extTools = content.match(/execSync\(`(\w+)/g);
        if (extTools) {
          for (const t of extTools) {
            const name = t.replace(/execSync\(`/, "");
            if (!self.tools.includes(name)) {
              gaps.push({ area: "missing_wrapper", issue: name, priority: "medium", source: f });
            }
          }
        }
      } catch {}
    }
  }

  return gaps;
}

export async function selfEvolve() {
  const startTime = Date.now();
  const report = {
    target: "self",
    started: new Date().toISOString(),
    generated: [],
    applied: [],
    errors: [],
  };

  try {
    // 1. Scan self
    const self = analyzeSelf();
    report.selfTools = self.tools.length;

    // 2. Find own gaps — detect external binaries referenced but not wrapped
    const gaps = analyzeSelfGaps();
    report.gapsFound = gaps.length;

    // 3. Generate wrappers for missing binaries
    for (const gap of gaps) {
      if (gap.area === "missing_wrapper") {
        try {
          const gen = generateTool(gap.issue, `Auto-detected missing wrapper from ${gap.source}`);
          if (gen.filePath) {
            report.generated.push({ tool: gap.issue, file: gen.filePath });
          }
        } catch (e) {
          report.errors.push({ phase: "generate", tool: gap.issue, error: e.message });
        }
      }
    }

    // 4. Auto-apply any generated code
    if (report.generated.length > 0) {
      const applyResults = autoApplyGenerated();
      report.applied = applyResults;
    }

    // 5. Update state
    report.elapsed = Date.now() - startTime;
    const st = loadState();
    st.self_improve.push({
      target: "self",
      ts: report.started,
      elapsed: report.elapsed,
      gaps: gaps.length,
      generated: report.generated.length,
      applied: report.applied.length,
      errors: report.errors.length,
    });
    saveState(st);

    return report;
  } catch (e) {
    report.elapsed = Date.now() - startTime;
    report.errors.push({ phase: "overall", error: e.message });
    return report;
  }
}

// ── 11. CONTINUOUS EVOLUTION — schedule + health ──

export function scheduleAutoEvolve(intervalMs = 3600000) {
  // intervalMs = default 1 hour
  const st = loadState();
  st.scheduledInterval = intervalMs;
  st.nextScheduledEvolve = Date.now() + intervalMs;
  saveState(st);
  return { ok: true, nextRun: new Date(st.nextScheduledEvolve).toISOString(), intervalMs };
}

export function getScheduledEvolve() {
  const st = loadState();
  if (!st.nextScheduledEvolve) return { scheduled: false };
  return {
    scheduled: true,
    nextRun: new Date(st.nextScheduledEvolve).toISOString(),
    intervalMs: st.scheduledInterval,
    due: Date.now() >= st.nextScheduledEvolve,
  };
}

export async function checkAndEvolve() {
  const sched = getScheduledEvolve();
  if (!sched.due) return { skipped: "not due yet", nextRun: sched.nextRun };
  return await selfEvolve();
}

// ── 12. READ ANY FILE — for self-editing context ──

export function readSelfSource(filePath) {
  const fullPath = resolve(PHANTOM_DIR, filePath);
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    return {
      path: fullPath,
      lines: lines.length,
      size: content.length,
      content: content.slice(0, 50000),
      truncated: content.length > 50000,
    };
  } catch (e) {
    return { error: e.message };
  }
}

export function editSelfFile(filePath, oldString, newString) {
  const fullPath = resolve(PHANTOM_DIR, filePath);
  try {
    let content = fs.readFileSync(fullPath, "utf-8");
    if (!content.includes(oldString)) {
      return { ok: false, error: "old_string not found in file" };
    }
    content = content.replace(oldString, newString);
    fs.writeFileSync(fullPath, content, "utf-8");
    return { ok: true, path: fullPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
