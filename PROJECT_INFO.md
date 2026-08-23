# Phantom (Node.js/TypeScript Version)

**Primary project for bug bounty terminal AI**

- **Language**: Node.js/TypeScript (dual runtime: .mjs zero-dep + src/ TypeScript)
- **Repository**: https://github.com/Njap-png/Phantom.git
- **Branch**: main
- **Purpose**: Cybersecurity AI terminal with HackerOne integration, git auto-push, conversational UI
- **Key features**:
  - Zero-dependency CLI (`phantom.mjs`)
  - TypeScript source in `src/` compiled to `dist/`
  - HackerOne API tool (7 commands: programs, scope, reports, report, submit, me, help)
  - Git sync with auto-push using GitHub credentials
  - Natural language parser for conversational commands
  - Works on Termux/Android and desktop
- **Config**: `config.json` at project root (API keys at root level)
- **Build**: `npm run build` (tsc)
- **Test**: `npm run test`
- **Run**: `npm start` or `node phantom.mjs`