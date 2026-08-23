// Test the exact phantom.mjs createProvider and chat method
import fs from "fs";

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

// Copy exact phantom.mjs PROVIDERS
const PROVIDERS = {
  openai:      { url: "https://opencode.ai/zen/v1",                keyEnv: "OPENCODE_ZEN_API_KEY",     defaultModel: "nemotron-3-ultra-free", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 16384 }),               parse: d => { const c = d.choices?.[0]?.message?.content?.trim(); return c || (d.choices?.[0]?.finish_reason === "length" ? "[Response truncated — increase max_tokens]" : "…"); }, auth: k => ({ "Authorization": `Bearer ${k}` }) },
  anthropic:   { url: "https://api.anthropic.com/v1",         keyEnv: "ANTHROPIC_API_KEY",   defaultModel: "claude-sonnet-4-20250514", chatPath: "/messages",         fmt: o => ({ model: o.model, messages: o.messages, max_tokens: 512 }),                                 parse: d => d.content?.[0]?.text || d.content?.toString() || "...",                                                                                                      auth: k => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
  gemini:      { url: "https://generativelanguage.googleapis.com/v1beta", keyEnv: "GEMINI_API_KEY", defaultModel: "gemini-2.0-flash", chatPath: "/models/{model}:generateContent", fmt: o => ({ contents: o.messages.map(m => ({ role: m.role === "assistant" ? "model" : m.role, parts: [{ text: m.content }] })) }), parse: d => d.candidates?.[0]?.content?.parts?.[0]?.text || "...",                                             auth: () => ({}), urlMod: (u, m, k) => `${u}${m}?key=${k}` },
  groq:        { url: "https://api.groq.com/openai/v1",       keyEnv: "GROQ_API_KEY",        defaultModel: "llama-3.3-70b-versatile", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
  deepseek:    { url: "https://api.deepseek.com/v1",          keyEnv: "DEEPSEEK_API_KEY",    defaultModel: "deepseek-chat",   chatPath: "/chat/completions",     fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
  mistral:     { url: "https://api.mistral.ai/v1",            keyEnv: "MISTRAL_API_KEY",     defaultModel: "mistral-large-latest", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
  openrouter:  { url: "https://openrouter.ai/api/v1",         keyEnv: "OPENROUTER_API_KEY",  defaultModel: "anthropic/claude-sonnet-4", chatPath: "/chat/completions", fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),               parse: d => d.choices?.[0]?.message?.content?.trim() || "...",                                                                                                       auth: k => ({ "Authorization": `Bearer ${k}` }) },
  ollama:      { url: process.env.OLLAMA_HOST || "http://localhost:11434", keyEnv: "",        defaultModel: "llama3",         chatPath: "/api/chat",           fmt: o => ({ model: o.model, messages: o.messages, stream: false }),                                  parse: d => d.message?.content?.trim() || "...",                                                                                                                       auth: () => ({}) },
  opencode:    { url: "https://opencode.ai/zen/v1",                keyEnv: "OPENCODE_ZEN_API_KEY",     defaultModel: "nemotron-3-ultra-free", chatPath: "/chat/completions",     fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 16384 }),               parse: d => { const c = d.choices?.[0]?.message?.content?.trim(); return c || (d.choices?.[0]?.finish_reason === "length" ? "[Response truncated — increase max_tokens or shorten context]" : "…"); },                                                        auth: k => ({ "Authorization": `Bearer ${k}` }) },
};

const PHANTOM_LLM_PROVIDER = "openai";
let _config = config;

function getProvider() {
  const name = PHANTOM_LLM_PROVIDER || "openai";
  const p = PROVIDERS[name];
  if (!p) return PROVIDERS.openai;
  return p;
}

function getKey(p) {
  if (p.keyEnv) {
    const k = process.env[p.keyEnv];
    if (k) return k;
    if (_config[p.keyEnv]) return _config[p.keyEnv];
  }
  return "";
}

async function detectProviders() {
  const available = {};
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (name === "ollama") {
      try {
        const r = await fetch(`${p.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
        available[name] = r.ok ? "local" : "no";
      } catch { available[name] = "no"; }
    } else {
      available[name] = p.keyEnv && getKey(p) ? "key" : "no";
    }
  }
  return available;
}

function selectBest(avail) {
  const order = ["openai", "ollama", "opencode", "anthropic", "groq", "gemini", "deepseek", "mistral", "openrouter"];
  for (const name of order) {
    if (avail[name] && avail[name] !== "no") return name;
  }
  return null;
}

const provider = {
  get provider() { return PHANTOM_LLM_PROVIDER; },
  set provider(name) { if (PROVIDERS[name]) PHANTOM_LLM_PROVIDER = name; },
  get providers() { return Object.keys(PROVIDERS); },
  detectProviders,
  selectBest,
  get hasLLM() {
    const p = getProvider();
    return !!(p.keyEnv ? getKey(p) : p === PROVIDERS.ollama);
  },
  chat: async function(messages, opts = {}) {
    const p = getProvider();
    const key = getKey(p);
    if (p.keyEnv && !key) return `[${PHANTOM_LLM_PROVIDER}] No API key. Set ${p.keyEnv} env or in config.json`;
    const model = opts.model || p.defaultModel;

    // Fallback chain on rate limits / errors
    const fallbackOrder = ["openai", "anthropic", "groq", "gemini", "deepseek", "mistral", "openrouter", "opencode"];
    let currentProvider = PHANTOM_LLM_PROVIDER;
    let lastError = "";

    for (const providerName of fallbackOrder) {
      const providerObj = PROVIDERS[providerName];
      if (!providerObj) continue;

      const providerKey = getKey(providerObj);
      if (providerObj.keyEnv && !providerKey && providerName !== "ollama") continue;

      try {
        let url = `${providerObj.url}${providerObj.chatPath.replace("{model}", model)}`;
        const headers = { "Content-Type": "application/json", ...providerObj.auth(providerKey) };
        if (providerObj.urlMod) url = providerObj.urlMod(url, providerObj.chatPath.replace("{model}", model), providerKey);
        const body = JSON.stringify(providerObj.fmt({ model, messages }));

        const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(60000) });

        if (!r.ok) {
          const t = await r.text().catch(() => "");
          lastError = `[${providerName} ${r.status}] ${t.substring(0, 200)}`;

          // Fallback on rate limit or service errors
          if (r.status === 429 || r.status === 503 || r.status >= 500) {
            console.log(`[LLM Fallback] ${providerName} returned ${r.status}, trying next provider...`);
            continue;
          }
          return lastError;
        }

        const d = await r.json();
        const result = providerObj.parse(d) || "...";

        if (providerName !== currentProvider) {
          console.log(`[LLM Fallback] Switched to ${providerName}`);
        }
        return result;
      } catch (e) {
        lastError = `[${providerName} err] ${e.message}`;
        console.log(`[LLM Fallback] ${providerName} error: ${e.message}, trying next...`);
        continue;
      }
    }

    return `[LLM Fallback] All providers exhausted. Last error: ${lastError}`;
  },
};

const messages = [
  { role: 'system', content: 'You are Phantom, a helpful AI assistant. You are concise, knowledgeable, and direct. Answer clearly and accurately.' },
  { role: 'user', content: 'what is phantom?' }
];

console.log('Provider:', provider.provider);
console.log('Has LLM:', provider.hasLLM);
const response = await provider.chat(messages);
console.log('Response:', response);