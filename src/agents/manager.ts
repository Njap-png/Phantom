import { PhantomAgent } from "./agent.js";
import { AgentMessage, AgentIdentity, AGENT_ARCHETYPES } from "./types.js";
import { EventBus } from "../core/eventbus.js";
import { LLMProvider } from "../providers/openai.js";

export class AgentManager {
  private agents: Map<string, PhantomAgent> = new Map();
  private bus: EventBus;
  private llm?: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.bus = EventBus.getInstance();
    this.llm = llm;
  }

  setLLM(provider: LLMProvider): void {
    this.llm = provider;
    this.agents.forEach((a) => a.setLLM(provider));
  }

  spawnAgent(
    name?: string,
    role?: string,
    persona?: string
  ): PhantomAgent {
    const archetype =
      AGENT_ARCHETYPES[Math.floor(Math.random() * AGENT_ARCHETYPES.length)];
    const agent = new PhantomAgent(
      name || archetype.name,
      role || archetype.role,
      persona || archetype.persona,
      this.llm
    );
    this.agents.set(agent.identity.id, agent);
    this.bus.emit("agent:spawned", agent.identity);
    return agent;
  }

  spawnArchetype(index: number): PhantomAgent {
    if (index < 0 || index >= AGENT_ARCHETYPES.length) {
      return this.spawnAgent();
    }
    const a = AGENT_ARCHETYPES[index];
    return this.spawnAgent(a.name, a.role, a.persona);
  }

  spawnDefaults(): void {
    AGENT_ARCHETYPES.slice(0, 4).forEach((a) =>
      this.spawnAgent(a.name, a.role, a.persona)
    );
  }

  getAgent(id: string): PhantomAgent | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentIdentity[] {
    return Array.from(this.agents.values()).map((a) => a.identity);
  }

  async broadcast(fromId: string, content: string): Promise<void> {
    const from = this.agents.get(fromId);
    if (!from) return;

    const msg: AgentMessage = {
      from: fromId,
      to: "all",
      content,
      timestamp: Date.now(),
      type: "text",
    };

    await Promise.all(
      Array.from(this.agents.entries())
        .filter(([id]) => id !== fromId)
        .map(([, agent]) => agent.receive(msg))
    );
  }

  async sendMessage(fromId: string, toId: string, content: string): Promise<void> {
    const from = this.agents.get(fromId);
    const to = this.agents.get(toId);
    if (!from || !to) return;

    const msg: AgentMessage = {
      from: fromId,
      to: toId,
      content,
      timestamp: Date.now(),
      type: "text",
    };

    await to.receive(msg);
  }

  async debate(topic: string): Promise<void> {
    const allAgents = Array.from(this.agents.values());
    if (allAgents.length < 2) return;

    const starter = allAgents[0];
    const msg: AgentMessage = {
      from: starter.identity.id,
      to: "all",
      content: `Let's debate: ${topic}. Share your perspective.`,
      timestamp: Date.now(),
      type: "text",
    };

    await Promise.all(
      allAgents.slice(1).map((agent) => agent.receive(msg))
    );
  }

  removeAgent(id: string): void {
    this.agents.delete(id);
    this.bus.emit("agent:removed", id);
  }

  evolveAll(): void {
    this.agents.forEach((agent) => agent.evolve());
  }

  count(): number {
    return this.agents.size;
  }
}
