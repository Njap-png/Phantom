import { EventBus } from "../core/eventbus.js";
import {
  AgentIdentity,
  AgentMessage,
  AgentCapability,
  AgentStatus,
  generateAgentId,
} from "./types.js";

export class PhantomAgent {
  identity: AgentIdentity;
  private capabilities: AgentCapability[] = [];
  private memory: AgentMessage[] = [];
  private bus: EventBus;
  private evolutionLevel: number = 1;

  constructor(name: string, role: string, persona: string) {
    this.identity = {
      id: generateAgentId(),
      name,
      role,
      persona,
      status: "idle",
      color: this.randomColor(),
    };
    this.bus = EventBus.getInstance();
    this.registerDefaults();
  }

  private randomColor(): string {
    const colors = [
      "#00ff88", "#00ccff", "#ff00cc", "#ff8800",
      "#8800ff", "#00ffcc", "#ff0066", "#66ff00",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private registerDefaults(): void {
    this.addCapability({
      name: "echo",
      description: "Echoes input back",
      execute: async (input) => `Echo: ${input}`,
    });
  }

  addCapability(cap: AgentCapability): void {
    this.capabilities.push(cap);
  }

  async receive(msg: AgentMessage): Promise<void> {
    this.memory.push(msg);
    this.identity.status = "thinking";
    this.bus.emit("agent:thinking", this.identity);

    let response = "";
    for (const cap of this.capabilities) {
      if (msg.content.toLowerCase().includes(cap.name.toLowerCase())) {
        response = await cap.execute(msg.content);
        break;
      }
    }

    if (!response) {
      response = `[${this.identity.name}] Processing: "${msg.content.substring(0, 50)}..."`;
    }

    this.identity.status = "speaking";
    this.bus.emit("agent:speaking", { agent: this.identity, message: response });

    const reply: AgentMessage = {
      from: this.identity.id,
      to: msg.from,
      content: response,
      timestamp: Date.now(),
      type: "text",
    };

    this.memory.push(reply);
    this.identity.status = "idle";
    this.bus.emit("agent:idle", this.identity);
  }

  evolve(): void {
    this.evolutionLevel++;
    this.identity.status = "evolving";
    this.bus.emit("agent:evolving", {
      agent: this.identity,
      level: this.evolutionLevel,
    });
  }

  getMemory(): AgentMessage[] {
    return [...this.memory];
  }

  getEvolutionLevel(): number {
    return this.evolutionLevel;
  }
}
