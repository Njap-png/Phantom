import blessed from "blessed";
import { phantomTheme } from "./theme.js";
import { PanelManager } from "./panels.js";
import { AgentManager } from "../agents/manager.js";
import { EventBus, EventHandler } from "../core/eventbus.js";
import { AgentIdentity } from "../agents/types.js";
import { loadConfig } from "../core/config.js";
import { createOpenAIProvider, createOllamaProvider, LLMProvider } from "../providers/openai.js";

export class PhantomTerminal {
  private screen: blessed.Widgets.Screen;
  private panelManager!: PanelManager;
  private agentManager!: AgentManager;
  private bus: EventBus;
  private titleBar!: blessed.Widgets.BoxElement;
  private commandInput!: blessed.Widgets.TextboxElement;
  private llm?: LLMProvider;

  constructor() {
    this.bus = EventBus.getInstance();

    const config = loadConfig();
    if (config.providers.openai.apiKey) {
      this.llm = createOpenAIProvider(config);
    } else if (config.providers.ollama.baseUrl) {
      try {
        this.llm = createOllamaProvider(config);
      } catch {}
    }

    this.agentManager = new AgentManager(this.llm);

    const term = process.env.TERM || "xterm-256color";
    const isTermux = process.env.TERMUX_VERSION !== undefined;

    this.screen = blessed.screen({
      smartCSR: !isTermux,
      title: "Phantom — Space Evolving Terminal",
      cursor: { artificial: true, shape: "line", blink: true } as any,
      dockBorders: !isTermux,
      fullUnicode: true,
      terminal: term,
      useBCE: true,
      forceUnicode: true,
      sendFocus: true,
      debug: false,
      warnings: false,
    });

    this.screen.key(["C-c", "C-q", "q"], () => {
      process.exit(0);
    });

    this.screen.on("resize", () => {
      this.screen.render();
    });

    this.buildUI();
    this.registerEvents();
    this.spawnDefaultAgents();
  }

  private buildUI(): void {
    this.titleBar = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: this.makeTitleContent(0, false),
      tags: true,
      style: { bg: phantomTheme.titleBar, fg: phantomTheme.accent },
    });

    this.panelManager = new PanelManager(this.screen);

    const statusBar = blessed.box({
      parent: this.screen,
      bottom: 1,
      left: 0,
      width: "100%",
      height: 1,
      content: ` ${GRAY}⏎ cmd  →← panels  TAB focus  ESC palette  q quit${R}`,
      tags: true,
      style: { bg: phantomTheme.titleBar, fg: phantomTheme.dim },
    });

    this.commandInput = blessed.textbox({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      inputOnFocus: true,
      style: {
        bg: phantomTheme.background,
        fg: phantomTheme.accent2,
        focus: { bg: phantomTheme.background },
      },
      prompt: ` {${phantomTheme.accent2}-fg}⚡{/${phantomTheme.accent2}-fg} `,
    });

    this.screen.key(["escape"], () => {
      this.commandInput.readInput((_err: any, val?: string) => {
        if (val) this.handleCommand(val);
        this.commandInput.clearValue();
        this.screen.render();
      });
    });

    this.screen.key(["tab"], () => {
      const focused = this.panelManager.getFocused();
      if (focused) {
        this.commandInput.focus();
      } else {
        this.screen.focusNext();
      }
      this.screen.render();
    });

    this.screen.key(["right"], () => this.panelManager.nextPanel());
    this.screen.key(["left"], () => this.panelManager.prevPanel());

    if (!this.llm) {
      setTimeout(() => {
        const panel = this.panelManager.getFocused();
        if (panel) {
          panel.log.add(`{yellow-fg}⚠ No LLM configured. Agents will use basic responses.{/yellow-fg}`);
          panel.log.add(`{cyan-fg}  Set OPENAI_API_KEY or configure ~/.config/phantom/config.json{/cyan-fg}`);
        }
      }, 500);
    }
  }

  private registerEvents(): void {
    this.bus.on("agent:spawned", ((data: unknown) => {
      const agent = data as AgentIdentity;
      const panel = this.panelManager.createPanel(agent);
      panel.log.add(`{green-fg}◈ Agent ${agent.name} initialized{/green-fg}`);
      panel.log.add(`{cyan-fg}  id: ${agent.id}  role: ${agent.role}{/cyan-fg}`);
      this.refreshTitle();
    }) as EventHandler);

    this.bus.on("agent:speaking", ((data: unknown) => {
      const { agent, message } = data as { agent: AgentIdentity; message: string };
      this.panelManager.writeToPanel(
        agent.id,
        `{${agent.color}-fg}[${agent.name}]{/${agent.color}-fg} ${message}`
      );
      this.refreshTitle();
    }) as EventHandler);

    this.bus.on("agent:thinking", ((_data: unknown) => {
      this.refreshTitle();
    }) as EventHandler);

    this.bus.on("agent:evolving", ((data: unknown) => {
      const { agent, level } = data as { agent: AgentIdentity; level: number };
      this.panelManager.writeToPanel(
        agent.id,
        `{magenta-fg}⬆ EVOLVED to level ${level}{/magenta-fg}`
      );
    }) as EventHandler);

    this.bus.on("agent:removed", ((data: unknown) => {
      const id = data as string;
      this.panelManager.removePanel(id);
      this.panelManager.writeToAll(`{red-fg}◈ Agent ${id} terminated{/red-fg}`);
      this.refreshTitle();
    }) as EventHandler);
  }

  private makeTitleContent(count: number, hasThinking: boolean): string {
    const status = hasThinking
      ? "{yellow-fg}🧠 thinking{/yellow-fg}"
      : "{green-fg}⚡ idle{/green-fg}";
    return ` {bold}PHANTOM{/bold} — space evolving terminal  {#333355-fg}|  agents: ${count}  |  ${status}{/#333355-fg}`;
  }

  private refreshTitle(): void {
    const agents = this.agentManager.listAgents();
    const hasThinking = agents.some((a) => a.status === "thinking");
    this.titleBar.setContent(this.makeTitleContent(agents.length, hasThinking));
    this.screen.render();
  }

  private spawnDefaultAgents(): void {
    this.agentManager.spawnDefaults();
  }

  private handleCommand(cmd: string): void {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);
    const panel = this.panelManager.getFocused();

    switch (command) {
      case "spawn":
      case "s": {
        this.agentManager.spawnAgent(args[0], args[1], args.slice(2).join(" "));
        break;
      }
      case "list":
      case "ls": {
        if (panel) {
          const agents = this.agentManager.listAgents();
          panel.log.add(`{cyan-fg}◈ Agents (${agents.length}):{/cyan-fg}`);
          agents.forEach((a) => {
            panel.log.add(
              `  {${a.color}-fg}●{/${a.color}-fg} ${a.name} (${a.id}) — ${a.role} [${a.status}] ★${a.evolutionLevel}`
            );
          });
        }
        break;
      }
      case "broadcast":
      case "b": {
        const msg = args.join(" ");
        if (panel && panel.agentId && msg) {
          this.agentManager.broadcast(panel.agentId, msg);
          panel.log.add(`{cyan-fg}◈ Broadcasting...{/cyan-fg}`);
        }
        break;
      }
      case "debate":
      case "d": {
        const topic = args.join(" ") || "what should we build?";
        const starterId = this.agentManager.listAgents()[0]?.id;
        if (starterId) {
          this.agentManager.debate(topic);
          if (panel) panel.log.add(`{magenta-fg}◈ Debate started: ${topic}{/magenta-fg}`);
        }
        break;
      }
      case "evolve":
      case "e": {
        this.agentManager.evolveAll();
        this.panelManager.writeToAll("{magenta-fg}⬆ Mass evolution initiated{/magenta-fg}");
        break;
      }
      case "clear":
      case "c": {
        if (panel) panel.log.setContent("");
        break;
      }
      case "help":
      case "h": {
        if (panel) {
          panel.log.add("");
          panel.log.add("{bold}PHANTOM COMMANDS{/bold}");
          panel.log.add(`  {green-fg}spawn{/green-fg} [name] [role] [persona]  — create agent`);
          panel.log.add(`  {green-fg}list{/green-fg}                          — list agents`);
          panel.log.add(`  {green-fg}broadcast{/green-fg} <msg>               — msg all agents`);
          panel.log.add(`  {green-fg}debate{/green-fg} [topic]               — agents debate`);
          panel.log.add(`  {green-fg}evolve{/green-fg}                        — evolve all`);
          panel.log.add(`  {green-fg}clear{/green-fg}                         — clear panel`);
          panel.log.add(`  {green-fg}help{/green-fg}                          — this help`);
          panel.log.add(`  {green-fg}quit{/green-fg}                          — exit`);
          panel.log.add("");
        }
        break;
      }
      case "quit":
      case "q":
        process.exit(0);
    }
  }

  start(): void {
    this.screen.render();
  }
}

const GRAY = "{#333355-fg}";
const R = "{/}";
