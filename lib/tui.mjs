// TUI — Full-screen terminal UI manager
// No scroll region: logo lives at top, conversation scrolls naturally with \n,
// input bar redrawn at bottom after each write. Terminal scrollback works for everything.
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
    this._scrollClear = 1; // rows above separator that are 'reserved' for logo
  }

  enter() {
    process.stdout.write(CSI + "?1049h"); // alt screen
    process.stdout.write(CSI + "?25l");   // hide cursor

    // Write logo once at top
    const logo = renderLogo({ tools: this._toolCount || 0 });
    const lines = logo.split("\n");
    const logoH = lines.length;
    process.stdout.write(logo + "\n");
    process.stdout.write(dim("─".repeat(this._cols)) + "\n");

    // Cursor starts right after separator for conversation writes
    this._cursorRow = logoH + 2;
    this._scrollClear = logoH + 1; // separator row — never write here

    // Draw input bar at bottom
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "▸ " + R);

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
    // Write at current cursorRow
    process.stdout.write(CSI + this._cursorRow + ";1H" + CSI + "2K");
    process.stdout.write(text);
    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();

    // Advance cursorRow. If past input-bar area, scroll naturally.
    if (this._cursorRow < this._rows - 2) {
      this._cursorRow++;
    } else {
      // At bottom — write \n to scroll, then redraw input bar
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
    // Cursor stays at end of input text for typing
    process.stdout.write(CSI + this._rows + ";" + (4 + this._inputText.length) + "H");
  }
}
