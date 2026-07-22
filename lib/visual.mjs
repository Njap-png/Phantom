// Phantom — shared visual components
// ANSI colors, ASCII art, banners, prompts, separators
// Neon violet/cyan on dark — hacker-in-hoodie aesthetic

// ── ANSI helpers (local — no dependency on phantom.mjs) ──
function fg(name) {
  const colors = { black:30, red:31, green:32, yellow:33, blue:34, magenta:35, cyan:36, white:37, dim:2 };
  const n = colors[name] ?? 37;
  return `\x1b[${n}m`;
}
const _R = "\x1b[0m";
const _B = "\x1b[1m";
const _D = "\x1b[2m";

// ── Hooded figure logo (cyberpunk neon) ─────────────────
export function renderLogo(opts = {}) {
  const {
    mode = "",  // "non-interactive", "v0.2.0"
    tools = 0,
    wide = false,
  } = opts;

  const M = fg("magenta");      // neon violet
  const C = fg("cyan");         // electric cyan
  const G = fg("green");        // matrix green
  const Y = fg("yellow");       // gold accent
  const dim = fg("dim");
  const _r = _R;
  const b = _B;
  const d = _D;

  if (wide) {
    // ── Wide: full shadow figlet + cyberpunk display ──
    const wideLogo = [
      `${d}┌── ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${d} ──┐${_r}`,
      `${M}${b}  _ \\  |   |    \\     \\  |__ __| _ \\   \\  |${_r}`,
      `${M}${b}  |   | |   |   _ \\     \\ |   |  |   | |\\/ |${_r}`,
      `${M}${b}  ___/  ___ |  ___ \\  |\\  |   |  |   | |   |${_r}`,
      `${M}${b}  _|    _|  _|_/    _\\_| \\_|  _| \\___/ _|  _|${_r}`,
      ``,
      `  ${M}${b}╔══════════════════════════════════════╗${_r}`,
      `  ${M}${b}║${_r}  ${C}${b}P${_r} ${M}${b}H${_r} ${Y}${b}A${_r} ${C}${b}N${_r} ${M}${b}T${_r} ${Y}${b}O${_r} ${C}${b}M${_r}  ${d}✦  ${G}${b}◈${_r}  ${C}${b}EVOLVE${_r}  ║${_r} ${M}${b}${_r}`,
      `  ${M}${b}╚══════════════════════════════════════╝${_r}`,
    ];
    if (mode) wideLogo.push(`  ${d}└─ ${Y}${mode}${_r}`);
    if (tools) wideLogo.push(`  ${d}└─ ${C}${tools}${_r} ${d}tools loaded${_r}`);
    return wideLogo.join("\n");
  }

  // ── Shadow figlet logo (cyberpunk neon) ─────────────
  // Generated with: figlet -f shadow "PHANTOM"
  const logoLines = [
    `${d}┌── ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${d} ──┐${_r}`,
    `${M}${b}  _ \\  |   |    \\     \\  |__ __| _ \\   \\  |${_r}`,
    `${M}${b}  |   | |   |   _ \\     \\ |   |  |   | |\\/ |${_r}`,
    `${M}${b}  ___/  ___ |  ___ \\  |\\  |   |  |   | |   |${_r}`,
    `${M}${b}  _|    _|  _|_/    _\\_| \\_|  _| \\___/ _|  _|${_r}`,
    ``,
    `  ${M}${b}╔══════════════════════════════════════╗${_r}`,
    `  ${M}${b}║${_r}  ${C}${b}P${_r} ${M}${b}H${_r} ${Y}${b}A${_r} ${C}${b}N${_r} ${M}${b}T${_r} ${Y}${b}O${_r} ${C}${b}M${_r}  ${d}✦  ${G}${b}◈${_r}  ${C}${b}EVOLVE${_r}  ║${_r} ${M}${b}${_r}`,
    `  ${M}${b}╚══════════════════════════════════════╝${_r}`,
  ];
  if (mode) logoLines.push(`  ${d}└─ ${Y}${mode}${_r}`);
  if (tools) logoLines.push(`  ${d}└─ ${C}${tools}${_r} ${d}tools loaded${_r}`);
  if (wide) return logoLines.join("\n");

  // ── Standard — shadow figlet only ─────────────────
  const lines = [
    `${d}┌── ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${d} ──┐${_r}`,
    `${M}${b}  _ \\  |   |    \\     \\  |__ __| _ \\   \\  |${_r}`,
    `${M}${b}  |   | |   |   _ \\     \\ |   |  |   | |\\/ |${_r}`,
    `${M}${b}  ___/  ___ |  ___ \\  |\\  |   |  |   | |   |${_r}`,
    `${M}${b}  _|    _|  _|_/    _\\_| \\_|  _| \\___/ _|  _|${_r}`,
    ``,
    `  ${M}${b}╔═══════════════════════╗${_r}`,
    `  ${M}${b}║${_r}  ${C}${b}P${_r} ${M}${b}H${_r} ${Y}${b}A${_r} ${C}${b}N${_r} ${M}${b}T${_r} ${Y}${b}O${_r} ${C}${b}M${_r}  ${M}${b}║${_r}`,
    `  ${M}${b}╚═══════════════════════╝${_r}`,
  ];
  if (mode) lines.push(`  ${d}└─ ${Y}${mode}${_r}`);
  if (tools) lines.push(`  ${d}└─ ${C}${tools}${_r} ${d}tools loaded${_r}`);
  return lines.join("\n");
}

// ── Simple banner (small terminals / DesktopUI) ──
export function renderBanner(text = "PHANTOM", subtitle = "") {
  const G = fg("green");
  const dim = fg("dim");
  const _r = _R;
  return [
    `${G}${_B}╔══════════════════════════════════════╗${_r}`,
    `${G}${_B}║${_r}  ${_B}${text}${_r} ${dim}${subtitle}${_r}  ${G}${_B}║${_r}`,
    `${G}${_B}╚══════════════════════════════════════╝${_r}`,
  ].join("\n");
}

// ── Prompt symbols ────────────────────────────────
export const prompt = {
  ghost:  `${fg("green")}👻${_R} `,
  bolt:   `${fg("cyan")}⚡${_R} `,
  hash:   `${fg("magenta")}#${_R} `,
  arrow:  `${fg("green")}→${_R} `,
  dim:    `${fg("dim")}⧩${_R} `,
};

// ── Separator line ──────────────────────────────────
export function separator(char = "─", len = 50) {
  return `${fg("dim")}${char.repeat(len)}${_R}`;
}

// ── Status icons ────────────────────────────────────
// ── Animated spinner ──────────────────────────────────
// Minimal frame-based spinner; no external deps.
export function createSpinner() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0, timer = null;
  return {
    start(msg) {
      if (timer) return;
      timer = setInterval(() => {
        const f = frames[i = (i + 1) % frames.length];
        process.stdout.write(`\r${fg("cyan")}${_B}${f}${_R} ${msg}`);
      }, 80);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer); timer = null;
      process.stdout.write('\r\x1b[K');
    },
    update(msg) {
      const f = timer ? frames[i] : frames[0];
      process.stdout.write(`\r${fg("cyan")}${_B}${f}${_R} ${msg}`);
    }
  };
}
    
export const icons = {
  ok:     `${fg("green")}✓${_R}`,
  err:    `${fg("red")}✕${_R}`,
  warn:   `${fg("yellow")}⚠${_R}`,
  info:   `${fg("cyan")}◈${_R}`,
  bullet: `${fg("magenta")}◆${_R}`,
  arrow:  `${fg("green")}→${_R}`,
};

// ── Chat border — wraps multi-line text in a bordered box ──
// width  = total width (defaults to terminal cols - 2)
// title  = optional top-left label
// color  = border color function (default dim)
export function chatBorder(text, opts = {}) {
  const { width, title, color = fg("dim") } = opts;
  const cols = width || (process.stdout.columns || 80) - 4;
  const c = color;
  const _r = _R;
  const lines = text.split("\n");
  const out = [];
  const top = title
    ? `${c}╔═ ${_B}${title}${_R}${c} ${"═".repeat(Math.max(0, cols - title.length - 4))}╗${_r}`
    : `${c}╔${"═".repeat(cols + 2)}╗${_r}`;
  out.push(top);
  for (const line of lines) {
    const wrapped = line.length > cols ? line.substring(0, cols - 1) + "…" : line;
    const pad = " ".repeat(Math.max(0, cols - wrapped.length + 2));
    out.push(`${c}║${_r} ${wrapped}${pad}${c}║${_r}`);
  }
  out.push(`${c}╚${"═".repeat(cols + 2)}╝${_r}`);
  return out.join("\n");
}
