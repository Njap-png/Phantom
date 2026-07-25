// TUI — Full-screen terminal UI manager
// Conversation: natural-scroll via process.stdout (phone scrollback works)
// Input bar: fixed at bottom 2 rows, redrawn after each log
import { renderLogo } from "./visual.mjs";

const R = "\x1b[0m";
const CSI = "\x1b[";
const SAVE = "\x1b7";
const RESTORE = "\x1b8";
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
  }

  enter() {
    process.stdout.write(SAVE);
    process.stdout.write(`${CSI}?25l`);

    // Write logo once (scrolls away — user can scroll back)
    const logo = renderLogo({ tools: this._toolCount || 0 });
    process.stdout.write(logo);
    process.stdout.write("\n");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write("\n");

    this.active = true;
    this._drawInput("");
  }

  exit() {
    if (!this.active) return;
    this._onExit();
    process.stdout.write(`${CSI}?25h`);
    process.stdout.write(RESTORE);
    this.active = false;
  }

  log(text) {
    if (!this.active) { process.stdout.write(text + "\n"); return; }
    // Write naturally — terminal handles scrollback (works on phone)
    process.stdout.write(text);
    process.stdout.write("\n");
    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();
    // Fix input bar that native scrolling may have disturbed
    this._drawInput(this._inputText);
  }

  setInput(text) {
    this._inputText = text || "";
    this._drawInput(text);
  }

  setToolCount(n) { this._toolCount = n; }

  _drawInput(text) {
    this._inputText = text ?? this._inputText;
    const sepRow = this._rows - 1;
    const inpRow = this._rows;

    process.stdout.write(SAVE);
    process.stdout.write(`${CSI}${sepRow};1H${CSI}2K`);
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(`${CSI}${inpRow};1H${CSI}2K`);
    process.stdout.write(`${c("green")}▸ ${R}${this._inputText}`);
    process.stdout.write(`${CSI}${inpRow};${4 + this._inputText.length}H`);
    process.stdout.write(RESTORE);
  }
}
