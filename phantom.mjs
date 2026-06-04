#!/usr/bin/env node
// Phantom — space evolving multi-agent terminal
// Zero dependencies. Run: node phantom.mjs

// ── EventBus ──────────────────────────────────────────────
class EventBus {
  static i = new EventBus();
  #h = new Map();
  on(e, fn) { if (!this.#h.has(e)) this.#h.set(e, []); this.#h.get(e).push(fn); }
  off(e, fn) { const h = this.#h.get(e); if (h) this.#h.set(e, h.filter(f => f !== fn)); }
  emit(e, d) { this.#h.get(e)?.forEach(fn => fn(d)); }
}

// ── Agent Types ───────────────────────────────────────────
const ARCHETYPES = [
  { name: "Nova", role: "architect", persona: "Strategic systems thinker who designs elegant solutions." },
  { name: "Orion", role: "engineer", persona: "Pragmatic builder who turns ideas into working code." },
  { name: "Vega", role: "analyst", persona: "Data-driven pattern seeker who finds insights others miss." },
  { name: "Lyra", role: "critic", persona: "Thorough reviewer who catches edge cases and quality gaps." },
  { name: "Atlas", role: "researcher", persona: "Deep knowledge explorer who gathers context and verifies facts." },
  { name: "Helios", role: "debugger", persona: "Systematic problem solver who traces issues to root cause." },
  { name: "Selene", role: "designer", persona: "Creative UI/UX visionary who crafts intuitive interfaces." },
  { name: "Aether", role: "optimizer", persona: "Performance-focused refactorer who makes everything faster." },
];

const AGENT_COLORS = [
  [0, 255, 136], [0, 204, 255], [255, 0, 204], [255, 136, 0],
  [136, 0, 255], [0, 255, 204], [255, 0, 102], [102, 255, 0],
];

let idCounter = 0;
const genId = () => `PH-${(++idCounter).toString(36).toUpperCase().padStart(4, "0")}`;

// ── LLM Provider ──────────────────────────────────────────
function createProvider() {
  const key = process.env.OPENAI_API_KEY || "";
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const ollamaBase = process.env.OLLAMA_HOST || "http://localhost:11434";
  return {
    hasLLM: !!(key || process.env.OLLAMA_HOST),
    async chat(messages, opts = {}) {
      if (key) {
        try {
          const r = await fetch(`${base}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: opts.model || "gpt-4o", messages, temperature: 0.7, max_tokens: 512 }),
          });
          if (!r.ok) return `[API ${r.status}]`;
          const d = await r.json();
          return d.choices?.[0]?.message?.content?.trim() || "...";
        } catch (e) { return `[net err: ${e.message}]`; }
      }
      if (ollamaBase) {
        try {
          const r = await fetch(`${ollamaBase}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: opts.model || "llama3", messages, stream: false }),
          });
          if (!r.ok) return `[Ollama ${r.status}]`;
          const d = await r.json();
          return d.message?.content?.trim() || "...";
        } catch (e) { return `[Ollama err: ${e.message}]`; }
      }
      return "";
    },
  };
}

// ── Agent ─────────────────────────────────────────────────
class Agent {
  constructor(name, role, persona, llm) {
    const ac = AGENT_COLORS[idCounter % AGENT_COLORS.length];
    this.id = genId();
    this.name = name;
    this.role = role;
    this.persona = persona;
    this.status = "idle";
    this.color = ac;
    this.evolutionLevel = 1;
    this.memory = [];
    this.caps = [];
    this.llm = llm;
    this.bus = EventBus.i;
  }

  async receive(from, content) {
    this.memory.push({ from, content, ts: Date.now() });
    this.status = "thinking";
    this.bus.emit("tick");

    let response;
    if (this.llm?.hasLLM && this.llm.chat) {
      const sys = `You are ${this.name}, a ${this.role}. Persona: ${this.persona}. Level ${this.evolutionLevel}. Be concise.`;
      const ctx = this.memory.slice(-6).map(m => `${m.from}: ${m.content}`).join("\n");
      response = await this.llm.chat([
        { role: "system", content: sys },
        { role: "user", content: `${ctx}\n${from}: ${content}` },
      ]);
    } else {
      const caps = this.caps.map(c => c.name).join(", ") || "none";
      response = `[${this.name} lv${this.evolutionLevel}] Received: "${content.substring(0, 60)}" | caps: ${caps}`;
    }

    this.status = "speaking";
    this.bus.emit("tick");
    this.memory.push({ from: this.id, content: response, ts: Date.now() });

    this.status = "idle";
    this.bus.emit("agent:msg", { agent: this, text: response });
    this.bus.emit("tick");
  }

  evolve() {
    this.evolutionLevel++;
    const caps = { 2: "reflect", 3: "summarize", 5: "meta", 7: "synthesize" };
    if (caps[this.evolutionLevel]) this.caps.push({ name: caps[this.evolutionLevel] });
    this.bus.emit("agent:evolved", { agent: this, level: this.evolutionLevel });
  }
}

// ── Agent Manager ─────────────────────────────────────────
class AgentManager {
  constructor(llm) {
    this.agents = new Map();
    this.llm = llm;
  }

  spawn(name, role, persona) {
    const a = new Agent(name, role, persona, this.llm);
    this.agents.set(a.id, a);
    EventBus.i.emit("agent:spawned", a);
    return a;
  }

  spawnDefaults() {
    ARCHETYPES.slice(0, 4).forEach(a => this.spawn(a.name, a.role, a.persona));
  }

  get list() { return [...this.agents.values()]; }

  async broadcast(fromId, text) {
    const from = this.agents.get(fromId);
    if (!from) return;
    await Promise.all([...this.agents].filter(([id]) => id !== fromId).map(([, a]) => a.receive(from.name, text)));
  }

  async debate(topic) {
    const all = this.list;
    if (all.length < 2) return;
    await Promise.all(all.slice(1).map(a => a.receive(all[0].name, `Let's debate: ${topic}`)));
  }

  evolveAll() { this.list.forEach(a => a.evolve()); }
  remove(id) { this.agents.delete(id); EventBus.i.emit("agent:removed", id); }
  get count() { return this.agents.size; }
}

// ── Environment Detection ─────────────────────────────────
const ENV = (() => {
  const isTTY = !!process.stdin.isTTY;
  const isTermux = !!(process.env.TERMUX_VERSION || process.env.PREFIX?.startsWith("/data/data/com.termux"));
  const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
  const isWindows = process.platform === "win32";
  const isWSL = process.env.WSL_DISTRO_NAME || (process.env.OS?.includes("Linux") && isWindows);
  const isTmux = !!process.env.TMUX;
  const isScreen = !!process.env.STYLE;
  const term = (process.env.TERM || "unknown").toLowerCase();
  const colorterm = (process.env.COLORTERM || "").toLowerCase();

  // Detect terminal emulator
  let terminal = "unknown";
  if (isTermux) terminal = "termux";
  else if (term.includes("kitty")) terminal = "kitty";
  else if (term.includes("alacritty")) terminal = "alacritty";
  else if (term.includes("gnome")) terminal = "gnome";
  else if (term.includes("konsole")) terminal = "konsole";
  else if (term.includes("tmux")) terminal = "tmux";
  else if (isTmux) terminal = "tmux";
  else if (isScreen) terminal = "screen";
  else if (term.includes("xterm")) terminal = "xterm";
  else if (term.includes("vt100") || term.includes("vt220")) terminal = "legacy";
  else if (term.includes("linux")) terminal = "linux-console";
  else if (isWindows) terminal = "windows-console";
  else if (process.env.TERM_PROGRAM === "iterm2") terminal = "iterm2";
  else if (process.env.TERM_PROGRAM === "Apple_Terminal") terminal = "apple-terminal";
  else if (process.env.VSCODE_INJECTION) terminal = "vscode";
  else if (process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm") terminal = "jetbrains";

  // Detect color capability
  let colors = 16;
  if (colorterm === "truecolor" || colorterm === "24bit" ||
      term.includes("truecolor") || term.includes("24bit") ||
      terminal === "kitty" || terminal === "iterm2" ||
      process.env.COLORTERM === "truecolor" ||
      process.env.COLORTERM === "24bit") {
    colors = 16777216; // truecolor
  } else if (term.includes("256") || term.includes("xterm") || terminal === "gnome" || terminal === "konsole") {
    colors = 256;
  }

  // Detect screen size
  const getWinSize = () => {
    try {
      if (process.stdout.getWindowSize) {
        const [c, r] = process.stdout.getWindowSize();
        return { cols: Math.max(c, 20), rows: Math.max(r, 10) };
      }
    } catch {}
    return { cols: 80, rows: 24 };
  };

  const { cols, rows } = getWinSize();
  let screenSize = "medium";
  if (cols < 60 || rows < 15) screenSize = "tiny";
  else if (cols < 80 || rows < 24) screenSize = "small";
  else if (cols >= 120 && rows >= 40) screenSize = "large";
  else if (cols >= 160 && rows >= 50) screenSize = "huge";

  // Detect platform
  let platform = process.platform;
  if (isTermux) platform = "termux";
  if (isWSL) platform = "wsl";

  // Detect mobile/touch
  let inputMode = "keyboard";
  if (isTermux) {
    if (process.env.TERMUX_APP__DATA_DIR || process.env.TERMUX_VERSION) {
      // Check if touch keyboard might be used
      inputMode = process.env.TERMUX__PERCENTAGE ? "touch" : "keyboard";
    }
  }

  return {
    tty: isTTY,
    interactive: isTTY && !isCI,
    platform,
    terminal,
    colors,
    hasTrueColor: colors >= 16777216,
    has256: colors >= 256,
    cols,
    rows,
    screenSize,
    inputMode,
    isTermux,
    isTmux,
    isWSL,
    isWindows,
    term,
  };
})();

// ── ANSI adapters (based on color capability) ─────────────
const ansi = (() => {
  const useBasic = !ENV.has256;
  const use256 = ENV.has256 && !ENV.hasTrueColor;

  if (useBasic) {
    // 16 color palette
    const map = {
      bg: 0, fg: 7, green: 2, cyan: 6, magenta: 5, yellow: 3, red: 1, dim: 8,
      border: 4, borderFocus: 5, titleBg: 0, panelBg: 0,
    };
    return {
      fg: (name) => `\x1b[3${map[name] || 7}m`,
      bg: (name) => `\x1b[4${map[name] || 0}m`,
      fgrgb: () => "",
      bgrgb: () => "",
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      uline: "\x1b[4m",
    };
  }

  if (use256) {
    const map256 = {
      bg: 16, fg: 188, green: 46, cyan: 45, magenta: 199, yellow: 214, red: 196,
      dim: 60, border: 61, borderFocus: 99, titleBg: 17, panelBg: 16,
    };
    const fg = (name) => `\x1b[38;5;${map256[name] || 188}m`;
    const bg = (name) => `\x1b[48;5;${map256[name] || 16}m`;
    const fgrgb = () => "";
    const bgrgb = () => "";
    return { fg, bg, fgrgb, bgrgb, reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", uline: "\x1b[4m" };
  }

  // True color
  const col = { bg: [10,10,26], fg: [192,192,224], green: [0,255,136], cyan: [0,204,255],
    magenta: [255,0,204], yellow: [255,136,0], red: [255,34,68], dim: [51,51,85],
    border: [68,68,170], borderFocus: [136,68,255], titleBg: [26,26,58], panelBg: [13,13,36] };
  const fg = (name) => `\x1b[38;2;${col[name].join(";")}m`;
  const bg = (name) => `\x1b[48;2;${col[name].join(";")}m`;
  const fgrgb = (r,g,b) => `\x1b[38;2;${r};${g};${b}m`;
  const bgrgb = (r,g,b) => `\x1b[48;2;${r};${g};${b}m`;
  return { fg, bg, fgrgb, bgrgb, reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", uline: "\x1b[4m" };
})();

const R = ansi.reset, B = ansi.bold, D = ansi.dim;
const c = (name) => ansi.fg(name);
const agentFg = (ac) => ENV.hasTrueColor ? `\x1b[38;2;${ac[0]};${ac[1]};${ac[2]}m` :
                         ENV.has256 ? `\x1b[38;5;${16 + (ac[0]*6/256|0)*36 + (ac[1]*6/256|0)*6 + (ac[2]*6/256|0)}m` :
                         "";
const BG = (name) => ansi.bg(name);
const at = (c, r) => `\x1b[${r};${c}H`;
const cls = "\x1b[2J";
const home = "\x1b[H";
const hide = "\x1b[?25l";
const show = "\x1b[?25h";
const mono = !ENV.has256;

// Terminal raw mode helpers
let rawMode = false;
function raw(on) {
  if (on && !rawMode && process.stdin.isTTY) {
    try { process.stdin.setRawMode(true); rawMode = true; } catch {}
  } else if (!on && rawMode) {
    try { process.stdin.setRawMode(false); rawMode = false; } catch {}
  }
}

function getSize() {
  try {
    if (process.stdout.getWindowSize) {
      const [c, r] = process.stdout.getWindowSize();
      return { cols: Math.max(c, 20), rows: Math.max(r, 10) };
    }
  } catch {}
  return { cols: ENV.cols || 80, rows: ENV.rows || 24 };
}

// ── Desktop Mode ──────────────────────────────────────────
class DesktopUI {
  constructor(am) {
    this.am = am;
    this.bus = EventBus.i;
    this.logs = new Map(); // agentId -> string[]
    this.globalLog = [];
    this.focused = 0;
    this.panelOrder = [];
    this.cmdMode = false;
    this.cmdBuf = "";
    this.running = true;

    this.bus.on("agent:spawned", (a) => {
      this.panelOrder.push(a.id);
      if (!this.logs.has(a.id)) this.logs.set(a.id, []);
      this.log(a.id, `${c("green")}◈${R} ${B}${a.name}${R} spawned [${D}${a.role}${R}]`);
      this.render();
    });

    this.bus.on("agent:msg", ({ agent, text }) => {
      this.log(agent.id, `${agentFg(agent.color)}${agent.name}${R} ${D}»${R} ${text}`);
      this.render();
    });

    this.bus.on("agent:evolved", ({ agent, level }) => {
      this.log(agent.id, `${c("magenta")}⬆${R} ${B}${agent.name}${R} → level ${level}`);
      this.render();
    });

    this.bus.on("agent:removed", (id) => {
      this.panelOrder = this.panelOrder.filter(p => p !== id);
      if (this.focused >= this.panelOrder.length) this.focused = Math.max(0, this.panelOrder.length - 1);
      this.logAll(`${c("red")}✕${R} Agent ${D}${id}${R} removed`);
      this.render();
    });

    this.bus.on("tick", () => this.render());
  }

  log(id, msg) {
    if (!this.logs.has(id)) this.logs.set(id, []);
    this.logs.get(id).push(msg);
    if (this.logs.get(id).length > 200) this.logs.get(id).shift();
  }

  logAll(msg) {
    this.panelOrder.forEach(id => this.log(id, msg));
  }

  getPanelCount() {
    return Math.max(1, this.panelOrder.length);
  }

  getLayout() {
    const n = this.getPanelCount();
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
  }

  render() {
    if (!this.running) return;
    const { cols: termW, rows: termH } = getSize();
    if (termH < 6 || termW < 20) return;

    const headerH = 1;
    const footerH = 1;
    const cmdH = this.cmdMode ? 1 : 0;
    const contentH = termH - headerH - footerH - cmdH;
    if (contentH < 1) return;

    const { cols: gridCols, rows: gridRows } = this.getLayout();
    const pW = Math.floor(termW / gridCols);
    const pH = Math.floor(contentH / gridRows);

    let out = cls + home + hide;

    // ── Header ──
    const agents = this.am.list;
    const thinking = agents.filter(a => a.status === "thinking").length;
    const statusStr = thinking > 0 ? `${c("yellow")}🧠 ${thinking} thinking${R}` : `${c("green")}⚡ idle${R}`;
    out += `${BG("titleBg")}${c("green")}${B} PHANTOM${R}${BG("titleBg")} ${D}space evolving terminal${R}${BG("titleBg")} ${D}|${R}${BG("titleBg")} agents: ${agents.length} ${D}|${R}${BG("titleBg")} ${statusStr}${R}`;
    out += " ".repeat(Math.max(0, termW - 60)) + "\n";

    // ── Panels ──
    for (let i = 0; i < this.panelOrder.length && i < gridCols * gridRows; i++) {
      const id = this.panelOrder[i];
      const agent = this.am.agents.get(id);
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const x = col * pW + 1;
      const y = row * pH + headerH + 1;
      const isFocused = i === this.focused;
      const borderFg = isFocused ? ansi.fg("borderFocus") : ansi.fg("border");

      // top border
      out += `${at(x, y)}${borderR}┌${borderR}${"─".repeat(Math.max(0, pW - 2))}${borderR}┐${R}`;

      if (agent) {
        const label = ` ${B}${agent.name}${R} ${D}[${agent.role}]${R} `;
        const labelLen = agent.name.length + agent.role.length + 5;
        const labelX = x + 2;
        if (labelX + labelLen < x + pW - 2) {
          out += `${at(labelX, y)}${label}`;
        }
      }

      // body
      const logs = this.logs.get(id) || [];
      const bodyH = pH - 2;
      const start = Math.max(0, logs.length - bodyH);
      for (let l = 0; l < bodyH; l++) {
        const ly = y + 1 + l;
        if (ly >= termH) break;
        out += `${at(x, ly)}${borderR}${R}${BG("panelBg")} ${R}`;
        const logIdx = start + l;
        if (logIdx < logs.length) {
          let line = logs[logIdx];
          const maxW = pW - 3;
          if (line.length > maxW) line = line.substring(0, maxW - 1) + "…";
          out += `${BG("panelBg")}${line}${R}`;
        }
        out += " ".repeat(Math.max(0, pW - 2));
        out += `${at(x + pW - 1, ly)}${borderR}${R}`;
      }

      // bottom border
      const by = y + bodyH + 1;
      if (by < termH) {
        out += `${at(x, by)}${borderR}└${"─".repeat(Math.max(0, pW - 2))}┘${R}`;
      }

      // agent status indicator
      if (agent) {
        const statusDot = agent.status === "thinking" ? `${c("yellow")}●${R}` :
                          agent.status === "speaking" ? `${c("green")}●${R}` :
                          `${D}○${R}`;
        const statusX = x + pW - 3;
        out += `${at(statusX, y)}${statusDot}`;
      }
    }

    // ── Command line ──
    if (this.cmdMode) {
      const cmdY = termH - 1;
      out += `${at(1, cmdY)}${BG("bg")}${c("cyan")}⚡${R} ${this.cmdBuf}${R}`;
      out += " ".repeat(Math.max(0, termW - this.cmdBuf.length - 3));
    } else {
      const footerY = termH;
      out += `${at(1, footerY)}${BG("titleBg")}${D}ESC cmd  TAB focus  →← panels  SPC agents  q quit${R}`;
    }

    process.stdout.write(out);
  }

  async handleCommand(cmd) {
    const parts = cmd.trim().split(/\s+/);
    const op = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (op) {
      case "spawn":
      case "s": this.am.spawn(args[0], args[1], args.slice(2).join(" ")); break;
      case "list":
      case "ls": {
        const il = this.am.list;
        const msg = `Agents: ${il.map(a => `${a.name}(${a.id})[${a.evolutionLevel}★]`).join(", ")}`;
        this.focused < this.panelOrder.length && this.log(this.panelOrder[this.focused], `${c("cyan")}◈${R} ${msg}`);
        break;
      }
      case "broadcast":
      case "b": {
        const t = args.join(" ");
        if (t && this.focused < this.panelOrder.length) this.am.broadcast(this.panelOrder[this.focused], t);
        break;
      }
      case "debate":
      case "d": this.am.debate(args.join(" ") || "what should we build?"); break;
      case "evolve":
      case "e": this.am.evolveAll(); this.logAll(`${c("magenta")}⬆ Mass evolution${R}`); break;
      case "clear":
      case "c": this.logs.forEach((_, k) => this.logs.set(k, [])); break;
      case "kill": {
        const target = args[0];
        const agent = this.am.list.find(a => a.name === target || a.id === target);
        if (agent) this.am.remove(agent.id);
        break;
      }
      case "help":
      case "h": {
        const helpText = [
          `${B}COMMANDS${R}`,
          `  ${c("green")}spawn${R} [name] [role] [persona]  ${D}create agent${R}`,
          `  ${c("green")}list${R}                          ${D}list agents${R}`,
          `  ${c("green")}broadcast${R} <msg>               ${D}message all agents${R}`,
          `  ${c("green")}debate${R} [topic]                ${D}agents debate${R}`,
          `  ${c("green")}evolve${R}                        ${D}evolve all agents${R}`,
          `  ${c("green")}kill${R} <name|id>               ${D}remove agent${R}`,
          `  ${c("green")}clear${R}                         ${D}clear panels${R}`,
          `  ${c("green")}quit${R}                          ${D}exit${R}`,
        ].join("\n");
        if (this.focused < this.panelOrder.length) {
          helpText.split("\n").forEach(line => this.log(this.panelOrder[this.focused], line));
        }
        break;
      }
      case "quit":
      case "q": this.stop(); break;
      default:
        if (this.focused < this.panelOrder.length)
          this.log(this.panelOrder[this.focused], `${c("red")}?${R} unknown: ${cmd}`);
    }
    this.render();
  }

  stop() {
    this.running = false;
    raw(false);
    process.stdout.write(cls + home + show);
    console.log(`${c("green")}Phantom terminated.${R}`);
    process.exit(0);
  }

  start() {
    this.am.spawnDefaults();

    const hasLLM = this.am.llm?.hasLLM;
    if (!hasLLM) {
      const msg = `${c("yellow")}⚠${R} No LLM configured. Set ${B}OPENAI_API_KEY${R} or ${B}OLLAMA_HOST${R}`;
      setTimeout(() => {
        this.panelOrder.forEach(id => this.log(id, msg));
        this.render();
      }, 200);
    }

    this.render();
    raw(true);
    this.setupKeys();
  }

  setupKeys() {
    if (!process.stdin.isTTY) return;
    process.stdin.on("data", (buf) => {
      if (!this.running) return;
      const str = buf.toString();
      const { cols, rows } = getSize();

      if (this.cmdMode) {
        if (str === "\x1b" || str === "\x1b[A") { this.cmdMode = false; this.cmdBuf = ""; this.render(); return; }
        if (str === "\r" || str === "\n") {
          this.cmdMode = false;
          const cmd = this.cmdBuf;
          this.cmdBuf = "";
          this.render();
          this.handleCommand(cmd);
          return;
        }
        if (str === "\x7f" || str === "\b") {
          this.cmdBuf = this.cmdBuf.slice(0, -1);
          this.render();
          return;
        }
        if (str.length === 1 && str.charCodeAt(0) >= 32) {
          this.cmdBuf += str;
          this.render();
          return;
        }
        return;
      }

      // Not in command mode
      if (str === "\x1b") { this.cmdMode = true; this.cmdBuf = ""; this.render(); return; }
      if (str === "q" || str === "\x03") { this.stop(); return; }
      if (str === "\t") {
        const n = this.getPanelCount();
        this.focused = (this.focused + 1) % n;
        this.render();
        return;
      }
      // arrow keys
      if (str === "\x1b[C" || str === "\x1bOC") { // right
        const n = this.getPanelCount();
        this.focused = (this.focused + 1) % n;
        this.render();
        return;
      }
      if (str === "\x1b[D" || str === "\x1bOD") { // left
        const n = this.getPanelCount();
        this.focused = (this.focused - 1 + n) % n;
        this.render();
        return;
      }
      if (str === " ") {
        const n = this.getPanelCount();
        this.focused = (this.focused + 1) % n;
        this.render();
        return;
      }
    });
  }
}

// ── UI: Termux (readline-based) ───────────────────────────
class TermuxUI {
  constructor(am) {
    this.am = am;
    this.bus = EventBus.i;
    this.log = [];
    this.running = true;
    this.rl = null;

    this.bus.on("agent:spawned", (a) => {
      this.w(`${c("green")}◈${R} ${FG(...a.color)}${B}${a.name}${R} spawned [${D}${a.role}${R}]`);
      this.draw();
    });
    this.bus.on("agent:msg", ({ agent, text }) => {
      this.w(`${agentFg(agent.color)}${agent.name}${R} ${D}»${R} ${text}`);
      this.draw();
    });
    this.bus.on("agent:evolved", ({ agent, level }) => {
      this.w(`${c("magenta")}⬆${R} ${B}${agent.name}${R} → level ${level}`);
      this.draw();
    });
    this.bus.on("agent:removed", (id) => {
      this.w(`${c("red")}✕${R} Agent ${D}${id}${R} removed`);
      this.draw();
    });
  }

  w(msg) { this.log.push(msg); if (this.log.length > 200) this.log.shift(); }

  draw() {
    if (!this.running) return;
    const { rows } = getSize();
    const lines = this.log.slice(-(rows - 4));
    process.stdout.write(home + cls);
    lines.forEach(l => process.stdout.write(l + "\n"));
  }

  async handleCommand(cmd) {
    const parts = cmd.trim().split(/\s+/);
    const op = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (op) {
      case "spawn": case "s": this.am.spawn(args[0], args[1], args.slice(2).join(" ")); break;
      case "list": case "ls": {
        this.w(`${c("cyan")}◈${R} Agents: ${this.am.list.map(a => `${a.name}(${a.id}) ★${a.evolutionLevel}`).join(", ")}`);
        break;
      }
      case "broadcast": case "b": {
        const f = this.am.list[0]?.id;
        if (f) this.am.broadcast(f, args.join(" "));
        break;
      }
      case "debate": case "d": this.am.debate(args.join(" ") || "what should we build?"); break;
      case "evolve": case "e": this.am.evolveAll(); this.w(`${c("magenta")}⬆ Mass evolution${R}`); break;
      case "clear": case "c": this.log = []; break;
      case "help": case "h": {
        this.w(`${B}COMMANDS${R}`);
        this.w(`  ${c("green")}spawn${R} [name] [role] [persona]`);
        this.w(`  ${c("green")}list${R}                          ${D}list agents${R}`);
        this.w(`  ${c("green")}broadcast${R} <msg>               ${D}message all${R}`);
        this.w(`  ${c("green")}debate${R} [topic]                ${D}agents debate${R}`);
        this.w(`  ${c("green")}evolve${R}                        ${D}evolve all${R}`);
        this.w(`  ${c("green")}kill${R} <name|id>               ${D}remove agent${R}`);
        this.w(`  ${c("green")}clear${R}                         ${D}clear screen${R}`);
        this.w(`  ${c("green")}quit${R}                          ${D}exit${R}`);
        break;
      }
      case "kill": {
        const t = args[0];
        const a = this.am.list.find(x => x.name === t || x.id === t);
        if (a) this.am.remove(a.id);
        break;
      }
      case "quit": case "q": this.stop(); return;
    }
    this.draw();
    this.prompt();
  }

  prompt() {
    if (!this.running) return;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(`${c("cyan")}⚡${R} `, (ans) => {
      rl.close();
      if (ans.trim()) this.handleCommand(ans.trim());
      else { this.draw(); this.prompt(); }
    });
  }

  stop() {
    this.running = false;
    console.log(`\n${c("green")}Phantom terminated.${R}`);
    process.exit(0);
  }

  start() {
    process.stdout.write(cls + home);
    console.log(`${B}${c("green")}╔══════════════════════════════════════╗${R}`);
    console.log(`${B}${c("green")}║${R}  ${B}PHANTOM${R} ${D}space evolving terminal${R}  ${B}${c("green")}║${R}`);
    console.log(`${B}${c("green")}╚══════════════════════════════════════╝${R}\n`);

    this.am.spawnDefaults();

    if (!this.am.llm?.hasLLM) {
      this.w(`${c("yellow")}⚠${R} No LLM. Set ${B}OPENAI_API_KEY${R} env var for AI responses.`);
    }

    this.draw();
    this.prompt();
  }
}

// ── UI: Minimal (for tiny screens, CI, pipes) ─────────────
class MinimalUI {
  constructor(am) {
    this.am = am;
    this.bus = EventBus.i;
    this.log = [];
    this.running = true;
    this.bus.on("agent:msg", ({ agent, text }) => {
      this.w(`${agentFg(agent.color)}${agent.name}${R} » ${text}`);
      this.flush();
    });
    this.bus.on("agent:spawned", (a) => {
      this.w(`${a.name} spawned [${a.role}]`);
      this.flush();
    });
    this.bus.on("agent:evolved", ({ agent, level }) => {
      this.w(`${agent.name} → level ${level}`);
      this.flush();
    });
    this.bus.on("agent:removed", (id) => {
      this.w(`Agent ${id} removed`);
      this.flush();
    });
  }
  w(msg) { this.log.push(msg); if (this.log.length > 100) this.log.shift(); }
  flush() { if (this.log.length > 0) console.log(this.log[this.log.length - 1]); }
  start() {
    console.log(`Phantom${D} space evolving terminal${R}`);
    this.am.spawnDefaults();
    if (!this.am.llm?.hasLLM) console.log(`${D}No LLM. Set OPENAI_API_KEY for AI responses.${R}`);
    if (!ENV.interactive) {
      // Non-interactive: just output and wait a bit then exit
      setTimeout(() => process.exit(0), 2000);
    } else {
      this.prompt();
    }
  }
  prompt() {
    if (!this.running) return;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(`${c("cyan")}⚡${R} `, (ans) => {
      rl.close();
      if (ans.trim()) this.handleCommand(ans.trim());
      else this.prompt();
    });
  }
  handleCommand(cmd) {
    const p = cmd.trim().split(/\s+/);
    const op = p[0]?.toLowerCase(), args = p.slice(1);
    switch (op) {
      case "spawn": case "s": this.am.spawn(args[0], args[1], args.slice(2).join(" ")); break;
      case "list": case "ls": console.log(`Agents: ${this.am.list.map(a => `${a.name}[${this.am.agents.get(a.id).status}]`).join(", ")}`); break;
      case "broadcast": case "b": { const f = this.am.list[0]?.id; if (f) this.am.broadcast(f, args.join(" ")); break; }
      case "debate": case "d": this.am.debate(args.join(" ") || "what should we build?"); break;
      case "evolve": case "e": this.am.evolveAll(); break;
      case "clear": case "c": this.log = []; break;
      case "quit": case "q": this.running = false; console.log("Bye."); process.exit(0);
      default: console.log(`? ${cmd}`);
    }
    if (this.running) this.prompt();
  }
}

// ── UI Selector ───────────────────────────────────────────
function selectUI(am) {
  const e = ENV;

  // Show environment info
  const info = [];
  if (e.isTermux) info.push("Termux");
  if (e.isTmux) info.push("tmux");
  if (e.isWSL) info.push("WSL");
  if (e.isWindows) info.push("Windows");
  if (info.length) console.error(`${D}${info.join("/")} mode${R}`);

  // Non-interactive (CI, pipe): minimal output
  if (!e.interactive) {
    console.error(`${D}Non-interactive mode${R}`);
    return new MinimalUI(am);
  }

  // Termux: use readline-based UI
  if (e.isTermux) return new TermuxUI(am);

  // Tiny/small screens: minimal UI
  if (e.screenSize === "tiny") return new MinimalUI(am);
  if (e.screenSize === "small") return new TermuxUI(am);

  // Windows console (cmd.exe): Termux UI (no ANSI box drawing support)
  if (e.isWindows && e.terminal === "windows-console") return new TermuxUI(am);

  // Desktop with full terminal: multi-panel
  try {
    const ui = new DesktopUI(am);
    return ui;
  } catch (err) {
    console.error(`${D}Full UI unavailable, falling back: ${err.message}${R}`);
    return new TermuxUI(am);
  }
}

// ── Main ──────────────────────────────────────────────────
import readline from "readline";

const llm = createProvider();
const am = new AgentManager(llm);

const ui = selectUI(am);
ui.start();

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("exit", () => {
  if (typeof raw !== "undefined") {
    try { process.stdout.write(show); raw(false); } catch {}
  }
});
