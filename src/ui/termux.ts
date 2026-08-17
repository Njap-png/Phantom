import * as readline from "readline";
import { EventBus, EventHandler } from "../core/eventbus.js";
import { AgentManager } from "../agents/manager.js";
import { AgentIdentity } from "../agents/types.js";
import { phantomTheme } from "./theme.js";
import { loadConfig } from "../core/config.js";
import { createOpenAIProvider, createOllamaProvider, LLMProvider } from "../providers/openai.js";

const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[38;2;0;255;136m";
const CYAN = "\x1b[38;2;0;204;255m";
const MAGENTA = "\x1b[38;2;255;0;204m";
const YELLOW = "\x1b[38;2;255;136;0m";
const RED = "\x1b[38;2;255;34;68m";
const BLUE = "\x1b[38;2;68;68;170m";
const GRAY = "\x1b[38;2;51;51;85m";
const BG = "\x1b[48;2;10;10;26m";

function colorFromHex(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

const AGENT_COLORS: Record<string, string> = {};

export class PhantomTermuxUI {
  private rl: readline.Interface;
  private agentManager: AgentManager;
  private bus: EventBus;
  private running = true;
  private commandHistory: string[] = [];
  private historyIndex = -1;
  private log: string[] = [];
  private llm?: LLMProvider;

  constructor() {
    this.bus = EventBus.getInstance();

    const config = loadConfig();
    if (config.providers.openai.apiKey) {
      this.llm = createOpenAIProvider(config);
    } else if (config.providers.ollama.baseUrl) {
      try {
        this.llm = createOllamaProvider(config);
      } catch {
        // fallback to no LLM
      }
    }

    this.agentManager = new AgentManager(this.llm);

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode?.(true);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "",
      terminal: true,
    });

    this.registerEvents();
  }

  private registerEvents(): void {
    this.bus.on("agent:spawned", ((data: unknown) => {
      const agent = data as AgentIdentity;
      AGENT_COLORS[agent.id] = agent.color;
      this.writeLog(`${GREEN}◈${R} ${colorFromHex(agent.color)}${agent.name}${R} spawned [${DIM}${agent.role}${R}]`);
    }) as EventHandler);

    this.bus.on("agent:speaking", ((data: unknown) => {
      const { agent, message } = data as { agent: AgentIdentity; message: string };
      const c = colorFromHex(agent.color);
      this.writeLog(`${c}${agent.name}${R} ${DIM}»${R} ${message}`);
    }) as EventHandler);

    this.bus.on("agent:evolving", ((data: unknown) => {
      const { agent, level } = data as { agent: AgentIdentity; level: number };
      this.writeLog(`${MAGENTA}⬆${R} ${colorFromHex(agent.color)}${agent.name}${R} evolved to ${BOLD}level ${level}${R}`);
    }) as EventHandler);

    this.bus.on("agent:removed", ((data: unknown) => {
      const id = data as string;
      this.writeLog(`${RED}✕${R} Agent ${DIM}${id}${R} removed`);
    }) as EventHandler);
  }

  private writeLog(msg: string): void {
    this.log.push(msg);
    if (this.log.length > 500) this.log.shift();
  }

  private clearScreen(): void {
    process.stdout.write("\x1b[2J\x1b[H");
  }

  private draw(): void {
    const [rows, cols] = process.stdout.getWindowSize();

    const agents = this.agentManager.listAgents();
    const statusLine = agents.length > 0
      ? `${GREEN}◈${R} ${agents.length} agents`
      : `${GRAY}no agents${R}`;

    let thinking = agents.filter((a) => a.status === "thinking").length;
    const status = thinking > 0 ? `${YELLOW}🧠 ${thinking} thinking${R}` : `${GREEN}⚡ idle${R}`;

    const header = `${BOLD}${GREEN}PHANTOM${R}${GRAY} — space evolving terminal${R}  ${GRAY}|${R} ${statusLine} ${GRAY}|${R} ${status}`;

    const footer = `${GRAY}ESC cmd  TAB focus  ←→ panels  q quit${R}`;

    const logLines = this.log.slice(-(rows - 4));
    const maxContentWidth = cols - 2;

    this.clearScreen();
    process.stdout.write(`${BG}${header}\n${R}`);

    if (logLines.length === 0) {
      process.stdout.write(`${DIM}${GRAY}  No activity yet. Press ESC to open command palette.${R}\n`);
    } else {
      for (const line of logLines) {
        const display = line.length > maxContentWidth
          ? line.substring(0, maxContentWidth - 3) + "..."
          : line;
        process.stdout.write(` ${display}\n`);
      }
    }

    process.stdout.write(`\n${DIM}${footer}${R}`);
  }

  private promptCommand(): void {
    this.rl.question(`${GREEN}⚡${R} `, (input) => {
      const cmd = input.trim();
      if (!cmd) {
        this.draw();
        this.waitForKey();
        return;
      }

      this.commandHistory.push(cmd);
      this.historyIndex = this.commandHistory.length;
      this.handleCommand(cmd);
      this.draw();
      this.waitForKey();
    });
  }

  private waitForKey(): void {
    if (!this.running) return;
    process.stdin.once("keypress", (_str, key) => {
      if (!key) return;
      if (key.name === "escape") {
        this.promptCommand();
      } else if (key.name === "q") {
        this.stop();
      } else if (key.name === "right") {
        // no-op in termux mode
        this.waitForKey();
      } else if (key.name === "left") {
        this.waitForKey();
      } else {
        this.waitForKey();
      }
    });
  }

  private handleCommand(cmd: string): void {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case "spawn":
      case "s": {
        this.agentManager.spawnAgent(args[0], args[1], args.slice(2).join(" "));
        break;
      }
      case "list":
      case "ls": {
        const agents = this.agentManager.listAgents();
        if (agents.length === 0) {
          this.writeLog(`${GRAY}No active agents. Use 'spawn' to create one.${R}`);
        } else {
          this.writeLog(`${CYAN}◈ Agents (${agents.length}):${R}`);
          agents.forEach((a) => {
            const c = colorFromHex(a.color);
            this.writeLog(`  ${c}●${R} ${BOLD}${a.name}${R} ${DIM}${a.id}${R} — ${a.role} ${GRAY}[${a.status}]${R} ${MAGENTA}★${a.evolutionLevel}${R}`);
          });
        }
        break;
      }
      case "broadcast":
      case "b": {
        const msg = args.join(" ");
        const id = this.agentManager.listAgents()[0]?.id;
        if (id && msg) {
          this.agentManager.broadcast(id, msg);
        }
        break;
      }
      case "debate":
      case "d": {
        const topic = args.join(" ") || "what should we build today?";
        this.agentManager.debate(topic);
        break;
      }
      case "evolve":
      case "e": {
        this.agentManager.evolveAll();
        this.writeLog(`${MAGENTA}⬆ Mass evolution initiated${R}`);
        break;
      }
      case "clear":
        this.log = [];
        break;
      case "help":
      case "h": {
        this.writeLog(`${BOLD}${GREEN}PHANTOM COMMANDS${R}`);
        this.writeLog(`  ${GREEN}spawn${R} [name] [role] [persona]  — create agent`);
        this.writeLog(`  ${GREEN}list${R}                          — list agents`);
        this.writeLog(`  ${GREEN}broadcast${R} <msg>               — message all agents`);
        this.writeLog(`  ${GREEN}debate${R} [topic]                — agents debate a topic`);
        this.writeLog(`  ${GREEN}evolve${R}                        — evolve all agents`);
        this.writeLog(`  ${GREEN}clear${R}                         — clear screen`);
        this.writeLog(`  ${GREEN}help${R}                          — this help`);
        this.writeLog(`  ${GREEN}quit${R}                          — exit`);
        break;
      }
      case "quit":
      case "q":
        this.stop();
        break;
      default:
        this.writeLog(`${RED}Unknown command:${R} ${cmd}. Type ${GREEN}help${R} for commands.`);
    }
  }

  start(): void {
    this.clearScreen();
    process.stdout.write(`\n${BOLD}${GREEN}╔══════════════════════════════════════╗${R}`);
    process.stdout.write(`\n${BOLD}${GREEN}║${R}  ${BOLD}PHANTOM${R}${GRAY} — space evolving terminal${R}  ${BOLD}${GREEN}║${R}`);
    process.stdout.write(`\n${BOLD}${GREEN}╚══════════════════════════════════════╝${R}\n\n`);

    this.agentManager.spawnDefaults();

    if (!this.llm) {
      this.writeLog(`${YELLOW}⚠ No LLM configured. Agents will use basic responses.${R}`);
      this.writeLog(`${GRAY}  Set OPENAI_API_KEY or configure ~/.config/phantom/config.json${R}`);
    } else {
      this.writeLog(`${GREEN}✓ LLM connected${R}`);
    }

    this.draw();
    this.waitForKey();
  }

  stop(): void {
    this.running = false;
    this.clearScreen();
    process.stdout.write(`${GREEN}Phantom terminated.${R}\n`);
    process.exit(0);
  }
}
