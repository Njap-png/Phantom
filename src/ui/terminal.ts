import blessed from "blessed";
import { phantomTheme } from "./theme.js";
import { PanelManager } from "./panels.js";
import { AgentManager } from "../agents/manager.js";
import { EventBus, EventHandler } from "../core/eventbus.js";
import { AgentIdentity, AgentStatus } from "../agents/types.js";

export class PhantomTerminal {
  private screen: blessed.Widgets.Screen;
  private panelManager!: PanelManager;
  private agentManager: AgentManager;
  private bus: EventBus;
  private titleBar!: blessed.Widgets.BoxElement;
  private statusBar!: blessed.Widgets.BoxElement;
  private commandInput!: blessed.Widgets.TextboxElement;

  constructor() {
    this.bus = EventBus.getInstance();
    this.agentManager = new AgentManager();

    this.screen = blessed.screen({
      smartCSR: true,
      title: "Phantom — Space Evolving Terminal",
      cursor: { artificial: true, shape: "line", blink: true } as any,
      dockBorders: true,
      fullUnicode: true,
      terminal: "xterm-256color",
    });

    this.screen.key(["C-c", "q"], () => {
      process.exit(0);
    });

    this.buildUI();
    this.registerEvents();
    this.startStarfield();
    this.spawnDefaultAgents();
  }

  private buildUI(): void {
    this.titleBar = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: " {bold}PHANTOM{/bold} — space evolving terminal  {#333355-fg}|  agents: 0  |  ⚡ idle{/#333355-fg}",
      tags: true,
      style: {
        bg: phantomTheme.titleBar,
        fg: phantomTheme.accent,
      },
    });

    this.panelManager = new PanelManager(this.screen);

    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 1,
      left: 0,
      width: "100%",
      height: 1,
      content: " {dim}⏎{/dim} enter cmd  {dim}→{/dim}{dim}←{/dim} panels  {dim}TAB{/dim} focus  {dim}ESC{/dim} cmd  {dim}q{/dim} quit",
      tags: true,
      style: {
        bg: phantomTheme.titleBar,
        fg: phantomTheme.dim,
      },
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
      prompt: " ⚡ ",
    });

    this.screen.key(["escape"], () => {
      this.commandInput.readInput((err: any, val?: string) => {
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
  }

  private registerEvents(): void {
    this.bus.on("agent:spawned", ((data: unknown) => {
      const agent = data as AgentIdentity;
      const panel = this.panelManager.createPanel(agent);
      panel.log.add(`{green-fg}◈ Agent ${agent.name} initialized{/green-fg}`);
      panel.log.add(`{cyan-fg}  id: ${agent.id}{/cyan-fg}`);
      panel.log.add(`{cyan-fg}  role: ${agent.role}{/cyan-fg}`);
      this.updateTitleBar();
    }) as EventHandler);

    this.bus.on("agent:speaking", ((data: unknown) => {
      const { agent, message } = data as { agent: AgentIdentity; message: string };
      this.panelManager.writeToPanel(
        agent.id,
        `{${agent.color}-fg}[${agent.name}]{/${agent.color}-fg} ${message}`
      );
      this.updateTitleBar();
    }) as EventHandler);

    this.bus.on("agent:thinking", ((agent: unknown) => {
      this.updateTitleBar();
    }) as EventHandler);

    this.bus.on("agent:evolving", ((data: unknown) => {
      const { agent, level } = data as { agent: AgentIdentity; level: number };
      this.panelManager.writeToPanel(
        agent.id,
        `{magenta-fg}◈ EVOLVING to level ${level}{/magenta-fg}`
      );
    }) as EventHandler);

    this.bus.on("agent:removed", ((data: unknown) => {
      const id = data as string;
      this.panelManager.removePanel(id);
      this.panelManager.writeToAll(`{red-fg}◈ Agent ${id} terminated{/red-fg}`);
      this.updateTitleBar();
    }) as EventHandler);
  }

  private updateTitleBar(): void {
    const agents = this.agentManager.listAgents();
    const counts: Record<string, number> = { idle: 0, thinking: 0, speaking: 0, evolving: 0, error: 0 };
    agents.forEach((a) => {
      const s = a.status as string;
      if (counts[s] !== undefined) counts[s]++;
    });

    let statusStr = "";
    if (counts.thinking > 0) statusStr = "{yellow-fg}🧠 thinking{/yellow-fg}";
    else if (counts.speaking > 0) statusStr = "{cyan-fg}💬 speaking{/cyan-fg}";
    else if (counts.evolving > 0) statusStr = "{magenta-fg}⬆ evolving{/magenta-fg}";
    else statusStr = "{green-fg}⚡ idle{/green-fg}";

    this.titleBar.setContent(
      ` {bold}PHANTOM{/bold} — space evolving terminal  {#333355-fg}|  agents: ${agents.length}  |  ${statusStr}{/#333355-fg}`
    );
    this.screen.render();
  }

  private spawnDefaultAgents(): void {
    const defaults = [
      { name: "Nova", role: "architect", persona: "Strategic system designer" },
      { name: "Orion", role: "engineer", persona: "Implementation specialist" },
      { name: "Vega", role: "analyst", persona: "Pattern recognition & data" },
      { name: "Lyra", role: "critic", persona: "Quality & edge-case finder" },
    ];
    defaults.forEach((d) => this.agentManager.spawnAgent(d.name, d.role, d.persona));
  }

  private handleCommand(cmd: string): void {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case "spawn":
      case "s": {
        const name = args[0] || `Agent-${Date.now()}`;
        const role = args[1] || "general";
        const persona = args.slice(2).join(" ") || "Curious explorer";
        this.agentManager.spawnAgent(name, role, persona);
        break;
      }
      case "list":
      case "ls": {
        const agents = this.agentManager.listAgents();
        const panel = this.panelManager.getFocused();
        if (panel) {
          panel.log.add(`{cyan-fg}◈ Agents (${agents.length}):{/cyan-fg}`);
          agents.forEach((a) => {
            panel.log.add(`  {${a.color}-fg}●{/${a.color}-fg} ${a.name} (${a.id}) — ${a.role} [${a.status}]`);
          });
        }
        break;
      }
      case "broadcast":
      case "b": {
        const msg = args.join(" ");
        const panel = this.panelManager.getFocused();
        if (panel && panel.agentId) {
          this.agentManager.broadcast(panel.agentId, msg);
        }
        break;
      }
      case "evolve":
      case "e": {
        this.agentManager.evolveAll();
        this.panelManager.writeToAll("{magenta-fg}◈ Initiating mass evolution...{/magenta-fg}");
        break;
      }
      case "clear":
      case "c": {
        const p = this.panelManager.getFocused();
        if (p) p.log.setContent("");
        break;
      }
      case "help":
      case "h": {
        const helpPanel = this.panelManager.getFocused();
        if (helpPanel) {
          helpPanel.log.add("");
          helpPanel.log.add("{bold}PHANTOM COMMANDS{/bold}");
          helpPanel.log.add(`  {green-fg}spawn|s{/green-fg} <name> <role> <persona>  — create agent`);
          helpPanel.log.add(`  {green-fg}list|ls{/green-fg}                       — list agents`);
          helpPanel.log.add(`  {green-fg}broadcast|b{/green-fg} <msg>              — broadcast to all agents`);
          helpPanel.log.add(`  {green-fg}evolve|e{/green-fg}                       — evolve all agents`);
          helpPanel.log.add(`  {green-fg}clear|c{/green-fg}                        — clear panel`);
          helpPanel.log.add(`  {green-fg}help|h{/green-fg}                         — this help`);
          helpPanel.log.add(`  {green-fg}quit|q{/green-fg}                         — exit phantom`);
          helpPanel.log.add("");
        }
        break;
      }
      case "quit":
      case "q":
        process.exit(0);
    }
  }

  private startStarfield(): void {
    const chars = ["·", "∙", "◦", "○", "✦", "✧"];
    let stars: { x: number; y: number; char: string; speed: number }[] = [];

    for (let i = 0; i < 60; i++) {
      stars.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        char: chars[Math.floor(Math.random() * chars.length)],
        speed: 0.1 + Math.random() * 0.5,
      });
    }

    setInterval(() => {
      const screenWidth = this.screen.width as number;
      if (screenWidth <= 0) return;

      stars = stars.map((s) => {
        let x = s.x + s.speed * 0.3;
        if (x > 100) x = 0;
        return { ...s, x };
      });

      const starStr = stars
        .filter((s) => s.y < 5)
        .slice(0, 3)
        .map(() => "")
        .join("");

      if (starStr) {
        this.titleBar.setContent(
          this.titleBar.getContent().replace(/[·∙◦○✦✧]/g, "") + starStr
        );
      }
    }, 200);
  }

  start(): void {
    this.screen.render();
  }
}
