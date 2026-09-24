// Phantom — Secret Vault
// Tokens live in a hidden random-named dir inside ~/.config/phantom, pointed to
// by a stable pointer file (~/.config/phantom/.vault). Phantom can relocate the
// vault at any time but always knows where it is via the pointer + memory record.
// Zero-dependency (Node builtins only).

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, rmSync, renameSync, readdirSync } from "fs";
import { randomBytes } from "crypto";
import { homedir } from "os";
import { join, resolve } from "path";

const BASE = resolve(homedir(), ".config", "phantom");
const POINTER = join(BASE, ".vault");
const GRAPH = join(BASE, "memory", "graph.json");

function readPointer() {
  try { return JSON.parse(readFileSync(POINTER, "utf-8")); } catch { return null; }
}

function writePointer(data) {
  mkdirSync(BASE, { recursive: true, mode: 0o700 });
  try { chmodSync(BASE, 0o700); } catch {}
  const tmp = POINTER + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, POINTER);
  try { chmodSync(POINTER, 0o600); } catch {}
}

function secretsPath(dirname) {
  return join(BASE, dirname, "secrets.json");
}

function readSecrets(dirname) {
  try {
    const f = secretsPath(dirname);
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf-8"));
  } catch { return {}; }
}

function writeSecrets(dirname, data) {
  const d = join(BASE, dirname);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  try { chmodSync(d, 0o700); } catch {}
  const f = secretsPath(dirname);
  const tmp = f + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, f);
  try { chmodSync(f, 0o600); } catch {}
}

function remember(location, moves, updated) {
  try {
    let g = {};
    try { g = JSON.parse(readFileSync(GRAPH, "utf-8")); } catch {}
    g.vault = { location, moves, updated };
    mkdirSync(join(BASE, "memory"), { recursive: true, mode: 0o700 });
    writeFileSync(GRAPH + ".tmp", JSON.stringify(g, null, 2), { mode: 0o600 });
    renameSync(GRAPH + ".tmp", GRAPH);
  } catch {}
}

export function newDirName() {
  return "v_" + randomBytes(4).toString("hex");
}

// Make sure a vault exists; create one if missing. Returns pointer.
export function ensure() {
  const ptr = readPointer();
  if (ptr && ptr.vault && existsSync(secretsPath(ptr.vault))) return ptr;
  const dirname = newDirName();
  writeSecrets(dirname, {});
  const next = { vault: dirname, updated: new Date().toISOString(), moves: (ptr?.moves || 0) + (ptr ? 1 : 0) };
  writePointer(next);
  remember(join(BASE, dirname, "secrets.json"), next.moves, next.updated);
  return next;
}

// Always yields the current vault dir name (creating it if needed).
export function where() {
  return ensure().vault;
}

// Relocate the vault to a fresh random location; pointer flips only after the
// new copy is written, so a crash mid-move never loses the secrets.
export function relocate() {
  const old = ensure();
  const secrets = readSecrets(old.vault);
  let dirname = newDirName();
  let guard = 0;
  while (dirname === old.vault && guard++ < 5) dirname = newDirName();
  writeSecrets(dirname, secrets);
  const next = { vault: dirname, updated: new Date().toISOString(), moves: (old.moves || 0) + 1 };
  writePointer(next);
  remember(join(BASE, dirname, "secrets.json"), next.moves, next.updated);
  try { rmSync(join(BASE, old.vault), { recursive: true, force: true }); } catch {}
  return next;
}

export function get(k) {
  const p = ensure();
  return readSecrets(p.vault)[k];
}

export function set(k, v) {
  const p = ensure();
  const s = readSecrets(p.vault);
  s[k] = v;
  writeSecrets(p.vault, s);
  return true;
}

export function remove(k) {
  const p = ensure();
  const s = readSecrets(p.vault);
  const had = k in s;
  delete s[k];
  writeSecrets(p.vault, s);
  return had;
}

export function keys() {
  const p = ensure();
  return Object.keys(readSecrets(p.vault));
}

export function all() {
  const p = ensure();
  return readSecrets(p.vault);
}

export function status() {
  const p = ensure();
  const names = Object.keys(readSecrets(p.vault));
  const loc = join(BASE, p.vault, "secrets.json");
  remember(loc, p.moves || 0, p.updated);
  return { base: BASE, pointer: POINTER, location: loc, moves: p.moves || 0, updated: p.updated, keys: names };
}

// Recovers the vault (and its location) from the base dir if the pointer is
// ever lost, by scanning for v_* dirs.
export function recoverHint() {
  try {
    return readdirSync(BASE).filter(d => d.startsWith("v_") && existsSync(secretsPath(d)));
  } catch { return []; }
}