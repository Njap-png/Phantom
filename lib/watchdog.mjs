// Phantom — idle watchdog
// Distinguishes "working" from "hung". A timer is reset on every progress beat;
// it only fires when no beat arrives within `idleMs`. Long-but-active work never
// trips it — only a stall (idle/hang) does. Zero-dependency (Node builtins only).

export function createWatchdog({ idleMs = 120000, onIdle, label = "task", checkEveryMs = 5000 } = {}) {
  let timer = null;
  let stopped = false;
  let fired = false;
  let lastBeat = Date.now();
  let beats = 0;

  function clear() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function arm() {
    clear();
    if (stopped || fired) return;
    const delay = Math.max(10, Math.min(idleMs, checkEveryMs));
    timer = setTimeout(() => {
      timer = null;
      if (stopped || fired) return;
      const idleFor = Date.now() - lastBeat;
      if (idleFor >= idleMs) {
        fired = true;
        const err = Object.assign(new Error(`${label} idle for ${idleFor}ms`), { idleFor, beats });
        try { onIdle && onIdle(err); } catch {}
        return;
      }
      arm();
    }, delay);
    if (timer.unref) timer.unref();
  }

  arm();

  return {
    beat() { lastBeat = Date.now(); beats++; arm(); return this; },
    stop() { stopped = true; clear(); },
    get beats() { return beats; },
    get idleFor() { return Date.now() - lastBeat; },
    get fired() { return fired; },
    get stopped() { return stopped; },
  };
}
