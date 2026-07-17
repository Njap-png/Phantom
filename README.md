# 👻 PHANTOM

**Multi-agent cybersecurity AI assistant** — autonomous penetration testing, reconnaissance, vulnerability analysis, and AI-powered security operations, all from your terminal.

```
·   ·   ·   ·   ·   ·  
  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 █ ═══ ═══ ═══ ═══ █
▐█ · · · · · · · █▌
▐█  ╔═══════════╗  █▌
▐█  ║ ◈     ◈ ║  █▌
▐█  ║  ╲ ╱ ╲ ╱ ║  █▌
▐█  ╚═══════════╝  █▌
▐█  ┊  ●  ┊  █▌
 ▀▄ ═══════════ ▄▀
  P H A N T O M
  cybersecurity AI · 67 tools
```

## Quick Start

```bash
# Clone
git clone https://github.com/Njap-png/Phantom.git
cd Phantom

# Run (no install needed — zero-dep ESM)
./phantom.mjs

# Or if symlinked
phantom
```

## Features

### 🔧 67 Built-in Tools (11 categories)

| Category | Tools |
|---|---|
| **Core** | shell, web_fetch, decode, hash, file_analyze |
| **Recon** | dns_lookup, whois, sub_enum, port_scan, http_headers, ssl_check, crawl, geoip, dns_zone, reverse_dns, wayback, robots_txt |
| **Web** | dir_bruteforce, xss_scan, sql_detect, open_redirect, cors_test, http_methods |
| **CVE/Exploit** | cve_search, searchsploit, shodan_search |
| **Auth** | bruteforce, jwt_decode, hash_crack |
| **OSINT** | email_verify, email_breach, github_dork, vt_check, sub_takeover |
| **Code** | code_gen, yara |
| **File** | file_read, file_write, file_edit, file_search, file_list |
| **Self** | self_info, self_read, self_edit, self_add_tool |
| **Knowledge** | knowledge_add, knowledge_search |
| **Automation** | playbook_create, playbook_list, playbook_run, playbook_edit, recon, vuln_scan, report_save, report_export, session_save, session_load |

### 🤖 Multi-Agent Team

4 specialized agents working in parallel:

| Agent | Role | Specialty |
|---|---|---|
| **Lyra** | Coordinator | Breaks down tasks, delegates, synthesizes results |
| **Nova** | Recon | DNS, OSINT, scanning, surface mapping |
| **Orion** | Exploit | Vulnerability research, pentesting, brute force |
| **Vega** | Defense | SSL, CORS, JWT, hardening, monitoring |

Use `@delegate|name|task` for agent-to-agent delegation, or `@fanout|agent1,agent2|task` for parallel execution.

### 🎯 One-Shot Commands

```bash
phantom --recon example.com        # Full recon pipeline
phantom --tool port_scan 10.0.0.1  # Run a single tool
phantom --tool vuln_scan example.com  # Full vulnerability assessment
phantom --list                     # List all available tools
phantom --help                     # Show usage
```

### 💬 Interactive REPL

```bash
phantom
👻 scan example.com
👻 /deploy nova recon example.com
👻 /talk orion analyze this CVE
👻 /model grok
```

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/tools` | List available tools |
| `/model` | Show/switch LLM provider |
| `/delegate <agent> <task>` | Delegate to a specialist |
| `/talk <agent> <message>` | Chat directly with an agent |
| `/agents` | List agent team with status |
| `/save <name>` | Save session |
| `/load <name>` | Load session |
| `/clear` | Clear screen |
| `/quit` | Exit |

## LLM Providers

Phantom auto-detects available providers on startup. Supported:

- **Ollama** (local, default)
- **OpenAI** / **Groq** / **Anthropic** / **Gemini**
- **DeepSeek** / **Mistral** / **OpenRouter**

Set API keys via interactive prompt on first run, or directly in `~/.config/phantom/config.json`.

```bash
# Use Ollama locally (auto-detected)
phantom

# Or switch providers at runtime
👻 /model groq
```

## Configuration

All config lives in `~/.config/phantom/`:

- `config.json` — LLM provider settings, API keys, defaults
- `memories/` — Per-agent persistent memory
- `tools/` — Custom tool definitions
- `reports/` — Generated security reports
- `knowledge/` — Persistent knowledge base entries

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PHANTOM_MAX_ITER` | `8` | Max ReAct loop iterations per request |
| `PHANTOM_TOOL_TIMEOUT` | `30000` | Shell command timeout (ms) |
| `PHANTOM_LLM_PROVIDER` | `openai` | Default LLM provider |
| `PHANTOM_PROVIDERS_READY` | — | Comma-separated ready providers |

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

- **Node.js** 18+ (ESM support)
- **Termux** / **Linux** / **macOS** / **WSL**
- LLM provider (Ollama recommended for local use)

## Known Issues

- System tool detection runs once at startup — tools installed later won't show until restart
- Agent delegation requires an LLM provider (not available in tools-only mode)
- Some tools (vt_check, shodan_search) require API keys in environment

## License

MIT
