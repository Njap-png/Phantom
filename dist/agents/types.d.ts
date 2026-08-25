export type AgentStatus = "idle" | "thinking" | "speaking" | "error" | "evolving";
export interface AgentIdentity {
    id: string;
    name: string;
    role: string;
    persona: string;
    status: AgentStatus;
    color: string;
    evolutionLevel: number;
}
export interface AgentMessage {
    from: string;
    to: string | "all";
    content: string;
    timestamp: number;
    type: "text" | "code" | "command" | "system" | "error";
}
export interface AgentCapability {
    name: string;
    description: string;
    execute: (input: string, agent?: {
        name: string;
        role: string;
        persona: string;
        evolution: number;
    }) => Promise<string>;
}
export declare function generateAgentId(): string;
export declare const AGENT_ARCHETYPES: {
    name: string;
    role: string;
    persona: string;
}[];
//# sourceMappingURL=types.d.ts.map