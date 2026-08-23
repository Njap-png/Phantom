import fs from "fs";

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

// Simulate phantom.mjs createProvider exactly
const PROVIDERS = {
  openai: { url: 'https://opencode.ai/zen/v1', keyEnv: 'OPENCODE_ZEN_API_KEY', defaultModel: 'nemotron-3-ultra-free', chatPath: '/chat/completions', fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 16384 }), parse: d => { const c = d.choices?.[0]?.message?.content?.trim(); return c || (d.choices?.[0]?.finish_reason === 'length' ? '[Response truncated]' : '...'); }, auth: k => ({ 'Authorization': 'Bearer ' + k }) },
  opencode: { url: 'https://opencode.ai/zen/v1', keyEnv: 'OPENCODE_ZEN_API_KEY', defaultModel: 'nemotron-3-ultra-free', chatPath: '/chat/completions', fmt: o => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 16384 }), parse: d => { const c = d.choices?.[0]?.message?.content?.trim(); return c || (d.choices?.[0]?.finish_reason === 'length' ? '[Response truncated]' : '...'); }, auth: k => ({ 'Authorization': 'Bearer ' + k }) },
};

const PHANTOM_LLM_PROVIDER = 'openai';

function getProvider() {
  const name = PHANTOM_LLM_PROVIDER || 'openai';
  const p = PROVIDERS[name];
  if (!p) return PROVIDERS.openai;
  return p;
}

function getKey(p) {
  if (p.keyEnv) {
    const k = process.env[p.keyEnv];
    if (k) return k;
    if (config[p.keyEnv]) return config[p.keyEnv];
  }
  return '';
}

const llm = {
  get provider() { return PHANTOM_LLM_PROVIDER; },
  set provider(name) { if (PROVIDERS[name]) PHANTOM_LLM_PROVIDER = name; },
  get providers() { return Object.keys(PROVIDERS); },
  detectProviders: async () => {},
  selectBest: () => {},
  get hasLLM() {
    const p = getProvider();
    return !!(p.keyEnv ? getKey(p) : p === PROVIDERS.ollama);
  },
  chat: async function(messages, opts = {}) {
    const p = getProvider();
    const key = getKey(p);
    if (p.keyEnv && !key) return '[' + PHANTOM_LLM_PROVIDER + '] No API key. Set ' + p.keyEnv + ' env or in config.json';
    const model = opts.model || p.defaultModel;
    console.log('Using model:', model);
    try {
      let url = p.url + p.chatPath.replace('{model}', model);
      const headers = { 'Content-Type': 'application/json', ...p.auth(key) };
      const body = JSON.stringify(p.fmt({ model, messages }));
      const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) });
      if (!r.ok) { const t = await r.text().catch(() => ''); return '[' + r.status + '] ' + t.substring(0, 200); }
      const d = await r.json();
      return p.parse(d) || '...';
    } catch (e) { return '[err] ' + e.message; }
  }
};

const messages = [
  { role: 'system', content: 'You are Phantom, a helpful AI assistant. You are concise, knowledgeable, and direct. Answer clearly and accurately.' },
  { role: 'user', content: 'what is phantom?' }
];
const response = await llm.chat(messages);
console.log('Response:', response);