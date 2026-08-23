// Phantom — Dashboard embedded HTML/CSS/JS
// VS Code-style IDE layout with sidebar, activity bar, bottom panel
// Dark neon hacker theme — violet/cyan

export const DASHBOARD_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phantom Dashboard</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#c8d6e5;font-family:'Cascadia Code','Fira Code','JetBrains Mono',monospace;font-size:13px;height:100vh;overflow:hidden;display:flex;flex-direction:column}
::selection{background:#a855f766;color:#fff}
::-webkit-scrollbar{width:4px;background:#0a0a0f}::-webkit-scrollbar-thumb{background:#a855f744;border-radius:2px}::-webkit-scrollbar-thumb:hover{background:#a855f788}

/* ── Activity Bar ── */
.activity-bar{width:48px;background:#0a0a14;border-right:1px solid #1a1a2e;display:flex;flex-direction:column;align-items:center;padding:8px 0;gap:4px;flex-shrink:0}
.activity-btn{width:36px;height:36px;display:flex;align-items:center;justify-content:center;color:#3a4a5a;cursor:pointer;border-radius:6px;transition:all .15s;font-size:16px;position:relative}
.activity-btn:hover{color:#c084fc;background:#a855f711}
.activity-btn.active{color:#c084fc;background:#a855f722}
.activity-btn.active::before{content:'';position:absolute;left:-6px;top:6px;bottom:6px;width:2px;background:#c084fc;border-radius:1px}

/* ── Monitoring Panel Styles ── */
.monitor-panel{display:flex;flex-direction:column;height:100%;padding:16px;overflow-y:auto}
.monitor-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.monitor-card{background:#0c0c18;border:1px solid #1a1a2e;border-radius:8px;padding:16px}
.monitor-card h3{color:#c084fc;font-size:13px;margin-bottom:12px;border-bottom:1px solid #1a1a2e;padding-bottom:8px;display:flex;align-items:center;gap:8px}
.monitor-card .stat{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #141424;font-size:12px}
.monitor-card .stat:last-child{border-bottom:none}
.monitor-card .stat-label{color:#5a6a7a}
.monitor-card .stat-value{color:#c8d6e5;font-weight:500}
.monitor-card .stat-value.ok{color:#34d399}
.monitor-card .stat-value.warn{color:#fbbf24}
.monitor-card .stat-value.error{color:#f87171}
.monitor-card .stat-value.running{color:#22d3ee}

.mission-list{max-height:400px;overflow:auto}
.mission-item{background:#0c0c18;border:1px solid #1a1a2e;border-radius:6px;padding:12px;margin-bottom:8px;cursor:pointer;transition:all .15s}
.mission-item:hover{border-color:#a855f744;background:#a855f70a}
.mission-item .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.mission-item .name{color:#c084fc;font-size:12px;font-weight:700;word-break:break-all}
.mission-item .status{font-size:10px;padding:2px 8px;border-radius:3px;white-space:nowrap}
.mission-item .status.planning{background:#a855f722;color:#c084fc}
.mission-item .status.ready{background:#fbbf2422;color:#fbbf24}
.mission-item .status.reconnaissance{background:#22d3ee22;color:#22d3ee}
.mission-item .status.paused{background:#f8717122;color:#f87171}
.mission-item .status.completed{background:#34d39922;color:#34d399}
.mission-item .status.cancelled{background:#f8717122;color:#f87171}
.mission-item .status.failed{background:#ef444422;color:#ef4444}
.mission-item .status.invalid_state{background:#5a6a7a22;color:#5a6a7a}
.mission-item .meta{color:#5a6a7a;font-size:10px;margin-bottom:4px}
.mission-item .scope{color:#3a4a5a;font-size:10px}

.schedule-item{background:#0c0c18;border:1px solid #1a1a2e;border-radius:6px;padding:12px;margin-bottom:8px}
.schedule-item .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.schedule-item .tool{color:#fbbf24;font-size:12px;font-weight:700}
.schedule-item .next{color:#5a6a7a;font-size:10px}
.schedule-item .target{color:#c8d6e5;font-size:11px;margin:4px 0;word-break:break-all}
.schedule-item .interval{color:#3a4a5a;font-size:10px}

.task-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;max-height:400px;overflow:auto}
.task-card{background:#0c0c18;border:1px solid #1a1a2e;border-radius:6px;padding:10px 12px;cursor:pointer;transition:all .15s}
.task-card:hover{border-color:#a855f744;background:#a855f70a}
.task-card .name{color:#22d3ee;font-size:11px;font-weight:700;word-break:break-all}
.task-card .category{color:#3a4a5a;font-size:9px;text-transform:uppercase;margin-top:2px}

.health-indicator{display:inline-flex;align-items:center;gap:6px}
.health-dot{width:8px;height:8px;border-radius:50%}
.health-dot.ok{background:#34d399;box-shadow:0 0 6px #34d399}
.health-dot.warn{background:#fbbf24;box-shadow:0 0 6px #fbbf24}
.health-dot.error{background:#f87171;box-shadow:0 0 6px #f87171}

.search-box{width:100%;padding:8px 12px;background:#050510;border:1px solid #1a1a3e;border-radius:6px;color:#c8d6e5;font-family:inherit;font-size:12px;margin-bottom:12px;outline:none;transition:border-color .15s}
.search-box:focus{border-color:#a855f766}

@media(max-width:768px){
.monitor-grid{grid-template-columns:1fr}
.task-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
}

/* ── Main Layout ── */
.main-wrap{display:flex;flex:1;overflow:hidden}
.sidebar{width:260px;background:#0c0c18;border-right:1px solid #1a1a2e;display:flex;flex-direction:column;flex-shrink:0;overflow:hidden}
.sidebar.hidden{display:none}
.sidebar.collapsed{width:0;min-width:0;overflow:hidden;border:none;transition:width .2s;flex-shrink:1;flex-grow:0}
.sidebar.collapsed+.editor{border-left:none}
.sidebar-toggle{cursor:pointer;color:#3a4a5a;font-size:10px;padding:2px 6px;border-radius:3px;transition:all .15s}
.sidebar-toggle:hover{color:#c084fc;background:#a855f711}
.sidebar-header{padding:10px 14px;font-size:11px;color:#5a6a7a;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1a1a2e;display:flex;justify-content:space-between;align-items:center}
.sidebar-header .count{color:#a855f7;font-size:10px}
.sidebar-search{padding:8px 10px}
.sidebar-search input{width:100%;padding:6px 10px;background:#050510;border:1px solid #1a1a3e;border-radius:4px;color:#c8d6e5;font-family:inherit;font-size:12px;outline:none;transition:border-color .15s}
.sidebar-search input:focus{border-color:#a855f766}
.sidebar-content{flex:1;overflow-y:auto;padding:4px 0}
.sidebar-empty{padding:20px;color:#3a4a5a;text-align:center;font-size:12px}

/* ── Tool tree ── */
.category-group{margin-bottom:2px}
.category-label{padding:6px 14px;font-size:10px;color:#5a6a7a;text-transform:uppercase;letter-spacing:1px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:color .15s}
.category-label:hover{color:#c084fc}
.category-label .arrow{font-size:8px;transition:transform .15s;display:inline-block}
.category-label .arrow.open{transform:rotate(90deg)}
.category-label .badge{font-size:9px;color:#3a4a5a;margin-left:auto}
.category-items{overflow:hidden}
.category-items.collapsed{display:none}
.tool-item{display:flex;align-items:center;padding:4px 14px 4px 24px;cursor:pointer;transition:all .1s;font-size:12px;gap:8px;border-left:2px solid transparent}
.tool-item:hover{background:#a855f70a;border-left-color:#a855f744}
.tool-item.active{background:#a855f714;border-left-color:#c084fc;color:#c084fc}
.tool-item .name{flex:1}
.tool-item .run-btn{font-size:10px;color:#3a4a5a;cursor:pointer;padding:1px 5px;border-radius:3px;transition:all .15s;opacity:0}
.tool-item:hover .run-btn{opacity:1}
.tool-item .run-btn:hover{background:#22d3ee22;color:#22d3ee}
.tool-icon{font-size:10px;width:16px;text-align:center}

/* ── Editor Area ── */
.editor{flex:1;display:flex;flex-direction:column;overflow:hidden;background:#0a0a0f}
.editor-tabs{display:flex;background:#0c0c18;border-bottom:1px solid #1a1a2e;min-height:32px;overflow-x:auto}
.editor-tab{display:flex;align-items:center;gap:6px;padding:6px 14px;font-size:11px;color:#5a6a7a;border-right:1px solid #1a1a2e;cursor:pointer;transition:color .15s;white-space:nowrap}
.editor-tab:hover{color:#c8d6e5}
.editor-tab.active{color:#c8d6e5;background:#0a0a0f;border-bottom:2px solid #c084fc}
.editor-tab .close{font-size:10px;color:#3a4a5a;cursor:pointer;padding:0 3px;border-radius:2px}
.editor-tab .close:hover{color:#f87171;background:#ef444422}
.editor-content{flex:1;display:flex;flex-direction:column;overflow:hidden}
.editor-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#3a4a5a;gap:16px;padding:40px}
.editor-welcome pre{color:#22d3ee;font-size:9px;line-height:1.15;text-shadow:0 0 10px #22d3ee11}
.editor-welcome h2{color:#a855f7;font-size:16px;letter-spacing:2px}
.editor-welcome p{font-size:12px;max-width:400px;text-align:center;color:#5a6a7a}

/* ── Bottom Panel ── */
.bottom-panel{height:200px;background:#0c0c18;border-top:1px solid #1a1a2e;display:flex;flex-direction:column;flex-shrink:0}
.bottom-panel.collapsed{height:28px}
.bottom-panel.collapsed .panel-body{display:none}
.panel-tabs{display:flex;align-items:center;background:#080810;border-bottom:1px solid #1a1a2e;min-height:28px;padding:0 4px;gap:0}
.panel-tab{padding:4px 12px;font-size:10px;color:#5a6a7a;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}
.panel-tab:hover{color:#c8d6e5}
.panel-tab.active{color:#22d3ee;border-bottom-color:#22d3ee}
.panel-actions{margin-left:auto;display:flex;gap:4px;padding:0 4px}
.panel-btn{font-size:10px;color:#3a4a5a;cursor:pointer;padding:2px 6px;border-radius:3px;transition:color .15s}
.panel-btn:hover{color:#c8d6e5}
.panel-body{flex:1;overflow:auto;padding:8px 12px;font-size:11px;white-space:pre-wrap;font-family:inherit;line-height:1.4}
.panel-body .prompt{color:#22d3ee88}
.panel-body .ok{color:#34d399}
.panel-body .err{color:#f87171}
.panel-body .info{color:#5a6a7a}
.panel-body .dim{color:#3a4a5a}

/* ── Status Bar ── */
.status-bar{height:22px;background:#0a0a14;border-top:1px solid #1a1a2e;display:flex;align-items:center;padding:0 12px;font-size:10px;color:#3a4a5a;gap:16px;flex-shrink:0}
.status-bar .left{display:flex;align-items:center;gap:12px}
.status-bar .right{margin-left:auto;display:flex;align-items:center;gap:12px}
.status-dot{width:6px;height:6px;border-radius:50%;display:inline-block}
.status-dot.on{background:#22d3ee;box-shadow:0 0 6px #22d3ee}
.status-dot.off{background:#3a4a5a}
.status-bar .item{display:flex;align-items:center;gap:4px;cursor:default}
.status-bar .item:hover{color:#5a6a7a}

/* ── Modal / Command Palette ── */
.palette-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:#00000088;display:none;align-items:flex-start;justify-content:center;padding-top:10vh;z-index:100}
.palette-overlay.show{display:flex}
.palette{background:#0c0c18;border:1px solid #1a1a3e;border-radius:8px;width:500px;max-width:90vw;box-shadow:0 20px 60px #00000088;overflow:hidden}
.palette input{width:100%;padding:12px 16px;background:#050510;border:none;color:#c8d6e5;font-family:inherit;font-size:14px;outline:none;border-bottom:1px solid #1a1a3e}
.palette-results{max-height:300px;overflow-y:auto}
.palette-item{padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:12px;transition:background .1s;border-left:2px solid transparent}
.palette-item:hover,.palette-item.active{background:#a855f714;border-left-color:#c084fc}
.palette-item .desc{color:#5a6a7a;font-size:11px;margin-left:auto}

@keyframes fadeIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}

/* ── Mobile responsive ── */
@media(max-width:768px){
.activity-bar{width:40px}
.activity-btn{width:28px;height:28px;font-size:12px}
.sidebar{width:200px}
.sidebar-header{font-size:10px;padding:6px 10px}
.sidebar-search{padding:4px 8px}
.sidebar-search input{font-size:11px;padding:4px 8px}
.category-label{font-size:9px;padding:4px 10px}
.tool-item{font-size:11px;padding:3px 10px 3px 18px}
.editor-welcome{padding:20px;gap:10px}
.editor-welcome h2{font-size:14px}
.editor-welcome pre{font-size:7px}
.bottom-panel{height:140px}
.panel-body{font-size:10px;padding:4px 8px}
.panel-tab{font-size:9px;padding:3px 8px}
.status-bar{font-size:9px;gap:8px;padding:0 8px}
.palette{width:95vw}
.palette input{font-size:13px;padding:10px 12px}
.palette-item{font-size:11px;padding:6px 12px}
}
@media(max-width:480px){
.activity-bar{width:36px}
.activity-btn{width:24px;height:24px;font-size:10px}
.activity-btn.active::before{left:-5px;top:4px;bottom:4px}
.sidebar{width:160px}
.sidebar-header{font-size:9px}
.category-label{font-size:8px;padding:3px 8px}
.tool-item{font-size:10px;padding:2px 8px 2px 14px}
.editor-welcome{padding:12px}
.editor-welcome h2{font-size:12px}
.editor-welcome p{font-size:10px}
.bottom-panel{height:120px}
.panel-body{font-size:9px}
.status-bar{font-size:8px;gap:4px;padding:0 4px}
.editor-welcome pre{display:none}
}

/* ── Chat Panel ── */
.chat-panel{display:flex;flex-direction:column;height:100%}
.chat-messages{flex:1;overflow-y:auto;padding:12px 16px}
.chat-msg{margin-bottom:10px;animation:fadeIn .15s}
.chat-msg.user{text-align:right}
.chat-msg.user .chat-bubble{background:#a855f722;border:1px solid #a855f744;color:#e2d5f7}
.chat-msg.agent .chat-bubble{background:#22d3ee11;border:1px solid #22d3ee33;color:#b8eef7}
.chat-msg.system .chat-bubble{background:#0a0a0f;border:1px solid #3a4a5a;color:#5a6a7a;font-size:10px;text-align:center}
.chat-bubble{display:inline-block;max-width:80%;padding:8px 14px;border-radius:8px;font-size:12px;line-height:1.5;text-align:left;white-space:pre-wrap;word-break:break-word}
.chat-bubble .chat-code{display:block;background:#050510;border:1px solid #1a1a3e;border-radius:4px;padding:6px 10px;margin:4px 0;font-size:11px;overflow-x:auto;color:#c8d6e5}
.chat-bubble .chat-code-header{font-size:9px;color:#5a6a7a;margin-bottom:2px}
.chat-input-bar{display:flex;align-items:center;padding:8px 12px;border-top:1px solid #1a1a2e;background:#0c0c18;gap:8px}
.chat-input-bar textarea{flex:1;padding:8px 12px;background:#050510;border:1px solid #1a1a3e;border-radius:6px;color:#c8d6e5;font-family:inherit;font-size:12px;outline:none;resize:none;min-height:36px;max-height:120px;line-height:1.4;transition:border-color .15s}
.chat-input-bar textarea:focus{border-color:#a855f766}
.chat-input-bar .chat-send{background:linear-gradient(135deg,#a855f744,#22d3ee44);color:#c084fc;border:1px solid #a855f755;padding:6px 16px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:12px;transition:all .15s}
.chat-input-bar .chat-send:hover{background:linear-gradient(135deg,#a855f766,#22d3ee66);color:#d8b4fe}
.chat-input-bar .chat-send:disabled{opacity:.4;cursor:default}
.chat-typing{text-align:center;color:#5a6a7a;font-size:11px;padding:4px}
.chat-emoji{font-size:11px}
.chat-status{font-size:10px;color:#3a4a5a;padding:2px 0}
.chat-status .dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style></head><body>

<div style="display:flex;flex-direction:column;height:100vh">
  <div class="main-wrap">
    <div class="activity-bar">
      <div class="activity-btn active" onclick="switchActivity('chat')" title="Chat">💬</div>
      <div class="activity-btn" onclick="switchActivity('tools')" title="Tools">◈</div>
      <div class="activity-btn" onclick="switchActivity('playbooks')" title="Playbooks">◆</div>
      <div class="activity-btn" onclick="switchActivity('reports')" title="Reports">■</div>
      <div class="activity-btn" onclick="switchActivity('monitor')" title="Monitor">📊</div>
      <div style="margin-top:auto" class="activity-btn" onclick="showPalette()" title="Commands">⌘</div>
    </div>

    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <span id="sidebarTitle">TOOLS</span>
        <span style="display:flex;gap:4px;align-items:center">
          <span class="count" id="toolCount">—</span>
          <span class="sidebar-toggle" onclick="toggleSidebar()" title="Collapse sidebar">◀</span>
        </span>
      </div>
      <div class="sidebar-search"><input id="search" placeholder="filter..." oninput="filterTools(this.value)"></div>
      <div class="sidebar-content" id="sidebarContent"><div class="sidebar-empty">loading...</div></div>
    </div>

    <div class="editor">
      <div class="editor-content" id="editorContent">
        <div class="editor-welcome" id="welcomeScreen">
          <pre id="logoAscii"></pre>
          <h2>⋊ PHANTOM ⋉</h2>
          <p>Select a tool from the sidebar or press <span style="color:#a855f7">⌘</span> to open the command palette</p>
        </div>
        <div class="editor-welcome" id="toolEditor" style="display:none">
          <div style="width:100%;max-width:600px;margin:0 auto;padding:40px 20px">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">
              <span id="editToolIcon" style="font-size:20px">🔧</span>
              <h2 id="editToolName" style="color:#c084fc;margin:0">@tool</h2>
            </div>
            <input id="toolArgs" placeholder="arguments..." style="width:100%;padding:10px 14px;background:#050510;border:1px solid #1a1a3e;border-radius:6px;color:#c8d6e5;font-family:inherit;font-size:13px;outline:none;margin-bottom:10px" onkeydown="if(event.key==='Enter')runTool()">
            <button onclick="runTool()" style="background:linear-gradient(135deg,#a855f722,#22d3ee22);color:#c084fc;border:1px solid #a855f744;padding:6px 20px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:12px">▶ Run</button>
          </div>
        </div>
        <div class="chat-panel" id="chatPanel" style="display:none;flex:1">
          <div class="chat-messages" id="chatMessages">
            <div class="chat-msg system"><div class="chat-bubble">🕷️ Phantom agent ready — ask me anything or give me a hacking target</div></div>
          </div>
          <div class="chat-status" id="chatStatus" style="display:none"><span class="dot" style="background:#22d3ee"></span>thinking...</div>
          <div class="chat-input-bar">
            <textarea id="chatInput" rows="1" placeholder="Type a command, target, or question..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"></textarea>
            <button class="chat-send" id="chatSend" onclick="sendChat()">▶ Send</button>
          </div>
        </div>
        <div class="monitor-panel" id="monitorPanel" style="display:none">
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
            </div>

            <div class="monitor-card">
              <h3>🎯 Active Missions</h3>
              <input class="search-box" id="missionSearch" placeholder="Filter missions..." oninput="filterMissions(this.value)">
              <div class="mission-list" id="missionList"><div class="sidebar-empty">Loading missions...</div></div>
            </div>

            <div class="monitor-card">
              <h3>⏰ Active Schedules</h3>
              <div id="scheduleList"><div class="sidebar-empty">Loading schedules...</div></div>
            </div>

            <div class="monitor-card">
              <h3>📋 All Tasks (Searchable)</h3>
              <input class="search-box" id="taskSearch" placeholder="Search tasks..." oninput="filterTasks(this.value)">
              <div class="task-grid" id="taskGrid"><div class="sidebar-empty">Loading tasks...</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="bottom-panel" id="bottomPanel">
    <div class="panel-tabs">
      <div class="panel-tab active" onclick="switchPanel('output')">OUTPUT</div>
      <div class="panel-tab" onclick="switchPanel('info')">INFO</div>
      <div class="panel-actions">
        <span class="panel-btn" onclick="clearPanel()" title="Clear">⊘</span>
        <span class="panel-btn" onclick="togglePanel()" title="Toggle panel">_</span>
      </div>
    </div>
    <div class="panel-body" id="panelOutput"><span class="dim">⧩ ready</span></div>
  </div>

  <div class="status-bar">
    <div class="left">
      <span class="item"><span class="status-dot on"></span><span id="statusConnected">connected</span></span>
      <span class="item" id="statusToolCount">— tools</span>
      <span class="item" id="statusBarLevel" style="color:#a855f7">lv1</span>
    </div>
    <div class="right">
      <span class="item">⋉ phantom v0.2.0 ⋊</span>
    </div>
  </div>
</div>

<div class="palette-overlay" id="palette" onclick="if(event.target===this)hidePalette()">
  <div class="palette" style="animation:fadeIn .15s">
    <input id="paletteInput" placeholder="Type a command..." oninput="filterPalette(this.value)" onkeydown="if(event.key==='Enter')execPalette();if(event.key==='Escape')hidePalette()" autofocus>
    <div class="palette-results" id="paletteResults"></div>
  </div>
</div>

<script>
const HOODIE = [
  '  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄',
  ' █ ═══ ═══ ═══ ═══ ═══ █',
  '▐█ ·   ·   ·   ·   · █▌',
  '▐█   ╔═══════════╗   █▌',
  '▐█   ║ ◈     ◈ ║   █▌',
  '▐█   ║  ╔═══╗   ║   █▌',
  '▐█   ╚═══════════╝   █▌',
  ' █   ┊ ║   ║ ┊   █',
  ' █   ┊ ║ ● ║ ┊   █',
  ' ▀▄  ║ ═══ ║  ▄▀',
  '   P H A N T O M'
].join('\\n');
document.getElementById('logoAscii').textContent = HOODIE;

let tools = [];
let activeTab = 'tools';
let paletteItems = [];
let paletteIdx = -1;

// API
async function api(p,o){const r=await fetch(p,o);if(!r.ok)throw new Error(r.statusText);return r.json()}

// ── Chat ──
let chatBusy = false;
function addChatMsg(role, text) {
  const el = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  // Format code blocks
  const formatted = text.replace(/\`\`\`(\w*)\n?([\s\S]*?)\`\`\`/g, (_, lang, code) => {
    return '<div class=\"chat-code-header\">' + (lang || 'code') + '</div><pre class=\"chat-code\">' + code.trim() + '</pre>';
  });
  div.innerHTML = '<div class="chat-bubble">' + formatted + '</div>';
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}
async function sendChat() {
  if (chatBusy) return;
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  input.style.height = 'auto';
  addChatMsg('user', msg);
  chatBusy = true;
  document.getElementById('chatSend').disabled = true;
  document.getElementById('chatStatus').style.display = 'block';
  try {
    const r = await api('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:msg}) });
    if (r.ok) {
      addChatMsg('agent', r.response);
      if (r.level) {
        document.getElementById('statusBarLevel').textContent = 'lv' + r.level;
      }
    } else {
      addChatMsg('system', '⛔ ' + (r.error || 'request failed'));
    }
  } catch(e) {
    addChatMsg('system', '⛔ Error: ' + e.message);
  }
  chatBusy = false;
  document.getElementById('chatSend').disabled = false;
  document.getElementById('chatStatus').style.display = 'none';
  document.getElementById('chatInput').focus();
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chatInput').focus();
  // Auto-resize textarea
  document.getElementById('chatInput').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });
});

// Categorize tool
function toolCat(t){
  const n=t.toLowerCase();
  if(['shell','web_fetch','decode','encode','hash','file_analyze','batch','code_analyze','code_gen','yara','random'].some(x=>n.includes(x)))return{cat:'core',icon:'⚡',color:'#22d3ee'};
  if(['dns','whois','sub_enum','subfinder','port_scan','http_headers','ssl_check','crawl','geoip','dns_zone','reverse_dns','wayback','robots_txt','amass','dnsx','httpx','naabu','katana','sub_takeover','cloud_enum','dns_lookup','cert_expiry','dig','ping','traceroute','netstat'].some(x=>n.includes(x)))return{cat:'recon',icon:'🔍',color:'#c084fc'};
  if(['dir_brute','xss','sql','open_redirect','cors_test','http_methods','ffuf','arjun','nuclei'].some(x=>n.includes(x)))return{cat:'web',icon:'🌐',color:'#fbbf24'};
  if(['cve','searchsploit','shodan','bruteforce','jwt_decode','hash_crack','hashcat','nmap','masscan'].some(x=>n.includes(x)))return{cat:'exploit',icon:'💥',color:'#f87171'};
  if(['email','github_dork','vt_check','cloud_enum','geoip'].some(x=>n.includes(x)))return{cat:'osint',icon:'📡',color:'#34d399'};
  if(['file_read','file_write','file_edit','file_search','file_list','file_analyze'].some(x=>n.includes(x)))return{cat:'file',icon:'📁',color:'#818cf8'};
  if(['self_','knowledge_','playbook_','session_','report_','schedule','batch'].some(x=>n.includes(x)))return{cat:'system',icon:'⚙',color:'#5a6a7a'};
  return{cat:'other',icon:'🔧',color:'#5a6a7a'};
}

// Load tools
async function loadTools(){
  try{
    const resp=await api('/api/tools');
    tools=resp.tools||[];
    if(!tools.length){document.getElementById('sidebarContent').innerHTML='<div class=sidebar-empty>⛔ no tools from API</div>';return}
    const cats={};
    tools.forEach(t=>{const c=toolCat(t).cat;if(!cats[c])cats[c]=[];cats[c].push(t)});
    renderSidebar(cats);
    document.getElementById('toolCount').textContent=tools.length;
    document.getElementById('statusToolCount').textContent=tools.length+' tools';
    buildPalette();
  }catch(e){
    document.getElementById('sidebarContent').innerHTML='<div class=sidebar-empty>⛔ '+e.message+'<br><br><button onclick="loadTools()" style="background:#a855f722;color:#c084fc;border:1px solid #a855f744;padding:6px 16px;border-radius:4px;cursor:pointer;font:inherit;font-size:11px">↻ retry</button></div>';
  }
}

// Render sidebar
function renderSidebar(cats){
  const order=['core','recon','web','exploit','osint','file','system','other'];
  const labels={core:'CORE',recon:'RECON',web:'WEB',exploit:'EXPLOIT',osint:'OSINT',file:'FILE',system:'SYSTEM',other:'OTHER'};
  const expanded=JSON.parse(localStorage.getItem('phantom_cats')||'{}');
  let html='';
  order.forEach(c=>{
    if(!cats[c]||!cats[c].length)return;
    const open=expanded[c]!==false;
    const icon={core:'⚡',recon:'🔍',web:'🌐',exploit:'💥',osint:'📡',file:'📁',system:'⚙',other:'🔧'}[c];
    html+='<div class=category-group>';
    html+='<div class=category-label onclick="toggleCat(\\''+c+'\\')"><span class="arrow '+(open?'open':'')+'">▶</span>'+icon+' '+labels[c]+' <span class=badge>'+cats[c].length+'</span></div>';
    html+='<div class="category-items'+(open?'':' collapsed')+'" id="cat_'+c+'">';
    cats[c].forEach(t=>{
      const info=toolCat(t);
      html+='<div class=tool-item onclick="selectTool(\\''+t+'\\')"><span class=tool-icon style=color:'+info.color+'>'+info.icon+'</span><span class=name>'+t+'</span><span class=run-btn onclick="event.stopPropagation();quickRun(\\''+t+'\\')">▶</span></div>';
    });
    html+='</div></div>';
  });
  document.getElementById('sidebarContent').innerHTML=html;
}

function toggleCat(c){
  const el=document.getElementById('cat_'+c);
  const label=el.previousElementSibling.querySelector('.arrow');
  const collapsed=el.classList.toggle('collapsed');
  label.classList.toggle('open');
  const stored=JSON.parse(localStorage.getItem('phantom_cats')||'{}');
  stored[c]=!collapsed;
  localStorage.setItem('phantom_cats',JSON.stringify(stored));
}

// Select tool
let currentTool=null;
function selectTool(t){
  currentTool=t;
  document.querySelectorAll('.tool-item').forEach(i=>i.classList.remove('active'));
  event.currentTarget.classList.add('active');
  document.getElementById('welcomeScreen').style.display='none';
  document.getElementById('toolEditor').style.display='block';
  const info=toolCat(t);
  document.getElementById('editToolIcon').textContent=info.icon;
  document.getElementById('editToolName').textContent='@'+t;
  document.getElementById('toolArgs').value='';
  document.getElementById('toolArgs').focus();
}

function quickRun(t){
  currentTool=t;
  document.getElementById('welcomeScreen').style.display='none';
  document.getElementById('toolEditor').style.display='block';
  const info=toolCat(t);
  document.getElementById('editToolIcon').textContent=info.icon;
  document.getElementById('editToolName').textContent='@'+t;
  document.getElementById('toolArgs').value='';
  setTimeout(()=>runTool(),50);
}

async function runTool(){
  if(!currentTool)return;
  const args=document.getElementById('toolArgs').value;
  const out=document.getElementById('panelOutput');
  document.getElementById('bottomPanel').classList.remove('collapsed');
  out.innerHTML+='\\n<span class=prompt>⧩</span> @'+currentTool+'|'+args+'\\n';
  out.scrollTop=out.scrollHeight;
  switchPanel('output');
  try{
    const r=await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:currentTool,args})});
    out.innerHTML+='<span class=ok>'+r.result+'</span>\\n\\n';
  }catch(e){
    out.innerHTML+='<span class=err>⛔ '+e.message+'</span>\\n\\n';
  }
  out.scrollTop=out.scrollHeight;
}

// Filter tools
function filterTools(q){
  const f=q.toLowerCase();
  document.querySelectorAll('.tool-item').forEach(el=>{
    el.style.display=el.querySelector('.name').textContent.includes(f)?'':'none';
  });
  document.querySelectorAll('.category-group').forEach(g=>{
    const visible=Array.from(g.querySelectorAll('.tool-item')).some(i=>i.style.display!=='none');
    g.style.display=visible?'':'none';
  });
}

// Command palette
function buildPalette(){
  paletteItems=[];
  tools.forEach(t=>{
    const info=toolCat(t);
    paletteItems.push({label:'@'+t,desc:info.cat.toUpperCase(),action:()=>selectTool(t)});
  });
  ['Help','Tools','Model','Clear','Quit','GUI','API'].forEach(c=>{
    paletteItems.push({label:'/'+c.toLowerCase(),desc:'COMMAND',action:()=>{
      document.getElementById('panelOutput').innerHTML+='<span class=prompt>⧩</span> /'+c.toLowerCase()+'\\n';
    }});
  });
}

function showPalette(){
  document.getElementById('palette').classList.add('show');
  document.getElementById('paletteInput').value='';
  document.getElementById('paletteInput').focus();
  filterPalette('');
}

function hidePalette(){
  document.getElementById('palette').classList.remove('show');
}

function filterPalette(q){
  const f=q.toLowerCase();
  const results=paletteItems.filter(p=>p.label.toLowerCase().includes(f)||p.desc.toLowerCase().includes(f));
  const container=document.getElementById('paletteResults');
  container.innerHTML=results.map((p,i)=>'<div class="palette-item'+(i===0?' active':'')+'" onclick="execPaletteItem('+i+')" data-idx="'+i+'"><span>'+p.label+'</span><span class=desc>'+p.desc+'</span></div>').join('');
  paletteIdx=0;
}

// Sidebar toggle
let sidebarOpen=true;
function toggleSidebar(){
  sidebarOpen=!sidebarOpen;
  document.getElementById('sidebar').classList.toggle('collapsed');
  document.querySelector('.sidebar-toggle').textContent=sidebarOpen?'◀':'▶';
  document.querySelector('.sidebar-toggle').title=sidebarOpen?'Collapse sidebar':'Expand sidebar';
}

// Keyboard shortcuts
  const active=document.querySelector('.palette-item.active');
  if(active)execPaletteItem(parseInt(active.dataset.idx));
}

function execPaletteItem(idx){
  hidePalette();
  if(paletteItems[idx])paletteItems[idx].action();
}

// Panel controls
function switchPanel(name){
  document.querySelectorAll('.panel-tab').forEach(t=>t.classList.remove('active'));
  const idx=name==='output'?0:1;
  document.querySelectorAll('.panel-tab')[idx].classList.add('active');
}

function clearPanel(){
  document.getElementById('panelOutput').innerHTML='<span class=dim>⧩ cleared</span>';
}

function togglePanel(){
  document.getElementById('bottomPanel').classList.toggle('collapsed');
}

// Activity switching
function switchActivity(name){
  document.querySelectorAll('.activity-btn').forEach(b=>b.classList.remove('active'));
  event.currentTarget.classList.add('active');
  activeTab=name;
  
  // Hide chat panel / tools / welcome / monitor when switching
  document.getElementById('chatPanel').style.display='none';
  document.getElementById('welcomeScreen').style.display='none';
  document.getElementById('toolEditor').style.display='none';
  document.getElementById('monitorPanel').style.display='none';
  
  if(name==='chat'){
    document.getElementById('sidebarTitle').textContent='CHAT';
    document.getElementById('sidebarContent').innerHTML='<div class=sidebar-empty style="font-size:10px">💬 Chat with Phantom<br><span style="color:#3a4a5a">Send commands, targets, or questions</span></div>';
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('chatPanel').style.display='flex';
    setTimeout(()=>document.getElementById('chatInput').focus(),100);
  }else if(name==='tools'){
    document.getElementById('sidebarTitle').textContent='TOOLS';
    document.getElementById('sidebarContent').querySelector('.sidebar-empty')||loadTools();
    document.getElementById('sidebar').classList.remove('hidden');
  }else if(name==='playbooks'){
    document.getElementById('sidebarTitle').textContent='PLAYBOOKS';
    document.getElementById('sidebarContent').innerHTML='<div class=sidebar-empty>loading...</div>';
    document.getElementById('sidebar').classList.remove('hidden');
    loadPlaybooks();
  }else if(name==='reports'){
    document.getElementById('sidebarTitle').textContent='REPORTS';
    document.getElementById('sidebarContent').innerHTML='<div class=sidebar-empty>loading...</div>';
    document.getElementById('sidebar').classList.remove('hidden');
    loadReports();
  }else if(name==='monitor'){
    document.getElementById('sidebarTitle').textContent='MONITOR';
    document.getElementById('sidebarContent').innerHTML='<div class=sidebar-empty style="font-size:10px">📊 System monitoring<br><span style="color:#3a4a5a">Real-time status, missions, schedules & tasks</span></div>';
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('monitorPanel').style.display='flex';
    loadMonitorData();
  }
}

async function loadPlaybooks(){
  try{
    const resp=await api('/api/playbooks');
    const l=resp.playbooks||[];
    const c=document.getElementById('sidebarContent');
    if(!l.length){c.innerHTML='<div class=sidebar-empty>◆ no playbooks</div>';return}
    c.innerHTML=l.map(p=>'<div class="tool-item" onclick="runPlaybook(\\''+p.name+'\\')"><span class=tool-icon>◆</span><span class=name>'+p.name+'</span></div>').join('');
  }catch(e){
    document.getElementById('sidebarContent').innerHTML='<div class=sidebar-empty>⛔ '+e.message+'</div>';
  }
}

async function runPlaybook(n){
  const out=document.getElementById('panelOutput');
  document.getElementById('bottomPanel').classList.remove('collapsed');
  out.innerHTML+='\\n<span class=prompt>⧩</span> ◆ '+n+'\\n';
  switchPanel('output');
  try{
    const r=await api('/api/playbook/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,vars:'target='})});
    out.innerHTML+='<span class=ok>'+r.result+'</span>\\n\\n';
  }catch(e){
    out.innerHTML+='<span class=err>⛔ '+e.message+'</span>\\n\\n';
  }
  out.scrollTop=out.scrollHeight;
}

async function loadReports(){
  try{
    const resp=await api('/api/reports');
    const l=resp.reports||[];
    const c=document.getElementById('sidebarContent');
    if(!l.length){c.innerHTML='<div class=sidebar-empty>■ no reports</div>';return}
    c.innerHTML=l.map(r=>'<div class="tool-item" onclick="viewReport(\\''+r.name+'\\')"><span class=tool-icon>■</span><span class=name>'+r.name+'<span style=color:#3a4a5a;font-size:10px;margin-left:8px>'+r.size+'</span></div>').join('');
  }catch(e){
    document.getElementById('sidebarContent').innerHTML='<div class=sidebar-empty>⛔ '+e.message+'</div>';
  }
}

async function viewReport(n){
  try{
    const r=await api('/api/report/'+encodeURIComponent(n));
    const out=document.getElementById('panelOutput');
    document.getElementById('bottomPanel').classList.remove('collapsed');
    out.innerHTML+='\\n<span class=prompt>⧩</span> ■ '+n+'\\n<span class=info>'+r.content+'</span>\\n\\n';
    out.scrollTop=out.scrollHeight;
    switchPanel('output');
  }catch(e){}
}

// ── Monitoring Functions ──
let monitorRefreshInterval = null;

async function loadMonitorData() {
  await Promise.all([loadMissions(), loadSchedules(), loadTasks(), loadHealth(), loadSystem()]);
  
  // Set up periodic refresh
  if (monitorRefreshInterval) clearInterval(monitorRefreshInterval);
  monitorRefreshInterval = setInterval(() => {
    loadHealth();
    loadSystem();
    loadSchedules();
  }, 10000);
  
  setInterval(loadMissions, 30000);
  setInterval(loadTasks, 60000);
}

async function loadMissions() {
  try {
    const resp = await api('/api/missions');
    const missions = resp.missions || [];
    renderMissions(missions);
  } catch(e) {
    document.getElementById('missionList').innerHTML = '<div class=sidebar-empty>⛔ ' + e.message + '</div>';
  }
}

function renderMissions(list) {
  const div = document.getElementById('missionList');
  if (!list.length) { div.innerHTML = '<div class=sidebar-empty>No missions found</div>'; return; }
  div.innerHTML = list.map(m => 
    '<div class="mission-item">' +
      '<div class="header">' +
        '<span class="name">' + m.id + '</span>' +
        '<span class="status ' + m.status + '">' + m.status.toUpperCase() + '</span>' +
      '</div>' +
      '<div class="meta">' + m.programName + ' (' + m.programHandle + ') • Updated: ' + new Date(m.updatedAt).toLocaleString() + '</div>' +
      '<div class="scope">In-scope: ' + m.inScopeCount + ' assets • Objectives: ' + m.objectives + '</div>' +
    '</div>'
  ).join('');
}

function filterMissions(q) {
  const items = document.querySelectorAll('.mission-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(q.toLowerCase()) ? '' : 'none';
  });
}

async function loadSchedules() {
  try {
    const resp = await api('/api/schedules');
    const list = resp.schedules || [];
    renderSchedules(list);
  } catch(e) {
    document.getElementById('scheduleList').innerHTML = '<div class=sidebar-empty>⛔ ' + e.message + '</div>';
  }
}

function renderSchedules(list) {
  const div = document.getElementById('scheduleList');
  if (!list.length) { div.innerHTML = '<div class=sidebar-empty>No active schedules. Use @schedule|daily|tool|target to create one.</div>'; return; }
  div.innerHTML = list.map(s => 
    '<div class="schedule-item">' +
      '<div class="header">' +
        '<span class="tool">@' + s.tool + '</span>' +
        '<span class="next">Next: ' + s.nextAtHuman + '</span>' +
      '</div>' +
      '<div class="target">Target: ' + s.target + '</div>' +
      '<div class="interval">Interval: ' + s.interval + ' • ID: ' + s.id + '</div>' +
    '</div>'
  ).join('');
}

async function loadTasks() {
  try {
    const resp = await api('/api/tasks');
    const tasks = resp.tasks || [];
    renderTasks(tasks);
  } catch(e) {
    document.getElementById('taskGrid').innerHTML = '<div class=sidebar-empty>⛔ ' + e.message + '</div>';
  }
}

function renderTasks(list) {
  const grid = document.getElementById('taskGrid');
  grid.innerHTML = list.map(t => 
    '<div class="task-card" onclick="runTaskFromMonitor(\'' + t.name + '\')">' +
      '<div class="name">@' + t.name + '</div>' +
      '<div class="category">' + t.category + '</div>' +
    '</div>'
  ).join('');
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
  const out = document.getElementById('panelOutput');
  document.getElementById('bottomPanel').classList.remove('collapsed');
  out.innerHTML += '\n<span class=prompt>⧩</span> @' + name + '|' + input + '\n';
  out.scrollTop = out.scrollHeight;
  switchPanel('output');
  try {
    const r = await api('/api/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tool:name, args:input}) });
    out.innerHTML += '<span class=ok>' + r.result + '</span>\n\n';
  } catch(e) {
    out.innerHTML += '<span class=err>⛔ ' + e.message + '</span>\n\n';
  }
  out.scrollTop = out.scrollHeight;
}

async function loadHealth() {
  try {
    const h = await api('/api/health');
    updateHealth(h);
  } catch(e) {}
}

function updateHealth(h) {
  document.getElementById('sysUptime').textContent = h.uptimeHuman;
  document.getElementById('sysMemory').textContent = h.memory.heapUsed + ' / ' + h.memory.heapTotal + ' (RSS: ' + h.memory.rss + ')';
  document.getElementById('sysNode').textContent = h.nodeVersion;
  document.getElementById('sysPid').textContent = h.pid;
  document.getElementById('sysUsb').textContent = h.usbMounted ? '✓ Mounted' : '✗ Not mounted';
  document.getElementById('sysUsb').className = 'stat-value ' + (h.usbMounted ? 'ok' : 'error');
}

async function loadSystem() {
  try {
    const s = await api('/api/system');
    document.getElementById('sysLoad').textContent = s.loadAvg || '—';
    document.getElementById('sysDisk').textContent = s.disk ? s.disk.split('\n')[1]?.trim() || '—' : '—';
  } catch(e) {}
}

// Keyboard shortcuts
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='p'){e.preventDefault();showPalette()}
  if(e.key==='Escape')hidePalette();
});

loadTools();
</script></body></html>`;