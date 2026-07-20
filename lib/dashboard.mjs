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

/* ── Main Layout ── */
.main-wrap{display:flex;flex:1;overflow:hidden}
.sidebar{width:260px;background:#0c0c18;border-right:1px solid #1a1a2e;display:flex;flex-direction:column;flex-shrink:0;overflow:hidden}
.sidebar.hidden{display:none}
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
</style></head><body>

<div style="display:flex;flex-direction:column;height:100vh">
  <div class="main-wrap">
    <div class="activity-bar">
      <div class="activity-btn active" onclick="switchActivity('tools')" title="Tools">◈</div>
      <div class="activity-btn" onclick="switchActivity('playbooks')" title="Playbooks">◆</div>
      <div class="activity-btn" onclick="switchActivity('reports')" title="Reports">■</div>
      <div style="margin-top:auto" class="activity-btn" onclick="showPalette()" title="Commands">⌘</div>
    </div>

    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <span id="sidebarTitle">TOOLS</span>
        <span class="count" id="toolCount">—</span>
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
      <span class="item" id="statusToolCount">108 tools</span>
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
    tools=await api('/api/tools');
    const cats={};
    tools.forEach(t=>{const c=toolCat(t).cat;if(!cats[c])cats[c]=[];cats[c].push(t)});
    renderSidebar(cats);
    document.getElementById('toolCount').textContent=tools.length;
    document.getElementById('statusToolCount').textContent=tools.length+' tools';
    buildPalette();
  }catch(e){
    document.getElementById('sidebarContent').innerHTML='<div class=sidebar-empty>⛔ '+e.message+'</div>';
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

function execPalette(){
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
  
  if(name==='tools'){
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
  }
}

async function loadPlaybooks(){
  try{
    const l=await api('/api/playbooks');
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
    const l=await api('/api/reports');
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

// Keyboard shortcuts
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='p'){e.preventDefault();showPalette()}
  if(e.key==='Escape')hidePalette();
});

loadTools();
</script></body></html>`;