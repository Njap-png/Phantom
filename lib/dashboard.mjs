// Phantom — Dashboard embedded HTML/CSS/JS
// Extracted from phantom.mjs for cleaner module structure

export const DASHBOARD_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phantom Dashboard</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#c8d6e5;font-family:'Cascadia Code','Fira Code','JetBrains Mono',monospace;font-size:13px;min-height:100vh}
header{background:linear-gradient(135deg,#0f0f1a,#1a1a2e);border-bottom:1px solid #00ff8844;padding:12px 20px;display:flex;justify-content:space-between}
header h1{color:#00ff88;font-size:18px;letter-spacing:1px}
.tabs{display:flex;background:#0f0f1a;border-bottom:1px solid #1a1a2e;padding:0 20px}
.tab{padding:10px 20px;cursor:pointer;color:#5a6a7a;border-bottom:2px solid transparent;transition:.2s;font-size:12px}
.tab:hover,.tab.active{color:#00ff88;border-bottom-color:#00ff88}
.content{padding:16px 20px;display:none}.content.active{display:block}
.search-box{width:100%;padding:8px 12px;background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;color:#c8d6e5;font-family:inherit;font-size:12px;margin-bottom:16px;outline:none}
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.tool-card{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:10px 12px;cursor:pointer;transition:.2s}
.tool-card:hover{border-color:#00ff8844;background:#12122a}
.tool-card .name{color:#00ff88;font-size:12px;font-weight:700}
.tool-detail{display:none;margin-top:8px}.tool-detail.open{display:block}
.tool-detail input{width:100%;padding:6px 10px;background:#05050a;border:1px solid #1a2a1a;border-radius:3px;color:#c8d6e5;font-family:inherit;font-size:12px;margin-bottom:6px;outline:none}
.tool-detail button,.playbook-detail button{background:#00ff8822;color:#00ff88;border:1px solid #00ff8844;padding:4px 14px;border-radius:3px;cursor:pointer;font-family:inherit;font-size:11px}
.tool-detail button:hover{background:#00ff8844}
.output{background:#05050a;border:1px solid #1a1a2e;border-radius:4px;padding:12px;margin-top:12px;max-height:400px;overflow:auto;font-size:11px;white-space:pre-wrap;display:none}
.output.show{display:block}.output .prompt{color:#00ff8844}
.playbook-item,.report-item{background:#0f0f1a;border:1px solid #1a1a2e;border-radius:4px;padding:12px;margin-bottom:8px;cursor:pointer}
.playbook-item:hover,.report-item:hover{border-color:#ffaa0044}
.playbook-item .name{color:#ffaa00;font-size:13px}
.playbook-item .desc,.report-item .name{color:#5a6a7a;font-size:11px}
.playbook-detail{display:none;margin-top:8px;padding:8px;background:#05050a;border-radius:3px}
.playbook-detail.open{display:block}
.playbook-detail input{width:100%;padding:6px 10px;background:#05050a;border:1px solid #3a2a00;border-radius:3px;color:#c8d6e5;font-family:inherit;font-size:12px;margin:4px 0;outline:none}
.report-item .size{color:#3a4a5a;font-size:10px;margin-left:8px}
#reportViewer{display:none;background:#05050a;border:1px solid #1a1a2e;border-radius:4px;padding:16px;margin-top:8px;max-height:500px;overflow:auto;white-space:pre-wrap;font-size:11px}
#reportViewer.show{display:block}
.loading,.error{color:#5a6a7a;text-align:center;padding:20px;font-size:12px}
.status-bar{background:#0f0f1a;border-top:1px solid #1a1a2e;padding:6px 20px;font-size:10px;color:#3a4a5a;display:flex;justify-content:space-between}
::-webkit-scrollbar{width:4px;background:#0a0a0f}::-webkit-scrollbar-thumb{background:#1a1a2e;border-radius:2px}
@media(max-width:600px){.tool-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}}
</style></head><body>
<header><h1>🔮 PHANTOM</h1><span id="status">● localhost:PORT</span></header>
<div class="tabs"><div class="tab active" onclick="switchTab('tools')">🛠 Tools</div><div class="tab" onclick="switchTab('playbooks')">📋 Playbooks</div><div class="tab" onclick="switchTab('reports')">📄 Reports</div></div>
<div id="tools" class="content active"><input class="search-box" id="search" placeholder="Search tools..." oninput="filter(this.value)"><div class="tool-grid" id="grid"><div class="loading">Loading...</div></div><div id="output" class="output"></div></div>
<div id="playbooks" class="content"><div id="pbList"><div class="loading">Loading...</div></div></div>
<div id="reports" class="content"><div id="rptList"><div class="loading">Loading...</div></div><div id="reportViewer"></div></div>
<div class="status-bar"><span id="tcount">—</span><span>● connected</span></div>
<script>
const B='';let tools=[];
async function api(p,o){const r=await fetch(B+p,o);if(!r.ok)throw new Error(r.statusText);return r.json()}
async function loadTools(){try{tools=await api('/api/tools');document.getElementById('tcount').textContent=tools.length+' tools';render(tools)}catch(e){document.getElementById('grid').innerHTML='<div class=error>'+e.message+'</div>'}}
function render(n){document.getElementById('grid').innerHTML=n.map((t,i)=>'<div class=tool-card onclick="td('+i+')"><div class=name>@'+t+'</div><div class=tool-detail id=td'+i+'><input id=in'+i+' placeholder=Args... onkeydown="if(event.key===\\'Enter\\')run(t,'+i+')"><button onclick="run(\\''+t+'\\','+i+')">▶ Run</button></div></div>').join('')}
function td(i){document.getElementById('td'+i).classList.toggle('open')}
async function run(t,i){const v=document.getElementById('in'+i).value;const o=document.getElementById('output');o.classList.add('show');o.innerHTML+='<span class=prompt>$</span> @'+t+'|'+v+'\\n';o.scrollTop=o.scrollHeight;try{const r=await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:t,args:v})});o.innerHTML+=r.result+'\\n\\n'}catch(e){o.innerHTML+='<span class=error>[Error] '+e.message+'</span>\\n\\n'}o.scrollTop=o.scrollHeight}
function filter(q){document.querySelectorAll('.tool-card').forEach((c,i)=>{c.style.display=tools[i].includes(q.toLowerCase())?'':'none'})}
async function loadPb(){try{const l=await api('/api/playbooks');const d=document.getElementById('pbList');if(!l.length){d.innerHTML='<div style=color:#5a6a7a>No playbooks.</div>';return}d.innerHTML=l.map((p,i)=>'<div class=playbook-item onclick="tpb('+i+')"><div class=name>📋 '+p.name+'</div><div class=desc>'+(p.description||'')+' — '+p.steps+' steps</div><div class="playbook-detail" id=pd'+i+'><input id=pv'+i+' placeholder="target=example.com" value=target=><button onclick="rpb(\\''+p.name+'\\','+i+')">▶ Run</button></div></div>').join('')}catch(e){document.getElementById('pbList').innerHTML='<div class=error>'+e.message+'</div>'}}
function tpb(i){document.getElementById('pd'+i).classList.toggle('open')}
async function rpb(n,i){const v=document.getElementById('pv'+i).value;const o=document.getElementById('output');o.classList.add('show');o.innerHTML+='<span class=prompt>$</span> 📋 '+n+'|'+v+'\\n';try{const r=await api('/api/playbook/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,vars:v})});o.innerHTML+=r.result+'\\n\\n'}catch(e){o.innerHTML+='<span class=error>'+e.message+'</span>\\n\\n'}o.scrollTop=o.scrollHeight;switchTab('tools')}
async function loadRpt(){try{const l=await api('/api/reports');const d=document.getElementById('rptList');if(!l.length){d.innerHTML='<div style=color:#5a6a7a>No reports.</div>';return}d.innerHTML=l.map(r=>'<div class=report-item onclick="viewRpt(\\''+r.name+'\\')"><span class=name>📄 '+r.name+'</span><span class=size>'+r.size+'</span></div>').join('')}catch(e){document.getElementById('rptList').innerHTML='<div class=error>'+e.message+'</div>'}}
async function viewRpt(n){try{const r=await api('/api/report/'+encodeURIComponent(n));const v=document.getElementById('reportViewer');v.textContent=r.content;v.classList.add('show')}catch(e){}}
function switchTab(n){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.content').forEach(c=>c.classList.remove('active'));document.querySelector('.tab:nth-child('+(n==='tools'?1:n==='playbooks'?2:3)+')').classList.add('active');document.getElementById(n).classList.add('active');if(n==='playbooks')loadPb();if(n==='reports')loadRpt()}
loadTools();
</script></body></html>`;
