# Phantom — Development Context

## What is Phantom?

**Phantom** is a multi-agent terminal AI that runs **zero-dependency** on any system with Node.js 18+ (desktop, Termux on Android, CI). It spawns AI agents that can talk to each other, evolve, and use tools.

## What We're Building

### Goal
Transform Phantom into a **Hermes-like cybersecurity AI assistant** — a terminal-based hacking companion with real tool access. Agents should be able to:
- Execute shell commands
- Fetch web pages
- Analyze files and malware
- Decode/encode data
- DNS reconnaissance
- Hash files/text
- (future) More advanced security tooling

### Current State (as of commit)

**Latest commit:** `93500f6` — *Add persistence layer, dynamic tools system, and Whisper transcription*

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
│   │   └── hacker-tools.ts  ← NEW: Cybersecurity tool implementations
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

## What Has Been Built

### Hacker Tools (added to phantom.mjs + TypeScript src)
Each tool is callable by the LLM agent via `@tool_name|argument` syntax:

| Tool | Function | What it does |
|------|----------|-------------|
| `shell` | `shell(cmd)` | Execute ANY shell command (30s timeout) |
| `web_fetch` | `webFetch(url)` | Fetch URL, strip HTML, return text |
| `decode` | `decode(input)` | Auto-detect base64/hex/URL/binary/ROT13 |
| `file_analyze` | `fileAnalyze(path)` | File type (magic bytes), hashes (MD5/SHA1/SHA256), entropy (packing detection), strings extraction |
| `dns_lookup` | `dnsLookup(domain)` | DNS A/AAAA/MX/NS/TXT/CNAME/SOA records |
| `hash` | `hash(input)` | MD5/SHA1/SHA256 of text or file |

### ReAct Loop (in phantom.mjs + TypeScript agent.ts)
The agent now has a **Reasoning + Acting loop**:
1. System prompt lists all available tools with descriptions
2. LLM decides whether to use a tool or respond directly
3. If LLM writes `@tool_name|args`, the tool executes and result feeds back
4. LLM can chain up to 3 tool calls before final response
5. No API key = shows available tools and prompts user

### Persistence (in phantom.mjs + TypeScript)
Agents auto-save/load conversation memory to `~/.config/phantom/memory/<agent_name>.json`

### TypeScript Status
- `src/core/hacker-tools.ts` — Fully implemented with proper TypeScript types
- `src/agents/agent.ts` — Updated with ReAct loop + hacker tool registration
- `tsc` — Compiles cleanly, output in `dist/`

## What's Left To Do

### Feature Ideas
- [ ] **More tools:** WHOIS lookup, port scanner, HTTP header inspector, SSL cert checker, subdomain enum
- [ ] **VirusTotal API integration** — Check hashes against known malware DB
- [ ] **YARA scanner** — Rule-based malware pattern matching
- [ ] **Agent-to-agent tool sharing** — Agents can delegate tasks
- [ ] **Web UI / dashboard** — For monitoring agent activity
- [ ] **Agent personality prompt tuning** — Better cybersecurity persona
- [ ] **Local model support** — Ollama/local LLM for offline use
- [ ] **File upload/download** — For malware sample analysis
- [ ] **Better error recovery** — Handle tool failures gracefully
- [ ] **Multi-step autonomous chains** — Higher max iterations, smarter loop

### Known Issues
- No LLM key configured by default — need `OPENAI_API_KEY` or `OLLAMA_HOST`

## How To Run

```bash
# Zero-setup (downloads phantom.mjs automatically)
bash <(curl -s https://raw.githubusercontent.com/Njap-png/Phantom/main/run.sh)

# Or from local checkout (auto-builds TypeScript):
cd /root/phantom && npm run dev        # runs TS directly via tsx (no build)
cd /root/phantom && bash run.sh        # auto-tsc then runs from dist
cd /root/phantom && node phantom.mjs   # zero-dep entry, no build needed

# With LLM (for AI-powered agents)
OPENAI_API_KEY=sk-... node phantom.mjs

# Or with Ollama
OLLAMA_HOST=http://localhost:11434 node phantom.mjs
```

## Tool Calling Format (for LLM agents)

When the LLM wants to use a tool, it writes:
```
@tool_name|argument
```

Example flow:
```
User: what's the SHA256 of /etc/passwd?
Agent: @hash|/etc/passwd
[Tool returns hashes]
Agent: The SHA256 hash of /etc/passwd is: ...
```

Current tools and their arguments:
- `@shell|ls -la /tmp`
- `@web_fetch|https://example.com`
- `@decode|SGVsbG8=`
- `@file_analyze|/path/to/file`
- `@dns_lookup|example.com`
- `@hash|hello world`

## Git Config

- User: `Njap-png`
- Email: `teddy.njagi.w@gmail.com`
- Remote: `https://github.com/Njap-png/phantom.git`
- Auth: **Not configured** — need PAT or SSH key to push
