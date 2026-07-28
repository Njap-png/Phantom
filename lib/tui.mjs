// TUI — Minimal full-screen terminal UI
// Auto-adjusting to any terminal size. Conversation scrolls naturally
// via terminal scrolling, input bar stays fixed at bottom.
// Reliable across all terminals — no scroll region trickery.
import { renderLogo } from "./visual.mjs";

const R = "\x1b[0m";
const CSI = "\x1b[";
const home = CSI + "H";
const cls = CSI + "2J" + CSI + "3J";
const hide = CSI + "?25l";
const show = CSI + "?25h";

function c(name) {
  const cl = { black:30, red:31, green:32, yellow:33, blue:34, magenta:35, cyan:36, white:37, dim:2, fg:37 };
  return `${CSI}${cl[name] ?? 37}m`;
}
function dim(s) { return `${c("dim")}${s}${R}`; }

// ── Helper: count how many terminal lines a string occupies ──
function countLines(text, cols) {
  if (!text) return 0;
  const lines = text.split("\n");
  let total = 0;
  for (const line of lines) {
    const plain = line.replace(/\x1b\[[0-9;]*[mK]/g, "");
    if (plain.length === 0) {
      total += 1;
    } else {
      total += Math.max(1, Math.ceil(plain.length / Math.max(cols, 1)));
    }
  }
  return total;
}

export class TUI {
  constructor(opts = {}) {
    this.active = false;
    this._buf = [];           // full conversation history (for resize redraw)
    this._maxBuf = 500;
    this._inputText = "";
    this._toolCount = 0;
    this._onExit = opts.onExit || (() => {});
    this._rows = process.stdout.rows || 24;
    this._cols = process.stdout.columns || 80;
    this._resizeHandler = null;
    this._logoHeight = 0;
    this._contentLines = 0;   // total lines of conversation written so far
    this._firstDraw = true;   // first draw does full layout

    // Handle terminal resize
    this._onResize = () => {
      const newRows = process.stdout.rows || 24;
      const newCols = process.stdout.columns || 80;
      if (newRows === this._rows && newCols === this._cols) return;
      this._rows = newRows;
      this._cols = newCols;
      if (this.active) this._fullRedraw();
    };
  }

  enter() {
    if (this.active) { this.exit(); }
    process.stdout.write(home + cls + hide);

    const logo = renderLogo({ tools: this._toolCount || 0 });
    this._logoHeight = logo.split("\n").length + 1; // +1 for separator line

    // Write logo
    process.stdout.write(logo + "\n");
    process.stdout.write(dim("\u2500".repeat(this._cols)) + "\n");

    // Draw empty input bar at bottom
    process.stdout.write(dim("\u2500".repeat(this._cols)) + "\n");
    process.stdout.write(c("green") + "\u25b8 " + R);
    process.stdout.write(CSI + this._rows + ";1H");
    process.stdout.write(CSI + this._rows + ";3H");

    this._contentLines = 0;
    this._firstDraw = true;
    this.active = true;

    // Listen for resize
    if (typeof process.stdout.on === "function" && !this._resizeHandler) {
      this._resizeHandler = this._onResize.bind(this);
      process.stdout.on("resize", this._resizeHandler);
    }
  }

  exit() {
    if (!this.active) return;
    if (this._resizeHandler) {
      try { process.stdout.removeListener("resize", this._resizeHandler); } catch {}
      this._resizeHandler = null;
    }
    this._onExit();
    process.stdout.write(show);
    process.stdout.write(CSI + "r"); // Reset any scroll region
    this.active = false;
  }

  log(text) {
    if (!this.active) { process.stdout.write(text + "\n"); return; }

    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();

    const lineCount = countLines(text, this._cols);
    const convRows = this._rows - this._logoHeight - 2; // space for conversation

    // If this is the first draw, position cursor just after the separator
    if (this._firstDraw) {
      this._firstDraw = false;
      // Cursor is already at line logoHeight
    }

    // ── Write text and let terminal scroll naturally ──
    // We write from the current position. If we fill the screen,
    // terminal scrolls the whole display up. Then we redraw the
    // input bar at the bottom.
    if (this._contentLines + lineCount <= convRows) {
      // Still fits: just append text
      process.stdout.write(text + "\n");
      this._contentLines += lineCount;
    } else {
      // Screen is full or will overflow. Write text at bottom
      // of conversation area, then redraw input bar.
      // Move cursor to just above the input bar
      process.stdout.write(CSI + (this._rows - 1) + ";1H");
      // Write text — terminal may scroll it
      process.stdout.write(text + "\n");
      // content stays maxed
    }

    // Always redraw input bar at the bottom
    this._redrawInput();
  }

  _fullRedraw() {
    // Full redraw on resize — redraw logo + as much conversation as fits
    if (!this.active) return;
    const rows = this._rows;
    const cols = this._cols;

    let out = home + cls;

    // Logo
    const logo = renderLogo({ tools: this._toolCount || 0 });
    this._logoHeight = logo.split("\n").length + 1;
    out += logo + "\n";
    out += dim("\u2500".repeat(cols)) + "\n";

    // Replay conversation buffer — show last convRows lines
    const convRows = rows - this._logoHeight - 2;
    const visible = [];
    let lineCount = 0;

    for (let i = this._buf.length - 1; i >= 0 && lineCount < convRows; i--) {
      const entry = this._buf[i];
      const entryLines = countLines(entry, cols);
      if (lineCount + entryLines <= convRows) {
        visible.unshift(entry);
        lineCount += entryLines;
      } else {
        break;
      }
    }

    this._contentLines = lineCount;

    // Fill remaining with blank lines, then write visible entries
    const blankRows = convRows - lineCount;
    for (let i = 0; i < blankRows; i++) {
      out += "\n";
    }
    for (const line of visible) {
      out += line + "\n";
    }

    // Input bar
    out += dim("\u2500".repeat(cols)) + "\n";
    const visibleLen = this._inputText.replace(/\x1b\[[0-9;]*[mK]/g, '').length;
    out += c("green") + "\u25b8 " + R + this._inputText;

    process.stdout.write(out);
    process.stdout.write(CSI + rows + ";" + (3 + visibleLen) + "H");
    this._firstDraw = false;
  }

  setInput(text) {
    this._inputText = text || "";
    this._redrawInput();
  }

  setToolCount(n) { this._toolCount = n; }

  _redrawInput() {
    const rows = this._rows;
    const cols = this._cols;
    const visibleLen = this._inputText.replace(/\x1b\[[0-9;]*[mK]/g, '').length;
    // Redraw separator line + input line at bottom
    process.stdout.write(CSI + (rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("\u2500".repeat(cols)));
    process.stdout.write(CSI + rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "\u25b8 " + R + this._inputText);
    process.stdout.write(CSI + rows + ";" + (3 + visibleLen) + "H");
  }
}
