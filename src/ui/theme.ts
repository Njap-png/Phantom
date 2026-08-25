export const phantomTheme = {
  background: "#0a0a1a",
  foreground: "#c0c0e0",
  border: "#4444aa",
  borderFocus: "#8844ff",
  accent: "#00ff88",
  accent2: "#00ccff",
  accent3: "#ff00cc",
  warning: "#ff8800",
  error: "#ff2244",
  dim: "#333355",
  panelBg: "#0d0d24",
  titleBar: "#1a1a3a",
  agentColors: [
    "#00ff88", "#00ccff", "#ff00cc", "#ff8800",
    "#8800ff", "#00ffcc", "#ff0066", "#66ff00",
  ],
};

export const phantomBorders = {
  type: "line" as const,
  fg: 63,
};

export const phantomBordersFocus = {
  type: "line" as const,
  fg: 99,
};
