// Phantom — shared directory constants
// Zero-dep ESM. Imported by phantom.mjs and lib modules.
import { homedir } from "os";
import { resolve } from "path";

export const BASE_DIR = resolve(homedir(), ".config", "phantom");
export const MEMORY_DIR = resolve(BASE_DIR, "memory");
export const KNOWLEDGE_DIR = resolve(BASE_DIR, "knowledge");
export const TOOLS_DIR = resolve(BASE_DIR, "tools");
export const REPORTS_DIR = resolve(BASE_DIR, "reports");
export const PLAYBOOKS_DIR = resolve(BASE_DIR, "playbooks");
export const PHANTOM_VERSION = "3.0.0";
