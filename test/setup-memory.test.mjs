// Phantom — setup memory tests
// Regression cover for the startup nag: the provider/model wizard and the
// bug bounty key prompt used to run on *every* interactive start, so users were
// asked for an LLM API key and a HackerOne token again after every exit even
// though both were already saved in the vault.
//
// Setup must now run once and be remembered until a new session is requested.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";

const CWD = dirname(dirname(fileURLToPath(import.meta.url)));
const PHANTOM = join(CWD, "phantom.mjs");
const VAULT = join(CWD, "lib", "vault.mjs");

function readPhantom() {
  return fs.readFileSync(PHANTOM, "utf-8");
}

// ── Static guards ───────────────────────────────────────────
describe("setup state is persisted", () => {
  it("records the wizard in config so the next start can skip it", () => {
    const src = readPhantom();
    assert.match(src, /_config\.setup = s/, "setup state must be written to config");
    assert.match(src, /writeFileSync\(userConfigPath, JSON\.stringify\(_config, null, 2\)\)/);
    assert.match(src, /function markSetup\(step\)/);
  });

  it("the LLM wizard is skipped once setup is remembered", () => {
    const src = readPhantom();
    assert.match(src, /if \(llmSetupRemembered\(\) && !force && usable\(llm\.provider\)\)/);
    assert.match(src, /\(\/setup to change\)/, "the quiet path must point at /setup");
  });

  it("the bug bounty prompt checks the vault before asking", () => {
    const src = readPhantom();
    const start = src.indexOf("async function runBugBountySetup");
    assert.ok(start > 0, "runBugBountySetup not found");
    const body = src.slice(start, start + 1200);
    assert.match(body, /loadCred\("HACKERONE_API_USERNAME"\)/, "must look up the vault first");
    assert.match(body, /loadCred\("BUGCROWD_API_TOKEN"\)/);
    assert.ok(
      body.indexOf("loadCred(\"HACKERONE_API_USERNAME\")") < body.indexOf("Set up bug bounty API keys?"),
      "the vault lookup must happen before the prompt"
    );
  });

  it("a new session can always be requested", () => {
    const src = readPhantom();
    assert.match(src, /const setupForced = \(\) => !!process\.env\.PHANTOM_SETUP/, "force must be read lazily, not snapshotted at import");
    assert.match(src, /args\.indexOf\("--setup"\)/, "--setup must be parsed from argv");
    assert.match(src, /setup: async function\(\)/, "/setup must exist");
    assert.match(src, /runLLMSetup\(true\)/, "/setup must re-run the LLM wizard");
    assert.match(src, /runBugBountySetup\(true\)/, "/setup must re-run the bug bounty wizard");
  });

  it("the GitHub auto-push prompt is remembered too", () => {
    const src = readPhantom();
    const start = src.indexOf("Set up GitHub credentials for auto-push?");
    assert.ok(start > 0, "the GitHub prompt is gone");
    const line = src.slice(src.lastIndexOf("else if", start), src.indexOf("{", start) + 1);
    assert.match(line, /setupDone\("github"\)/, "a skipped GitHub prompt must not come back");
    assert.match(src, /markSetup\("github"\)/);
  });
});

// ── Live pty runs ───────────────────────────────────────────
// The wizards only run when stdin is a TTY, so these drive Phantom through
// `script(1)`, which gives the child a real pty.
const PTY = spawnSync("script", ["-qec", "true", "/dev/null"], { encoding: "utf-8" }).status === 0;
const NO_PTY = PTY ? false : "script(1) is needed to allocate a pty";

describe("startup does not re-ask for keys it already has", { timeout: 120000 }, () => {
  const homes = [];

  after(() => {
    for (const h of homes) try { fs.rmSync(h, { recursive: true, force: true }); } catch {}
  });

  // Boot Phantom in a throwaway HOME and return everything it printed.
  // `bin/` is pre-seeded with stubs so the recon auto-installer stays offline.
  // Blank lines answer the wizards ("keep"/"skip"). These tests only care about
  // the startup output, so runs are cut short once it has been captured rather
  // than waiting for the REPL to exit.
  function boot(config, { vault = {}, argv = "", env = {}, input = "\n\n\n/quit\n", timeout = 20000 } = {}) {
    const home = mkdtempSync(join(os.tmpdir(), "phantom-setupmem-"));
    homes.push(home);
    const dir = join(home, ".config", "phantom");
    mkdirSync(join(dir, "bin"), { recursive: true });
    for (const tool of ["subfinder", "dnsx", "httpx"]) {
      const p = join(dir, "bin", tool);
      writeFileSync(p, "#!/bin/sh\necho stub\n");
      chmodSync(p, 0o755);
    }
    writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2));

    const seed = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import { set } from ${JSON.stringify(VAULT)};` +
      `for (const [k, v] of Object.entries(${JSON.stringify(vault)})) set(k, v);`,
    ], { env: { ...process.env, HOME: home }, encoding: "utf-8" });
    assert.equal(seed.status, 0, `seeding the vault failed: ${seed.stderr}`);

    const cmd = `node ${JSON.stringify(PHANTOM)}${argv}`;
    const r = spawnSync("script", ["-qec", cmd, "/dev/null"], {
      env: { ...process.env, HOME: home, TERM: "dumb", CI: "", ...env },
      input, encoding: "utf-8", timeout,
    });
    const out = r.stdout || "";
    assert.ok(out.includes("PHANTOM") || out.length > 0, "Phantom produced no output at all");
    const readConfig = () => JSON.parse(readFileSync(join(dir, "config.json"), "utf-8"));
    return { out, readConfig };
  }

  const CONFIGURED = {
    default_provider: "openrouter",
    default_model: "some-model:free",
    OPENROUTER_API_KEY: "sk-test-key",
  };
  const H1 = { HACKERONE_API_USERNAME: "h1-user", HACKERONE_API_TOKEN: "h1-token" };

  it("stays quiet when the previous session is remembered", { skip: NO_PTY }, () => {
    const { out } = boot({ ...CONFIGURED, setup: { done: true, llm: true, bugbounty: true } }, { vault: H1 });
    assert.doesNotMatch(out, /Provider \[1-/, "the provider menu must not reappear");
    assert.doesNotMatch(out, /Enter OpenRouter API key/, "must not ask for a key it already has");
    assert.doesNotMatch(out, /Set up bug bounty API keys\?/, "the bug bounty prompt must not reappear");
    assert.doesNotMatch(out, /HackerOne username/, "must not ask for the HackerOne username again");
    assert.match(out, /Using/, "it should still report the provider in use");
  });

  it("stays quiet for a pre-existing install that never recorded setup", { skip: NO_PTY }, () => {
    // No `setup` key at all: an existing user whose keys are already saved.
    const { out, readConfig } = boot(CONFIGURED, { vault: H1 });
    assert.doesNotMatch(out, /Provider \[1-/, "a persisted provider choice means the wizard already ran");
    assert.doesNotMatch(out, /Set up bug bounty API keys\?/, "vault credentials must not be re-requested");
    assert.doesNotMatch(out, /HackerOne username/);
    const cfg = readConfig();
    assert.ok(cfg.setup?.llm, "the LLM step must be recorded for next time");
    assert.ok(cfg.setup?.bugbounty, "the bug bounty step must be recorded for next time");
    assert.equal(typeof cfg.setup?.at, "string", "the recording must be timestamped");
  });

  it("re-asks when the remembered provider is no longer usable", { skip: NO_PTY }, () => {
    // Provider gone (no key, Ollama down) must not be trusted from the marker.
    const { out } = boot({ setup: { done: true, llm: true, bugbounty: true } });
    assert.match(out, /Provider \[1-/, "a stale provider must bring the wizard back");
  });

  it("--setup starts a new session and re-opens both wizards", { skip: NO_PTY }, () => {
    const { out } = boot(
      { ...CONFIGURED, setup: { done: true, llm: true, bugbounty: true } },
      { vault: H1, argv: " --setup" },
    );
    assert.match(out, /Provider \[1-/, "--setup must re-open the provider menu");
    assert.match(out, /Set up bug bounty API keys\?/, "--setup must re-open the bug bounty prompt");
  });

  it("PHANTOM_SETUP=1 does the same", { skip: NO_PTY }, () => {
    const { out } = boot(
      { ...CONFIGURED, setup: { done: true, llm: true, bugbounty: true } },
      { vault: H1, env: { PHANTOM_SETUP: "1" } },
    );
    assert.match(out, /Provider \[1-/);
  });

  it("still asks on a genuine first run", { skip: NO_PTY }, () => {
    const { out } = boot({});
    assert.match(out, /Provider \[1-/, "a first run must still offer provider selection");
    assert.match(out, /Set up bug bounty API keys\?/, "a first run must still offer bug bounty setup");
  });
});
