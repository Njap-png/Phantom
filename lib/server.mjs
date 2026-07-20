// Phantom — API server + GUI dashboard
// Extracted from phantom.mjs for cleaner module structure

import http from "http";
import fs from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { DASHBOARD_HTML } from "./dashboard.mjs";
import { log } from "./logger.mjs";

/** Shared deps — passed in at setup time */
let hackerTools = null;
let __r = null;
let REPORTS_DIR = "";

export function initApiDeps(tools, runtime, reportsDir) {
  hackerTools = tools;
  __r = runtime;
  REPORTS_DIR = reportsDir;
}

// ── REST API Handler ──────────────────────────────────────

// Agent reference for chat — set by dashboard/server startup
let chatAgent = null;
let chatAgentManager = null;
let chatBus = null;

export function setChatAgent(agent, manager, bus) {
  chatAgent = agent;
  chatAgentManager = manager;
  chatBus = bus || null;
}
const json = (res, data, code = 200) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};
const parseBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(b));
      } catch {
        resolve({});
      }
    });
  });

export async function handleApiRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));

  try {
    // GET /api — list all
    if (url.pathname === "/api" || url.pathname === "/api/") {
      return json(res, {
        ok: true,
        tools: Object.keys(hackerTools).sort(),
        version: "0.2.0",
        docs: "/api/tools, /api/run, /api/info, /api/playbooks, /api/reports",
      });
    }
    // GET /api/tools — list tool names
    if (url.pathname === "/api/tools") {
      return json(res, {
        ok: true,
        count: Object.keys(hackerTools).length,
        tools: Object.keys(hackerTools).sort(),
      });
    }
    // GET /api/info — detailed tool info
    if (url.pathname === "/api/info") {
      const entries = Object.entries(hackerTools)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name]) => ({ name }));
      return json(res, { ok: true, count: entries.length, tools: entries });
    }
    // GET /api/tool/:name — tool metadata
    const toolMatch = url.pathname.match(/^\/api\/tool\/(.+)$/);
    if (toolMatch) {
      const name = decodeURIComponent(toolMatch[1]);
      if (!hackerTools[name]) return json(res, { ok: false, error: "Tool not found" }, 404);
      return json(res, { ok: true, name });
    }
    // POST /api/run — execute tool
    if (url.pathname === "/api/run" && req.method === "POST") {
      const { tool, args } = await parseBody(req);
      if (!tool || !hackerTools[tool])
        return json(res, { ok: false, error: `Tool "${tool}" not found` }, 404);
      const result = await hackerTools[tool](args || "");
      return json(res, { ok: true, tool, args: args || "", result });
    }
    // GET /api/run?tool=...&args=... — execute via GET
    if (url.pathname === "/api/run" && req.method === "GET") {
      const tool = url.searchParams.get("tool");
      const args = url.searchParams.get("args") || "";
      if (!tool || !hackerTools[tool])
        return json(res, { ok: false, error: `Tool "${tool}" not found` }, 404);
      const result = await hackerTools[tool](args);
      return json(res, { ok: true, tool, args, result });
    }
    // GET /api/playbooks — list playbooks
    if (url.pathname === "/api/playbooks") {
      const pbDir = resolve(homedir(), ".config", "phantom", "playbooks");
      const names = [];
      if (fs.existsSync(pbDir)) {
        for (const f of fs.readdirSync(pbDir).filter((f) => f.endsWith(".json"))) {
          const pb = JSON.parse(fs.readFileSync(resolve(pbDir, f), "utf-8"));
          names.push({
            name: pb.name,
            description: pb.description,
            steps: (pb.steps || []).length,
            vars: pb.variables,
          });
        }
      }
      return json(res, { ok: true, playbooks: names });
    }
    // POST /api/playbook/run — run a playbook
    if (url.pathname === "/api/playbook/run" && req.method === "POST") {
      const { name, vars } = await parseBody(req);
      if (!hackerTools.playbook_run)
        return json(res, { ok: false, error: "playbook_run tool not loaded" }, 404);
      const result = await hackerTools.playbook_run(vars ? name + "|" + vars : name);
      return json(res, { ok: true, name, result });
    }
    // GET /api/playbook/run?name=...&vars=... — run via GET
    if (url.pathname === "/api/playbook/run" && req.method === "GET") {
      const name = url.searchParams.get("name");
      const vars = url.searchParams.get("vars") || "";
      if (!name) return json(res, { ok: false, error: "?name= required" }, 400);
      if (!hackerTools.playbook_run)
        return json(res, { ok: false, error: "playbook_run not loaded" }, 404);
      const result = await hackerTools.playbook_run(vars ? name + "|" + vars : name);
      return json(res, { ok: true, name, result });
    }
    // GET /api/reports — list reports
    if (url.pathname === "/api/reports") {
      const reports = [];
      if (fs.existsSync(REPORTS_DIR)) {
        for (const f of fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".md") || f.endsWith(".txt"))) {
          const s = fs.readFileSync(resolve(REPORTS_DIR, f)).length;
          reports.push({ name: f, size: s < 1024 ? s + "B" : (s / 1024).toFixed(1) + "KB" });
        }
      }
      return json(res, { ok: true, reports });
    }
    // GET /api/report/:name — view a report
    if (url.pathname.startsWith("/api/report/")) {
      const name = decodeURIComponent(url.pathname.slice(12));
      const fp = resolve(REPORTS_DIR, name);
      if (!fs.existsSync(fp)) return json(res, { ok: false, error: "Report not found" }, 404);
      return json(res, { ok: true, name, content: fs.readFileSync(fp, "utf-8") });
    }
    // GET /api/health — health check
    if (url.pathname === "/api/health") {
      return json(res, {
        ok: true,
        status: "running",
        tools: Object.keys(hackerTools).length,
        chat: chatAgent ? `${chatAgent.name} (lvl ${chatAgent.evolutionLevel})` : false,
        pid: process.pid,
        uptime: process.uptime().toFixed(0) + "s",
      });
    }
    // POST /api/chat — send message to agent
    if (url.pathname === "/api/chat" && req.method === "POST") {
      if (!chatAgent) return json(res, { ok: false, error: "No chat agent running" }, 503);
      const { message } = await parseBody(req);
      if (!message) return json(res, { ok: false, error: "message required" }, 400);
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Agent timeout")), 90000);
        const handler = ({ agent: a, text }) => {
          if (a && a.id === chatAgent.id) {
            clearTimeout(timeout);
            try { if (chatBus) chatBus.off("agent:msg", handler); } catch {}
            resolve(text);
          }
        };
        if (chatBus) chatBus.on("agent:msg", handler);
        chatAgent.receive("user", message).catch(err => {
          clearTimeout(timeout);
          try { if (chatBus) chatBus.off("agent:msg", handler); } catch {}
          reject(err);
        });
      });
      return json(res, { ok: true, response, level: chatAgent.evolutionLevel });
    }
    // POST /api/chat/reset — reset agent conversation
    if (url.pathname === "/api/chat/reset" && req.method === "POST") {
      if (!chatAgent) return json(res, { ok: false, error: "No chat agent" }, 503);
      chatAgent.memory = [];
      chatAgent.evolutionLevel = 1;
      return json(res, { ok: true });
    }
    return json(res, { ok: false, error: "Not found" }, 404);
  } catch (e) {
    return json(res, { ok: false, error: e.message }, 500);
  }
}

export function startApiServer(port) {
  initApiDeps(hackerTools, __r, REPORTS_DIR); // keep refs
  const server = http.createServer((req, res) => handleApiRequest(req, res));
  server.listen(port, () => {
    const clickable = `\x1b]8;;http://localhost:${port}\x07http://localhost:${port}\x1b]8;;\x07`;
    log.cli(`  ◆ Phantom API: ${clickable}  (--api)`);
  });
  return server;
}

export function startGuiDashboard(port) {
  initApiDeps(hackerTools, __r, REPORTS_DIR);
  const html = DASHBOARD_HTML.replace(/PORT/g, port);
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api")) return handleApiRequest(req, res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  const url = `http://localhost:${port}`;
  server.on("error", e => {
    if (e.code === "EADDRINUSE") {
      log.warn(`Port ${port} in use — killing previous process...`);
      try {
        execSync(`lsof -ti:${port} | xargs kill 2>/dev/null`, { timeout: 3000 });
        setTimeout(() => {
          server.close();
          server.listen(port);
        }, 500);
      } catch { /* ignore kill failures */ }
    }
  });
  server.listen(port, () => {
    const clickable = `\x1b]8;;${url}\x07${url}\x1b]8;;\x07`;
    log.cli(`\n  ◈ Phantom Dashboard: ${clickable}`);
    log.cli(`  ⚡ Ctrl+Click or tap to open in browser\n`);
    try {
      const isTermux = process.env.PREFIX === "/data/data/com.termux/files/usr";
      execSync(isTermux ? `termux-open-url ${url}` : `xdg-open ${url}`, {
        timeout: 2000, stdio: "ignore",
      });
    } catch { /* browser may not be available */ }
  });
  return server;
}
