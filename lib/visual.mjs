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

// ── Hooded figure logo ─────────────────────────────────
export function renderLogo(opts = {}) {
  const {
    mode = "",  // "non-interactive", "v0.2.0"
    tools = 0,
    wide = false,
  } = opts;

  const M = fg("magenta");      // neon violet
  const C = fg("cyan");         // electric cyan
  const G = fg("green");        // accent glow
  const dim = fg("dim");
  const _r = _R;

  if (wide) {
    // ── Wide terminal variant ─────────────────
    const lines = [
      `${dim}·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ${_r}`,
      `${C}  ▄███████████████████████████████████████▄  ${_r}`,
      `${C} ▐█${M} ═══ ═══ ═══ ═══ ═══ ═══ ═══ ═══${C} █▌${_r}`,
      `${C}▐█${M} ·   ·   ·   ·   ·   ·   ·   ·   ·${C} █▌${_r}`,
      `${C}▐█   ${M}╔═══════════════════════╗${C}   █▌${_r}`,
      `${C}▐█   ${M}║ ${G}◈     ${G}◈     ${G}◈     ${G}◈${M} ║${C}   █▌${_r}`,
      `${C}▐█   ${M}║${dim}  ╔═══╗  ${dim}╔═══╗  ${dim}╔═══╗${M}  ║${C}   █▌${_r}`,
      `${C}▐█   ${M}╚═══════════════════════╝${C}   █▌${_r}`,
      `${C} █   ${M}┊ ${dim}║${M}   ${dim}║${M}   ${dim}║${M}   ${dim}║${M} ┊${C}   █${_r}`,
      `${C} █   ${M}┊ ${dim}║${M} ● ${dim}║${M} ● ${dim}║${M} ● ${dim}║${M} ┊${C}   █${_r}`,
      `${C} ▀▄  ${dim}║${M} ═══ ${dim}║${M} ═══ ${dim}║${M} ═══ ${dim}║${C}  ▄▀${_r}`,
      `  ${M}${_B}P H A N T O M${_r}`,
    ];
    if (mode) lines.push(`  ${dim}${mode}${_r}`);
    if (tools) lines.push(`  ${dim}${tools} tools${_r}`);
    return lines.join("\n");
  }

  // ── Standard hooded figure ───────────────────
  const lines = [
    `${dim}·   ·   ·   ·   ·   ·   ${_r}`,
    `${C}  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  ${_r}`,
    `${C} █${M} ═══ ═══ ═══ ═══ ═══${C} █${_r}`,
    `${C}▐█${M} ·   ·   ·   ·   ·${C} █▌${_r}`,
    `${C}▐█   ${M}╔═══════════╗${C}   █▌${_r}`,
    `${C}▐█   ${M}║ ${G}◈     ${G}◈${M} ║${C}   █▌${_r}`,
    `${C}▐█   ${M}║${dim}  ╔═══╗${M}   ║${C}   █▌${_r}`,
    `${C}▐█   ${M}╚═══════════╝${C}   █▌${_r}`,
    `${C} █   ${M}┊ ${dim}║${M}   ${dim}║${M} ┊${C}   █${_r}`,
    `${C} █   ${M}┊ ${dim}║${M} ● ${dim}║${M} ┊${C}   █${_r}`,
    `${C} ▀▄  ${dim}║${M} ═══ ${dim}║${C}  ▄▀${_r}`,
    `  ${M}${_B}P H A N T O M${_r}`,
  ];
  if (mode) lines.push(`  ${dim}${mode}${_r}`);
  if (tools) lines.push(`  ${dim}${tools} tools${_r}`);
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
export const icons = {
  ok:     `${fg("green")}✓${_R}`,
  err:    `${fg("red")}✕${_R}`,
  warn:   `${fg("yellow")}⚠${_R}`,
  info:   `${fg("cyan")}◈${_R}`,
  bullet: `${fg("magenta")}◆${_R}`,
  arrow:  `${fg("green")}→${_R}`,
};
