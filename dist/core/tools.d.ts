import { AgentCapability } from "../agents/types.js";
export declare function saveDynamicTool(toolName: string, code: string): string;
export declare function loadDynamicTool(filePath: string, toolName: string, description: string): Promise<AgentCapability>;
export declare function loadAllDynamicTools(): Promise<{
    name: string;
    description: string;
    filePath: string;
}[]>;
//# sourceMappingURL=tools.d.ts.map