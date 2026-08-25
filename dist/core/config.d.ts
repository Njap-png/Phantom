export interface PhantomConfig {
    agents: {
        maxInstances: number;
        defaultModel: string;
        defaultProvider: string;
        heartbeatInterval: number;
    };
    ui: {
        borderStyle: string;
        animationSpeed: number;
    };
    providers: {
        openai: {
            apiKey: string;
            baseUrl: string;
        };
        anthropic: {
            apiKey: string;
        };
        ollama: {
            baseUrl: string;
            model: string;
        };
    };
}
export declare const defaultConfig: PhantomConfig;
export declare function loadConfig(): PhantomConfig;
export interface EnvInfo {
    tty: boolean;
    interactive: boolean;
    platform: string;
    terminal: string;
    colors: number;
    hasTrueColor: boolean;
    has256: boolean;
    cols: number;
    rows: number;
    screenSize: "tiny" | "small" | "medium" | "large" | "huge";
    inputMode: string;
    isTermux: boolean;
    isTmux: boolean;
    isWSL: boolean;
    isWindows: boolean;
}
export declare function detectEnv(): EnvInfo;
//# sourceMappingURL=config.d.ts.map