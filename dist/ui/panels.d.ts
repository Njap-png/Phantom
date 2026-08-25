import blessed from "blessed";
import { AgentIdentity } from "../agents/types.js";
export interface PhantomPanel {
    box: blessed.Widgets.BoxElement;
    log: blessed.Widgets.Log;
    agentId?: string;
}
export declare class PanelManager {
    private screen;
    private panels;
    private focusedIndex;
    private container;
    constructor(screen: blessed.Widgets.Screen);
    createPanel(agent?: AgentIdentity): PhantomPanel;
    focus(index: number): void;
    getFocused(): PhantomPanel | undefined;
    getPanels(): PhantomPanel[];
    removePanel(id: string): void;
    writeToPanel(agentId: string, msg: string): void;
    writeToAll(msg: string): void;
    nextPanel(): void;
    prevPanel(): void;
}
//# sourceMappingURL=panels.d.ts.map