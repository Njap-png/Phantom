import http from "http";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { hackerTools } from "../core/hacker-tools.js";
// WebSocket imported dynamically to avoid build issues on USB
let WebSocketServer;
let WebSocket;
try {
    const ws = require("ws");
    WebSocketServer = ws.WebSocketServer;
    WebSocket = ws.WebSocket;
}
catch { }
const REPORTS_DIR = resolve(homedir(), ".config", "phantom", "reports");
const PLAYBOOKS_DIR = resolve(homedir(), ".config", "phantom", "playbooks");
const SESSIONS_DIR = resolve(homedir(), ".config", "phantom", "sessions");
const MISSIONS_DIR = resolve(homedir(), ".config", "phantom", "missions");
// WebSocket clients for real-time updates
const wsClients = new Set();
function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
}
// Broadcast helpers for specific events
function broadcastHealth() {
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    broadcast({
        type: "health",
        data: {
            status: "ok",
            uptime: Math.floor(uptime),
            uptimeHuman: formatUptime(uptime),
            memory: {
                rss: Math.round(mem.rss / 1024 / 1024) + "MB",
                heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB",
                heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + "MB",
                external: Math.round(mem.external / 1024 / 1024) + "MB"
            },
            pid: process.pid,
            platform: process.platform,
            nodeVersion: process.version,
            usbMounted: existsSync("/root/usb/Phantom"),
            timestamp: new Date().toISOString()
        }
    });
}
function broadcastMissions() {
    const missions = [];
    if (existsSync(MISSIONS_DIR)) {
        for (const f of readdirSync(MISSIONS_DIR).filter((f) => f.endsWith(".json"))) {
            const m = JSON.parse(readFileSync(resolve(MISSIONS_DIR, f), "utf-8"));
            missions.push({
                id: m.id,
                programName: m.programName,
                programHandle: m.programHandle,
                status: m.status,
                createdAt: m.createdAt,
                updatedAt: m.updatedAt,
                inScopeCount: m.scope?.inScope?.length || 0,
                objectives: m.objectives?.length || 0
            });
        }
    }
    missions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    broadcast({ type: "missions", data: missions });
}
function broadcastSchedules() {
    const schedules = globalThis.__phantomSchedules || [];
    broadcast({
        type: "schedules",
        data: schedules.map((s) => ({
            id: s.id,
            tool: s.tool,
            target: s.target,
            interval: s.interval,
            nextAt: s.nextAt,
            nextAtHuman: new Date(s.nextAt).toLocaleString()
        }))
    });
}
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

/* Monitoring specific styles */
.monitor-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.monitor-card{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:16px}
.monitor-card h3{color:#00ff88;font-size:13px;margin-bottom:12px;border-bottom:1px solid #1a1a2e;padding-bottom:8px}
.monitor-card .stat{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #0d0d14}
.monitor-card .stat:last-child{border-bottom:none}
.monitor-card .stat-label{color:#5a6a7a;font-size:11px}
.monitor-card .stat-value{color:#c8d6e5;font-size:11px;font-weight:500}
.monitor-card .stat-value.ok{color:#44ff88}
.monitor-card .stat-value.warn{color:#ffaa00}
.monitor-card .stat-value.error{color:#ff4444}
.monitor-card .stat-value.running{color:#00ff88}

.mission-list{max-height:400px;overflow:auto}
.mission-item{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:10px;margin-bottom:8px;cursor:pointer;transition:.2s}
.mission-item:hover{border-color:#00ff8844}
.mission-item .header{display:flex;justify-content:space-between;margin-bottom:6px}
.mission-item .name{color:#00ff88;font-size:12px;font-weight:700}
.mission-item .status{font-size:10px;padding:2px 6px;border-radius:3px}
.mission-item .status.planning{background:#5a7aff22;color:#5a7aff}
.mission-item .status.ready{background:#ffaa0022;color:#ffaa00}
.mission-item .status.reconnaissance{background:#00ff8822;color:#00ff88}
.mission-item .status.paused{background:#ff880022;color:#ff8800}
.mission-item .status.completed{background:#44ff8822;color:#44ff88}
.mission-item .status.cancelled{background:#ff444422;color:#ff4444}
.mission-item .status.failed{background:#ff444422;color:#ff4444}
.mission-item .meta{color:#5a6a7a;font-size:10px}
.mission-item .scope{color:#3a4a5a;font-size:10px;margin-top:4px}

.schedule-item{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:10px;margin-bottom:8px}
.schedule-item .header{display:flex;justify-content:space-between;margin-bottom:6px}
.schedule-item .tool{color:#ffaa00;font-size:12px;font-weight:700}
.schedule-item .next{color:#5a6a7a;font-size:10px}
.schedule-item .target{color:#c8d6e5;font-size:11px}
.schedule-item .interval{color:#3a4a5a;font-size:10px}

.task-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.task-card{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:10px 12px;cursor:pointer;transition:.2s}
.task-card:hover{border-color:#00ff8844;background:#12122a}
.task-card .name{color:#5a7aff;font-size:11px;font-weight:700}
.task-card .category{color:#3a4a5a;font-size:9px;text-transform:uppercase}

.health-indicator{display:inline-flex;align-items:center;gap:6px}
.health-dot{width:8px;height:8px;border-radius:50%}
.health-dot.ok{background:#44ff88}
.health-dot.warn{background:#ffaa00}
.health-dot.error{background:#ff4444}

@media(max-width:600px){.tool-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}.content{padding:10px 12px}header{padding:10px 12px}.monitor-grid{grid-template-columns:1fr}}
</style></head>
<body>
<header><h1>🔮 PHANTOM</h1><span id="status"><span class="health-dot ok"></span> online</span></header>
<div class="tabs">
<div class="tab active" onclick="switchTab('tools')">🛠 Tools</div>
<div class="tab" onclick="switchTab('playbooks')">📋 Playbooks</div>
<div class="tab" onclick="switchTab('reports')">📄 Reports</div>
<div class="tab" onclick="switchTab('monitor')">📊 Monitor</div>
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

<div id="monitor" class="content">
<div class="monitor-grid">
  <div class="monitor-card">
    <h3>🖥 System Health</h3>
    <div class="stat"><span class="stat-label">Status</span><span class="stat-value ok" id="sysStatus"><span class="health-dot ok"></span> OK</span></div>
    <div class="stat"><span class="stat-label">Uptime</span><span class="stat-value" id="sysUptime">—</span></div>
    <div class="stat"><span class="stat-label">Memory</span><span class="stat-value" id="sysMemory">—</span></div>
    <div class="stat"><span class="stat-label">CPU Load</span><span class="stat-value" id="sysLoad">—</span></div>
    <div class="stat"><span class="stat-label">Disk (USB)</span><span class="stat-value" id="sysDisk">—</span></div>
    <div class="stat"><span class="stat-label">Node</span><span class="stat-value" id="sysNode">—</span></div>
    <div class="stat"><span class="stat-label">PID</span><span class="stat-value" id="sysPid">—</span></div>
    <div class="stat"><span class="stat-label">USB Mount</span><span class="stat-value ok" id="sysUsb">✓ Mounted</span></div>
    <div class="stat"><span class="stat-label">Platform</span><span class="stat-value" id="sysPlatform">—</span></div>
    <div class="stat"><span class="stat-label">Version</span><span class="stat-value" id="sysVersion">—</span></div>
    <div class="stat"><span class="stat-label">Network</span><span class="stat-value" id="sysNet">—</span></div>
    <div class="stat"><span class="stat-label">Disk I/O</span><span class="stat-value" id="sysDiskIO">—</span></div>
    <div class="stat"><span class="stat-label">Uptime (raw)</span><span class="stat-value" id="sysUptime2">—</span></div>
    <div class="stat"><span class="stat-label">Platform</span><span class="stat-value" id="sysPlatform">—</span></div>
    <div class="stat"><span class="stat-label">Version</span><span class="stat-value" id="sysVersion">—</span></div>
    <div class="stat"><span class="stat-label">PID</span><span class="stat-value" id="sysPid2">—</span></div>
  </div>

  <div class="monitor-card">
    <h3>🎯 Active Missions</h3>
    <input class="search-box" id="missionSearch" placeholder="Filter missions..." oninput="filterMissions(this.value)" style="margin-bottom:12px;padding:6px 10px;font-size:11px">
    <div class="mission-list" id="missionList"><div class="loading">Loading missions...</div></div>
  </div>

  <div class="monitor-card">
    <h3>⏰ Active Schedules</h3>
    <div id="scheduleList"><div class="loading">Loading schedules...</div></div>
  </div>

  <div class="monitor-card">
    <h3>📋 All Tasks (Searchable)</h3>
    <input class="search-box" id="taskSearch" placeholder="Search tasks..." oninput="filterTasks(this.value)" style="margin-bottom:12px;padding:6px 10px;font-size:11px">
    <div class="task-grid" id="taskGrid"><div class="loading">Loading tasks...</div></div>
  </div>
</div>
</div>

<div class="status-bar"><span id="toolCount">—</span><span id="connStatus" class="ok">● connected</span></div>

<script>
const BASE = '';
let tools = [];
let missions = [];
let tasks = [];
let ws = null;

// WebSocket connection for real-time updates
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host);
  ws.onopen = () => {
    document.getElementById('connStatus').textContent = '● connected';
    document.getElementById('connStatus').className = 'ok';
  };
  ws.onclose = () => {
    document.getElementById('connStatus').textContent = '○ disconnected';
    document.getElementById('connStatus').className = '';
    setTimeout(connectWS, 3000); // reconnect
  };
  ws.onerror = () => {
    document.getElementById('connStatus').textContent = '● error';
    document.getElementById('connStatus').className = '';
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'health') updateHealth(msg.data);
      else if (msg.type === 'missions') renderMissions(msg.data);
      else if (msg.type === 'schedules') renderSchedules(msg.data);
    } catch(e) {}
  };
}

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
  out.innerHTML += '<span class="prompt">$</span> @' + name + '|' + input + '\\\\n';
  out.scrollTop = out.scrollHeight;
  try {
    const r = await api('/api/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tool:name, args:input}) });
    out.innerHTML += r.result + '\\\\n\\\\n';
  } catch(e) { out.innerHTML += '<span class="error">[Error] ' + e.message + '</span>\\\\n\\\\n'; }
  out.scrollTop = out.scrollHeight;
}

function filterTools(q) {
  const cards = document.querySelectorAll('.tool-card');
  cards.forEach((c, i) => {
    const name = tools[i] || '';
    c.style.display = name.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
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
  out.innerHTML += '<span class="prompt">$</span> 📋 playbook_run|' + name + '|' + vars + '\\\\n';
  out.scrollTop = out.scrollHeight;
  try {
    const r = await api('/api/playbook/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, vars}) });
    out.innerHTML += r.result + '\\\\n\\\\n';
  } catch(e) { out.innerHTML += '<span class="error">[Error] ' + e.message + '</span>\\\\n\\\\n'; }
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

// ── Monitoring ──
async function loadMissions() {
  try {
    missions = await api('/api/missions');
    renderMissions(missions);
  } catch(e) { document.getElementById('missionList').innerHTML = '<div class="error">' + e.message + '</div>'; }
}

function renderMissions(list) {
  const div = document.getElementById('missionList');
  if (!list.length) { div.innerHTML = '<div style="color:#5a6a7a">No missions found.</div>'; return; }
  div.innerHTML = list.map(function(m) {
    return '<div class="mission-item" onclick="showMissionDetail(\'' + m.id + '\')">' +
      '<div class="header">' +
        '<span class="name">' + m.id + '</span>' +
        '<span class="status ' + m.status + '">' + m.status.toUpperCase() + '</span>' +
      '</div>' +
      '<div class="meta">' + m.programName + ' (' + m.programHandle + ') • Updated: ' + new Date(m.updatedAt).toLocaleString() + '</div>' +
      '<div class="scope">In-scope: ' + m.inScopeCount + ' assets • Objectives: ' + m.objectives + '</div>' +
    '</div>';
  }).join('');
}

function filterMissions(q) {
  const items = document.querySelectorAll('.mission-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(q.toLowerCase()) ? '' : 'none';
  });
}

async function showMissionDetail(missionId) {
  try {
    const m = await api('/api/missions/' + encodeURIComponent(missionId));
    if (!m) { alert('Mission not found'); return; }
    
    const detailHtml = 
      '<div class="mission-detail-panel" style="position:fixed;top:60px;right:0;bottom:0;width:500px;background:#0c0c18;border-left:1px solid #1a1a2e;z-index:100;padding:16px;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
          '<h3 style="color:#c084fc">🎯 ' + m.id + '</h3>' +
          '<button onclick="closeMissionDetail()" style="background:none;border:none;color:#5a6a7a;font-size:18px;cursor:pointer">×</button>' +
        '</div>' +
        '<div style="margin-bottom:12px">' +
          '<span class="status ' + m.status + '" style="font-size:10px;padding:2px 8px;border-radius:3px;background:' + 
            (['planning','ready'].includes(m.status) ? '#a855f722' : 
             m.status === 'paused' ? '#f8717122' : 
             m.status === 'reconnaissance' ? '#22d3ee22' : 
             m.status === 'completed' ? '#34d39922' : 
             m.status === 'cancelled' ? '#f8717122' : '#5a6a7a22') + 
            ';color:' + 
            (['planning','ready'].includes(m.status) ? '#c084fc' : 
             m.status === 'paused' ? '#f87171' : 
             m.status === 'reconnaissance' ? '#22d3ee' : 
             m.status === 'completed' ? '#34d399' : 
             m.status === 'cancelled' ? '#f87171' : '#5a6a7a') + 
          '">' + m.status.toUpperCase() + '</span>' +
        '</div>' +
        '<div style="color:#5a6a7a;font-size:11px;margin-bottom:16px">' +
          '<div>Program: ' + m.programName + ' (' + m.programHandle + ')</div>' +
          '<div>URL: <a href="' + m.programUrl + '" target="_blank" style="color:#22d3ee">' + m.programUrl + '</a></div>' +
          '<div>Created: ' + new Date(m.createdAt).toLocaleString() + '</div>' +
          '<div>Updated: ' + new Date(m.updatedAt).toLocaleString() + '</div>' +
        '</div>' +
        '<hr style="border-color:#1a1a2e;margin:16px 0">' +
        '<h4 style="color:#c084fc;margin-bottom:8px">📋 Scope (' + m.inScopeCount + ' assets)</h4>' +
        '<div id="missionScope" style="max-height:200px;overflow:auto;font-size:10px;color:#c8d6e5">' +
          '<div style="color:#5a6a7a">Loading scope...</div>' +
        '</div>' +
        '<hr style="border-color:#1a1a2e;margin:16px 0">' +
        '<h4 style="color:#c084fc;margin-bottom:8px">🎯 Objectives</h4>' +
        '<ul style="font-size:11px;color:#c8d6e5;margin-left:16px">' +
          (m.objectives?.map(function(o) { return '<li>' + o + '</li>'; }).join('') || '<li style="color:#5a6a7a">No objectives</li>') +
        '</ul>' +
        '<hr style="border-color:#1a1a2e;margin:16px 0">' +
        '<h4 style="color:#c084fc;margin-bottom:8px">📋 Activity Log</h4>' +
        '<div id="missionActivity" style="max-height:200px;overflow:auto;font-size:10px;color:#5a6a7a">' +
          '<div>Loading activity...</div>' +
        '</div>' +
        '<div style="margin-top:16px;display:flex;gap:8px">' +
          '<button onclick="runMissionRecon(\'' + m.id + '\')" style="flex:1;background:#a855f722;color:#c084fc;border:1px solid #a855f744;padding:8px;border-radius:4px;cursor:pointer">▶ Run Recon</button>' +
          '<button onclick="closeMissionDetail()" style="flex:1;background:#1a1a2e;color:#c8d6e5;border:1px solid #1a1a2e;padding:8px;border-radius:4px;cursor:pointer">Close</button>' +
        '</div>' +
      '</div>';
    
    // Remove existing detail panel
    const existing = document.getElementById('missionDetailPanel');
    if (existing) existing.remove();
    
    const panel = document.createElement('div');
    panel.id = 'missionDetailPanel';
    panel.innerHTML = detailHtml;
    document.body.appendChild(panel);
    
    // Load scope and activity
    loadMissionScope(missionId);
    loadMissionActivity(missionId);
  } catch(e) {
    console.error(e);
    alert('Error loading mission: ' + e.message);
  }
}

function closeMissionDetail() {
  const panel = document.getElementById('missionDetailPanel');
  if (panel) panel.remove();
}

async function loadMissionScope(missionId) {
  try {
    const m = await api('/api/missions/' + encodeURIComponent(missionId));
    if (!m || !m.scope) { document.getElementById('missionScope').innerHTML = '<div style="color:#5a6a7a">No scope data</div>'; return; }
    
    let html = '';
    if (m.scope.inScope?.length) {
      html += '<div style="color:#34d399;margin-bottom:8px">✅ IN SCOPE:</div>';
      html += m.scope.inScope.map(s => 
        '<div style="margin:4px 0;padding:4px 8px;background:#34d39911;border-radius:3px">' + 
        (s.isWildcard ? '🌐 ' : '🎯 ') + s.identifier + 
        ' <span style="color:#5a6a7a;font-size:9px">(' + s.assetType + ')</span>' +
        (s.instruction ? ' <span style="color:#fbbf24;font-size:9px">— ' + s.instruction + '</span>' : '') +
        '</div>'
      ).join('');
    }
    if (m.scope.exclusions?.length) {
      html += '<div style="color:#f87171;margin:12px 0 8px">❌ EXCLUSIONS:</div>';
      html += m.scope.exclusions.map(s => 
        '<div style="margin:4px 0;padding:4px 8px;background:#f8717111;border-radius:3px">🚫 ' + s.identifier + 
        (s.instruction ? ' <span style="color:#fbbf24;font-size:9px">— ' + s.instruction + '</span>' : '') +
        '</div>'
      ).join('');
    }
    if (m.scope.restrictions?.length) {
      html += '<div style="color:#fbbf24;margin:12px 0 8px">⚠️ RESTRICTIONS:</div>';
      html += m.scope.restrictions.map(r => 
        '<div style="margin:4px 0;padding:4px 8px;background:#fbbf2411;border-radius:3px">📝 ' + r.asset + ': ' + r.restriction + ' [' + r.severity + ']</div>'
      ).join('');
    }
    if (!html) html = '<div style="color:#5a6a7a">No scope data</div>';
    document.getElementById('missionScope').innerHTML = html;
  } catch(e) {
    document.getElementById('missionScope').innerHTML = '<div style="color:#f87171">Error loading scope: ' + e.message + '</div>';
  }
}

async function loadMissionActivity(missionId) {
  try {
    const m = await api('/api/missions/' + encodeURIComponent(missionId));
    if (!m || !m.activityLog?.length) { document.getElementById('missionActivity').innerHTML = '<div style="color:#5a6a7a">No activity log</div>'; return; }
    
    const html = m.activityLog.slice(-20).reverse().map(a => 
      '<div style="margin:4px 0;padding:4px 8px;background:#0a0a0f;border-radius:3px">' +
      '<span style="color:#5a6a7a;font-size:9px">' + new Date(a.timestamp).toLocaleTimeString() + '</span> ' +
      '<span style="color:#c084fc;font-weight:600">[' + a.action + ']</span> ' +
      '<span style="color:#c8d6e5;font-size:10px">' + (a.details || '') + '</span>' +
      '</div>'
    ).join('');
    document.getElementById('missionActivity').innerHTML = html;
  } catch(e) {
    document.getElementById('missionActivity').innerHTML = '<div style="color:#f87171">Error loading activity: ' + e.message + '</div>';
  }
}

async function runMissionRecon(missionId) {
  closeMissionDetail();
  const out = document.getElementById('output');
  out.classList.add('show');
  out.innerHTML += '<span class="prompt">$</span> @mission_recon start ' + missionId + '\\\\\\\\n';
  out.scrollTop = out.scrollHeight;
  try {
    const r = await api('/api/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tool:'mission_recon', args:'start ' + missionId}) });
    out.innerHTML += '<span class=ok>' + r.result + '</span>\\\\\\\\n\\\\\\\\n';
  } catch(e) { out.innerHTML += '<span class=err>⛔ ' + e.message + '</span>\\\\\\\\n\\\\\\\\n'; }
  out.scrollTop = out.scrollHeight;
}

async function loadSchedules() {
  try {
    const list = await api('/api/schedules');
    renderSchedules(list);
  } catch(e) { document.getElementById('scheduleList').innerHTML = '<div class="error">' + e.message + '</div>'; }
}

function renderSchedules(list) {
  const div = document.getElementById('scheduleList');
  if (!list.length) { div.innerHTML = '<div style="color:#5a6a7a">No active schedules. Use @schedule|daily|tool|target to create one.</div>'; return; }
  div.innerHTML = list.map(function(s) {
    return '<div class="schedule-item">' +
      '<div class="header">' +
        '<span class="tool">@' + s.tool + '</span>' +
        '<span class="next">Next: ' + s.nextAtHuman + '</span>' +
      '</div>' +
      '<div class="target">Target: ' + s.target + '</div>' +
      '<div class="interval">Interval: ' + s.interval + ' • ID: ' + s.id + '</div>' +
      '<div style="margin-top:8px;display:flex;gap:4px">' +
        '<button onclick="editSchedule(' + s.id + ', \'' + s.tool + '\', \'' + s.target.replace(/'/g, "\\'") + '\', \'' + s.interval + '\')" style="background:#a855f722;color:#c084fc;border:1px solid #a855f744;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:10px">✏ Edit</button>' +
        '<button onclick="deleteSchedule(' + s.id + ')" style="background:#f8717122;color:#f87171;border:1px solid #f8717144;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:10px">🗑 Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function editSchedule(id, tool, target, interval) {
  const newInterval = prompt('Edit interval (daily, hourly, 30m, etc):', interval);
  if (newInterval === null) return;
  const newTarget = prompt('Edit target:', target);
  if (newTarget === null) return;
  
  try {
    const r = await api('/api/run', { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body:JSON.stringify({tool:'schedule', args:'stop ' + id}) 
    });
    
    const r2 = await api('/api/run', { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body:JSON.stringify({tool:'schedule', args:newInterval + '|' + tool + '|' + newTarget}) 
    });
    
    loadSchedules();
    const out = document.getElementById('output');
    out.classList.add('show');
    out.innerHTML += '<span class="prompt">$</span> @schedule ' + newInterval + '|' + tool + '|' + newTarget + '\\n';
    out.innerHTML += '<span class=ok>' + r2.result + '</span>\\n\\n';
    out.scrollTop = out.scrollHeight;
  } catch(e) {
    alert('Error editing schedule: ' + e.message);
  }
}

async function deleteSchedule(id) {
  if (!confirm('Delete schedule ' + id + '?')) return;
  
  try {
    const r = await api('/api/run', { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body:JSON.stringify({tool:'schedule', args:'stop ' + id}) 
    });
    
    loadSchedules();
    const out = document.getElementById('output');
    out.classList.add('show');
    out.innerHTML += '<span class="prompt">$</span> @schedule stop ' + id + '\\n';
    out.innerHTML += '<span class=ok>' + r.result + '</span>\\n\\n';
    out.scrollTop = out.scrollHeight;
  } catch(e) {
    alert('Error deleting schedule: ' + e.message);
  }
}

async function loadTasks() {
  try {
    tasks = await api('/api/tasks');
    renderTasks(tasks);
  } catch(e) { document.getElementById('taskGrid').innerHTML = '<div class="error">' + e.message + '</div>'; }
}

function renderTasks(list) {
  const grid = document.getElementById('taskGrid');
  grid.innerHTML = list.map(t => \`
    <div class="task-card" onclick="runTaskFromMonitor('\${t.name}')">
      <div class="name">@\${t.name}</div>
      <div class="category">\${t.category}</div>
    </div>
  \`).join('');
}

function filterTasks(q) {
  const cards = document.querySelectorAll('.task-card');
  cards.forEach(c => {
    const name = c.querySelector('.name').textContent.toLowerCase();
    const cat = c.querySelector('.category').textContent.toLowerCase();
    c.style.display = (name.includes(q.toLowerCase()) || cat.includes(q.toLowerCase())) ? '' : 'none';
  });
}

async function runTaskFromMonitor(name) {
  const input = prompt('Enter arguments for @' + name + ':');
  if (input === null) return;
  const out = document.getElementById('output');
  out.classList.add('show');
  out.innerHTML += '<span class="prompt">$</span> @' + name + '|' + input + '\\\\n';
  out.scrollTop = out.scrollHeight;
  try {
    const r = await api('/api/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tool:name, args:input}) });
    out.innerHTML += r.result + '\\\\n\\\\n';
  } catch(e) { out.innerHTML += '<span class="error">[Error] ' + e.message + '</span>\\\\n\\\\n'; }
  out.scrollTop = out.scrollHeight;
}

function updateHealth(h) {
  document.getElementById('sysUptime').textContent = h.uptimeHuman || (Math.floor(h.uptime) + 's');
  document.getElementById('sysMemory').textContent = h.memory.heapUsed + ' / ' + h.memory.heapTotal + ' (RSS: ' + h.memory.rss + ')';
  document.getElementById('sysNode').textContent = h.nodeVersion;
  document.getElementById('sysPid').textContent = h.pid;
  document.getElementById('sysUsb').textContent = h.usbMounted ? '✓ Mounted' : '✗ Not mounted';
  document.getElementById('sysUsb').className = 'stat-value ' + (h.usbMounted ? 'ok' : 'error');
  // New fields
  const platformEl = document.getElementById('sysPlatform');
  if (platformEl) platformEl.textContent = h.platform;
  const versionEl = document.getElementById('sysVersion');
  if (versionEl) versionEl.textContent = h.nodeVersion;
}

async function loadSystem() {
  try {
    const s = await api('/api/system');
    document.getElementById('sysLoad').textContent = s.loadAvg || '—';
    document.getElementById('sysDisk').textContent = s.disk ? s.disk.split('\n')[1]?.trim() || '—' : '—';
    // New fields
    const netEl = document.getElementById('sysNet');
    if (netEl) netEl.textContent = s.netDev ? s.netDev.split('\n').length + ' interfaces' : '—';
    const diskIOEl = document.getElementById('sysDiskIO');
    if (diskIOEl) diskIOEl.textContent = s.diskIO ? s.diskIO.split('\n').length + ' devices' : '—';
    const uptimeEl = document.getElementById('sysUptime2');
    if (uptimeEl) uptimeEl.textContent = Math.floor(s.uptime) + 's';
    const platformEl = document.getElementById('sysPlatform');
    if (platformEl) platformEl.textContent = s.platform;
    const versionEl = document.getElementById('sysVersion');
    if (versionEl) versionEl.textContent = s.nodeVersion;
    const pidEl = document.getElementById('sysPid2');
    if (pidEl) pidEl.textContent = s.pid;
  } catch(e) {}
}

// Periodic refresh
setInterval(loadHealth, 10000);
setInterval(loadSystem, 15000);
setInterval(loadMissions, 30000);
setInterval(loadSchedules, 10000);

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
  document.querySelector('.tab[onclick*="' + name + '"]').classList.add('active');
  document.getElementById(name).classList.add('active');
  if (name === 'playbooks') loadPlaybooks();
  if (name === 'reports') loadReports();
  if (name === 'monitor') { loadMissions(); loadSchedules(); loadTasks(); loadHealth(); loadSystem(); }
}

// Initialize
loadTools();
connectWS();

// WebSocket message handler
function handleWSMessage(msg) {
  if (msg.type === "health") updateHealth(msg.data);
  else if (msg.type === "missions") renderMissions(msg.data);
  else if (msg.type === "schedules") renderSchedules(msg.data);
}
</script></body></html>`;
export function startGui(port = parseInt(process.env.PHANTOM_PORT || "8080")) {
    const server = http.createServer(async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
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
                if (!fn) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: "Tool not found" }));
                    return;
                }
                const result = await fn.execute(args);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ result }));
                return;
            }
            if (path === "/api/playbooks") {
                const names = [];
                if (existsSync(PLAYBOOKS_DIR)) {
                    for (const f of readdirSync(PLAYBOOKS_DIR).filter((f) => f.endsWith(".json"))) {
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
                if (!fn) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: "playbook_run tool not found" }));
                    return;
                }
                const input = vars ? `${name}|${vars}` : name;
                const result = await fn.execute(input);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ result }));
                return;
            }
            if (path === "/api/reports") {
                const reports = [];
                if (existsSync(REPORTS_DIR)) {
                    for (const f of readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".md") || f.endsWith(".txt"))) {
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
                if (!existsSync(fp)) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: "Not found" }));
                    return;
                }
                const content = readFileSync(fp, "utf-8");
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ content }));
                return;
            }
            // ── Monitoring API endpoints ──
            if (path === "/api/missions") {
                const missions = [];
                if (existsSync(MISSIONS_DIR)) {
                    for (const f of readdirSync(MISSIONS_DIR).filter((f) => f.endsWith(".json"))) {
                        const m = JSON.parse(readFileSync(resolve(MISSIONS_DIR, f), "utf-8"));
                        missions.push({
                            id: m.id,
                            programName: m.programName,
                            programHandle: m.programHandle,
                            status: m.status,
                            createdAt: m.createdAt,
                            updatedAt: m.updatedAt,
                            inScopeCount: m.scope?.inScope?.length || 0,
                            objectives: m.objectives?.length || 0
                        });
                    }
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(missions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())));
                return;
            }
            if (path === "/api/schedules") {
                // Access globalThis.__phantomSchedules from the main process
                const schedules = globalThis.__phantomSchedules || [];
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(schedules.map((s) => ({
                    id: s.id,
                    tool: s.tool,
                    target: s.target,
                    interval: s.interval,
                    nextAt: s.nextAt,
                    nextAtHuman: new Date(s.nextAt).toLocaleString()
                }))));
                return;
            }
            if (path === "/api/tasks") {
                // Get all available tasks from hackerTools
                const tasks = Object.keys(hackerTools).map(name => ({
                    name,
                    category: categorizeTool(name)
                }));
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(tasks));
                return;
            }
            if (path === "/api/health") {
                const mem = process.memoryUsage();
                const uptime = process.uptime();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    status: "ok",
                    uptime: Math.floor(uptime),
                    uptimeHuman: formatUptime(uptime),
                    memory: {
                        rss: Math.round(mem.rss / 1024 / 1024) + "MB",
                        heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB",
                        heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + "MB",
                        external: Math.round(mem.external / 1024 / 1024) + "MB"
                    },
                    pid: process.pid,
                    platform: process.platform,
                    nodeVersion: process.version,
                    usbMounted: existsSync("/root/usb/Phantom"),
                    timestamp: new Date().toISOString()
                }));
                return;
            }
            if (path === "/api/system") {
                const { execFileSync } = await import("child_process");
                let diskInfo = "";
                let loadAvg = "";
                try {
                    diskInfo = execFileSync("df", ["-h", "/root/usb"], { encoding: "utf-8", timeout: 5000 }).trim();
                }
                catch { }
                try {
                    loadAvg = execFileSync("cat", ["/proc/loadavg"], { encoding: "utf-8", timeout: 5000 }).trim();
                }
                catch { }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    disk: diskInfo,
                    loadAvg: loadAvg,
                    cpus: require("os").cpus().length,
                    totalMem: Math.round(require("os").totalmem() / 1024 / 1024 / 1024 * 10) / 10 + "GB",
                    freeMem: Math.round(require("os").freemem() / 1024 / 1024 / 1024 * 10) / 10 + "GB"
                }));
                return;
            }
            // Serve HTML for everything else
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(HTML);
        }
        catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
        }
    });
    // WebSocket server for real-time updates
    if (WebSocketServer) {
        const wss = new WebSocketServer({ server });
        wss.on("connection", (ws) => {
            wsClients.add(ws);
            ws.on("close", () => wsClients.delete(ws));
            ws.on("error", () => wsClients.delete(ws));
            // Send initial state
            ws.send(JSON.stringify({ type: "welcome", timestamp: new Date().toISOString() }));
        });
        // Periodic broadcasts for real-time updates
        setInterval(broadcastHealth, 5000);
        setInterval(broadcastMissions, 30000);
        setInterval(broadcastSchedules, 10000);
    }
    server.listen(port, () => {
        console.log(`\n  🌐 Phantom Dashboard: http://localhost:${port}\n`);
    });
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let b = "";
        req.on("data", (c) => b += c);
        req.on("end", () => resolve(b));
        req.on("error", reject);
    });
}
function formatSize(bytes) {
    if (bytes < 1024)
        return bytes + "B";
    if (bytes < 1048576)
        return (bytes / 1024).toFixed(1) + "KB";
    return (bytes / 1048576).toFixed(1) + "MB";
}
function categorizeTool(name) {
    if (name.startsWith("mission") || name.startsWith("hackerone"))
        return "mission";
    if (name.startsWith("recon") || name === "subfinder" || name === "dnsx" || name === "httpx" || name === "sub_enum" || name === "wayback" || name === "amass")
        return "recon";
    if (name.startsWith("net:") || name === "port_scan" || name === "ssl_check" || name === "whois" || name === "geoip" || name === "dns_lookup" || name === "reverse_dns" || name === "nmap" || name === "naabu")
        return "network";
    if (name.startsWith("vuln:") || name === "cve_search" || name === "exploit_search" || name === "nuclei" || name === "nikto" || name === "sqlmap" || name === "sql_detect" || name === "xss_scan")
        return "vulnerability";
    if (name.startsWith("web:") || name === "crawl" || name === "http_headers" || name === "web_fetch" || name === "web_links" || name === "web_snapshot" || name === "whatweb" || name === "wafw00f" || name === "robots_txt" || name === "dir_bruteforce" || name === "ffuf" || name === "gobuster")
        return "web";
    if (name.startsWith("osint:") || name === "email_verify" || name === "email_breach" || name === "github_dork" || name === "shodan_search" || name === "vt_check" || name === "cert_expiry")
        return "osint";
    if (name.startsWith("schedule") || name === "cron" || name === "batch" || name === "pipe" || name === "session" || name === "playbook")
        return "automation";
    return "other";
}
function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d)
        parts.push(`${d}d`);
    if (h)
        parts.push(`${h}h`);
    if (m)
        parts.push(`${m}m`);
    if (s || parts.length === 0)
        parts.push(`${s}s`);
    return parts.join(" ");
}
//# sourceMappingURL=server.js.map