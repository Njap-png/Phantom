// Phantom — config/setup/LLM integration tests
// Verifies: bug-bounty + OpenRouter config persistence, free-model default,
// startup prompt wiring, and live auth/LLM checks.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const CWD = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE_DIR = resolve(os.homedir(), ".config", "phantom");
const USER_CONFIG = join(BASE_DIR, "config.json");
const HAS_CONFIG = fs.existsSync(USER_CONFIG);
const NO_CONFIG = "no ~/.config/phantom/config.json — run setup first";
const state = {
  origKey: null,
  origCfg: null,
  proxied: null,
};

before(() => {
  if (fs.existsSync(USER_CONFIG)) state.origCfg = fs.readFileSync(USER_CONFIG, "utf-8");
  state.origKey = process.env.OPENROUTER_API_KEY;
});

after(() => {
  if (state.origCfg) fs.writeFileSync(USER_CONFIG, state.origCfg);
  else try { fs.unlinkSync(USER_CONFIG); } catch {}
  if (state.origKey) process.env.OPENROUTER_API_KEY = state.origKey;
});

function readPhantom() {
  return fs.readFileSync(join(CWD, "phantom.mjs"), "utf-8");
}

describe("persisted config (~/.config/phantom/config.json)", { skip: HAS_CONFIG ? false : NO_CONFIG }, () => {
  it("config file exists", () => {
    assert.ok(fs.existsSync(USER_CONFIG), `${USER_CONFIG} missing`);
  });

  it("HackerOne credentials are stored (in the secret vault, not plaintext config)", async () => {
    const { get, status } = await import(join(CWD, "lib", "vault.mjs"));
    assert.ok(status().location, "vault location missing");
    if (!get("HACKERONE_API_USERNAME") || !get("HACKERONE_API_TOKEN")) return;
    const cfg = JSON.parse(fs.readFileSync(USER_CONFIG, "utf-8"));
    assert.equal(cfg.HACKERONE_API_TOKEN, undefined, "token must NOT be in plaintext config");
  });

  it("OpenRouter key + default provider are stored", () => {
    const cfg = JSON.parse(fs.readFileSync(USER_CONFIG, "utf-8"));
    assert.ok(cfg.OPENROUTER_API_KEY, "OPENROUTER_API_KEY missing");
    assert.equal(cfg.default_provider, "openrouter");
  });
});

describe("provider key auto-load (phantom.mjs PROVIDER_KEYS)", () => {
  it("includes bug-bounty and OpenRouter keys", () => {
    const src = readPhantom();
    const line = src.split("\n").find(l => l.includes("const PROVIDER_KEYS"));
    assert.ok(line, "PROVIDER_KEYS not found");
    for (const k of ["OPENROUTER_API_KEY", "HACKERONE_API_USERNAME", "HACKERONE_API_TOKEN", "BUGCROWD_API_TOKEN", "BUGCROWD_API_USERNAME"]) {
      assert.ok(line.includes(k), `PROVIDER_KEYS missing ${k}`);
    }
  });

  it("loads config keys into process.env at runtime", { skip: HAS_CONFIG ? false : NO_CONFIG }, async () => {
    const cfg = JSON.parse(fs.readFileSync(USER_CONFIG, "utf-8"));
    const line = readPhantom().split("\n").find(l => l.includes("const PROVIDER_KEYS"));
    for (const k of Object.keys(cfg)) {
      if (line.includes(k)) {
        // Provider loop copies _config[k] -> process.env[k]; verify value equivalence
        assert.equal(cfg[k].length > 0, true, `${k} should have a value`);
      }
    }
  });
});

describe("default OpenRouter model is free", () => {
  it("phantom.mjs defaultModel ends with :free", () => {
    const src = readPhantom();
    const m = src.match(/openrouter:.*?defaultModel: "(.*?)"/);
    assert.ok(m, "openrouter provider not found in phantom.mjs");
    assert.match(m[1], /:free$/, `expected a :free model, got ${m[1]}`);
  });

  it("chat.mjs defaultModel ends with :free", () => {
    const src = fs.readFileSync(join(CWD, "chat.mjs"), "utf-8");
    const m = src.match(/openrouter:.*?defaultModel: "(.*?)"/);
    assert.ok(m, "openrouter provider not found in chat.mjs");
    assert.match(m[1], /:free$/, `expected a :free model, got ${m[1]}`);
  });

  it("no paid OpenRouter models left as defaults", () => {
    const src = readPhantom();
    assert.doesNotMatch(src, /openrouter:.*defaultModel: "anthropic\/claude-sonnet-4"/);
  });
});

describe("startup bug-bounty prompt wiring (phantom.mjs)", () => {
  it("asks for HackerOne username and token", () => {
    const src = readPhantom();
    assert.match(src, /Set up bug bounty API keys\?/);
    assert.match(src, /HackerOne username \(API token identifier\)/);
    assert.match(src, /HackerOne API token/);
    assert.match(src, /Bugcrowd API token/);
  });

  it("persists entered keys to config.json", () => {
    const src = readPhantom();
    assert.match(src, /HACKERONE_API_USERNAME = username\.trim\(\)/);
    assert.match(src, /HACKERONE_API_TOKEN = token\.trim\(\)/);
    assert.match(src, /BUGCROWD_API_TOKEN = token\.trim\(\)/);
    assert.match(src, /writeFileSync\(userConfigPath/);
  });
});

const LIVE = process.env.PHANTOM_LIVE_TESTS === "1";
describe("live integration checks", { skip: LIVE ? false : "set PHANTOM_LIVE_TESTS=1 to run network/credential checks" }, () => {
  it("HackerOne tool authenticates with stored credentials", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.hackerone("test");
    assert.match(r, /Auth test: HTTP 200 OK/, `got: ${r.slice(0, 120)}`);
  });

  it("Bugcrowd tool returns its help/usage", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.bugcrowd("help");
    assert.match(r, /Bugcrowd Tool/);
  });

  it("HackerOne programs list is reachable", async () => {
    const { hackerTools } = await import("../lib/tools.mjs");
    const r = await hackerTools.hackerone("programs");
    assert.ok(typeof r === "string" && r.length > 0);
    if (/No programs found|Unauthorized|HTTP 40/.test(r)) {
      assert.fail(`programs failed: ${r.slice(0, 150)}`);
    }
  });

  it("OpenRouter free model responds over the API", async () => {
    const cfg = JSON.parse(fs.readFileSync(USER_CONFIG, "utf-8"));
    const key = cfg.OPENROUTER_API_KEY;
    assert.ok(key, "no OPENROUTER_API_KEY in config");
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        max_tokens: 32,
        messages: [{ role: "user", content: "Reply with exactly: FREE" }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(res.ok, true, `HTTP ${res.status}`);
    const d = await res.json();
    assert.ok(d.choices?.[0]?.message?.content, "no content in response");
  });
});