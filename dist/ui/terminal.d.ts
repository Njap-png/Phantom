export declare class PhantomTerminal {
    private screen;
    private panelManager;
    private agentManager;
    private bus;
    private titleBar;
    private commandInput;
    private llm?;
    constructor();
    private buildUI;
    private registerEvents;
    private makeTitleContent;
    private refreshTitle;
    private spawnDefaultAgents;
    private handleCommand;
    start(): void;
}
//# sourceMappingURL=terminal.d.ts.map