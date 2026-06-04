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

export function isTermux(): boolean {
  return !!(
    process.env.TERMUX_VERSION ||
    process.env.PREFIX === "/data/data/com.termux/files/usr" ||
    existsSync("/data/data/com.termux/files/usr/bin/termux-info") ||
    process.env.TERM === "xterm-256color" && !process.env.DISPLAY
  );
}
