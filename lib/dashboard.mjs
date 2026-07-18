// Phantom — Dashboard embedded HTML/CSS/JS
// Dark neon hacker aesthetic — violet/cyan hooded figure theme
// Extracted from phantom.mjs for cleaner module structure

export const DASHBOARD_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phantom Dashboard</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#c8d6e5;font-family:'Cascadia Code','Fira Code','JetBrains Mono',monospace;font-size:13px;min-height:100vh;overflow-x:hidden}
::selection{background:#a855f766;color:#fff}
::-webkit-scrollbar{width:4px;background:#0a0a0f}::-webkit-scrollbar-thumb{background:#a855f744;border-radius:2px}::-webkit-scrollbar-thumb:hover{background:#a855f788}

/* ── Header ── */
header{background:linear-gradient(135deg,#0a0a1a 0%,#1a0a2e 50%,#0a1a2e 100%);border-bottom:1px solid #a855f744;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;position:relative}
header::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#a855f7,#22d3ee,transparent)}
header h1{color:#c084fc;font-size:20px;letter-spacing:2px;text-shadow:0 0 20px #a855f744}
header h1 span{color:#22d3ee}
#status{font-size:11px;color:#22d3ee88;display:flex;align-items:center;gap:6px}
#status::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:#22d3ee;box-shadow:0 0 8px #22d3ee;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* ── Hooded figure logo ── */
.logo-area{text-align:center;padding:12px 0 8px;position:relative}
.logo-area pre{display:inline-block;color:#22d3ee;font-size:9px;line-height:1.15;letter-spacing:0;text-shadow:0 0 10px #22d3ee22}
.logo-area .tagline{font-size:11px;color:#a855f7;letter-spacing:3px;margin-top:-2px;text-shadow:0 0 15px #a855f744}

/* ── Tabs ── */
.tabs{display:flex;background:#0a0a14;border-bottom:1px solid #1a1a2e;padding:0 24px;gap:0}
.tab{padding:10px 20px;cursor:pointer;color:#5a6a7a;border-bottom:2px solid transparent;transition:all .2s;font-size:12px;letter-spacing:.5px}
.tab:hover{color:#c084fc;border-bottom-color:#c084fc66}
.tab.active{color:#c084fc;border-bottom-color:#c084fc;text-shadow:0 0 10px #a855f744}

/* ── Content ── */
.content{padding:16px 24px;display:none}.content.active{display:block}

/* ── Search ── */
.search-box{width:100%;padding:10px 14px;background:#0a0a14;border:1px solid #1a1a3e;border-radius:6px;color:#c8d6e5;font-family:inherit;font-size:13px;margin-bottom:16px;outline:none;transition:border-color .2s}
.search-box:focus{border-color:#a855f788;box-shadow:0 0 12px #a855f722}

/* ── Tool grid ── */
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.tool-card{background:linear-gradient(135deg,#0f0f1e,#0a0a18);border:1px solid #1a1a3e;border-radius:6px;padding:10px 14px;cursor:pointer;transition:all .2s;position:relative;overflow:hidden}
.tool-card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#a855f744,transparent);opacity:0;transition:opacity .2s}
.tool-card:hover::before{opacity:1}
.tool-card:hover{border-color:#a855f766;background:linear-gradient(135deg,#14142a,#0e0e22);transform:translateY(-1px);box-shadow:0 4px 20px #a855f711}
.tool-card .name{color:#c084fc;font-size:12px;font-weight:700;transition:color .2s}
.tool-card:hover .name{color:#d8b4fe}
.tool-card .cat-badge{display:inline-block;font-size:9px;padding:1px 6px;border-radius:3px;margin-left:6px;vertical-align:middle;letter-spacing:.3px}
.cat-core{background:#22d3ee22;color:#22d3ee;border:1px solid #22d3ee33}
.cat-recon{background:#a855f722;color:#c084fc;border:1px solid #a855f733}
.cat-web{background:#f59e0b22;color:#fbbf24;border:1px solid #f59e0b33}
.cat-cve{background:#ef444422;color:#f87171;border:1px solid #ef444433}
.cat-osint{background:#10b98122;color:#34d399;border:1px solid #10b98133}
.cat-file{background:#6366f122;color:#818cf8;border:1px solid #6366f133}
.cat-default{background:#ffffff0a;color:#5a6a7a;border:1px solid #ffffff11}

.tool-detail{display:none;margin-top:8px;padding-top:8px;border-top:1px solid #1a1a3e}.tool-detail.open{display:block}
.tool-detail input{width:100%;padding:6px 10px;background:#050510;border:1px solid #2a1a4e;border-radius:4px;color:#c8d6e5;font-family:inherit;font-size:12px;margin-bottom:6px;outline:none;transition:border-color .2s}
.tool-detail input:focus{border-color:#a855f7}
.tool-detail button,.playbook-detail button{background:linear-gradient(135deg,#a855f722,#22d3ee22);color:#c084fc;border:1px solid #a855f744;padding:4px 14px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px;transition:all .2s}
.tool-detail button:hover{background:linear-gradient(135deg,#a855f744,#22d3ee44);box-shadow:0 0 12px #a855f722}

/* ── Output ── */
.output{background:#050510;border:1px solid #1a1a3e;border-radius:6px;padding:14px;margin-top:12px;max-height:450px;overflow:auto;font-size:11px;white-space:pre-wrap;display:none;font-family:inherit}
.output.show{display:block}
.output .prompt{color:#22d3ee88;font-weight:700}
.output .result-out{color:#c8d6e5}
.output .result-err{color:#f87171}
.output .result-ok{color:#34d399}

/* ── Playbooks & Reports ── */
.playbook-item,.report-item{background:linear-gradient(135deg,#0f0f1e,#0a0a18);border:1px solid #1a1a3e;border-radius:6px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:all .2s}
.playbook-item:hover,.report-item:hover{border-color:#a855f766;transform:translateY(-1px)}
.playbook-item .name{color:#fbbf24;font-size:13px}
.playbook-item .desc,.report-item .name{color:#5a6a7a;font-size:11px}
.playbook-detail{display:none;margin-top:8px;padding:10px;background:#050510;border-radius:4px;border:1px solid #1a1a3e}
.playbook-detail.open{display:block}
.playbook-detail input{width:100%;padding:6px 10px;background:#050510;border:1px solid #3a2a1e;border-radius:4px;color:#c8d6e5;font-family:inherit;font-size:12px;margin:4px 0;outline:none}
.playbook-detail input:focus{border-color:#f59e0b}
.playbook-detail button{background:linear-gradient(135deg,#f59e0b22,#f9731622);color:#fbbf24;border-color:#f59e0b44}
.playbook-detail button:hover{background:linear-gradient(135deg,#f59e0b44,#f9731644)}
.report-item .size{color:#3a4a5a;font-size:10px;margin-left:8px}
#reportViewer{display:none;background:#050510;border:1px solid #1a1a3e;border-radius:6px;padding:16px;margin-top:8px;max-height:500px;overflow:auto;white-space:pre-wrap;font-size:11px;color:#c8d6e5}
#reportViewer.show{display:block}
.loading,.error{color:#5a6a7a;text-align:center;padding:20px;font-size:12px}
.error{color:#f87171}

/* ── Status bar ── */
.status-bar{background:linear-gradient(90deg,#0a0a1a,#0a0a14,#0a0a1a);border-top:1px solid #1a1a3e;padding:6px 24px;font-size:10px;color:#3a4a5a;display:flex;justify-content:space-between;position:fixed;bottom:0;left:0;right:0}
.status-bar span{display:flex;align-items:center;gap:4px}
.status-bar .dot{width:6px;height:6px;border-radius:50%;display:inline-block}
.status-bar .dot.on{background:#22d3ee;box-shadow:0 0 6px #22d3ee}
.status-bar .dot.off{background:#3a4a5a}

@media(max-width:600px){.tool-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}.content{padding:12px}.tabs{padding:0 12px}}
</style></head><body>
<header>
  <h1><span>⋊</span> PHANTOM <span>⋉</span></h1>
  <span id="status">● connected</span>
</header>
<div class="logo-area"><pre id="logo-ascii"></pre><div class="tagline">CYBERSECURITY AI · <span id="hdrCount">—</span> TOOLS</div></div>
<div class="tabs">
  <div class="tab active" onclick="switchTab('tools')">◈ Tools</div>
  <div class="tab" onclick="switchTab('playbooks')">◆ Playbooks</div>
  <div class="tab" onclick="switchTab('reports')">■ Reports</div>
</div>
<div id="tools" class="content active">
  <input class="search-box" id="search" placeholder="filter tools..." oninput="filter(this.value)">
  <div class="tool-grid" id="grid"><div class="loading">⟳ loading...</div></div>
  <div id="output" class="output"></div>
</div>
<div id="playbooks" class="content"><div id="pbList"><div class="loading">⟳ loading...</div></div></div>
<div id="reports" class="content"><div id="rptList"><div class="loading">⟳ loading...</div></div><div id="reportViewer"></div></div>
<div class="status-bar"><span><span class="dot on"></span><span id="tcount">—</span></span><span>⋉ phantom v0.2.0 ⋊</span></div>
<script>
const HOODIE = [
  '  \\x1b[36m  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  \\x1b[0m',
  '  \\x1b[36m \\x1b[35m═══ ═══ ═══ ═══ ═══\\x1b[36m \\x1b[0m',
  '  \\x1b[36m▐█\\x1b[35m ·   ·   ·   ·   ·\\x1b[36m █▌\\x1b[0m',
  '  \\x1b[36m▐█   \\x1b[35m╔═══════════╗\\x1b[36m   █▌\\x1b[0m',
  '  \\x1b[36m▐█   \\x1b[35m║ \\x1b[32m◈     ◈\\x1b[35m ║\\x1b[36m   █▌\\x1b[0m',
  '  \\x1b[36m▐█   \\x1b[35m║\\x1b[2m  ╔═══╗\\x1b[35m   ║\\x1b[36m   █▌\\x1b[0m',
  '  \\x1b[36m▐█   \\x1b[35m╚═══════════╝\\x1b[36m   █▌\\x1b[0m',
  '  \\x1b[36m █   \\x1b[35m┊ \\x1b[2m║\\x1b[35m   \\x1b[2m║\\x1b[35m ┊\\x1b[36m   █\\x1b[0m',
  '  \\x1b[36m █   \\x1b[35m┊ \\x1b[2m║\\x1b[35m ● \\x1b[2m║\\x1b[35m ┊\\x1b[36m   █\\x1b[0m',
  '  \\x1b[36m ▀▄  \\x1b[2m║\\x1b[35m ═══ \\x1b[2m║\\x1b[36m  ▄▀\\x1b[0m',
  '  \\x1b[35m    P H A N T O M\\x1b[0m'].join('\\n');
document.getElementById('logo-ascii').textContent = HOODIE;

const B='';let tools=[];
async function api(p,o){const r=await fetch(B+p,o);if(!r.ok)throw new Error(r.statusText);return r.json()}
async function loadTools(){try{tools=await api('/api/tools');const c=tools.length;document.getElementById('tcount').textContent=c+' tools';document.getElementById('hdrCount').textContent=c;render(tools)}catch(e){document.getElementById('grid').innerHTML='<div class=error>'+e.message+'</div>'}}
function catClass(t){const n=t.toLowerCase();if(['shell','web_fetch','decode','encode','hash','file_analyze','batch','code_analyze','code_gen','yara'].some(x=>n.includes(x)))return'cat-core';if(['dns','whois','sub_enum','subfinder','port_scan','http_headers','ssl_check','crawl','geoip','dns_zone','reverse_dns','wayback','robots_txt','amass','dnsx','httpx','naabu','katana','sub_takeover','cloud_enum','dns_lookup'].some(x=>n.includes(x)))return'cat-recon';if(['dir_brute','xss','sql','open_redirect','cors_test','http_methods','ffuf','arjun','nuclei','cve','searchsploit','shodan'].some(x=>n.includes(x)))return'cat-cve';if(['email','github_dork','vt_check','wayback','cloud'].some(x=>n.includes(x)))return'cat-osint';if(['file_read','file_write','file_edit','file_search','file_list','file_analyze'].some(x=>n.includes(x)))return'cat-file';return'cat-default'}
function render(n){document.getElementById('grid').innerHTML=n.map((t,i)=>'<div class=tool-card onclick="td('+i+')"><div class=name>@'+t+' <span class="cat-badge '+catClass(t)+'">'+catClass(t).replace('cat-','').toUpperCase()+'</span></div><div class=tool-detail id=td'+i+'><input id=in'+i+' placeholder="args..." onkeydown="if(event.key===\\\'Enter\\\')run(t,'+i+')"><button onclick="run(\\''+t+'\\','+i+')">▶ Run</button></div></div>').join('')}
function td(i){document.getElementById('td'+i).classList.toggle('open')}
async function run(t,i){const v=document.getElementById('in'+i).value;const o=document.getElementById('output');o.classList.add('show');o.innerHTML+='<span class=prompt>⧩</span> @'+t+'|'+v+'\\n';o.scrollTop=o.scrollHeight;try{const r=await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:t,args:v})});o.innerHTML+='<span class=result-ok>'+r.result+'</span>\\n\\n'}catch(e){o.innerHTML+='<span class=result-err>⛔ '+e.message+'</span>\\n\\n'}o.scrollTop=o.scrollHeight}
function filter(q){const f=q.toLowerCase();document.querySelectorAll('.tool-card').forEach((c,i)=>{c.style.display=tools[i].includes(f)?'':'none'})}
async function loadPb(){try{const l=await api('/api/playbooks');const d=document.getElementById('pbList');if(!l.length){d.innerHTML='<div style=color:#5a6a7a;text-align:center;padding:20px;font-size:12px>◆ no playbooks</div>';return}d.innerHTML=l.map((p,i)=>'<div class=playbook-item onclick="tpb('+i+')"><div class=name>◆ '+p.name+'</div><div class=desc>'+(p.description||'')+' — '+p.steps+' steps</div><div class="playbook-detail" id=pd'+i+'><input id=pv'+i+' placeholder="target=example.com" value=target=><button onclick="rpb(\\''+p.name+'\\','+i+')">▶ Run</button></div></div>').join('')}catch(e){document.getElementById('pbList').innerHTML='<div class=error>'+e.message+'</div>'}}
function tpb(i){document.getElementById('pd'+i).classList.toggle('open')}
async function rpb(n,i){const v=document.getElementById('pv'+i).value;const o=document.getElementById('output');o.classList.add('show');o.innerHTML+='<span class=prompt>⧩</span> ◆ '+n+'|'+v+'\\n';try{const r=await api('/api/playbook/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,vars:v})});o.innerHTML+='<span class=result-out>'+r.result+'</span>\\n\\n'}catch(e){o.innerHTML+='<span class=result-err>⛔ '+e.message+'</span>\\n\\n'}o.scrollTop=o.scrollHeight;switchTab('tools')}
async function loadRpt(){try{const l=await api('/api/reports');const d=document.getElementById('rptList');if(!l.length){d.innerHTML='<div style=color:#5a6a7a;text-align:center;padding:20px;font-size:12px>■ no reports</div>';return}d.innerHTML=l.map(r=>'<div class=report-item onclick="viewRpt(\\''+r.name+'\\')"><span class=name>■ '+r.name+'</span><span class=size>'+r.size+'</span></div>').join('')}catch(e){document.getElementById('rptList').innerHTML='<div class=error>'+e.message+'</div>'}}
async function viewRpt(n){try{const r=await api('/api/report/'+encodeURIComponent(n));const v=document.getElementById('reportViewer');v.textContent=r.content;v.classList.add('show')}catch(e){}}
function switchTab(n){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.content').forEach(c=>c.classList.remove('active'));document.querySelector('.tab:nth-child('+(n==='tools'?1:n==='playbooks'?2:3)+')').classList.add('active');document.getElementById(n).classList.add('active');if(n==='playbooks')loadPb();if(n==='reports')loadRpt()}
loadTools();
</script></body></html>`;