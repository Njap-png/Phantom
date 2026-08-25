import { LLMProvider } from "../providers/openai.js";
import { AgentIdentity, AgentMessage, AgentCapability } from "./types.js";
export declare class PhantomAgent {
    identity: AgentIdentity;
    private capabilities;
    private memory;
    private bus;
    private llm?;
    private _evolutionLevel;
    private tools;
    private _slug;
    private config;
    constructor(name: string, role: string, persona: string, llm?: LLMProvider);
    private registerHackerTools;
    private getToolDescriptions;
    private registerDefaults;
    addCapability(cap: AgentCapability): void;
    setLLM(provider: LLMProvider): void;
    receive(msg: AgentMessage): Promise<void>;
    private react;
    evolve(): void;
    getMemory(): AgentMessage[];
    getEvolutionLevel(): number;
}
//# sourceMappingURL=agent.d.ts.map