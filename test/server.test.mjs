// Phantom — API server tests
// Run: node --test test/server.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const PORT = 18999; // non-standard port to avoid collisions
const BASE = `http://localhost:${PORT}`;

let startGuiDashboard, startApiServer, initApiDeps, hackerTools, __r;
let apiServer, guiServer;

before(async () => {
  // Import modules
  const toolsMod = await import("../lib/tools.mjs");
  const runtimeMod = await import("../lib/runtime.mjs");
  const serverMod = await import("../lib/server.mjs");

  hackerTools = toolsMod.hackerTools;
  __r = runtimeMod;
  initApiDeps = serverMod.initApiDeps;
  startGuiDashboard = serverMod.startGuiDashboard;
  startApiServer = serverMod.startApiServer;

  // Suppress server logs during tests
  process.env.PHANTOM_QUIET = "1";

  // Initialize deps before starting server
  initApiDeps(toolsMod.hackerTools, runtimeMod, "");

  // Start API server
  apiServer = startApiServer(PORT);

  // Wait for server to be ready
  await new Promise(r => setTimeout(r, 500));
});

after(() => {
  delete process.env.PHANTOM_QUIET;
  if (apiServer) apiServer.close();
  if (guiServer) guiServer.close();
});

const fetchJson = async (path, opts = {}) => {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
  const data = await res.json();
  return { status: res.status, data };
};

// ── API tests ───────────────────────────────────────────

describe("GET /api", () => {
  it("returns api info", async () => {
    const { status, data } = await fetchJson("/api");
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.ok(Array.isArray(data.tools));
    assert.match(data.version, /0\.2\.0/);
  });
});

describe("GET /api/tools", () => {
  it("lists all tools with count", async () => {
    const { status, data } = await fetchJson("/api/tools");
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.count >= 108);
    assert.ok(Array.isArray(data.tools));
  });
});

describe("GET /api/health", () => {
  it("returns health status", async () => {
    const { status, data } = await fetchJson("/api/health");
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.status, "running");
    assert.ok(data.tools >= 108);
    assert.ok(data.pid > 0);
  });
});

describe("POST /api/run", () => {
  it("runs a tool via POST", async () => {
    const { status, data } = await fetchJson("/api/run", {
      method: "POST",
      body: JSON.stringify({ tool: "shell", args: "echo api_test_ok" }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.tool, "shell");
    assert.match(data.result, /api_test_ok/);
  });

  it("returns 404 for unknown tool", async () => {
    const { status, data } = await fetchJson("/api/run", {
      method: "POST",
      body: JSON.stringify({ tool: "nonexistent_nope", args: "" }),
    });
    assert.equal(status, 404);
    assert.equal(data.ok, false);
    assert.match(data.error, /not found/i);
  });
});

describe("GET /api/run", () => {
  it("runs a tool via GET", async () => {
    const { status, data } = await fetchJson("/api/run?tool=shell&args=echo get_test_ok");
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.tool, "shell");
    assert.match(data.result, /get_test_ok/);
  });

  it("returns 404 for unknown tool via GET", async () => {
    const { status, data } = await fetchJson("/api/run?tool=bad_tool&args=");
    assert.equal(status, 404);
    assert.equal(data.ok, false);
  });
});

describe("API CORS", () => {
  it("returns CORS headers", async () => {
    const res = await fetch(`${BASE}/api/tools`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  });

  it("handles OPTIONS preflight", async () => {
    const res = await fetch(`${BASE}/api/tools`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
  });
});

describe("404 handler", () => {
  it("returns 404 for unknown route", async () => {
    const { status, data } = await fetchJson("/api/unknown_route_xyz");
    assert.equal(status, 404);
    assert.equal(data.ok, false);
  });
});

describe("dashboard HTML", () => {
  it("serves dashboard HTML at /", async () => {
    // Start GUI dashboard on a different port
    const guiPort = PORT + 1;
    guiServer = startGuiDashboard(guiPort);
    await new Promise(r => setTimeout(r, 300));

    const res = await fetch(`http://localhost:${guiPort}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /PHANTOM/i);
    assert.match(html, /<!DOCTYPE html>/i);
  });

  it("serves dashboard for any non-API route", async () => {
    const res = await fetch(`http://localhost:${PORT + 1}/anything-here`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /PHANTOM/i);
  });
});
