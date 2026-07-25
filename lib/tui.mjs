// TUI — Full-screen terminal UI manager
// Manages: alt-screen, fixed header (logo), scrollable conversation, fixed input bar
import { renderLogo } from "./visual.mjs";

// ── ANSI helpers (self-contained, no dep on phantom.mjs) ──
const _R = "\x1b[0m";
const _B = "\x1b[1m";
const _D = "\x1b[2m";
function c(name) {
  const colors = { black:30, red:31, green:32, yellow:33, blue:34, magenta:35, cyan:36, white:37, dim:2 };
  return `\x1b[${colors[name] ?? 37}m`;
}
const R = _R, dim = _D;

const ESC = "\x1b";
const CSI = `${ESC}[`;
const SAVE = `${CSI}s`;
const RESTORE = `${CSI}u`;

export class TUI {
  constructor(opts = {}) {
    this.active = false;
    this._buf = [];           // conversation line buffer
    this._maxBuf = 500;
    this._inputText = "";
    this._rows = process.stdout.rows || 24;
    this._cols = process.stdout.columns || 80;
    this._onExit = opts.onExit || (() => {});
    this._logoLines = [];     // cached logo lines
    this._headerHeight = 0;   // recalculated on draw
    this._inputHeight = 2;    // separator + input
  }

  // ── Lifecycle ──

  enter() {
    process.stdout.write(SAVE);
    process.stdout.write(`${CSI}?1049h`); // alt screen
    process.stdout.write(`${CSI}?25l`);    // hide cursor
    this.active = true;
    this._drawStatic();
  }

  exit() {
    if (!this.active) return;
    this._onExit();
    process.stdout.write(`${CSI}?25h`);    // show cursor
    process.stdout.write(`${CSI}?1049l`);   // exit alt
    process.stdout.write(RESTORE);
    this.active = false;
  }

  // ── Drawing ──

  _drawStatic() {
    // Fixed header at top — logo + separator
    process.stdout.write(`${CSI}H`);
    const logo = renderLogo({ tools: this._toolCount || 0 });
    this._logoLines = logo.split("\n");
    const n = this._logoLines.length;
    for (let i = 0; i < n; i++) {
      process.stdout.write(this._logoLines[i] || "");
      process.stdout.write(`${CSI}K`);
      process.stdout.write("\n");
    }
    // Separator
    process.stdout.write(`${c("dim")}${"─".repeat(this._cols)}${R}`);
    process.stdout.write(`${CSI}K`);
    this._headerHeight = n + 1; // logo lines + separator
    this._staticDrawn = true;
  }

  _conversationRows() {
    return this._rows - this._headerHeight - this._inputHeight;
  }

  _drawConversation() {
    const rows = this._conversationRows();
    // Clear conversation area
    for (let r = 0; r < rows; r++) {
      process.stdout.write(`${CSI}${this._headerHeight + 1 + r};1H`); // line, col
      process.stdout.write(`${CSI}2K`); // clear entire line
    }
    // Write visible portion of buffer (tail)
    const start = Math.max(0, this._buf.length - rows);
    const visible = this._buf.slice(start);
    for (let i = 0; i < visible.length; i++) {
      const line = visible[i];
      process.stdout.write(`${CSI}${this._headerHeight + 1 + i};1H`);
      process.stdout.write(line.substring(0, this._cols));
      process.stdout.write(`${CSI}K`);
    }
  }

  _drawInput(text) {
    this._inputText = text || "";
    const row = this._rows - this._inputHeight + 1;
    process.stdout.write(`${CSI}${row};1H`);
    process.stdout.write(`${CSI}2K`);
    process.stdout.write(`${c("dim")}${"─".repeat(this._cols)}${R}`);
    process.stdout.write(`${CSI}${row + 1};1H`);
    process.stdout.write(`${CSI}2K`);
    process.stdout.write(`${c("green")}>> ${R}${this._inputText}`);
    // Place cursor for typing
    process.stdout.write(`${CSI}${row + 1};${this._inputText.length + 5}H`);
  }

  _redrawAll() {
    this._drawStatic();
    this._drawConversation();
    this._drawInput(this._inputText);
  }

  // ── Public API ──

  setToolCount(n) {
    this._toolCount = n;
    if (this.active) this._redrawAll();
  }

  log(text) {
    if (!this.active) { console.log(text); return; }
    const lines = text.split("\n");
    for (const line of lines) {
      this._buf.push(line);
    }
    // Trim buffer
    if (this._buf.length > this._maxBuf) {
      this._buf.splice(0, this._buf.length - this._maxBuf);
    }
    // Redraw conversation area + restore input bar
    this._drawConversation();
    this._drawInput(this._inputText);
  }

  setInput(text) {
    this._drawInput(text);
  }

  get rows() { return this._rows; }
  get cols() { return this._cols; }
  get buf() { return this._buf; }
}
