// TUI — Minimal full-screen terminal UI
// Layout: logo (at top, scrolls away when full) | conversation (scrollable) | input bar (fixed bottom)
// Everything stays in its proper place — logo area never gets polluted.
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
    this._convTop = 0;        // 1-based row where conversation starts (after logo+separator)
    this._convBot = 0;        // 1-based row where conversation ends (before input bar)
    this._cursorRow = 0;      // current row within conversation area

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

    // ── Logo (top) ──
    const logo = renderLogo({ tools: this._toolCount || 0 });
    this._logoHeight = logo.split("\n").length;
    process.stdout.write(logo + "\n");
    const sepRow = this._logoHeight + 1; // row of the separator line
    process.stdout.write(dim("\u2500".repeat(this._cols)) + "\n");

    // ── Conversation area (middle) ──
    this._convTop = this._logoHeight + 2;                  // first row after separator
    this._convBot = this._rows - 2;                         // last row before input bar
    const convRows = this._convBot - this._convTop + 1;     // total available rows
    this._cursorRow = this._convTop;

    // Fill conversation area with blank lines so the screen looks right
    for (let i = 0; i < convRows; i++) {
      process.stdout.write("\n");
    }
    // Cursor is now at _convBot

    // ── Input bar (fixed at bottom) ──
    process.stdout.write(dim("\u2500".repeat(this._cols)) + "\n"); // separator at _rows-1
    process.stdout.write(c("green") + "\u25b8 " + R);              // prompt at _rows
    process.stdout.write(CSI + this._rows + ";1H");                // cursor to bottom

    // Position cursor at conversation start for first log
    process.stdout.write(CSI + this._convTop + ";1H");

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

    // Move to current cursor position in conversation area
    process.stdout.write(CSI + this._cursorRow + ";1H");

    // Write text
    process.stdout.write(text);

    // Advance cursor
    this._cursorRow += lineCount;

    // If we've filled or overflowed the conversation area,
    // write newlines to trigger terminal scroll (scrolls logo+convo up)
    while (this._cursorRow > this._convBot) {
      process.stdout.write("\n");
      this._cursorRow--;
    }

    // Redraw input bar (may have scrolled up)
    this._redrawInput();
  }

  _fullRedraw() {
    // Full redraw on resize — redraw logo + as much conversation as fits
    if (!this.active) return;
    const rows = this._rows;
    const cols = this._cols;

    let out = "";

    // Logo (fixed at top)
    const logo = renderLogo({ tools: this._toolCount || 0 });
    this._logoHeight = logo.split("\n").length;
    out += logo + "\n";
    out += dim("\u2500".repeat(cols)) + "\n";

    // Recalculate conversation area
    this._convTop = this._logoHeight + 2;
    this._convBot = rows - 2;
    const convRows = this._convBot - this._convTop + 1;

    // Replay conversation buffer — show last convRows lines
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

    // Fill remaining conversation rows with blank lines (at the top)
    const blankRows = convRows - lineCount;
    for (let i = 0; i < blankRows; i++) {
      out += "\n";
    }

    // Write visible conversation entries
    for (const line of visible) {
      out += line + "\n";
    }

    // Input bar (fixed at bottom)
    out += dim("\u2500".repeat(cols)) + "\n";
    const visibleLen = this._inputText.replace(/\x1b\[[0-9;]*[mK]/g, '').length;
    out += c("green") + "\u25b8 " + R + this._inputText;

    process.stdout.write(home + cls);
    process.stdout.write(out);
    process.stdout.write(CSI + rows + ";" + (3 + visibleLen) + "H");

    // Reset cursor to where it would be in the conversation
    this._cursorRow = this._convTop + lineCount;
    if (this._cursorRow > this._convBot) this._cursorRow = this._convBot;
  }

  setInput(text) {
    this._inputText = text || "";
    if (this.active) this._redrawInput();
  }

  setToolCount(n) { this._toolCount = n; }

  _redrawInput() {
    const rows = this._rows;
    const cols = this._cols;
    const visibleLen = this._inputText.replace(/\x1b\[[0-9;]*[mK]/g, '').length;
    // Redraw separator line + input line at bottom (never touches logo/convo area)
    process.stdout.write(CSI + (rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("\u2500".repeat(cols)));
    process.stdout.write(CSI + rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "\u25b8 " + R + this._inputText);
    process.stdout.write(CSI + rows + ";" + (3 + visibleLen) + "H");
  }
}
