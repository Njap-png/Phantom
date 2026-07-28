// TUI — Minimal full-screen terminal UI
// Auto-adjusting to any terminal size. Conversation scrolls properly
// with accurate line counting, resize handling, and no cursor drift.
import { renderLogo } from "./visual.mjs";

const R = "\x1b[0m";
const CSI = "\x1b[";
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
    // Strip ANSI codes for width calculation
    const plain = line.replace(/\x1b\[[0-9;]*[mK]/g, "");
    if (plain.length === 0) {
      total += 1; // empty line still takes a row
    } else {
      total += Math.max(1, Math.ceil(plain.length / cols));
    }
  }
  return total;
}

export class TUI {
  constructor(opts = {}) {
    this.active = false;
    this._buf = [];          // full conversation history
    this._maxBuf = 500;
    this._inputText = "";
    this._toolCount = 0;
    this._onExit = opts.onExit || (() => {});
    this._cursorRow = 0;     // tracked terminal row of conversation cursor
    this._convTop = 0;       // first row of conversation area (1-based)
    this._convBot = 0;       // last row of conversation area (1-based)
    this._rows = process.stdout.rows || 24;
    this._cols = process.stdout.columns || 80;
    this._resizeHandler = null;

    // Handle terminal resize
    this._onResize = () => {
      const newRows = process.stdout.rows || 24;
      const newCols = process.stdout.columns || 80;
      if (newRows === this._rows && newCols === this._cols) return;
      this._rows = newRows;
      this._cols = newCols;
      if (this.active) this._reflow();
    };
  }

  _reflow() {
    // Recalculate layout and redraw everything on resize
    const oldConvBot = this._convBot;

    this._convTop = 7; // logo + separator
    this._convBot = Math.max(this._convTop + 1, this._rows - 2);

    // Set new scroll region
    process.stdout.write(CSI + "1;" + this._convBot + "r");

    // Clear and redraw from buffer
    this._redrawAll();
  }

  enter() {
    if (this.active) { this.exit(); }
    process.stdout.write(CSI + "2J" + CSI + "3J" + CSI + "H");
    process.stdout.write(CSI + "?25l");

    // Draw logo
    const logo = renderLogo({ tools: this._toolCount || 0 });
    for (const line of logo.split("\n")) {
      process.stdout.write(line + "\n");
    }
    process.stdout.write(dim("\u2500".repeat(this._cols)) + "\n");

    // Calculate conversation region (1-based terminal rows)
    this._convTop = logo.split("\n").length + 2;  // logo lines + separator
    this._convBot = Math.max(this._convTop + 1, this._rows - 2);

    // Set scroll region: rows 1.._convBot scroll naturally,
    // input bar at bottom stays fixed
    process.stdout.write(CSI + "1;" + this._convBot + "r");

    this._cursorRow = this._convTop;
    this._redrawInput();

    // Move cursor to conversation start
    process.stdout.write(CSI + this._cursorRow + ";1H");
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
      try { process.stdout.off("resize", this._resizeHandler); } catch {}
      this._resizeHandler = null;
    }
    this._onExit();
    process.stdout.write(CSI + "?25h");
    process.stdout.write(CSI + "r");   // Reset scroll region to full screen
    this.active = false;
  }

  log(text) {
    if (!this.active) { process.stdout.write(text + "\n"); return; }

    const lineCount = countLines(text, this._cols);

    // If past the bottom of the scroll region, scroll enough to fit
    if (this._cursorRow + lineCount - 1 > this._convBot) {
      const scrollBy = (this._cursorRow + lineCount - 1) - this._convBot;
      // Write scrollBy newlines at the bottom margin to trigger scrolling
      process.stdout.write(CSI + this._convBot + ";1H");
      for (let i = 0; i < scrollBy; i++) {
        process.stdout.write("\n");
      }
      this._cursorRow = this._convBot - scrollBy + 1;
      if (this._cursorRow < this._convTop) this._cursorRow = this._convTop;
    }

    // Write text at current cursor position
    process.stdout.write(CSI + this._cursorRow + ";1H" + CSI + "2K");
    process.stdout.write(text);
    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();

    // Advance cursor by actual line count
    this._cursorRow += lineCount;
    if (this._cursorRow > this._convBot) this._cursorRow = this._convBot;

    this._redrawInput();
  }

  _redrawAll() {
    // Full redraw from buffer on resize
    process.stdout.write(CSI + "2J" + CSI + "3J" + CSI + "H");

    const logo = renderLogo({ tools: this._toolCount || 0 });
    for (const line of logo.split("\n")) {
      process.stdout.write(line + "\n");
    }
    process.stdout.write(dim("\u2500".repeat(this._cols)) + "\n");

    // Rewind and replay conversation buffer
    this._cursorRow = this._convTop;
    for (const line of this._buf) {
      const lc = countLines(line, this._cols);
      if (this._cursorRow + lc - 1 > this._convBot) break;
      process.stdout.write(CSI + this._cursorRow + ";1H" + CSI + "2K");
      process.stdout.write(line);
      this._cursorRow += lc;
    }
    if (this._cursorRow > this._convBot) this._cursorRow = this._convBot;

    this._redrawInput();
    process.stdout.write(CSI + (this._rows) + ";1H");
  }

  setInput(text) {
    this._inputText = text || "";
    this._redrawInput();
  }

  setToolCount(n) { this._toolCount = n; }

  _redrawInput() {
    const visibleLen = this._inputText.replace(/\x1b\[[0-9;]*[mK]/g, '').length;
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("\u2500".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "\u25b8 " + R + this._inputText);
    // ▸ and space occupy columns 1-2, cursor goes after visible text
    process.stdout.write(CSI + this._rows + ";" + (3 + visibleLen) + "H");
  }
}
