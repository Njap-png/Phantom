// TUI — Full-screen terminal UI manager with scroll region
// Conversation scrolls naturally within scroll region (phone scrollback works)
// Input bar fixed at bottom 2 rows (outside scroll region, never overwritten)
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
    this._convTop = 0;  // scroll region top (1-indexed)
    this._convBot = 0;  // scroll region bottom
    this._cursorRow = 0; // current write row within scroll region
  }

  enter() {
    process.stdout.write(CSI + "?1049h");
    process.stdout.write(CSI + "?25l");

    // Write logo + top separator
    const logo = renderLogo({ tools: this._toolCount || 0 });
    const lines = logo.split("\n");
    const logoH = lines.length;
    process.stdout.write(logo + "\n");
    process.stdout.write(dim("─".repeat(this._cols)) + "\n");

    // Set scroll region: logo+2 .. rows-2
    this._convTop = logoH + 2;
    this._convBot = this._rows - 2;
    this._cursorRow = this._convTop;
    process.stdout.write(CSI + this._convTop + ";" + this._convBot + "r");

    // Draw input bar (rows rows-1, rows — outside scroll region)
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "▸ " + R);

    // Start writing at top of scroll region
    process.stdout.write(CSI + this._convTop + ";1H");
    this.active = true;
  }

  exit() {
    if (!this.active) return;
    this._onExit();
    process.stdout.write(CSI + "r");        // reset scroll region
    process.stdout.write(CSI + this._rows + ";1H");
    process.stdout.write(CSI + "?25h");     // show cursor
    process.stdout.write(CSI + "?1049l");   // exit alt
    this.active = false;
  }

  log(text) {
    if (!this.active) { process.stdout.write(text + "\n"); return; }
    // Always write at current tracked row within scroll region
    process.stdout.write(CSI + this._cursorRow + ";1H" + CSI + "2K");
    process.stdout.write(text);
    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();

    // Advance row — stop at bottom of scroll region (terminal scrolls there)
    if (this._cursorRow < this._convBot) {
      this._cursorRow++;
    } else {
      // At bottom of scroll region: write \n to trigger scroll, stay at bottom
      process.stdout.write("\n");
    }

    // Redraw input bar (scrolling may have disturbed it)
    this._redrawInput();
  }

  setInput(text) {
    this._inputText = text || "";
    this._redrawInput();
  }

  setToolCount(n) { this._toolCount = n; }

  // ── Input bar (rows rows-1 and rows, OUTSIDE scroll region) ──

  _redrawInput() {
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "▸ " + R + this._inputText);
    // Cursor stays at end of input text for typing
    process.stdout.write(CSI + this._rows + ";" + (4 + this._inputText.length) + "H");
  }
}
