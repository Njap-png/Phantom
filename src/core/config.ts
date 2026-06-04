import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

export interface PhantomConfig {
  agents: {
    maxInstances: number;
    defaultModel: string;
    defaultProvider: string;
    heartbeatInterval: number;
  };
  ui: {
    borderStyle: string;
    animationSpeed: number;
  };
  providers: {
    openai: { apiKey: string; baseUrl: string };
    anthropic: { apiKey: string };
    ollama: { baseUrl: string; model: string };
  };
}

const CONFIG_DIR = resolve(homedir(), ".config", "phantom");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.json");

export const defaultConfig: PhantomConfig = {
  agents: {
    maxInstances: 8,
    defaultModel: "gpt-4o",
    defaultProvider: "openai",
    heartbeatInterval: 3000,
  },
  ui: {
    borderStyle: "line",
    animationSpeed: 50,
  },
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY || "", baseUrl: "https://api.openai.com/v1" },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY || "" },
    ollama: { baseUrl: process.env.OLLAMA_HOST || "http://localhost:11434", model: "llama3" },
  },
};

export function loadConfig(): PhantomConfig {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    if (!existsSync(CONFIG_PATH)) {
      writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    return defaultConfig;
  }
}

export interface EnvInfo {
  tty: boolean;
  interactive: boolean;
  platform: string;
  terminal: string;
  colors: number;
  hasTrueColor: boolean;
  has256: boolean;
  cols: number;
  rows: number;
  screenSize: "tiny" | "small" | "medium" | "large" | "huge";
  inputMode: string;
  isTermux: boolean;
  isTmux: boolean;
  isWSL: boolean;
  isWindows: boolean;
}

export function detectEnv(): EnvInfo {
  const isTTY = !!process.stdin.isTTY;
  const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
  const isTermux = !!(process.env.TERMUX_VERSION || process.env.PREFIX?.startsWith("/data/data/com.termux"));
  const isWindows = process.platform === "win32";
  const isWSL = !!process.env.WSL_DISTRO_NAME;
  const isTmux = !!process.env.TMUX;
  const term = (process.env.TERM || "unknown").toLowerCase();
  const colorterm = (process.env.COLORTERM || "").toLowerCase();

  let terminal = "unknown";
  if (isTermux) terminal = "termux";
  else if (term.includes("kitty")) terminal = "kitty";
  else if (term.includes("alacritty")) terminal = "alacritty";
  else if (term.includes("gnome")) terminal = "gnome";
  else if (term.includes("konsole")) terminal = "konsole";
  else if (term.includes("tmux") || isTmux) terminal = "tmux";
  else if (term.includes("screen")) terminal = "screen";
  else if (term.includes("xterm")) terminal = "xterm";
  else if (isWindows) terminal = "windows-console";
  else if (process.env.TERM_PROGRAM === "iterm2") terminal = "iterm2";
  else if (process.env.TERM_PROGRAM === "Apple_Terminal") terminal = "apple-terminal";
  else if (process.env.VSCODE_INJECTION) terminal = "vscode";

  let colors = 16;
  if (colorterm === "truecolor" || colorterm === "24bit" || term.includes("truecolor") || term.includes("24bit")) {
    colors = 16777216;
  } else if (term.includes("256") || term.includes("xterm")) {
    colors = 256;
  }

  let cols = 80, rows = 24;
  try {
    if (process.stdout.getWindowSize) {
      [cols, rows] = process.stdout.getWindowSize();
      cols = Math.max(cols, 20);
      rows = Math.max(rows, 10);
    }
  } catch {}

  let screenSize: EnvInfo["screenSize"] = "medium";
  if (cols < 60 || rows < 15) screenSize = "tiny";
  else if (cols < 80 || rows < 24) screenSize = "small";
  else if (cols >= 120 && rows >= 40) screenSize = "large";
  else if (cols >= 160 && rows >= 50) screenSize = "huge";

  return {
    tty: isTTY,
    interactive: isTTY && !isCI,
    platform: isTermux ? "termux" : isWSL ? "wsl" : process.platform,
    terminal,
    colors,
    hasTrueColor: colors >= 16777216,
    has256: colors >= 256,
    cols, rows,
    screenSize,
    inputMode: "keyboard",
    isTermux, isTmux, isWSL, isWindows,
  };
}
