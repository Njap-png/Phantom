// TUI — Full-screen terminal UI manager
// No scroll region: logo and conversation scroll together naturally with \n.
// Input bar redrawn at absolute bottom after each write.
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
    process.stdout.write(CSI + "?1049h"); // alt screen
    process.stdout.write(CSI + "?25l");   // hide cursor

    // Write logo + separator at the very top
    const logo = renderLogo({ tools: this._toolCount || 0 });
    const lines = logo.split("\n");
    const logoH = lines.length;
    process.stdout.write(logo + "\n");
    process.stdout.write(dim("─".repeat(this._cols)) + "\n");

    // Track first conversation row (just after separator)
    this._convTop = logoH + 2;
    this._convBot = this._rows - 2;
    this._cursorRow = this._convTop;

    // Draw input bar at bottom
    this._redrawInput();

    // Position cursor at first conversation line
    process.stdout.write(CSI + this._cursorRow + ";1H");
    this.active = true;
  }

  exit() {
    if (!this.active) return;
    this._onExit();
    process.stdout.write(CSI + (this._rows - 1) + ";1H");
    process.stdout.write(CSI + "?25h");
    process.stdout.write(CSI + "?1049l");
    this.active = false;
  }

  log(text) {
    if (!this.active) { process.stdout.write(text + "\n"); return; }
    // Write at current cursorRow, clearing line first
    process.stdout.write(CSI + this._cursorRow + ";1H" + CSI + "2K");
    process.stdout.write(text);
    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();

    // Advance cursor row. If past input bar area, \n scrolls entire screen.
    if (this._cursorRow < this._rows - 2) {
      this._cursorRow++;
    } else {
      // At bottom — \n scrolls everything (logo + conversation scroll up)
      process.stdout.write("\n");
    }

    this._redrawInput();
  }

  setInput(text) {
    this._inputText = text || "";
    this._redrawInput();
  }

  setToolCount(n) { this._toolCount = n; }

  _redrawInput() {
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "▸ " + R + this._inputText);
    // Cursor stays at input text position for live typing
    process.stdout.write(CSI + this._rows + ";" + (4 + this._inputText.length) + "H");
  }
}
