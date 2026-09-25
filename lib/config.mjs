// Phantom — shared directory constants
// Zero-dep ESM. Imported by phantom.mjs and lib modules.
import { homedir } from "os";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Project root, derived from this module's own location (lib/ -> repo root).
// Never hardcode homedir()+"Phantom": the repo can be cloned anywhere, and a
// wrong root silently breaks self-update, the evolve gate and generated output.
export const PHANTOM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const BASE_DIR = resolve(homedir(), ".config", "phantom");
export const MEMORY_DIR = resolve(BASE_DIR, "memory");
export const KNOWLEDGE_DIR = resolve(BASE_DIR, "knowledge");
export const BOOKS_DIR = resolve(BASE_DIR, "books");
export const TOOLS_DIR = resolve(BASE_DIR, "tools");
export const REPORTS_DIR = resolve(BASE_DIR, "reports");
export const PLAYBOOKS_DIR = resolve(BASE_DIR, "playbooks");
export const HACKBOOK_DIR = resolve(BASE_DIR, "hackbook");
export const MISSIONS_DIR = resolve(BASE_DIR, "missions");
export const PHANTOM_VERSION = "0.2.0";
