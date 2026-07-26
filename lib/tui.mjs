// TUI — Minimal full-screen terminal UI
// Clear-screen approach (no alt screen). Logo at top, conversation scrolls
// naturally with \n, input bar redrawn at absolute bottom.
import { renderLogo } from "./visual.mjs";

const R = "\x1b[0m";
const CSI = "\x1b[";
function c(name) {
  const cl = { black:30, red:31, green:32, yellow:33, blue:34, magenta:35, cyan:36, white:37, dim:2, fg:37 };
  return `${CSI}${cl[name] ?? 37}m`;
}
function dim(s) { return `${c("dim")}${s}${R}`; }

export class TUI {
  constructor(opts = {}) {
    this.active = false;
    this._buf = [];
    this._maxBuf = 500;
    this._inputText = "";
    this._rows = process.stdout.rows || 24;
    this._cols = process.stdout.columns || 80;
    this._toolCount = 0;
    this._onExit = opts.onExit || (() => {});
    this._cursorRow = 0;
    this._convTop = 0;
    this._convBot = 0;
  }

  enter() {
    if (this.active) { this.exit(); }
    process.stdout.write(CSI + "2J" + CSI + "3J" + CSI + "H");
    process.stdout.write(CSI + "?25l");

    const logo = renderLogo({ tools: this._toolCount || 0 });
    for (const line of logo.split("\n")) {
      process.stdout.write(line + "\n");
    }
    process.stdout.write(dim("─".repeat(this._cols)) + "\n");

    this._convTop = logo.split("\n").length + 2;
    this._convBot = this._rows - 2;

    // Scroll region: 1.._convBot — logo + conversation scroll together
    // (logo scrolls away as new messages appear). Input bar at _rows-1/_rows
    // is outside the region and stays fixed.
    process.stdout.write(CSI + "1;" + this._convBot + "r");

    this._cursorRow = this._convTop;
    this._redrawInput();
    process.stdout.write(CSI + this._cursorRow + ";1H");
    this.active = true;
  }

  exit() {
    if (!this.active) return;
    this._onExit();
    process.stdout.write(CSI + "?25h");
    process.stdout.write(CSI + "r");   // Reset scroll region to full screen
    this.active = false;
  }

  log(text) {
    if (!this.active) { process.stdout.write(text + "\n"); return; }

    // If past the bottom of the scroll region, write \n at the bottom
    // margin — the terminal scrolls the region content (including logo) up.
    if (this._cursorRow > this._convBot) {
      process.stdout.write(CSI + this._convBot + ";1H");
      process.stdout.write("\n");
      this._cursorRow = this._convBot;
    }

    process.stdout.write(CSI + this._cursorRow + ";1H" + CSI + "2K");
    process.stdout.write(text);
    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();

    this._cursorRow++;
    this._redrawInput();
  }

  setInput(text) {
    this._inputText = text || "";
    this._redrawInput();
  }

  setToolCount(n) { this._toolCount = n; }

  _redrawInput() {
    const visibleLen = this._inputText.replace(/\x1b\[[0-9;]*[mK]/g, '').length;
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "▸ " + R + this._inputText);
    // ▸ and space occupy columns 1-2, text starts at column 3,
    // cursor goes after the visible text
    process.stdout.write(CSI + this._rows + ";" + (3 + visibleLen) + "H");
  }
}
