// Phantom — idle watchdog tests
// The watchdog must fire only on a stall (no beats), never while work is progressing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWatchdog } from "../lib/watchdog.mjs";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

describe("idle watchdog", () => {
  it("fires onIdle after the idle threshold with no beats", async () => {
    let fired = null;
    const wd = createWatchdog({ idleMs: 80, checkEveryMs: 20, label: "test", onIdle: (e) => { fired = e; } });
    await sleep(220);
    wd.stop();
    assert.ok(fired, "watchdog should have fired");
    assert.match(fired.message, /idle for/);
  });

  it("does not fire while progress beats continue (long but active)", async () => {
    let fired = false;
    const wd = createWatchdog({ idleMs: 120, checkEveryMs: 20, onIdle: () => { fired = true; } });
    for (let i = 0; i < 12; i++) { wd.beat(); await sleep(40); }
    wd.stop();
    assert.equal(fired, false, "watchdog must not fire during active work");
    assert.ok(wd.beats >= 12);
  });

  it("stop() prevents a pending idle from firing", async () => {
    let fired = false;
    const wd = createWatchdog({ idleMs: 60, checkEveryMs: 20, onIdle: () => { fired = true; } });
    wd.stop();
    await sleep(160);
    assert.equal(fired, false);
  });

  it("beat() resets the idle timer", async () => {
    let fired = false;
    const wd = createWatchdog({ idleMs: 120, checkEveryMs: 20, onIdle: () => { fired = true; } });
    await sleep(80);
    assert.ok(wd.idleFor >= 80);
    wd.beat();
    assert.ok(wd.idleFor < 40);
    await sleep(60);
    wd.stop();
    assert.equal(fired, false);
  });
});
