// TUI — Full-screen terminal UI with scroll region
// Logo stays fixed at top, conversation scrolls within region,
// input bar stays fixed at bottom.
import { renderLogo } from "./visual.mjs";

const R = "\x1b[0m";
const CSI = "\x1b[";
function c(name) {
  const cl = { black:30, red:31, green:32, yellow:33, blue:34, magenta:35, cyan:36, white:37, dim:2 };
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
    this._convTop = 0;
    this._convBot = 0;
    this._cursorRow = 0;
  }

  enter() {
    process.stdout.write(CSI + "?1049h"); // alt screen
    process.stdout.write(CSI + "?25l");   // hide cursor

    // Write fixed header (logo + separator)
    const logo = renderLogo({ tools: this._toolCount || 0 });
    const logoH = logo.split("\n").length;
    process.stdout.write(logo + "\n");
    process.stdout.write(dim("─".repeat(this._cols)) + "\n");

    // Scroll region: rows after header .. rows-2 (leave 2 rows for input bar)
    this._convTop = logoH + 2;  // row after separator's trailing newline
    this._convBot = this._rows - 2;
    this._cursorRow = this._convTop;
    process.stdout.write(CSI + this._convTop + ";" + this._convBot + "r");

    // Draw input bar (rows _rows-1 and _rows, outside scroll region)
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "\u25b8 " + R); // ▸

    // Cursor to scroll region top
    process.stdout.write(CSI + this._convTop + ";1H");
    this.active = true;
  }

  exit() {
    if (!this.active) return;
    this._onExit();
    // Restore full scroll region
    process.stdout.write(CSI + "r");
    process.stdout.write(CSI + (this._rows) + ";1H");
    process.stdout.write(CSI + "?25h");  // show cursor
    process.stdout.write(CSI + "?1049l"); // alt screen off
    this.active = false;
  }

  log(text) {
    if (!this.active) { process.stdout.write(text + "\n"); return; }

    if (this._cursorRow <= this._convBot) {
      // Write at tracked position within scroll region
      process.stdout.write(CSI + this._cursorRow + ";1H" + CSI + "2K");
      process.stdout.write(text);
    }

    this._buf.push(text);
    if (this._buf.length > this._maxBuf) this._buf.shift();

    // Advance cursor — once past bottom of region, write \n to scroll
    if (this._cursorRow < this._convBot) {
      this._cursorRow++;
    } else {
      // At bottom — write newline to scroll region
      process.stdout.write("\n");
      // cursorRow stays at convBot (newline scrolled within region)
    }
    this._redrawInput();
  }

  setInput(text) {
    this._inputText = text || "";
    this._redrawInput();
  }

  setToolCount(n) { this._toolCount = n; }

  _redrawInput() {
    // Redraw input bar — these rows are OUTSIDE the scroll region
    process.stdout.write(CSI + (this._rows - 1) + ";1H" + CSI + "2K");
    process.stdout.write(dim("─".repeat(this._cols)));
    process.stdout.write(CSI + this._rows + ";1H" + CSI + "2K");
    process.stdout.write(c("green") + "\u25b8 " + R + this._inputText);
    // Cursor to end of input text for typing
    process.stdout.write(CSI + this._rows + ";" + (4 + this._inputText.length) + "H");
  }
}
