import { AgentMessage } from "../agents/types.js";
export declare function saveMemory(agentId: string, memory: AgentMessage[]): void;
export declare function loadMemory(agentId: string): AgentMessage[];
export declare function saveKnowledge(agentId: string, knowledge: string): void;
export declare function loadKnowledge(agentId: string): string;
//# sourceMappingURL=persistence.d.ts.map