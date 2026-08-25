import blessed from "blessed";
import { phantomTheme, phantomBorders } from "./theme.js";
export class PanelManager {
    screen;
    panels = [];
    focusedIndex = 0;
    container;
    constructor(screen) {
        this.screen = screen;
        this.container = blessed.box({
            parent: screen,
            top: 1,
            left: 0,
            width: "100%",
            height: "95%-1",
        });
    }
    createPanel(agent) {
        const cols = Math.ceil(Math.sqrt(this.panels.length + 1));
        const rows = Math.ceil((this.panels.length + 1) / cols);
        const idx = this.panels.length;
        const box = blessed.box({
            parent: this.container,
            top: `${Math.floor(idx / cols) * (100 / rows)}%`,
            left: `${(idx % cols) * (100 / cols)}%`,
            width: `${100 / cols}%`,
            height: `${100 / rows}%`,
            border: phantomBorders,
            style: {
                bg: phantomTheme.panelBg,
                fg: phantomTheme.foreground,
                border: { fg: phantomTheme.border },
            },
            label: agent
                ? ` {bold}${agent.name}{/bold} [${agent.role}] `
                : " {bold}~terminal{/bold} ",
            tags: true,
        });
        const log = blessed.log({
            parent: box,
            top: 0,
            left: 0,
            width: "100%",
            height: "100%-1",
            scrollable: true,
            scrollbar: {
                ch: "░",
                style: { fg: phantomTheme.dim },
            },
            style: {
                bg: phantomTheme.panelBg,
                fg: phantomTheme.foreground,
            },
            keys: true,
            vi: true,
            alwaysScroll: true,
            scrollback: 500,
            tags: true,
        });
        const footer = blessed.box({
            parent: box,
            bottom: 0,
            left: 0,
            width: "100%",
            height: 1,
            content: agent
                ? ` {${agent.color}-fg}●{/${agent.color}-fg} ${agent.id}`
                : " {bold}←→{/bold} switch  {bold}SPC{/bold} cmd  {bold}ESC{/bold} menu ",
            tags: true,
            style: {
                bg: phantomTheme.titleBar,
                fg: phantomTheme.dim,
            },
        });
        const panel = { box, log, agentId: agent?.id };
        this.panels.push(panel);
        box.on("click", () => this.focus(idx));
        this.focus(idx);
        this.screen.render();
        return panel;
    }
    focus(index) {
        const prev = this.panels[this.focusedIndex];
        if (prev && prev.box.style.border) {
            prev.box.style.border.fg = phantomTheme.border;
        }
        this.focusedIndex = Math.max(0, Math.min(index, this.panels.length - 1));
        const current = this.panels[this.focusedIndex];
        if (current && current.box.style.border) {
            current.box.style.border.fg = phantomTheme.borderFocus;
        }
        this.screen.render();
    }
    getFocused() {
        return this.panels[this.focusedIndex];
    }
    getPanels() {
        return this.panels;
    }
    removePanel(id) {
        const idx = this.panels.findIndex((p) => p.agentId === id);
        if (idx === -1)
            return;
        const panel = this.panels[idx];
        panel.box.detach();
        this.panels.splice(idx, 1);
        this.screen.render();
    }
    writeToPanel(agentId, msg) {
        const panel = this.panels.find((p) => p.agentId === agentId);
        if (panel) {
            panel.log.add(msg);
            this.screen.render();
        }
    }
    writeToAll(msg) {
        this.panels.forEach((p) => {
            p.log.add(msg);
        });
        this.screen.render();
    }
    nextPanel() {
        this.focus((this.focusedIndex + 1) % this.panels.length);
    }
    prevPanel() {
        this.focus((this.focusedIndex - 1 + this.panels.length) % this.panels.length);
    }
}
//# sourceMappingURL=panels.js.map