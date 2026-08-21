import { PhantomConfig } from "../core/config.js";

export interface LLMProvider {
  chat: (messages: { role: string; content: string }[], opts?: { model?: string; temperature?: number }) => Promise<string>;
  transcribe?: (filePath: string) => Promise<string>;
}

interface ProviderConfig {
  url: string;
  keyEnv: string;
  defaultModel: string;
  chatPath: string;
  fmt: (o: any) => any;
  parse: (d: any) => string;
  auth: (k: string) => Record<string, string>;
  urlMod?: (u: string, m: string, k: string) => string;
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  openai: {
    url: "https://opencode.ai/zen/v1",
    keyEnv: "OPENCODE_ZEN_API_KEY",
    defaultModel: "deepseek-v4-flash-free",
    chatPath: "/chat/completions",
    fmt: (o: any) => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 16384 }),
    parse: (d: any) => {
      const c = d.choices?.[0]?.message?.content?.trim();
      return c || (d.choices?.[0]?.finish_reason === "length" ? "[Response truncated — increase max_tokens]" : "…");
    },
    auth: (k: string) => ({ "Authorization": `Bearer ${k}` })
  },
  anthropic: {
    url: "https://api.anthropic.com/v1",
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-20250514",
    chatPath: "/messages",
    fmt: (o: any) => ({ model: o.model, messages: o.messages, max_tokens: 512 }),
    parse: (d: any) => d.content?.[0]?.text || d.content?.toString() || "...",
    auth: (k: string) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" })
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta",
    keyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.0-flash",
    chatPath: "/models/{model}:generateContent",
    fmt: (o: any) => ({
      contents: o.messages.map((m: any) => ({
        role: m.role === "assistant" ? "model" : m.role,
        parts: [{ text: m.content }]
      }))
    }),
    parse: (d: any) => d.candidates?.[0]?.content?.parts?.[0]?.text || "...",
    auth: () => ({}),
    urlMod: (u: string, m: string, k: string) => `${u}${m}?key=${k}`
  },
  groq: {
    url: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    chatPath: "/chat/completions",
    fmt: (o: any) => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),
    parse: (d: any) => d.choices?.[0]?.message?.content?.trim() || "...",
    auth: (k: string) => ({ "Authorization": `Bearer ${k}` })
  },
  deepseek: {
    url: "https://api.deepseek.com/v1",
    keyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    chatPath: "/chat/completions",
    fmt: (o: any) => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),
    parse: (d: any) => d.choices?.[0]?.message?.content?.trim() || "...",
    auth: (k: string) => ({ "Authorization": `Bearer ${k}` })
  },
  mistral: {
    url: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",
    defaultModel: "mistral-large-latest",
    chatPath: "/chat/completions",
    fmt: (o: any) => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),
    parse: (d: any) => d.choices?.[0]?.message?.content?.trim() || "...",
    auth: (k: string) => ({ "Authorization": `Bearer ${k}` })
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-sonnet-4",
    chatPath: "/chat/completions",
    fmt: (o: any) => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 512 }),
    parse: (d: any) => d.choices?.[0]?.message?.content?.trim() || "...",
    auth: (k: string) => ({ "Authorization": `Bearer ${k}` })
  },
  ollama: {
    url: process.env.OLLAMA_HOST || "http://localhost:11434",
    keyEnv: "",
    defaultModel: "llama3",
    chatPath: "/api/chat",
    fmt: (o: any) => ({ model: o.model, messages: o.messages, stream: false }),
    parse: (d: any) => d.message?.content?.trim() || "...",
    auth: () => ({})
  },
  opencode: {
    url: "https://opencode.ai/zen/v1",
    keyEnv: "OPENCODE_ZEN_API_KEY",
    defaultModel: "deepseek-v4-flash-free",
    chatPath: "/chat/completions",
    fmt: (o: any) => ({ model: o.model, messages: o.messages, temperature: 0.7, max_tokens: 16384 }),
    parse: (d: any) => {
      const c = d.choices?.[0]?.message?.content?.trim();
      return c || (d.choices?.[0]?.finish_reason === "length" ? "[Response truncated — increase max_tokens or shorten context]" : "…");
    },
    auth: (k: string) => ({ "Authorization": `Bearer ${k}` })
  },
} as const;

type ProviderName = keyof typeof PROVIDER_CONFIGS;

function getKey(p: ProviderConfig, config: PhantomConfig): string {
  if (p.keyEnv) {
    const k = process.env[p.keyEnv];
    if (k) return k;
    // fallback: check config
    if ((config as any)[p.keyEnv]) return (config as any)[p.keyEnv];
  }
  return "";
}

export async function createProvider(config: PhantomConfig): Promise<LLMProvider> {
  // Determine provider order for fallback
  const fallbackOrder: ProviderName[] = ["openai", "anthropic", "groq", "gemini", "deepseek", "mistral", "openrouter", "opencode"];
  
  // Find first available provider
  let selectedProvider: ProviderName = "openai";
  for (const name of fallbackOrder) {
    const p = PROVIDER_CONFIGS[name];
    if (p.keyEnv) {
      const key = getKey(p, config);
      if (key) {
        selectedProvider = name;
        break;
      }
    } else if (name === "ollama") {
      // Check if Ollama is available
      try {
        const r = await fetch(`${p.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) {
          selectedProvider = name;
          break;
        }
      } catch {}
    }
  }

  const p = PROVIDER_CONFIGS[selectedProvider];
  const key = getKey(p, config);
  const model = config.providers.openai?.baseUrl ? config.agents.defaultModel : p.defaultModel;

  return {
    async chat(messages, opts = {}) {
      const modelToUse = opts.model || model;
      
      // Try selected provider first, then fallback through chain
      for (const providerName of fallbackOrder) {
        const provider = PROVIDER_CONFIGS[providerName];
        if (!provider) continue;

        const providerKey = getKey(provider, config);
        if (provider.keyEnv && !providerKey && providerName !== "ollama") continue;

        try {
          let url = `${provider.url}${provider.chatPath.replace("{model}", modelToUse)}`;
          const headers = { "Content-Type": "application/json", ...provider.auth(providerKey) };
          if (provider.urlMod) url = provider.urlMod(url, provider.chatPath.replace("{model}", modelToUse), providerKey);
          const body = JSON.stringify(provider.fmt({ model: modelToUse, messages }));

          const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(60000) });

          if (!r.ok) {
            const t = await r.text().catch(() => "");
            const err = `[${providerName} ${r.status}] ${t.substring(0, 200)}`;

            // Fallback on rate limit or service errors
            if (r.status === 429 || r.status === 503 || r.status >= 500) {
              console.log(`[LLM Fallback] ${providerName} returned ${r.status}, trying next provider...`);
              continue; // Try next provider
            }
            return err;
          }

          const d = await r.json();
          const result = provider.parse(d) || "...";

          if (providerName !== selectedProvider) {
            console.log(`[LLM Fallback] Switched to ${providerName}`);
          }
          return result;
        } catch (e: any) {
          console.log(`[LLM Fallback] ${providerName} error: ${e.message}, trying next...`);
          continue;
        }
      }

      return `[LLM Fallback] All providers exhausted.`;
    },

    async transcribe(filePath) {
      const openaiKey = getKey(PROVIDER_CONFIGS.openai, config);
      if (!openaiKey) return "[Transcribe] Set OPENCODE_ZEN_API_KEY";
      try {
        const { readFileSync } = await import("fs");
        const buf = readFileSync(filePath);
        const blob = new Blob([buf], { type: "audio/mpeg" });
        const fd = new FormData(); fd.append("file", blob, "audio.mp3"); fd.append("model", "whisper-1");
        const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { "Authorization": `Bearer ${openaiKey}` }, body: fd });
        const d: any = await r.json();
        return d.text || "[empty]";
      } catch (e: any) { return `[Transcribe err] ${e.message}`; }
    }
  };
}

export function createOpenAIProvider(config: PhantomConfig): LLMProvider {
  // Synchronous wrapper for backward compatibility - calls createProvider synchronously
  const { apiKey, baseUrl } = config.providers.openai;
  return {
    async chat(messages, opts = {}) {
      if (!apiKey) {
        return "[No OpenAI API key set. Configure via `OPENAI_API_KEY` env or `~/.config/phantom/config.json`]";
      }
      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: opts.model || config.agents.defaultModel,
            messages,
            temperature: opts.temperature ?? 0.7,
            max_tokens: 1024,
          }),
        });

        if (!resp.ok) {
          const err = await resp.text().catch(() => "");
          return `[API error ${resp.status}: ${err.substring(0, 200)}]`;
        }

        const data: any = await resp.json();
        return data.choices?.[0]?.message?.content?.trim() || "[empty response]";
      } catch (e: any) {
        return `[Request failed: ${e.message}]`;
      }
    },

    async transcribe(filePath) {
      if (!apiKey) {
        return "[No OpenAI API key set. Configure via `OPENAI_API_KEY` env or `~/.config/phantom/config.json`]";
      }
      try {
        const { readFileSync } = await import("fs");
        const fileBuffer = readFileSync(filePath);
        const blob = new Blob([fileBuffer], { type: "audio/mpeg" });
        const formData = new FormData();
        formData.append("file", blob, "audio.mp3");
        formData.append("model", "whisper-1");

        const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
        });

        if (!resp.ok) {
          const err = await resp.text().catch(() => "");
          return `[Transcription API error ${resp.status}: ${err.substring(0, 200)}]`;
        }

        const data: any = await resp.json();
        return data.text || "[empty transcription]";
      } catch (e: any) {
        return `[Transcription request failed: ${e.message}]`;
      }
    },
  };
}

export function createOllamaProvider(config: PhantomConfig): LLMProvider {
  const { baseUrl, model: defaultModel } = config.providers.ollama;

  return {
    async chat(messages, opts = {}) {
      try {
        const resp = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: opts.model || defaultModel,
            messages,
            stream: false,
          }),
        });

        if (!resp.ok) {
          const err = await resp.text().catch(() => "");
          return `[Ollama error ${resp.status}: ${err.substring(0, 200)}]`;
        }

        const data: any = await resp.json();
        return data.message?.content?.trim() || "[empty response]";
      } catch (e: any) {
        return `[Ollama request failed: ${e.message}]`;
      }
    },
  };
}