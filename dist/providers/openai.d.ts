import { PhantomConfig } from "../core/config.js";
export interface LLMProvider {
    chat: (messages: {
        role: string;
        content: string;
    }[], opts?: {
        model?: string;
        temperature?: number;
    }) => Promise<string>;
    transcribe?: (filePath: string) => Promise<string>;
}
export declare function createProvider(config: PhantomConfig): Promise<LLMProvider>;
export declare function createOpenAIProvider(config: PhantomConfig): LLMProvider;
export declare function createOllamaProvider(config: PhantomConfig): LLMProvider;
//# sourceMappingURL=openai.d.ts.map