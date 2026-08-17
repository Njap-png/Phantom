import http from "http";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { hackerTools } from "../core/hacker-tools.js";
import { readFile, writeFile } from "fs/promises";

const REPORTS_DIR = resolve(homedir(), ".config", "phantom", "reports");
const PLAYBOOKS_DIR = resolve(homedir(), ".config", "phantom", "playbooks");
const SESSIONS_DIR = resolve(homedir(), ".config", "phantom", "sessions");

const HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phantom Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#c8d6e5;font-family:'Cascadia Code','Fira Code','JetBrains Mono',monospace;font-size:13px;line-height:1.5;min-height:100vh}
header{background:linear-gradient(135deg,#0f0f1a,#1a1a2e);border-bottom:1px solid #00ff8844;padding:12px 20px;display:flex;justify-content:space-between;align-items:center}
header h1{color:#00ff88;font-size:18px;letter-spacing:1px}
header span{color:#5a6a7a;font-size:11px}
.tabs{display:flex;gap:0;background:#0f0f1a;border-bottom:1px solid #1a1a2e;padding:0 20px}
.tab{padding:10px 20px;cursor:pointer;color:#5a6a7a;border-bottom:2px solid transparent;transition:.2s;font-size:12px}
.tab:hover{color:#00ff88}
.tab.active{color:#00ff88;border-bottom-color:#00ff88}
.content{padding:16px 20px;display:none}
.content.active{display:block}
.search-box{width:100%;padding:8px 12px;background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;color:#c8d6e5;font-family:inherit;font-size:12px;margin-bottom:16px;outline:none;transition:.2s}
.search-box:focus{border-color:#00ff8844}
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.tool-card{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:10px 12px;cursor:pointer;transition:.2s}
.tool-card:hover{border-color:#00ff8844;background:#12122a}
.tool-card .name{color:#00ff88;font-size:12px;font-weight:700}
.tool-card .desc{color:#5a6a7a;font-size:10px;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tool-detail{display:none;margin-top:8px}
.tool-detail.open{display:block}
.tool-detail input{width:100%;padding:6px 10px;background:#05050a;border:1px solid #1a2a1a;border-radius:3px;color:#c8d6e5;font-family:inherit;font-size:12px;margin-bottom:6px;outline:none}
.tool-detail input:focus{border-color:#00ff8844}
.tool-detail button{background:#00ff8822;color:#00ff88;border:1px solid #00ff8844;padding:4px 14px;border-radius:3px;cursor:pointer;font-family:inherit;font-size:11px}
.tool-detail button:hover{background:#00ff8844}
.output{background:#05050a;border:1px solid #1a1a2e;border-radius:4px;padding:12px;margin-top:12px;max-height:400px;overflow:auto;font-size:11px;white-space:pre-wrap;word-break:break-all;display:none}
.output.show{display:block}
.output .prompt{color:#00ff8844}
.output .error{color:#ff4444}
.output .info{color:#5a7aff}
.output .success{color:#44ff88}
.playbook-item{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:12px;margin-bottom:8px;cursor:pointer}
.playbook-item:hover{border-color:#00ff8844}
.playbook-item .name{color:#ffaa00;font-size:13px}
.playbook-item .desc{color:#5a6a7a;font-size:11px;margin:4px 0}
.playbook-item .steps{color:#3a4a5a;font-size:10px}
.playbook-detail{display:none;margin-top:8px;padding:8px;background:#05050a;border-radius:3px}
.playbook-detail.open{display:block}
.playbook-detail input{width:100%;padding:6px 10px;background:#05050a;border:1px solid #3a2a00;border-radius:3px;color:#c8d6e5;font-family:inherit;font-size:12px;margin:4px 0;outline:none}
.playbook-detail input:focus{border-color:#ffaa0044}
.playbook-detail button{background:#ffaa0022;color:#ffaa00;border:1px solid #ffaa0044;padding:4px 14px;border-radius:3px;cursor:pointer;font-family:inherit;font-size:11px}
.report-item{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:12px;margin-bottom:6px;cursor:pointer}
.report-item:hover{border-color:#5a7aff44}
.report-item .name{color:#5a7aff;font-size:12px}
.report-item .size{color:#3a4a5a;font-size:10px;margin-left:8px}
#reportViewer{display:none;background:#05050a;border:1px solid #1a1a2e;border-radius:4px;padding:16px;margin-top:8px;max-height:500px;overflow:auto;white-space:pre-wrap;font-size:11px}
#reportViewer.show{display:block}
.loading{color:#5a6a7a;text-align:center;padding:20px;font-size:12px}
.status-bar{background:#0f0f1a;border-top:1px solid #1a1a2e;padding:6px 20px;font-size:10px;color:#3a4a5a;display:flex;justify-content:space-between}
.status-bar .ok{color:#44ff88}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:#0a0a0f}
::-webkit-scrollbar-thumb{background:#1a1a2e;border-radius:2px}
@media(max-width:600px){.tool-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}.content{padding:10px 12px}header{padding:10px 12px}}
</style></head>
<body>
<header><h1>🔮 PHANTOM</h1><span id="status">● offline</span></header>
<div class="tabs">
<div class="tab active" onclick="switchTab('tools')">🛠 Tools</div>
<div class="tab" onclick="switchTab('playbooks')">📋 Playbooks</div>
<div class="tab" onclick="switchTab('reports')">📄 Reports</div>
</div>

<div id="tools" class="content active">
<input class="search-box" id="search" placeholder="Search tools..." oninput="filterTools(this.value)">
<div class="tool-grid" id="toolGrid"><div class="loading">Loading tools...</div></div>
<div id="output" class="output"></div>
</div>

<div id="playbooks" class="content">
<div id="playbookList"><div class="loading">Loading playbooks...</div></div>
</div>

<div id="reports" class="content">
<div id="reportList"><div class="loading">Loading reports...</div></div>
<div id="reportViewer"></div>
</div>

<div class="status-bar"><span id="toolCount">—</span><span id="connStatus" class="ok">● connected</span></div>

<script>
const BASE = '';
let tools = [];

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

// ── Tools ──
async function loadTools() {
  try {
    const names = await api('/api/tools');
    tools = names;
    document.getElementById('toolCount').textContent = names.length + ' tools';
    renderTools(names);
  } catch (e) {
    document.getElementById('toolGrid').innerHTML = '<div class="error">Failed to load tools: ' + e.message + '</div>';
  }
}

function renderTools(names) {
  const grid = document.getElementById('toolGrid');
  grid.innerHTML = names.map((name, i) => \`
    <div class="tool-card" onclick="toggleTool(\${i})">
      <div class="name">@\${name}</div>
      <div class="desc">\${name.replace(/_/g,' ')}</div>
      <div class="tool-detail" id="td\${i}">
        <input id="tinput\${i}" placeholder="Enter args..." onkeydown="if(event.key==='Enter')runTool('\${name}',\${i})">
        <button onclick="runTool('\${name}',\${i})">▶ Run</button>
      </div>
    </div>
  \`).join('');
}

function toggleTool(i) {
  const d = document.getElementById('td' + i);
  d.classList.toggle('open');
}

async function runTool(name, i) {
  const input = document.getElementById('tinput' + i).value;
  const out = document.getElementById('output');
  out.classList.add('show');
  out.innerHTML += '<span class="prompt">$</span> @' + name + '|' + input + '\\n';
  out.scrollTop = out.scrollHeight;
  try {
    const r = await api('/api/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tool:name, args:input}) });
    out.innerHTML += r.result + '\\n\\n';
  } catch(e) { out.innerHTML += '<span class="error">[Error] ' + e.message + '</span>\\n\\n'; }
  out.scrollTop = out.scrollHeight;
}

function filterTools(q) {
  const cards = document.querySelectorAll('.tool-card');
  cards.forEach((c, i) => {
    const name = tools[i] || '';
    c.style.display = name.includes(q.toLowerCase()) ? '' : 'none';
  });
}

// ── Playbooks ──
async function loadPlaybooks() {
  const div = document.getElementById('playbookList');
  try {
    const list = await api('/api/playbooks');
    if (!list.length) { div.innerHTML = '<div style="color:#5a6a7a">No playbooks found. Create one with playbook_create tool.</div>'; return; }
    div.innerHTML = list.map((pb, i) => \`
      <div class="playbook-item" onclick="togglePb(\${i})">
        <div class="name">📋 \${pb.name}</div>
        <div class="desc">\${pb.description || ''}</div>
        <div class="steps">\${pb.steps} steps</div>
        <div class="playbook-detail" id="pd\${i}">
          <div style="color:#5a6a7a;font-size:10px;margin-bottom:4px">Variables: \${(pb.vars||['target']).join(', ')}</div>
          <input id="pbvars\${i}" placeholder="target=example.com" value="target=">
          <button onclick="runPb('\${pb.name}',\${i})">▶ Run Playbook</button>
        </div>
      </div>
    \`).join('');
  } catch(e) { div.innerHTML = '<div class="error">' + e.message + '</div>'; }
}

function togglePb(i) { document.getElementById('pd'+i).classList.toggle('open'); }

async function runPb(name, i) {
  const vars = document.getElementById('pbvars'+i).value;
  const out = document.getElementById('output');
  out.classList.add('show');
  out.innerHTML += '<span class="prompt">$</span> 📋 playbook_run|' + name + '|' + vars + '\\n';
  out.scrollTop = out.scrollHeight;
  try {
    const r = await api('/api/playbook/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, vars}) });
    out.innerHTML += r.result + '\\n\\n';
  } catch(e) { out.innerHTML += '<span class="error">[Error] ' + e.message + '</span>\\n\\n'; }
  out.scrollTop = out.scrollHeight;
}

// ── Reports ──
async function loadReports() {
  const div = document.getElementById('reportList');
  try {
    const list = await api('/api/reports');
    if (!list.length) { div.innerHTML = '<div style="color:#5a6a7a">No reports yet. Run vuln_scan or recon to generate one.</div>'; return; }
    div.innerHTML = list.map((r, i) => \`
      <div class="report-item" onclick="viewReport('\${r.name}')">
        <span class="name">📄 \${r.name}</span><span class="size">\${r.size}</span>
      </div>
    \`).join('');
  } catch(e) { div.innerHTML = '<div class="error">' + e.message + '</div>'; }
}

async function viewReport(name) {
  const v = document.getElementById('reportViewer');
  try {
    const r = await api('/api/report/' + encodeURIComponent(name));
    v.textContent = r.content;
    v.classList.add('show');
  } catch(e) { v.textContent = 'Error: ' + e.message; v.classList.add('show'); }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
  document.querySelector('.tab[onclick*="' + name + '"]').classList.add('active');
  document.getElementById(name).classList.add('active');
  if (name === 'playbooks') loadPlaybooks();
  if (name === 'reports') loadReports();
}

loadTools();
</script></body></html>`;

export function startGui(port: number = parseInt(process.env.PHANTOM_PORT || "8080")): void {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    try {
      if (path === "/api/tools") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(Object.keys(hackerTools).sort()));
        return;
      }

      if (path === "/api/run" && req.method === "POST") {
        const body = await readBody(req);
        const { tool, args } = JSON.parse(body);
        const fn = hackerTools[tool];
        if (!fn) { res.writeHead(404); res.end(JSON.stringify({ error: "Tool not found" })); return; }
        const result = await fn.execute(args);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result }));
        return;
      }

      if (path === "/api/playbooks") {
        const names: any[] = [];
        if (existsSync(PLAYBOOKS_DIR)) {
          for (const f of readdirSync(PLAYBOOKS_DIR).filter((f: string) => f.endsWith(".json"))) {
            const pb = JSON.parse(readFileSync(resolve(PLAYBOOKS_DIR, f), "utf-8"));
            names.push({ name: pb.name, description: pb.description, steps: pb.steps?.length || 0, vars: pb.variables });
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(names));
        return;
      }

      if (path === "/api/playbook/run" && req.method === "POST") {
        const body = await readBody(req);
        const { name, vars } = JSON.parse(body);
        const fn = hackerTools["playbook_run"];
        if (!fn) { res.writeHead(404); res.end(JSON.stringify({ error: "playbook_run tool not found" })); return; }
        const input = vars ? `${name}|${vars}` : name;
        const result = await fn.execute(input);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result }));
        return;
      }

      if (path === "/api/reports") {
        const reports: any[] = [];
        if (existsSync(REPORTS_DIR)) {
          for (const f of readdirSync(REPORTS_DIR).filter((f: string) => f.endsWith(".md") || f.endsWith(".txt"))) {
            const stat = existsSync(resolve(REPORTS_DIR, f)) ? "" : "";
            reports.push({ name: f, size: formatSize(readFileSync(resolve(REPORTS_DIR, f)).length) });
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(reports.sort((a, b) => a.name.localeCompare(b.name))));
        return;
      }

      if (path.startsWith("/api/report/")) {
        const name = decodeURIComponent(path.slice(12));
        const fp = resolve(REPORTS_DIR, name);
        if (!existsSync(fp)) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return; }
        const content = readFileSync(fp, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content }));
        return;
      }

      // Serve HTML for everything else
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML);
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  server.listen(port, () => {
    console.log(`\n  🌐 Phantom Dashboard: http://localhost:${port}\n`);
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c: string) => b += c);
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / 1048576).toFixed(1) + "MB";
}
