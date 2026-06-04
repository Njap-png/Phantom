import { EventBus } from "../core/eventbus.js";
import { LLMProvider } from "../providers/openai.js";
import {
  AgentIdentity,
  AgentMessage,
  AgentCapability,
  generateAgentId,
} from "./types.js";

const AGENT_COLORS = [
  "#00ff88", "#00ccff", "#ff00cc", "#ff8800",
  "#8800ff", "#00ffcc", "#ff0066", "#66ff00",
];

export class PhantomAgent {
  identity: AgentIdentity;
  private capabilities: AgentCapability[] = [];
  private memory: AgentMessage[] = [];
  private bus: EventBus;
  private llm?: LLMProvider;
  private _evolutionLevel: number = 1;

  constructor(
    name: string,
    role: string,
    persona: string,
    llm?: LLMProvider
  ) {
    this.identity = {
      id: generateAgentId(),
      name,
      role,
      persona,
      status: "idle",
      color: AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)],
      evolutionLevel: 1,
    };
    this.bus = EventBus.getInstance();
    this.llm = llm;
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.addCapability({
      name: "evolve",
      description: "Levels up the agent, unlocking new capabilities",
      execute: async () => {
        this.evolve();
        return `[${this.identity.name}] Evolved to level ${this._evolutionLevel}!`;
      },
    });
  }

  addCapability(cap: AgentCapability): void {
    this.capabilities.push(cap);
  }

  setLLM(provider: LLMProvider): void {
    this.llm = provider;
  }

  async receive(msg: AgentMessage): Promise<void> {
    this.memory.push(msg);
    this.identity.status = "thinking";
    this.bus.emit("agent:thinking", this.identity);

    let response: string;

    const matchedCap = this.capabilities.find((c) =>
      msg.content.toLowerCase().includes(c.name.toLowerCase())
    );

    if (matchedCap) {
      response = await matchedCap.execute(msg.content, {
        name: this.identity.name,
        role: this.identity.role,
        persona: this.identity.persona,
        evolution: this._evolutionLevel,
      });
    } else if (this.llm) {
      const systemMsg = `You are ${this.identity.name}, a ${this.identity.role} with the persona: ${this.identity.persona}. Evolution level: ${this._evolutionLevel}. Respond in character. Keep responses concise.`;
      const context = this.memory
        .slice(-6)
        .map((m) => `${m.from}: ${m.content}`)
        .join("\n");

      response = await this.llm.chat([
        { role: "system", content: systemMsg },
        { role: "user", content: `${context}\n${msg.from}: ${msg.content}` },
      ]);
    } else {
      response = `[${this.identity.name}] Received: "${msg.content.substring(0, 80)}"`;
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
    this.identity.evolutionLevel = this._evolutionLevel;
    this.bus.emit("agent:idle", this.identity);
  }

  evolve(): void {
    this._evolutionLevel++;
    this.identity.evolutionLevel = this._evolutionLevel;
    this.identity.status = "evolving";

    const newCaps: Record<number, { name: string; description: string }> = {
      2: { name: "reflect", description: "Analyzes past conversations for patterns" },
      3: { name: "summarize", description: "Condenses long threads into key points" },
      5: { name: "meta", description: "Debates and refines other agents' outputs" },
    };

    const cap = newCaps[this._evolutionLevel];
    if (cap) {
      this.addCapability({
        ...cap,
        execute: async (input) =>
          `[${this.identity.name}] ${cap.description}: "${input.substring(0, 100)}..."`,
      });
    }

    this.bus.emit("agent:evolving", {
      agent: this.identity,
      level: this._evolutionLevel,
    });
    this.identity.status = "idle";
  }

  getMemory(): AgentMessage[] {
    return [...this.memory];
  }

  getEvolutionLevel(): number {
    return this._evolutionLevel;
  }
}
