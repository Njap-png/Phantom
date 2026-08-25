export declare class PhantomTermuxUI {
    private rl;
    private agentManager;
    private bus;
    private running;
    private commandHistory;
    private historyIndex;
    private log;
    private llm?;
    constructor();
    private registerEvents;
    private writeLog;
    private clearScreen;
    private draw;
    private promptCommand;
    private waitForKey;
    private handleCommand;
    start(): void;
    stop(): void;
}
//# sourceMappingURL=termux.d.ts.map