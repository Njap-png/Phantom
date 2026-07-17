# Phantom — Development Context

## What is Phantom?

**Phantom** is a multi-agent terminal AI turned **cybersecurity assistant** — zero-dependency on any system with Node.js 18+ (desktop, Termux on Android, CI). It spawns AI agents that use tools autonomously to perform recon, vulnerability research, scanning, and exploitation tasks.

## Current State (as of latest commit)

**62 hacker tools** in dual runtime (`.mjs` zero-dep + `src/` TypeScript):
- **6 core**: shell, web_fetch, decode, file_analyze, dns_lookup, hash
- **8 advanced**: whois, port_scan, http_headers, ssl_check, sub_enum, crawl, vt_check, yara
- **4 workflow**: recon, cve_search, searchsploit, bruteforce
- **5 file ops**: file_read, file_write, file_edit, file_search, file_list
- **3 self tools**: self_info, self_read, self_edit
- **2 auto-scan**: vuln_scan, report_save
- **2 sessions**: session_save, session_load
- **2 knowledge**: knowledge_add, knowledge_search
- **4 playbook**: playbook_create, playbook_list, playbook_run, playbook_edit
- **5 recon tools**: geoip, dns_zone, http_methods, robots_txt, email_verify
- **6 utility**: reverse_dns, wayback, cert_expiry, cors_test, jwt_decode, hash_crack
- **4 web security**: dir_bruteforce, xss_scan, sql_detect, open_redirect
- **4 OSINT**: shodan_search, email_breach, github_dork, sub_takeover
- **2 plugin system**: plugin_load, plugin_create
- **1 reporting**: report_export
- **1 LLM config**: llm_config
- **1 distro tools**: distro (Termux PRoot distro mgmt)
- **1 GUI dashboard**, 1 code_gen, 1 self_add_tool

## Project Structure

```
/root/phantom/
├── phantom.mjs          ← MAIN: Zero-dep standalone entry (what actually runs)
├── run.sh               ← Zero-setup bootstrap launcher
├── package.json         ← NPM metadata (optional deps)
├── tsconfig.json        ← TypeScript config
├── src/                 ← TypeScript source (refactored version)
│   ├── agents/
│   │   ├── agent.ts     ← Agent class with capabilities + persistence
│   │   ├── manager.ts   ← Agent orchestrator
│   │   └── types.ts     ← Types
│   ├── core/
│   │   ├── config.ts    ← Configuration
│   │   ├── eventbus.ts  ← Pub/sub event bus
│   │   ├── persistence.ts  ← Memory/knowledge save/load
│   │   ├── tools.ts     ← Dynamic tool system
│   │   └── hacker-tools.ts  ← 18 cybersecurity tool implementations
│   ├── providers/
│   │   └── openai.ts    ← OpenAI + Ollama provider
│   ├── ui/
│   │   ├── panels.ts    ← Desktop terminal UI
│   │   ├── terminal.ts
│   │   ├── termux.ts    ← Termux-specific UI
│   │   └── theme.ts     ← Color themes
│   └── index.ts         ← Entry point
└── CONTEXT.md           ← THIS FILE
```

## All 61 Tools

| Tool | What it does |
|------|-------------|
| `shell` | Execute ANY shell command (30s timeout) |
| `web_fetch` | Fetch URL, strip HTML, return text |
| `decode` | Auto-detect base64/hex/URL/binary/ROT13 |
| `file_analyze` | File type (magic bytes), hashes, entropy, strings |
| `dns_lookup` | DNS A/AAAA/MX/NS/TXT/CNAME/SOA records |
| `hash` | MD5/SHA1/SHA256 of text or file |
| `whois` | WHOIS lookup — registrar, dates, contacts |
| `port_scan` | TCP port scan — 30+ common ports or custom range |
| `http_headers` | HTTP response headers via HEAD request |
| `ssl_check` | SSL certificate details, expiry, cipher, SANs |
| `sub_enum` | Subdomain enumeration via crt.sh CT logs |
| `crawl` | Web crawler: extract links, forms, scripts |
| `vt_check` | VirusTotal hash lookup (requires `VT_API_KEY`) |
| `yara` | YARA malware pattern scanner (requires `yara` CLI) |
| `recon` | FULL AUTO RECON: WHOIS → DNS → subdomains → headers → SSL → ports → crawl → report |
| `cve_search` | Search NVD for CVEs by query (e.g. "apache 2.4.49") |
| `searchsploit` | Search exploit-db/packetstorm for public exploits |
| `bruteforce` | Multi-protocol brute force: SSH, FTP, HTTP, MySQL |
| `file_read` | Read any file (max 100KB) |
| `file_write` | Write content to any file (creates dirs) |
| `file_edit` | Find/replace text in a file |
| `file_search` | Search file contents by pattern |
| `file_list` | List directory contents with sizes |
| `self_info` | Show Phantom version, tools, runtime, LLM status |
| `self_read` | Read Phantom's own source (project-locked) |
| `self_edit` | Edit Phantom's own source (project-locked) |
| `vuln_scan` | 4-phase vuln scan → report: recon + CVEs + exploits + brute force |
| `report_save` | Save text as timestamped markdown report |
| `session_save` | Save Phantom session state to file |
| `session_load` | Load a saved Phantom session |
| `code_gen` | Generate code via LLM — `prompt|language|output_path` |
| `self_add_tool` | **Generate & auto-integrate new tool via LLM (patches both files, rebuilds)** |
| `knowledge_add` | **Save knowledge entry (tagged, searchable)** |
| `knowledge_search` | **Query Phantom's knowledge base** |
| `playbook_create` | **Create a multi-step automation playbook (LLM or manual)** |
| `playbook_list` | **List all playbooks (4 built-in + custom)** |
| `playbook_run` | **Execute a playbook against a target** |
| `playbook_edit` | **Edit playbook steps, description, or add steps** |
| `geoip` | **IP geolocation — country, city, ISP, ASN** |
| `dns_zone` | **DNS zone transfer vulnerability test** |
| `http_methods` | **Fuzz HTTP methods (GET/POST/PUT/DELETE/etc.)** |
| `robots_txt` | **Fetch & analyze robots.txt** |
| `email_verify` | **Validate email format + MX records** |
| `reverse_dns` | **Reverse DNS PTR lookup for an IP** |
| `wayback` | **Wayback Machine historical URL snapshots** |
| `cert_expiry` | **SSL cert expiry check (openssl)** |
| `cors_test` | **CORS misconfiguration scanner** |
| `jwt_decode` | **Decode JWT header + payload** |
| `hash_crack` | **Online MD5 rainbow table lookup** |
| `dir_bruteforce` | **🎯 Web dir brute: 30+ common paths** |
| `xss_scan` | **⚠️ XSS scanner: injects payloads, checks reflection** |
| `sql_detect` | **⚠️ SQLi detection: error signatures** |
| `open_redirect` | **🔀 Open redirect scanner: 15 params** |
| `shodan_search` | **🌐 Shodan device search (needs API key)** |
| `email_breach` | **🔒 HIBP breach lookup (needs API key)** |
| `github_dork` | **🔍 GitHub code search for secrets** |
| `sub_takeover` | **⚠️ Subdomain CNAME takeover check** |
| `plugin_load` | **🔌 Load external plugins dynamically** |
| `plugin_create` | **🔌 Create plugin skeleton** |
| `report_export` | **📄 Export report to HTML/PDF** |
| `llm_config` | **🤖 Configure LLM provider: switch, set keys, list** |
| `distro` | **📦 Show/manage Linux distros (Termux PRoot env)** |

## How to Use

### CLI One-Shot Mode
```bash
node phantom.mjs                           # zero-dep interactive
OPENAI_API_KEY=sk-... node phantom.mjs     # with AI agents
OLLAMA_HOST=http://localhost:11434 node phantom.mjs  # local LLM (offline)

node phantom.mjs --recon example.com           # full recon + report
node phantom.mjs --tool cve_search "nginx"     # run one tool
node phantom.mjs --tool port_scan scanme.org   # port scan
node phantom.mjs --tool bruteforce "ssh|host|root|pass1,pass2"
node phantom.mjs --list                        # list all 62 tools
node phantom.mjs --gui                         # web dashboard (port 8080)
node phantom.mjs --api                         # REST API server (port 9090)
node phantom.mjs --help                        # show help
```

## REST API (`--api`)

Start the standalone API server on port 9090 (or `PHANTOM_API_PORT`):
```bash
node phantom.mjs --api
```

All responses are JSON `{ ok: true, data }` or `{ ok: false, error }`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api` | API overview, tool list, version |
| `GET` | `/api/tools` | List all 62 tools |
| `GET` | `/api/info` | Tool metadata |
| `GET` | `/api/tool/:name` | Specific tool info |
| `GET` / `POST` | `/api/run?tool=X&args=Y` or `POST {"tool":"X","args":"Y"}` | Execute any tool |
| `GET` | `/api/playbooks` | List playbooks |
| `GET` / `POST` | `/api/playbook/run?name=X&vars=Y` | Run a playbook |
| `GET` | `/api/reports` | List reports |
| `GET` | `/api/report/:name` | View a report |
| `GET` | `/api/health` | Health check (status, pid, uptime, tool count) |

Examples:
```bash
# List tools
curl http://localhost:9090/api/tools

# Execute a tool (GET)
curl "http://localhost:9090/api/run?tool=dns_lookup&args=example.com"

# Execute a tool (POST)
curl -X POST http://localhost:9090/api/run \
  -H 'Content-Type: application/json' \
  -d '{"tool":"port_scan","args":"scanme.org"}'

# Health check
curl http://localhost:9090/api/health
```

## Offline / Local LLM

Set `OLLAMA_HOST` to use a local Ollama instance:
```bash
OLLAMA_HOST=http://localhost:11434 node phantom.mjs
```

Phantom will use Ollama for AI features (agent mode, code gen, etc.) instead of OpenAI.
No internet connection needed — run fully air-gapped with your local models.

## Multi-Provider LLM

Choose from **8 providers** at runtime — no restart needed:

| Provider | Env Var | Default Model |
|----------|---------|---------------|
| OpenAI | `OPENAI_API_KEY` | gpt-4o |
| Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4 |
| Google Gemini | `GEMINI_API_KEY` | gemini-2.0-flash |
| Groq | `GROQ_API_KEY` | llama-3.3-70b |
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat |
| Mistral | `MISTRAL_API_KEY` | mistral-large |
| OpenRouter | `OPENROUTER_API_KEY` | claude-sonnet-4 |
| Ollama | `OLLAMA_HOST` (base URL) | llama3 |

**Set API key via env:**
```bash
ANTHROPIC_API_KEY=sk-ant-... node phantom.mjs
```

**Set API key at runtime (persisted to config.json):**
```
@llm_config|set ANTHROPIC_API_KEY sk-ant-...
```

**Switch provider at runtime:**
```
@llm_config|anthropic
@llm_config|openai
@llm_config|ollama
```

**View status:**
```
@llm_config|list
```

All keys can also be saved to `~/.config/phantom/config.json`:
```json
{ "default_provider": "anthropic", "ANTHROPIC_API_KEY": "sk-ant-..." }
```

### Tool Calling Format (for LLM agents)
```
@tool_name|argument
```

## Config System
Auto-loads from `~/.config/phantom/config.json`:
```json
{
  "VT_API_KEY": "your-key-here",
  "report_dir": "/path/to/reports"
}
```

## What's Left To Do

- [x] **Web UI / dashboard** — `node phantom.mjs --gui` or `npm run dashboard`
- [x] **Web app security scanning** — dir bruteforce, XSS, SQLi, open redirect
- [x] **OSINT & recon tools** — Shodan, email breach, GitHub dork, subdomain takeover
- [x] **Plugin system** — Extend Phantom with external modules
- [x] **Report export** — HTML/PDF report generation
- [ ] **Local model support** — Offline LLM via Ollama
- [ ] **Autonomous agent chaining** — Multi-agent parallel playbook runs
- [ ] **Distributed scanning** — Phantom runs across multiple hosts

### Web Dashboard
Start the dashboard with zero extra dependencies:

```
node phantom.mjs --gui
# or
npm run dashboard
```

Opens at **http://localhost:8080**. Custom port via `PHANTOM_PORT` env.

**Tabs:**
- **🛠 Tools** — Grid of all 49 tools, search bar, click to open & run with args. Output streams inline.
- **📋 Playbooks** — List available playbooks, click to run with variable substitution.
- **📄 Reports** — View saved scan reports.

Built with vanilla JS/HTML/CSS. No npm deps, no CDN, no build step. Works in every browser including mobile Termux.

### External Deps (optional)
- `OPENAI_API_KEY` — enables code_gen, self_add_tool (auto-integrate), playbook_create LLM generation
- `VT_API_KEY` — enables VirusTotal hash lookups
- `yara` CLI — enables YARA scanning (`apt install yara`)
- `whois` CLI — enables WHOIS lookups (`apt install whois`)
- `sshpass` CLI — enables SSH brute force (`apt install sshpass`)
- `mysql` CLI — enables MySQL brute force (`apt install mysql-client`)
- `searchsploit` CLI — enables exploit-db queries (`apt install exploitdb`)
- `openssl` — enables cert_expiry tool (usually pre-installed)

## Git Config
- User: `Njap-png`
- Email: `teddy.njagi.w@gmail.com`
- Remote: `https://github.com/Njap-png/phantom.git`
- Auth: Token in `~/.git-credentials`
