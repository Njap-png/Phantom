#!/usr/bin/env node
// Chat — Phantom conversational CLI
// Zero deps. Run: node chat.mjs

import { createRequire } from "module";
const $r = createRequire(import.meta.url);
import fs from "fs";
import { resolve } from "path";

const R = "\x1b[0m";
const _B = "\x1b[1m";
const _D = "\x1b[2m";
function c(n) {
  const colors = { green: "32", cyan: "36", dim: "2", yellow: "33", magenta: "35", red: "31", blue: "34" };
  return colors[n] ? `\x1b[${colors[n]}m` : "";
}

// ── Provider (from phantom.mjs) ──
export function createProvider() {
  const PROVIDERS = {
    openai:    { url: "https://opencode.ai/zen/v1",              keyEnv: "OPENCODE_ZEN_API_KEY",   defaultModel: "nemotron-3-ultra-free", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 16384 }), parse: d => d.choices?.[0]?.message?.content?.trim() || "...", auth: k => ({ Authorization: `Bearer ${k}` }) },
    anthropic: { url: "https://api.anthropic.com/v1",            keyEnv: "ANTHROPIC_API_KEY",      defaultModel: "claude-sonnet-4-20250514", chatPath: "/messages", fmt: o => ({ model: o.model, messages: o.messages, max_tokens: 4096 }), parse: d => d.content?.[0]?.text || "...", auth: k => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
    openrouter:{ url: "https://openrouter.ai/api/v1",            keyEnv: "OPENROUTER_API_KEY",     defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7 }), parse: d => d.choices?.[0]?.message?.content?.trim() || "...", auth: k => ({ Authorization: `Bearer ${k}` }) },
    ollama:    { url: process.env.OLLAMA_HOST || "http://localhost:11434", keyEnv: "", defaultModel: "llama3", chatPath: "/api/chat", fmt: o => ({ model: o.model, messages: o.messages, stream: false }), parse: d => d.message?.content?.trim() || "...", auth: () => ({}) },
    opencode:  { url: "https://opencode.ai/zen/v1",              keyEnv: "OPENCODE_ZEN_API_KEY",   defaultModel: "nemotron-3-ultra-free", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 256 }), parse: d => d.choices?.[0]?.message?.content?.trim() || "...", auth: k => ({ Authorization: `Bearer ${k}` }) },
  };

  const MODELS = {
    openai: ["nemotron-3-ultra-free", "qwen3-coder-free", "grok-code-fast-free", "deepseek-v4-flash-free"],
    opencode: ["nemotron-3-ultra-free", "qwen3-coder-free", "grok-code-fast-free", "deepseek-v4-flash-free"],
    anthropic: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219", "claude-3-5-haiku-20241022"],
    openrouter: ["nvidia/nemotron-3-ultra-550b-a55b:free", "auto"],
    ollama: ["llama3", "llama3.1", "qwen2.5-coder", "mistral", "gemma3"],
  };

  // Load config once so default_provider / default_model are honoured here too.
  let cfg = {};
  const userConfigPath = resolve(process.env.HOME || "/root", ".config", "phantom", "config.json");
  const projectConfigPath = resolve(new URL(".", import.meta.url).pathname, "..", "config.json");
  for (const f of [projectConfigPath, userConfigPath]) {
    try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(f, "utf8")) }; } catch {}
  }

  let providerName = process.env.PHANTOM_LLM_PROVIDER || cfg.default_provider || "openai";
  if (!PROVIDERS[providerName]) providerName = "openai";
  function getProvider() { return PROVIDERS[providerName] || PROVIDERS.openai; }
  function getKey(p) {
    if (!p.keyEnv) return "";
    const k = process.env[p.keyEnv];
    if (k) return k;
    if (cfg[p.keyEnv]) return cfg[p.keyEnv];
    return "";
  }

  return {
    get provider() { return providerName; },
    set provider(name) { if (PROVIDERS[name]) providerName = name; },
    get providers() { return Object.keys(PROVIDERS); },
    get models() { return MODELS[providerName] || []; },
    get model() { return cfg.default_model || getProvider().defaultModel; },
    set model(name) {
      if (!name) return;
      cfg.default_model = name;
      try { fs.writeFileSync(userConfigPath, JSON.stringify(cfg, null, 2)); } catch {}
    },
    async listModels(name) {
      if (name === "ollama") {
        try {
          const r = await fetch(`${PROVIDERS.ollama.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
          if (r.ok) {
            const d = await r.json();
            const live = (d.models || []).map(m => m.name).filter(Boolean);
            if (live.length) return [...new Set([...live, ...(MODELS.ollama || [])])];
          }
        } catch {}
      }
      return MODELS[name] || [];
    },
    get hasLLM() { const p = getProvider(); return !!(p.keyEnv ? getKey(p) : true); },
    async chat(messages, opts = {}) {
      const p = getProvider();
      const key = getKey(p);
      if (p.keyEnv && !key) return `[${providerName}] No API key. Set ${p.keyEnv} env var.`;
      const model = opts.model || cfg.default_model || p.defaultModel;
      try {
        let url = `${p.url}${p.chatPath.replace("{model}", model)}`;
        const h = { "Content-Type": "application/json", ...p.auth(key) };
        const body = JSON.stringify(p.fmt({ model, messages }));
        const r = await fetch(url, { method: "POST", headers: h, body, signal: AbortSignal.timeout(60000) });
        if (!r.ok) { const t = await r.text().catch(() => ""); return `[${r.status}] ${t.substring(0, 200)}`; }
        const d = await r.json();
        return p.parse(d) || "...";
      } catch (e) { return `[err] ${e.message}`; }
    }
  };
}

// ── Spinner ──
function spinner(start) {
  const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  let i = 0, timer;
  const fmt = ts => { const s = Math.floor((Date.now() - ts) / 1000); return s > 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`; };
  return {
    start() { timer = setInterval(() => { process.stdout.write(`\r${c("dim")}${frames[i]} ${fmt(start)}${R}`); i = (i + 1) % frames.length; }, 120); },
    stop() { clearInterval(timer); process.stdout.write("\r\x1b[K\n"); },
  };
}

// ── CLI Chat ──
export async function runChat(llm) {
  const version = "0.1.0";
  const history = [];
  const maxHistory = 20;

  // Use provided LLM or create one
  const provider = llm || createProvider();
  if (!provider.hasLLM) {
    console.error(`${c("red")}No LLM provider configured.${R}`);
    console.error(`${c("dim")}Set PHANTOM_LLM_PROVIDER and the corresponding API key env var.${R}`);
    process.exit(1);
  }

  console.log(`${c("green")}${_B}PHANTOM Chat${R} ${c("dim")}v${version} · ${provider.provider}${R}`);
  console.log(`${c("dim")}Type /help for commands, /exit to quit${R}\n`);

  const rl = $r("readline").createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  function ask() {
    rl.question(`${c("green")}>> ${R}`, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { ask(); return; }

      // Commands
      if (trimmed.startsWith("/")) {
        const cmd = trimmed.slice(1).toLowerCase();
        if (cmd === "exit" || cmd === "quit" || cmd === "q") { rl.close(); return; }
        if (cmd === "help") {
          console.log(`\n${c("dim")}Commands:${R}`);
          console.log(`  ${c("green")}/exit${R}      Exit chat`);
          console.log(`  ${c("green")}/clear${R}     Clear conversation history`);
          console.log(`  ${c("green")}/model <n>${R} Show/set model`);
          console.log(`  ${c("green")}/help${R}      This help\n`);
          ask();
          return;
        }
        if (cmd === "clear") { history.length = 0; console.log(`${c("dim")}History cleared${R}\n`); ask(); return; }
        if (cmd === "model" || cmd.startsWith("model ")) {
          const arg = trimmed.slice(6).trim();
          if (!arg) {
            const models = (await provider.listModels?.(provider.provider).catch(() => [])) || provider.models || [];
            console.log(`${c("dim")}Provider: ${provider.provider}\nModel:    ${provider.model}${models.length ? `\n\n${models.slice(0, 12).map((m, i) => `  ${i + 1}) ${m}`).join("\n")}\n\n/model <#|name> to switch${R}` : ""}\n`);
          } else {
            const n = parseInt(arg);
            const models = (await provider.listModels?.(provider.provider).catch(() => [])) || [];
            const m = /^\d+$/.test(arg) ? models[n - 1] : arg;
            if (m) { provider.model = m; console.log(`${c("dim")}Model: ${provider.model}${R}\n`); }
            else console.log(`${c("yellow")}No such model: ${arg}${R}\n`);
          }
          ask();
          return;
        }
        console.log(`${c("yellow")}Unknown: ${trimmed}${R}\n`);
        ask();
        return;
      }

      // Show user input
      process.stdout.write(`${c("green")}>${R} ${trimmed}\n`);

      // Build context
      const messages = [
        { role: "system", content: "You are Phantom, a helpful AI assistant. You are concise, knowledgeable, and direct. Answer clearly and accurately." },
        ...history.slice(-maxHistory),
        { role: "user", content: trimmed },
      ];

      // Streaming spinner - DISABLED
      // const s = spinner(Date.now());
      // s.start();

      // Streaming spinner
      const s = spinner(Date.now());
      s.start();

      const start = Date.now();
      console.error("DEBUG chat.mjs: BEFORE provider.chat");
      let response;
      try {
        response = await provider.chat(messages);
      } catch (e) {
        console.error("DEBUG chat.mjs: EXCEPTION in provider.chat:", e.message);
        response = "[error] " + e.message;
      }
      console.error("DEBUG chat.mjs: AFTER provider.chat, response:", response?.substring(0, 50));
      s.stop();

      if (response.startsWith("[") && response.includes("] ")) {
        console.log(`${c("red")}${response}${R}\n`);
        ask();
        return;
      }

      // Show response
      process.stdout.write("\n");
      process.stdout.write(response + "\n");
      process.stdout.write("\n");
      console.error("DEBUG chat.mjs: wrote response:", response.substring(0, 50));
      const elapsed = Math.floor((Date.now() - start) / 1000);
      console.log(`${c("dim")}✓ ${elapsed}s${R}\n`);

      // Store in history
      history.push({ role: "user", content: trimmed });
      history.push({ role: "assistant", content: response });

      ask();
    });
  }

  rl.on("close", () => {
    console.log(`\n${c("dim")}Bye.${R}`);
    process.exit(0);
  });

  ask();
}

// ── Entry ──
// Only run if executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  const llm = createProvider();
  if (!llm.hasLLM) {
    console.error(`${c("red")}No LLM provider configured.${R}`);
    console.error(`${c("dim")}Set PHANTOM_LLM_PROVIDER and the corresponding API key env var.${R}`);
    process.exit(1);
  }

  runChat(llm).catch(e => { console.error(`${c("red")}${e.message}${R}`); process.exit(1); });
}
