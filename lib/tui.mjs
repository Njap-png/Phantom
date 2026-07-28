// TUI — Minimal full-screen terminal UI
// Full-redraw approach: on every log, redraw the entire screen from buffer.
// No cursor-positioning tricks — always starts from home.
// Auto-adjusts to any terminal size.
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

    this._onResize = () => {
      const newRows = process.stdout.rows || 24;
      const newCols = process.stdout.columns || 80;
      if (newRows === this._rows && newCols === this._cols) return;
      this._rows = newRows;
      this._cols = newCols;
      if (this.active) this._draw();
    };
  }

  enter() {
    if (this.active) { this.exit(); }
    this.active = true;
    this._buf = [];

    if (typeof process.stdout.on === "function" && !this._resizeHandler) {
      this._resizeHandler = this._onResize.bind(this);
      process.stdout.on("resize", this._resizeHandler);
    }

    process.stdout.write(hide);
    this._draw();
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
    this._draw();
  }

  _draw() {
    if (!this.active) return;
    const rows = this._rows;
    const cols = this._cols;

    let out = home + cls;

    // ── Logo (always at top, scrolls away when conversation fills) ──
    const logo = renderLogo({ tools: this._toolCount || 0 });
    const logoH = logo.split("\n").length;
    out += logo + "\n";
    out += dim("\u2500".repeat(cols)) + "\n";          // separator after logo

    // ── Conversation area ──
    // space = rows - logoH - 1(for logo separator) - 1(input separator) - 1(input line)
    const convMax = rows - logoH - 3;

    // Walk backwards through buffer counting lines
    const visible = [];
    let lineCount = 0;
    for (let i = this._buf.length - 1; i >= 0 && lineCount < convMax; i--) {
      const entry = this._buf[i];
      const lc = entry ? Math.max(1, Math.ceil(entry.replace(/\x1b\[[0-9;]*[mK]/g, '').length / Math.max(cols, 1))) : 1;
      if (lineCount + lc <= convMax) {
        visible.unshift(entry);
        lineCount += lc;
      } else {
        break;
      }
    }

    // Messages start right after the logo separator (no leading blanks)
    for (const line of visible) out += line + "\n";

    // Fill remaining conversation rows with blanks up to input bar
    const remaining = convMax - lineCount;
    for (let i = 0; i < remaining; i++) out += "\n";

    // ── Input bar (fixed at bottom) ──
    out += dim("\u2500".repeat(cols)) + "\n";
    const visibleLen = this._inputText.replace(/\x1b\[[0-9;]*[mK]/g, '').length;
    out += c("green") + "\u25b8 " + R + this._inputText;

    process.stdout.write(out);
    process.stdout.write(CSI + rows + ";" + (3 + visibleLen) + "H");
  }

  setInput(text) {
    this._inputText = text || "";
    if (this.active) this._draw();
  }

  setToolCount(n) { this._toolCount = n; }
}
