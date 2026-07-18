# 👻 PHANTOM

[![CI](https://github.com/Njap-png/Phantom/actions/workflows/ci.yml/badge.svg)](https://github.com/Njap-png/Phantom/actions/workflows/ci.yml)

**Multi-agent cybersecurity AI assistant** — autonomous penetration testing, reconnaissance, vulnerability analysis, and AI-powered security operations, all from your terminal.

```
·   ·   ·   ·   ·   ·
  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 █ ═══ ═══ ═══ ═══ █
▐█ ·   ·   ·   ·   █▌
▐█  ╔═══════════╗  █▌
▐█  ║ ◈     ◈ ║  █▌
▐█  ║  ╲ ╱ ╲ ╱ ║  █▌
▐█  ╚═══════════╝  █▌
▐█     ●         █▌
 ▀▄ ═══════════ ▄▀
  P H A N T O M
  cybersecurity AI · v0.2.0
```

## Quick Start

```bash
# Clone
git clone https://github.com/Njap-png/Phantom.git
cd Phantom

# Run (no install needed — zero-dep ESM)
node phantom.mjs

# Or Docker
docker build -t phantom .
docker run -it phantom
```

## Features

### 🔧 108 Built-in Tools

| Category | Tools |
|---|---|
| **Core** | shell, web_fetch, decode, encode, hash, file_analyze, batch, code_analyze, code_gen, yara |
| **Recon** | dns_lookup, whois, sub_enum, subfinder (ext), port_scan, http_headers, ssl_check, crawl, geoip, dns_zone, reverse_dns, wayback, robots_txt, amass (ext), dnsx (ext), httpx (ext), naabu (ext), katana (ext), sub_takeover |
| **Web** | dir_bruteforce, xss_scan, sql_detect, open_redirect, cors_test, http_methods, ffuf (ext), arjun (ext) |
| **CVE/Exploit** | cve_search, searchsploit, shodan_search, nuclei (ext) |
| **Auth** | bruteforce, jwt_decode, hash_crack, hashcat (ext) |
| **OSINT** | email_verify, email_breach, github_dork, vt_check, cloud_enum, wayback |
| **Network** | netcat (ext), nmap (ext), masscan (ext), dig, ping, traceroute, netstat |
| **Crypto** | ssl_check, cert_expiry, encrypt, decrypt, random |
| **File** | file_read, file_write, file_edit, file_search, file_list |
| **Self** | self_info, self_read, self_edit, self_add_tool, distro |
| **Knowledge** | knowledge_add, knowledge_search |
| **Automation** | playbook_create, playbook_list, playbook_run, playbook_edit, recon, vuln_scan, report_save, report_export, session_save, session_load, schedule |

> Type `node phantom.mjs --list` for the full list. External tools (marked `ext`) require installation — Phantom detects them at runtime.

### 🚀 New in v0.2.0

| Feature | Description |
|---|---|
| **`--json` output** | `phantom --tool --json <name> <input>` — structured `{ok, data}` JSON |
| **Tool piping** | `phantom --tool --pipe "subfinder\|dom\|httpx"` — chain output→input |
| **Scheduled scanning** | `@schedule\|daily\|recon\|target` — recurring automated scans |
| **Scope management** | `@scope\|add\|domain.com` — target scoping for batch ops |
| **Shell audit trail** | Every command logged, dangerous patterns blocked |
| **`--quiet` mode** | `PHANTOM_QUIET=1` or `--quiet` — suppress banner/status |
| **`--version`** | `phantom --version` — prints version and exits |
| **Docker** | `docker build -t phantom .` — Alpine-based container |
| **TAB autocomplete** | `@tool_name|` completion in REPL |

### 🤖 Multi-Agent Team

4 specialized agents working in parallel:

| Agent | Role | Specialty |
|---|---|---|
| **Lyra** | Coordinator | Breaks down tasks, delegates, synthesizes results |
| **Nova** | Recon | DNS, OSINT, scanning, surface mapping |
| **Orion** | Exploit | Vulnerability research, pentesting, brute force |
| **Vega** | Defense | SSL, CORS, JWT, hardening, monitoring |

Use `@delegate|name|task` for agent-to-agent delegation.

### 🎯 One-Shot Commands

```bash
phantom --recon example.com              # Full recon (7 steps + report)
phantom --tool port_scan scanme.org      # Run a single tool
phantom --tool --json cve_search "apache 2.4.49"   # JSON output
phantom --tool --pipe "subfinder|dom|httpx|nuclei"  # Tool chain
phantom --list                           # List all 108 tools
phantom --list --json                    # List as JSON
phantom --gui                            # Web dashboard (port 8080)
phantom --api                            # REST API (port 9090)
phantom --quiet                          # Suppress banner
phantom --version                        # Show version
phantom --help                           # Full usage
```

### 💬 Interactive REPL

```bash
phantom
👻 recon example.com
👻 /model groq           # Switch LLM
👻 @schedule|daily|recon|example.com   # Schedule daily scan
👻 @scope|add|example.com              # Add to target scope
👻 @pipe|subfinder|example.com|httpx   # Chain tools inline
```

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/tools` | List available tools |
| `/model` | Show/switch LLM provider |
| `/delegate <agent> <task>` | Delegate to a specialist |
| `/talk <agent> <message>` | Chat directly with an agent |
| `/agents` | List agent team with status |
| `/gui` | Start web dashboard |
| `/api` | Start REST API |
| `/save <name>` | Save session |
| `/load <name>` | Load session |
| `/clear` | Clear screen |
| `/quit` | Exit |

REPL also supports:
- `@tool_name|args` — run any tool inline
- `@pipe|tool1|input|tool2` — chain tools
- `@schedule|interval|tool|target` — schedule recurring scans
- `@scope|add|domain` — manage target scope
- `@workspace_write|key|value` — save findings
- `TAB` — autocomplete tool names

## CI

Every push runs across Node.js 20 and 22:

- JS syntax check
- TypeScript build (`tsc --noEmit`)
- CLI verification (`--list` with tool count > 100)
- **34 test cases** (core runtime + features)

[![CI](https://github.com/Njap-png/Phantom/actions/workflows/ci.yml/badge.svg)](https://github.com/Njap-png/Phantom/actions/workflows/ci.yml)

## LLM Providers

Phantom auto-detects available providers on startup. Supported:

| Provider | Config |
|---|---|
| **Ollama** (local, default) | Auto-detected if running |
| **OpenAI** | `OPENAI_API_KEY` env or `@llm_config\|set\|openai_api_key\|sk-...` |
| **OpenCode** (via Hermes) | `@llm_config\|opencode\|deepseek-v4-flash-free` |
| **Groq** | `GROQ_API_KEY` env |
| **Anthropic** | `ANTHROPIC_API_KEY` env |
| **Gemini** | `GEMINI_API_KEY` env |
| **DeepSeek** | `DEEPSEEK_API_KEY` env |
| **Mistral** | `MISTRAL_API_KEY` env |
| **OpenRouter** | `OPENROUTER_API_KEY` env |

Set API keys via interactive prompt on first run, or directly in `~/.config/phantom/config.json`.

### Example: Hermes Agent / OpenCode provider

Phantom works with Hermes Agent's OpenCode provider chain:

```bash
# Via @llm_config interactive
👻 @llm_config|opencode|deepseek-v4-flash-free

# Or set env vars
export PHANTOM_LLM_PROVIDER=opencode
export HERMES_OPCODE_API_KEY=sk-your-key-here   # <-- REPLACE with your key
phantom
```

> ⚠ Never commit real API keys to Git. Use environment variables or the interactive `@llm_config` prompt instead.

## Configuration

All config lives in `~/.config/phantom/`:

- `config.json` — LLM provider settings, API keys, defaults
- `memories/` — Per-agent persistent memory
- `tools/` — Custom tool definitions
- `reports/` — Generated security reports
- `knowledge/` — Persistent knowledge base entries
- `scope.json` — Target scope definitions
- `projects/` — Per-project workspace data
- `schedules.json` — Scheduled scan definitions

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PHANTOM_MAX_ITER` | `8` | Max ReAct loop iterations per request |
| `PHANTOM_TOOL_TIMEOUT` | `30000` | Shell command timeout (ms) |
| `PHANTOM_LLM_PROVIDER` | `openai` | Default LLM provider |
| `PHANTOM_PROVIDERS_READY` | — | Comma-separated ready providers |
| `PHANTOM_QUIET` | — | Suppress banner/status output |
| `HERMES_OPCODE_API_KEY` | — | Hermes Agent / OpenCode provider API key |

## Architecture

```
User Input
    │
    ▼
  Lyra (Coordinator)
    │
    ├── Nova (Recon) — DNS, ports, OSINT
    ├── Orion (Exploit) — CVEs, brute force, SQLi
    └── Vega (Defense) — SSL, CORS, hardening
    │
    ▼
  Shared Workspace (agent-to-agent data)
    │
    ▼
  Synthesized Response
```

- **Zero dependencies** — runs on vanilla Node.js ESM
- **EventBus** pattern for decoupled agent communication
- **ReAct loop** with 8 configurable tool iterations
- **Persistent memory** for each agent
- **Auto-save** conversations across sessions

## Requirements

- **Node.js** 20+ (ESM support)
- **Termux** / **Linux** / **macOS** / **WSL**
- LLM provider (Ollama recommended for local use)
- Docker (optional, for containerized use)

## Known Issues

- System tool detection runs once at startup — tools installed later won't show until restart
- Agent delegation requires an LLM provider (not available in tools-only mode)
- Some tools (vt_check, shodan_search) require API keys in environment
- Dashboard requires `blessed` for terminal split-panel UI (optional dep)

## License

MIT
