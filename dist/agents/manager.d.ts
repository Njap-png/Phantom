import { PhantomAgent } from "./agent.js";
import { AgentIdentity } from "./types.js";
import { LLMProvider } from "../providers/openai.js";
export declare class AgentManager {
    private agents;
    private bus;
    private llm?;
    constructor(llm?: LLMProvider);
    setLLM(provider: LLMProvider): void;
    spawnAgent(name?: string, role?: string, persona?: string): PhantomAgent;
    spawnArchetype(index: number): PhantomAgent;
    spawnDefaults(): void;
    getAgent(id: string): PhantomAgent | undefined;
    listAgents(): AgentIdentity[];
    broadcast(fromId: string, content: string): Promise<void>;
    sendMessage(fromId: string, toId: string, content: string): Promise<void>;
    debate(topic: string): Promise<void>;
    removeAgent(id: string): void;
    evolveAll(): void;
    count(): number;
}
//# sourceMappingURL=manager.d.ts.map