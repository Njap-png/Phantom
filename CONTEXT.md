# Phantom — Development Context

## What is Phantom?

**Phantom** is a multi-agent terminal AI turned **cybersecurity assistant** — zero-dependency on any system with Node.js 18+ (desktop, Termux on Android, CI). It spawns AI agents that use tools autonomously to perform recon, vulnerability research, scanning, and exploitation tasks.

## Current State (as of latest commit: `c111c5d`)

**62 hacker tools** in dual runtime (`.mjs` zero-dep + `src/` TypeScript):

| Category | Tools | Count |
|----------|-------|-------|
| Core | shell, web_fetch, decode, file_analyze, dns_lookup, hash | 6 |
| Advanced | whois, port_scan, http_headers, ssl_check, sub_enum, crawl, vt_check, yara | 8 |
| Workflow | recon, cve_search, searchsploit, bruteforce | 4 |
| File ops | file_read, file_write, file_edit, file_search, file_list | 5 |
| Self | self_info, self_read, self_edit | 3 |
| Auto-scan | vuln_scan, report_save | 2 |
| Sessions | session_save, session_load | 2 |
| Knowledge | knowledge_add, knowledge_search | 2 |
| Playbook | playbook_create, playbook_list, playbook_run, playbook_edit | 4 |
| Recon | geoip, dns_zone, http_methods, robots_txt, email_verify | 5 |
| Utility | reverse_dns, wayback, cert_expiry, cors_test, jwt_decode, hash_crack | 6 |
| Web sec | dir_bruteforce, xss_scan, sql_detect, open_redirect | 4 |
| OSINT | shodan_search, email_breach, github_dork, sub_takeover | 4 |
| Plugin | plugin_load, plugin_create | 2 |
| Reporting | report_export | 1 |
| LLM config | llm_config | 1 |
| Distro | distro (PRoot env mgmt) | 1 |
| Code gen | code_gen | 1 |
| Self-build | self_add_tool | 1 |
| GUI | dashboard | 1 |

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
│   │   └── ...          ← Terminal, Termux, Theme
│   └── index.ts         ← Entry point
├── gui/
│   └── server.ts        ← Web dashboard server
└── CONTEXT.md           ← THIS FILE
```

## How to Run

### One command (symlinked to PATH)
```bash
phantom                               # conversational REPL (default)
phantom --recon example.com           # full recon + report
phantom --tool cve_search "nginx"     # run one tool
phantom --tool port_scan scanme.org   # port scan
phantom --list                        # list all 62 tools
phantom --gui                         # web dashboard (port 8080)
phantom --api                         # REST API server (port 9090)
phantom --help                        # show help
```

### With LLM
```bash
OPENAI_API_KEY=sk-... phantom        # with AI agents
OLLAMA_HOST=http://localhost:11434 phantom  # local LLM (offline)
```

### No PATH symlink
```bash
node phantom.mjs                     # same as above
```

## Conversational REPL

Default mode is a **Hermes/Claude Code** style interactive shell. Features:
- `❯` prompt with arrow-key history, cursor movement, multi-line (`\` continuation)
- `/help`, `/tools`, `/model`, `/clear`, `/save`, `/load`, `/quit` commands
- Code blocks rendered with `┌─` / `│` / `└─` box-drawing
- Tool calls shown with `⚡ @tool|args`
- Auto-detects LLM provider; falls back to tools-only mode if no key set

## REST API (`--api`)

Start on port 9090 (or `PHANTOM_API_PORT`):
```bash
phantom --api
```

All responses are JSON `{ ok: true, data }` or `{ ok: false, error }`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api` | API overview, tool list, version |
| `GET` | `/api/tools` | List all 62 tools |
| `GET` | `/api/info` | Tool metadata |
| `GET` | `/api/tool/:name` | Specific tool info |
| `GET` / `POST` | `/api/run?tool=X&args=Y` or POST `{tool, args}` | Execute any tool |
| `GET` | `/api/playbooks` | List playbooks |
| `GET` / `POST` | `/api/playbook/run?name=X&vars=Y` | Run a playbook |
| `GET` | `/api/reports` | List reports |
| `GET` | `/api/report/:name` | View a report |
| `GET` | `/api/health` | Health check (status, pid, uptime, tool count) |

## Web Dashboard (`--gui`)

Zero-dep web UI at **http://localhost:8080** (or `PHANTOM_PORT`):
```bash
phantom --gui
```

**Tabs:** Tools grid (search + run), Playbooks (list + run with vars), Reports (view saved).

Built with vanilla JS/HTML/CSS. No npm, no CDN, no build step. Works in any browser including mobile Termux.

## Offline / Local LLM

Ollama fully supported:
```bash
OLLAMA_HOST=http://localhost:11434 phantom
```

Phantom will use Ollama for AI features (agent mode, code gen, playbook creation) instead of OpenAI. No internet needed.

## Multi-Provider LLM

**8 providers** at runtime — no restart. Switch with `@llm_config|<provider>` or `llm_config|<provider>`.

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

Set key at runtime (persisted to `~/.config/phantom/config.json`):
```
@llm_config|set ANTHROPIC_API_KEY sk-ant-...
```

Switch at runtime:
```
@llm_config|anthropic
@llm_config|ollama
@llm_config|list
```

## Config System

Auto-loads from `~/.config/phantom/config.json`:
```json
{
  "VT_API_KEY": "your-key-here",
  "report_dir": "/path/to/reports",
  "default_provider": "anthropic"
}
```

## Tool Calling Format (for LLM agents)
```
@tool_name|argument
```

## What's Left To Do

- [x] **Web UI / dashboard** — `phantom --gui` or `npm run dashboard`
- [x] **Web app security scanning** — dir bruteforce, XSS, SQLi, open redirect
- [x] **OSINT & recon tools** — Shodan, email breach, GitHub dork, subdomain takeover
- [x] **Plugin system** — Extend Phantom with external plugins
- [x] **Report export** — HTML/PDF report generation
- [x] **Local model support** — Offline LLM via Ollama
- [x] **Conversational REPL** — Hermes/Claude Code style interactive shell
- [x] **PRoot/Termux detection** — Distro management + env-aware
- [ ] **Autonomous agent chaining** — Multi-agent parallel playbook runs
- [ ] **Distributed scanning** — Phantom runs across multiple hosts
- [ ] **Self-healing tools** — Auto-detect broken deps, suggest install
- [ ] **Session memory across restarts** — Persistent agent memory

## External Deps (optional)
- `OPENAI_API_KEY` — enables code_gen, self_add_tool, playbook_create via LLM
- `VT_API_KEY` — VirusTotal hash lookups
- `yara` CLI — YARA scanning (`apt install yara`)
- `whois` CLI — WHOIS lookups (`apt install whois`)
- `sshpass` CLI — SSH brute force (`apt install sshpass`)
- `mysql` CLI — MySQL brute force (`apt install mysql-client`)
- `searchsploit` CLI — exploit-db queries (`apt install exploitdb`)
- `openssl` — cert_expiry tool (usually pre-installed)

## Git Config
- User: `Njap-png`
- Email: `teddy.njagi.w@gmail.com`
- Remote: `https://github.com/Njap-png/Phantom.git`
- Auth: Token in `~/.git-credentials`
- Latest: 3 commits ahead (conversational REPL, help text, PRoot + multi-provider)
