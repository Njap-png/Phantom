import { PhantomConfig } from "../core/config.js";

export interface LLMProvider {
  chat: (messages: { role: string; content: string }[], opts?: { model?: string; temperature?: number }) => Promise<string>;
}

export function createOpenAIProvider(config: PhantomConfig): LLMProvider {
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
