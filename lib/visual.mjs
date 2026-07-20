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
    // ── Wide: full hoodie + cyberpunk display ──
    const lines = [
      `${d}┌── ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${d} ──┐${_r}`,
      `${C}${b}  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  ${_r}`,
      `${C} ${b}█${_r}${d} ═ ${M}═══${d} ═ ${M}═══${d} ═ ${M}═══${d} ═ ${M}═══${d} ═ ${M}═══${d} ═ ${M}═══${d} ═${_r} ${C}${b}█${_r}`,
      `${C}${b}▐█${_r}${Y}${b} ✦ ${_r}${d}·${M}   ${d}·${M}   ${d}·${M}   ${d}·${M}   ${d}·${M}   ${d}·${M}   ${d}·${_r}${Y}${b} ✦ ${_r}${C}${b}█▌${_r}`,
      `${C}${b}▐█${_r}   ${M}${b}╔${M}${d}═══════════════════════════════════${M}${b}╗${_r}${C}   █▌${_r}`,
      `${C}${b}▐█   ${M}║${_r}    ${G}${b}◈${_r}         ${G}${b}◈${_r}         ${G}${b}◈${_r}    ${M}║${_r}${C}   █▌${_r}`,
      `${C}${b}▐█   ${M}║${_r}${d}  ╔═══╗  ${d}╔═══════╗  ${d}╔═══╗${_r}  ${M}║${_r}${C}   █▌${_r}`,
      `${C}${b}▐█   ${M}║${_r}${d}  ╚═══╝  ${d}╚═══════╝  ${d}╚═══╝${_r}  ${M}║${_r}${C}   █▌${_r}`,
      `${C}${b}▐█   ${M}╚${d}═══════════════════════════════════${M}╝${_r}${C}   █▌${_r}`,
      `${C}${b} █   ${M}┊${_r}${d} ║${_r}   ${d}║${_r}   ${d}║${_r}  ${d}║${_r}   ${d}║${_r}   ${d}║${_r}  ${M}┊${_r}${C}   █${_r}`,
      `${C}${b} █   ${M}┊${_r}${d} ║${_r} ● ${d}║${_r} ● ${d}║${_r} ● ${d}║${_r} ● ${d}║${_r} ● ${d}║${_r}  ${M}┊${_r}${C}   █${_r}`,
      `${C}${b} ▀▄  ${d}║${M}${b} ═══ ${_r}${d}║${M}${b} ═══ ${_r}${d}║${M}${b} ═══ ${_r}${d}║${M}${b} ═══ ${_r}${d}║${M}${b} ═══ ${_r}${d}║${C}${b}  ▄▀${_r}`,
      ``,
      `  ${M}${b}╔══════════════════════════════════════╗${_r}`,
      `  ${M}${b}║${_r}  ${C}${b}P${_r} ${M}${b}H${_r} ${Y}${b}A${_r} ${C}${b}N${_r} ${M}${b}T${_r} ${Y}${b}O${_r} ${C}${b}M${_r}  ${M}${b}║${_r}`,
      `  ${M}${b}╚══════════════════════════════════════╝${_r}`,
    ];
    if (mode) lines.push(`  ${d}└─ ${Y}${mode}${_r}`);
    if (tools) lines.push(`  ${d}└─ ${C}${tools}${_r} ${d}tools loaded${_r}`);
    return lines.join("\n");
  }

  // ── Standard cyberpunk hoodie ─────────────────
  const lines = [
    `${d}┌── ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${M} ═══ ${C}✦${d} ──┐${_r}`,
    `${C}${b}  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  ${_r}`,
    `${C} ${b}█${_r}${d} ═ ${M}═══${d} ═ ${M}═══${d} ═ ${M}═══${d} ═ ${M}═══${d} ═${_r} ${C}${b}█${_r}`,
    `${C}${b}▐█${_r}${Y}${b} ✦ ${_r}${d}·${M}   ${d}·${M}   ${d}·${M}   ${d}·${M}   ${d}·${_r}${Y}${b} ✦ ${_r}${C}${b}█▌${_r}`,
    `${C}${b}▐█   ${M}${b}╔${M}${d}═══════════════${M}${b}╗${_r}${C}   █▌${_r}`,
    `${C}${b}▐█   ${M}║${_r}    ${G}${b}◈${_r}     ${G}${b}◈${_r}    ${M}║${_r}${C}   █▌${_r}`,
    `${C}${b}▐█   ${M}║${_r}${d}  ╔═══╗${_r}  ${M}║${_r}${C}   █▌${_r}`,
    `${C}${b}▐█   ${M}╚${d}═══════════════${M}╝${_r}${C}   █▌${_r}`,
    `${C}${b} █   ${M}┊${_r}${d} ║${_r}   ${d}║${_r}  ${d}║${_r}   ${d}║${_r}  ${M}┊${_r}${C}   █${_r}`,
    `${C}${b} █   ${M}┊${_r}${d} ║${_r} ● ${d}║${_r} ● ${d}║${_r} ● ${d}║${_r}  ${M}┊${_r}${C}   █${_r}`,
    `${C}${b} ▀▄  ${d}║${M}${b} ═══ ${_r}${d}║${M}${b} ═══ ${_r}${d}║${M}${b} ═══ ${_r}${d}║${C}${b}  ▄▀${_r}`,
    ``,
    `  ${M}${b}╔═══════════════════╗${_r}`,
    `  ${M}${b}║${_r}  ${C}${b}P${_r} ${M}${b}H${_r} ${Y}${b}A${_r} ${C}${b}N${_r} ${M}${b}T${_r} ${Y}${b}O${_r} ${C}${b}M${_r}  ${M}${b}║${_r}`,
    `  ${M}${b}╚═══════════════════╝${_r}`,
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
