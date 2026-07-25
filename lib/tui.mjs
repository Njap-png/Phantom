// TUI — Full-screen terminal UI manager
// Conversation: natural-scroll within scroll region (phone scrollback works)
// Input bar: fixed at bottom 2 rows (outside scroll region)
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
    this._headerHeight = 0;  // set on enter
    this._convTop = 0;       // scroll region top (1-indexed)
    this._convBot = 0;       // scroll region bottom
  }

  enter() {
    process.stdout.write(CSI + "?1049h"); // alt screen
    process.stdout.write(CSI + "?25l");   // hide cursor

    // Write logo
    const logo = renderLogo({ tools: this._toolCount || 0 });
    const lines = logo.split("\n");
    this._headerHeight = lines.length + 2; // logo lines + separator + blank
    process.stdout.write(logo);
    process.stdout.write("\n");
    process.stdout.write(dim("─".repeat(this._cols)) + "\n");

    // Set scroll region: header+1 .. rows-2
    this._convTop = this._headerHeight + 1;
    this._convBot = this._rows - 2;
    process.stdout.write(CSI + this._convTop + ";" + this._convBot + "r");

    // Draw input bar (outside scroll region)
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "▸ " + R);

    // Position cursor at top of scroll region
    process.stdout.write(CSI + this._convTop + ";1H");

    this.active = true;
  }

  exit() {
    if (!this.active) return;
    this._onExit();
    process.stdout.write(CSI + "r");       // reset scroll region
    process.stdout.write(CSI + "?25h");    // show cursor
    process.stdout.write(CSI + "?1049l");  // exit alt
    this.active = false;
  }

  log(text) {
    if (!this.active) { process.stdout.write(text + "\n"); return; }
    // Write naturally within scroll region — terminal handles scroll
    process.stdout.write(text + "\n");
    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();
    // Redraw input bar (outside scroll region) — scrolling may have disturbed it
    this._setInput(this._inputText);
  }

  setInput(text) {
    this._inputText = text || "";
    this._setInput(text);
  }

  setToolCount(n) { this._toolCount = n; }

  // ── Input bar (rows rows-1 and rows, OUTSIDE scroll region) ──

  _setInput(text) {
    this._inputText = text ?? this._inputText;
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "▸ " + R + this._inputText);
    // Place cursor at end of input for typing
    process.stdout.write(CSI + this._rows + ";" + (4 + this._inputText.length) + "H");
  }
}
