// Phantom — LLM provider/model selection tests
// Regression cover for the bug where choosing a provider/model was a no-op:
//   1. chat() ignored the selected provider (hardcoded fallbackOrder, no ollama)
//   2. the resolved model was sent to whichever provider was first in the chain
//   3. the startup picker had no model step and used the wrong API key env var

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";

const CWD = dirname(dirname(fileURLToPath(import.meta.url)));

function readPhantom() {
  return fs.readFileSync(join(CWD, "phantom.mjs"), "utf-8");
}

// ── Static guards ───────────────────────────────────────────
describe("selected provider is honoured", () => {
  it("fallback chain is seeded with the selected provider", () => {
    const src = readPhantom();
    const line = src.split("\n").find(l => l.includes("const fallbackOrder = [...new Set([selected,"));
    assert.ok(line, "fallbackOrder must start from the selected provider");
    assert.match(line, /selected/, "fallbackOrder must be seeded with `selected`");
  });

  it("ollama is reachable in the fallback chain", () => {
    const src = readPhantom();
    const line = src.split("\n").find(l => l.includes("const fallbackOrder = [...new Set([selected,"));
    assert.ok(line, "fallbackOrder not found");
    assert.match(line, /"ollama"/, "ollama must be in the fallback chain");
  });

  it("model is resolved per provider, not once for the whole chain", () => {
    const src = readPhantom();
    assert.doesNotMatch(
      src,
      /const model = opts\.model \|\| _config\.default_model \|\| p\.defaultModel/,
      "a single cross-provider `model` variable is what caused model/provider mismatch"
    );
    assert.match(src, /if \(providerName === selected\)/, "model must be resolved for the selected provider");
  });
});

describe("model catalogue", () => {
  it("every provider in the registry has a model list", () => {
    const src = readPhantom();
    const m = src.match(/const MODELS = \{([\s\S]*?)\n  \};/);
    assert.ok(m, "MODELS catalogue not found");
    for (const p of ["openai", "anthropic", "gemini", "groq", "deepseek", "mistral", "openrouter", "ollama"]) {
      assert.match(m[1], new RegExp(`\\b${p}:`), `MODELS missing ${p}`);
    }
  });

  it("the provider object exposes models / model / listModels", () => {
    const src = readPhantom();
    assert.match(src, /get models\(\) \{ return MODELS\[PHANTOM_LLM_PROVIDER\]/);
    assert.match(src, /set model\(name\)/, "model must be settable so choices persist");
    assert.match(src, /listModels,/);
  });
});

describe("startup picker", () => {
  it("offers a model step, not just a provider step", () => {
    const src = readPhantom();
    assert.match(src, /LLM setup|Models for \$\{/, "picker must list models");
    assert.match(src, /Model \[1-/, "picker must ask for a model choice");
  });

  it("reads API key env vars from the registry, not a stale hardcoded map", () => {
    const src = readPhantom();
    assert.match(src, /P\[name\]\.keyEnv/, "picker must use the registry keyEnv");
    assert.doesNotMatch(
      src,
      /\["openai",\s*"OPENAI_API_KEY"/,
      "the old picker stored keys under OPENAI_API_KEY, which no provider reads"
    );
  });

  it("persists the model as default_model", () => {
    const src = readPhantom();
    assert.match(src, /llm\.model = m/, "picker must assign the chosen model");
    assert.match(src, /_config\.default_model = name/, "model must be persisted to config");
  });
});

describe("/model command", () => {
  it("accepts a model name, not only provider names", () => {
    const src = readPhantom();
    const start = src.indexOf("      model: async (rest) => {");
    assert.ok(start > 0, "/model command not found");
    const body = src.slice(start, start + 2600);
    assert.match(body, /this\.llm\.model = arg/, "/model <name> must set the model");
    assert.match(body, /this\.llm\.model = models\[n - 1\]/, "/model <#|name> must set the model");
    assert.match(body, /listModels/, "/model must be able to list models");
  });
});

// ── Live end-to-end: the selection must reach the wire ─────
describe("chat() dispatches to the selected provider", () => {
  let server, port, home;
  const hits = [];

  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", d => (body += d));
      req.on("end", () => {
        let model = null;
        try { model = JSON.parse(body).model; } catch {}
        hits.push({ path: req.url, model });
        res.writeHead(200, { "Content-Type": "application/json" });
        if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "llama3" }] }));
        res.end(JSON.stringify({ message: { content: "PONG_FROM_FAKE_OLLAMA" } }));
      });
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
    home = mkdtempSync(join(os.tmpdir(), "phantom-llmsel-"));
    mkdirSync(join(home, ".config", "phantom"), { recursive: true });
  });

  after(() => { try { server.close(); } catch {} });

  // code_gen routes through llm.chat(), so it exercises the real dispatch path.
  async function dispatch(cfg) {
    hits.length = 0;
    writeFileSync(join(home, ".config", "phantom", "config.json"), JSON.stringify(cfg));
    const env = {
      ...process.env,
      HOME: home,
      OLLAMA_HOST: `http://127.0.0.1:${port}`,
      PHANTOM_NO_SETUP: "1",
      // Decoys: a keyed provider that used to win the fallback race.
      OPENCODE_ZEN_API_KEY: "sk-decoy",
      ANTHROPIC_API_KEY: "sk-ant-decoy",
      GROQ_API_KEY: "gsk-decoy",
    };
    delete env.PHANTOM_LLM_PROVIDER;
    await new Promise((resolve, reject) => {
      const c = spawn("node", ["phantom.mjs", "--tool", "code_gen", "hello|javascript"], {
        cwd: CWD, env, stdio: ["ignore", "ignore", "ignore"],
      });
      c.on("close", resolve);
      c.on("error", reject);
    });
    return hits.filter(h => h.path !== "/api/tags");
  }

  it("sends the request to the selected provider, not a keyed decoy", { timeout: 120000 }, async () => {
    const sent = await dispatch({ default_provider: "ollama", default_model: "qwen2.5-coder" });
    assert.ok(sent.length, "no request reached the selected provider");
    assert.equal(sent[0].path, "/api/chat", "must hit ollama's /api/chat");
  });

  it("sends the configured model, verbatim", { timeout: 120000 }, async () => {
    const sent = await dispatch({ default_provider: "ollama", default_model: "qwen2.5-coder" });
    assert.equal(sent[0].model, "qwen2.5-coder", "configured model must be what is sent");
  });

  it("accepts an arbitrary model name", { timeout: 120000 }, async () => {
    const sent = await dispatch({ default_provider: "ollama", default_model: "llama3.1" });
    assert.equal(sent[0].model, "llama3.1");
  });
});
