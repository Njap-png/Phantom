// TUI — Incremental terminal UI
// Logo drawn once at top. Messages append with \n, terminal scrolls naturally.
// Input bar redrawn at bottom after each log. Full redraw only on resize.
// No repeated logo frames in scrollback history.
import { renderLogo } from "./visual.mjs";

const R = "\x1b[0m";
const CSI = "\x1b[";
const home = CSI + "H";
const cls = CSI + "2J";
const hide = CSI + "?25l";
const show = CSI + "?25h";

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
    this._toolCount = 0;
    this._onExit = opts.onExit || (() => {});
    this._rows = process.stdout.rows || 24;
    this._cols = process.stdout.columns || 80;
    this._resizeHandler = null;
    this._convStart = 0;    // 1-based row where conversation starts
    this._convMax = 0;      // how many conversation lines fit on screen

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

    // ── Logo (drawn once at top, scrolls away naturally) ──
    const logo = renderLogo({ tools: this._toolCount || 0 });
    const logoH = logo.split("\n").length;
    process.stdout.write(logo + "\n");
    process.stdout.write(dim("\u2500".repeat(this._cols)) + "\n");

    // ── Conversation area ──
    this._convStart = logoH + 2; // 1-based row right after separator
    this._convMax = this._rows - logoH - 3;
    this._msgCount = 0;

    // Fill with blank lines then input bar
    for (let i = 0; i < this._convMax; i++) process.stdout.write("\n");
    process.stdout.write(dim("\u2500".repeat(this._cols)) + "\n");
    process.stdout.write(c("green") + "\u25b8 " + R);

    // Move cursor to conversation start for first message
    process.stdout.write(CSI + this._convStart + ";1H");

    this.active = true;

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
    this.active = false;
  }

  log(text) {
    if (!this.active) { process.stdout.write(text + "\n"); return; }
    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();

    // Position cursor at the next conversation row and write
    const row = this._convStart + this._msgCount;
    if (row <= this._rows) {
      process.stdout.write(CSI + row + ";1H" + CSI + "2K");
    }
    process.stdout.write(text + "\n");
    this._msgCount++;

    // Redraw input bar (may have been pushed up by terminal scroll)
    this._redrawInput();
  }

  _fullRedraw() {
    if (!this.active) return;
    const rows = this._rows;
    const cols = this._cols;

    let out = home + cls;

    const logo = renderLogo({ tools: this._toolCount || 0 });
    const logoH = logo.split("\n").length;
    out += logo + "\n";
    out += dim("\u2500".repeat(cols)) + "\n";

    this._convStart = logoH + 2;
    this._convMax = rows - logoH - 3;

    // Show last convMax lines from buffer
    const visible = [];
    let lineCount = 0;
    for (let i = this._buf.length - 1; i >= 0 && lineCount < this._convMax; i--) {
      const entry = this._buf[i];
      const lc = entry ? Math.max(1, Math.ceil(entry.replace(/\x1b\[[0-9;]*[mK]/g, '').length / Math.max(cols, 1))) : 1;
      if (lineCount + lc <= this._convMax) {
        visible.unshift(entry);
        lineCount += lc;
      } else break;
    }

    for (const line of visible) out += line + "\n";
    const remaining = this._convMax - lineCount;
    for (let i = 0; i < remaining; i++) out += "\n";

    out += dim("\u2500".repeat(cols)) + "\n";
    const visibleLen = this._inputText.replace(/\x1b\[[0-9;]*[mK]/g, '').length;
    out += c("green") + "\u25b8 " + R + this._inputText;

    process.stdout.write(out);
    process.stdout.write(CSI + rows + ";" + (3 + visibleLen) + "H");
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
    process.stdout.write(CSI + (rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("\u2500".repeat(cols)));
    process.stdout.write(CSI + rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "\u25b8 " + R + this._inputText);
    process.stdout.write(CSI + rows + ";" + (3 + visibleLen) + "H");
  }
}
