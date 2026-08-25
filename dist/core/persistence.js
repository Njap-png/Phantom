import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
const BASE_DIR = resolve(homedir(), ".config", "phantom");
const MEMORY_DIR = resolve(BASE_DIR, "memory");
const KNOWLEDGE_DIR = resolve(BASE_DIR, "knowledge");
function ensureDirs() {
    if (!existsSync(MEMORY_DIR)) {
        mkdirSync(MEMORY_DIR, { recursive: true });
    }
    if (!existsSync(KNOWLEDGE_DIR)) {
        mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    }
}
export function saveMemory(agentId, memory) {
    try {
        ensureDirs();
        const filePath = resolve(MEMORY_DIR, `${agentId}.json`);
        writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
    }
    catch (e) {
        console.error(`Failed to save memory for agent ${agentId}: ${e.message}`);
    }
}
export function loadMemory(agentId) {
    try {
        ensureDirs();
        const filePath = resolve(MEMORY_DIR, `${agentId}.json`);
        if (!existsSync(filePath))
            return [];
        const raw = readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch (e) {
        console.error(`Failed to load memory for agent ${agentId}: ${e.message}`);
        return [];
    }
}
export function saveKnowledge(agentId, knowledge) {
    try {
        ensureDirs();
        const filePath = resolve(KNOWLEDGE_DIR, `${agentId}.txt`);
        writeFileSync(filePath, knowledge, "utf-8");
    }
    catch (e) {
        console.error(`Failed to save knowledge for agent ${agentId}: ${e.message}`);
    }
}
export function loadKnowledge(agentId) {
    try {
        ensureDirs();
        const filePath = resolve(KNOWLEDGE_DIR, `${agentId}.txt`);
        if (!existsSync(filePath))
            return "";
        return readFileSync(filePath, "utf-8");
    }
    catch (e) {
        console.error(`Failed to load knowledge for agent ${agentId}: ${e.message}`);
        return "";
    }
}
//# sourceMappingURL=persistence.js.map