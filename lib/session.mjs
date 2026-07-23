// Phantom — Session persistence + knowledge graph
// Saves/restores minimal state across restarts.
// Linked knowledge: tool ↔ book/CVE cross-reference.

import fs from "fs";
import { resolve } from "path";
import { MEMORY_DIR } from "./config.mjs";

const SESSION_FILE = resolve(MEMORY_DIR, "session.json");
const GRAPH_FILE = resolve(MEMORY_DIR, "graph.json");

// ── Session ──
export function saveSession(data) {
  try {
    const dir = MEMORY_DIR;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = loadSession();
    const merged = { ...existing, ...data, savedAt: Date.now() };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(merged, null, 2), "utf-8");
    return true;
  } catch { return false; }
}

export function loadSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return {};
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  } catch { return {}; }
}

export function clearSession() {
  try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch {}
}

// ── Knowledge Graph ──
// Links tools to related books/CVEs/techniques
// Format: { "tool_name": { books: ["book1", "book2"], cves: ["CVE-2025-..."], tags: ["xss", "sqli"] } }

export function loadGraph() {
  try {
    if (!fs.existsSync(GRAPH_FILE)) return {};
    return JSON.parse(fs.readFileSync(GRAPH_FILE, "utf-8"));
  } catch { return {}; }
}

export function saveGraph(graph) {
  try {
    const dir = MEMORY_DIR;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2), "utf-8");
    return true;
  } catch { return false; }
}

export function linkTool(toolName, { books = [], cves = [], tags = [] } = {}) {
  const graph = loadGraph();
  if (!graph[toolName]) graph[toolName] = { books: [], cves: [], tags: [] };
  if (books.length) graph[toolName].books = [...new Set([...graph[toolName].books, ...books])];
  if (cves.length) graph[toolName].cves = [...new Set([...graph[toolName].cves, ...cves])];
  if (tags.length) graph[toolName].tags = [...new Set([...graph[toolName].tags, ...tags])];
  saveGraph(graph);
  return graph[toolName];
}

export function queryGraph(query) {
  const graph = loadGraph();
  const q = query.toLowerCase();
  const results = [];
  for (const [tool, info] of Object.entries(graph)) {
    if (tool.includes(q) || info.tags?.some(t => t.includes(q)) || info.cves?.some(c => c.includes(q)) || info.books?.some(b => b.includes(q))) {
      results.push({ tool, ...info });
    }
  }
  return results;
}

// ── Auto-link from books directory ──
// Scans books/ for filenames matching tool categories
export function autoLinkFromBooks() {
  const booksDir = resolve(MEMORY_DIR, "../books");
  if (!fs.existsSync(booksDir)) return 0;
  const files = fs.readdirSync(booksDir).filter(f => f.endsWith(".txt"));
  const graph = loadGraph();
  let linked = 0;
  for (const file of files) {
    const name = file.replace(".txt", "").toLowerCase();
    // Map book names to tool tags
    const tagMap = {
      sql_injection: ["sql_detect", "sqlmap", "sqli", "sql_injection"],
      xss: ["xss_scan", "xss"],
      ssrf: ["ssrf", "ssrf_test"],
      nmap: ["nmap", "port_scan"],
      cve: ["cve_search", "searchsploit"],
    };
    for (const [tag, tools] of Object.entries(tagMap)) {
      if (name.includes(tag) || tag.includes(name)) {
        for (const t of tools) {
          if (!graph[t]) graph[t] = { books: [], cves: [], tags: [] };
          if (!graph[t].books.includes(file)) { graph[t].books.push(file); linked++; }
          if (!graph[t].tags.includes(tag)) { graph[t].tags.push(tag); }
        }
      }
    }
  }
  if (linked > 0) saveGraph(graph);
  return linked;
}
