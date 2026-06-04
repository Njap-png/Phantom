import { PhantomAgent } from "./agent.js";
import { AgentMessage, AgentIdentity } from "./types.js";
import { EventBus } from "../core/eventbus.js";

export class AgentManager {
  private agents: Map<string, PhantomAgent> = new Map();
  private bus: EventBus;

  constructor() {
    this.bus = EventBus.getInstance();
  }

  spawnAgent(name: string, role: string, persona: string): PhantomAgent {
    const agent = new PhantomAgent(name, role, persona);
    this.agents.set(agent.identity.id, agent);
    this.bus.emit("agent:spawned", agent.identity);
    return agent;
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

    const promises: Promise<void>[] = [];
    this.agents.forEach((agent, id) => {
      if (id !== fromId) {
        promises.push(agent.receive(msg));
      }
    });

    await Promise.all(promises);
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

  removeAgent(id: string): void {
    this.agents.delete(id);
    this.bus.emit("agent:removed", id);
  }

  evolveAll(): void {
    this.agents.forEach((agent) => agent.evolve());
  }
}
