# Phantom — Development Context

## What is Phantom?

**Phantom** is a multi-agent terminal AI turned **cybersecurity assistant** — zero-dependency on any system with Node.js 18+ (desktop, Termux on Android, CI). It spawns AI agents that use tools autonomously to perform recon, vulnerability research, scanning, and exploitation tasks.

## Current State (as of latest commit)

**18 hacker tools** in dual runtime (`.mjs` zero-dep + `src/` TypeScript):
- **6 core**: shell, web_fetch, decode, file_analyze, dns_lookup, hash
- **8 advanced**: whois, port_scan, http_headers, ssl_check, sub_enum, crawl, vt_check, yara
- **4 workflow**: recon, cve_search, searchsploit, bruteforce

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

## All 49 Tools

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

## How to Use

### Interactive Mode
```bash
node phantom.mjs                     # zero-dep entry
OPENAI_API_KEY=sk-... node phantom.mjs  # with AI agents
```

### CLI One-Shot Mode
```bash
node phantom.mjs --recon example.com           # full recon + report
node phantom.mjs --tool cve_search "nginx"     # run one tool
node phantom.mjs --tool port_scan scanme.org   # port scan
node phantom.mjs --tool bruteforce "ssh|host|root|pass1,pass2"
node phantom.mjs --list                        # list all tools
node phantom.mjs --gui                         # start web dashboard
node phantom.mjs --help                        # show help
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

- [x] **Web UI / dashboard** — Start with `node phantom.mjs --gui` or `npm run dashboard`
- [ ] **Local model support** — Offline LLM via Ollama
- [ ] **Autonomous agent chaining** — Multi-agent parallel playbook runs
- [ ] **Distributed scanning** — Phantom runs across multiple hosts
- [ ] **Plugin system** — Load external tool packs dynamically

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
