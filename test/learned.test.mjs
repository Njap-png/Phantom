import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

describe("learned modules", () => {
  it("absorbs knowledge + playbook entries into lib/learned", async () => {
    const home = mkdtempSync(resolve(tmpdir(), "phantom-learned-"));
    process.env.HOME = home;

    const kdir = resolve(home, ".config", "phantom", "knowledge");
    const pdir = resolve(home, ".config", "phantom", "playbooks");
    mkdirSync(kdir, { recursive: true });
    mkdirSync(pdir, { recursive: true });
    writeFileSync(resolve(kdir, "yt_test.json"), JSON.stringify({ tags: ["youtube"], content: "hello world", created: "2026-01-01" }));
    writeFileSync(resolve(pdir, "pb_test.json"), JSON.stringify({ name: "PB", steps: [{ tool: "x" }] }));

    const { absorbKnowledge } = await import(`../lib/evolve.mjs?t=${Date.now()}`);
    const r = absorbKnowledge({});
    const written = r.created.map(c => resolve(ROOT, c.file));

    try {
      assert.equal(r.created.length, 2);
      assert.ok(r.created.every(c => c.file.startsWith("lib/learned/")));
      assert.ok(written.every(f => existsSync(f)), "every learned module should be written");
      const kinds = r.created.map(c => c.kind).sort();
      assert.deepEqual(kinds, ["knowledge", "playbook"]);

      // Idempotent: already-absorbed entries are not regenerated
      const r2 = absorbKnowledge({ absorbedKnowledge: r.absorbed });
      assert.equal(r2.created.length, 0);
    } finally {
      for (const f of written) { try { rmSync(f, { force: true }); } catch {} }
      rmSync(home, { recursive: true, force: true });
    }
  });
});
