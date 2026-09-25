import { renderLogo } from "./visual.mjs";

const R = "\x1b[0m";
const CSI = "\x1b[";
const home = CSI + "H";
const cls = CSI + "2J";
const hide = CSI + "?25l";
const show = CSI + "?25h";
const ansiPattern = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;
const combiningPattern = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe00-\ufe0f\ufe20-\ufe2f]/u;

function c(name) {
  const cl = { black:30, red:31, green:32, yellow:33, blue:34, magenta:35, cyan:36, white:37, dim:2, fg:37 };
  return `${CSI}${cl[name] ?? 37}m`;
}

function dim(s) { return `${c("dim")}${s}${R}`; }

function sanitizeOutput(value) {
  return String(value ?? "")
    .replace(ansiPattern, sequence => /^\x1b\[[0-9;:]*m$/.test(sequence) ? sequence : "")
    .replace(/\t/g, "    ")
    .replace(/[\x00-\x08\x0b-\x0d\x0e-\x1a\x1c-\x1f\x7f-\x9f]/g, "")
    .replace(/\x1b(?!\[[0-9;:]*m)/g, "");
}

function stripAnsi(value) {
  return sanitizeOutput(value).replace(ansiPattern, "");
}

function codePointWidth(codePoint) {
  if (codePoint === 0x200d || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) return 0;
  if (combiningPattern.test(String.fromCodePoint(codePoint))) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) return 2;
  return 1;
}

function takeByWidth(value, maxWidth) {
  let width = 0;
  let text = "";
  let rest = "";
  const chars = Array.from(stripAnsi(value));
  if (maxWidth <= 0) return { text, rest: chars.join(""), width };
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    let charWidth = char === "\t" ? 8 - (width % 8) : codePointWidth(char.codePointAt(0));
    if (char === "\n" || char === "\r") charWidth = 0;
    if (charWidth > maxWidth) {
      text += "\ufffd";
      width += 1;
      continue;
    }
    if (width + charWidth > maxWidth) {
      rest = chars.slice(i).join("");
      break;
    }
    text += char === "\t" ? " ".repeat(charWidth) : char;
    width += charWidth;
  }
  return { text, rest, width };
}

function displayWidth(value) {
  return takeByWidth(value, Number.MAX_SAFE_INTEGER).width;
}

function wrapLine(value, width) {
  const line = sanitizeOutput(value);
  if (displayWidth(line) <= width) return [line];
  const lines = [];
  const stylePattern = /\x1b\[[0-9;:]*m/g;
  const activeStyles = [];
  let chunk = "";
  let chunkWidth = 0;
  let lastIndex = 0;
  const activeSequence = () => activeStyles.length ? CSI + activeStyles.join(";") + "m" : "";
  const appendText = (text) => {
    for (let char of text) {
      let charWidth = char === "\t" ? 8 - (chunkWidth % 8) : codePointWidth(char.codePointAt(0));
      if (charWidth > width) {
        char = "\ufffd";
        charWidth = 1;
      }
      if (chunkWidth + charWidth > width) {
        lines.push(chunk + R);
        chunk = activeSequence();
        chunkWidth = 0;
      }
      chunk += char === "\t" ? " ".repeat(charWidth) : char;
      chunkWidth += charWidth;
    }
  };
  for (const match of line.matchAll(stylePattern)) {
    appendText(line.slice(lastIndex, match.index));
    const sequence = match[0];
    const params = sequence.slice(2, -1).split(";").filter(Boolean);
    chunk += sequence;
    if (params.length === 0 || params.includes("0")) activeStyles.length = 0;
    else activeStyles.push(...params);
    lastIndex = match.index + sequence.length;
  }
  appendText(line.slice(lastIndex));
  lines.push(chunk + R);
  return lines;
}

function fitLine(value, width) {
  if (width <= 0) return "";
  return wrapLine(value, width)[0] || "";
}

export class TUI {
  constructor(opts = {}) {
    this.active = false;
    this._stdout = opts.stdout || process.stdout;
    this._buf = [];
    this._maxBuf = 500;
    this._inputText = "";
    this._inputCursor = 0;
    this._inputMasked = false;
    this._status = "";
    this._toolCount = 0;
    this._onExit = opts.onExit || (() => {});
    this._rows = opts.rows || this._stdout.rows || 24;
    this._cols = opts.cols || this._stdout.columns || 80;
    this._resizeHandler = null;
    this._redrawQueued = false;
    this._convStart = 0;
    this._convMax = 0;

    this._onResize = () => {
      const newRows = this._stdout.rows || 24;
      const newCols = this._stdout.columns || 80;
      if (newRows === this._rows && newCols === this._cols) return;
      this._rows = newRows;
      this._cols = newCols;
      if (this.active) this._fullRedraw();
    };
  }

  enter() {
    if (this.active) this.exit();
    this.active = true;
    this._fullRedraw(true);
    if (typeof this._stdout.on === "function" && !this._resizeHandler) {
      this._resizeHandler = this._onResize.bind(this);
      this._stdout.on("resize", this._resizeHandler);
    }
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    if (this._resizeHandler) {
      try { this._stdout.removeListener("resize", this._resizeHandler); } catch {}
      this._resizeHandler = null;
    }
    this._onExit();
    this._write(show);
  }

  log(text) {
    const output = sanitizeOutput(text);
    if (!this.active) {
      this._write(output + "\n");
      return;
    }
    this._buf.push(output);
    if (this._buf.length > this._maxBuf) this._buf.shift();
    if (this._redrawQueued) return;
    this._redrawQueued = true;
    queueMicrotask(() => {
      this._redrawQueued = false;
      if (this.active) this._redrawConversation();
    });
  }

  clear() {
    this._buf.length = 0;
    if (this.active) this._fullRedraw();
  }

  setInput(text, cursor, opts = {}) {
    this._inputText = String(text ?? "");
    this._inputCursor = Math.max(0, Math.min(cursor ?? this._inputText.length, this._inputText.length));
    this._inputMasked = opts.masked === true;
    this._redrawInput();
  }

  setToolCount(n) { this._toolCount = n; }

  setStatus(text) {
    this._status = sanitizeOutput(text).replace(/[\r\n]+/g, " ");
    if (this.active) this._redrawStatus();
  }

  clearStatus() { this.setStatus(""); }

  _layout() {
    if (this._rows < 6) {
      return {
        logo: "",
        logoH: 0,
        convStart: 1,
        convMax: Math.max(0, this._rows - 2),
        hasStatus: false,
        hasSeparator: this._rows >= 2,
      };
    }
    let logo = renderLogo({ tools: this._toolCount || 0 });
    if (logo.split("\n").length > this._rows - 5) logo = `${c("cyan")}PHANTOM${R}`;
    const logoH = logo.split("\n").length;
    const convStart = logoH + 2;
    const convMax = Math.max(0, this._rows - logoH - 4);
    return { logo, logoH, convStart, convMax, hasStatus: true, hasSeparator: true };
  }

  _visibleLines(convMax) {
    const width = Math.max(1, this._cols - 1);
    const visible = [];
    for (let i = this._buf.length - 1; i >= 0 && visible.length < convMax; i--) {
      const lines = String(this._buf[i]).replace(/\r/g, "").split("\n");
      for (let j = lines.length - 1; j >= 0 && visible.length < convMax; j--) {
        const wrapped = wrapLine(lines[j], width);
        for (let k = wrapped.length - 1; k >= 0 && visible.length < convMax; k--) visible.unshift(wrapped[k]);
      }
    }
    while (visible.length < convMax) visible.unshift("");
    return visible;
  }

  _inputView() {
    const maxWidth = Math.max(0, this._cols - 3);
    const rawText = stripAnsi(this._inputText).replace(/[\r\n]+/g, " ");
    const text = this._inputMasked ? "\u2022".repeat(rawText.length) : rawText;
    const cursor = Math.max(0, Math.min(this._inputCursor, rawText.length));
    if (!maxWidth) return { visible: "", cursorOffset: 0 };
    if (displayWidth(text) <= maxWidth) {
      return { visible: text, cursorOffset: displayWidth(text.slice(0, cursor)) };
    }
    const start = Math.max(0, cursor - maxWidth + 1);
    const visible = takeByWidth(text.slice(start), maxWidth).text;
    return { visible, cursorOffset: Math.min(maxWidth, displayWidth(text.slice(start, cursor))) };
  }

  _frame() {
    const { logo, logoH, convStart, convMax, hasStatus, hasSeparator } = this._layout();
    const contentWidth = Math.max(1, this._cols - 1);
    const separator = dim("─".repeat(contentWidth));
    const input = this._inputView();
    const prefix = this._cols >= 2 ? c("green") + "▸ " + R : "";
    const rows = [];
    if (logoH) rows.push(...logo.split("\n").map(line => fitLine(line, contentWidth)), separator);
    rows.push(...this._visibleLines(convMax));
    if (hasStatus) rows.push(fitLine(this._status, contentWidth));
    if (hasSeparator) rows.push(separator);
    rows.push(prefix + input.visible);
    return { convStart, rows, cursorOffset: input.cursorOffset };
  }

  _fullRedraw(initial = false) {
    const frame = this._frame();
    let out = home + cls + (initial ? hide : "");
    frame.rows.forEach((line, index) => {
      out += CSI + (index + 1) + ";1H" + CSI + "2K" + line;
    });
    out += this._cursorSequence(frame.cursorOffset);
    this._write(out);
  }

  _redrawConversation() {
    const { convStart, convMax, hasStatus } = this._layout();
    const contentWidth = Math.max(1, this._cols - 1);
    let out = "";
    this._visibleLines(convMax).forEach((line, index) => {
      out += CSI + (convStart + index) + ";1H" + CSI + "2K" + line;
    });
    if (hasStatus) out += CSI + (this._rows - 2) + ";1H" + CSI + "2K" + fitLine(this._status, contentWidth);
    this._write(out);
    this._redrawInput();
  }

  _redrawStatus() {
    const { hasStatus } = this._layout();
    if (!hasStatus) {
      this._redrawInput();
      return;
    }
    const contentWidth = Math.max(1, this._cols - 1);
    this._write(CSI + (this._rows - 2) + ";1H" + CSI + "2K" + fitLine(this._status, contentWidth));
    this._redrawInput();
  }

  _redrawInput() {
    if (!this.active) return;
    const { hasSeparator } = this._layout();
    const contentWidth = Math.max(1, this._cols - 1);
    const input = this._inputView();
    const prefix = this._cols >= 2 ? c("green") + "▸ " + R : "";
    let out = "";
    if (hasSeparator) out += CSI + (this._rows - 1) + ";1H" + CSI + "2K" + dim("─".repeat(contentWidth));
    out += CSI + this._rows + ";1H" + CSI + "2K" + prefix + input.visible;
    out += this._cursorSequence(input.cursorOffset);
    this._write(out);
  }

  _cursorSequence(offset) {
    const column = Math.max(1, Math.min(this._cols, 3 + offset));
    return CSI + this._rows + ";" + column + "H";
  }

  _write(text) {
    this._stdout.write(text);
  }
}
