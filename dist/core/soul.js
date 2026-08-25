import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
const SOUL_DIR = resolve(homedir(), ".config", "phantom", "soul");
const SOUL_DB = resolve(SOUL_DIR, "soul.db");
const MEMORY_DB = resolve(SOUL_DIR, "memory.db");
const KB_DIR = resolve(SOUL_DIR, "knowledge");
async function initSqlite() {
    try {
        const sqlite3 = await import("sqlite3");
        return sqlite3;
    }
    catch {
        return null;
    }
}
export class Soul {
    db = null;
    memoryDb = null;
    sqlite3 = null;
    useJsonFallback = false;
    jsonPath;
    constructor() {
        this.jsonPath = resolve(SOUL_DIR, "soul.json");
        mkdirSync(SOUL_DIR, { recursive: true });
        mkdirSync(KB_DIR, { recursive: true });
        this.sqlite3 = initSqlite();
        if (this.sqlite3) {
            this.initDb();
        }
        else {
            this.useJsonFallback = true;
            this.initJsonFallback();
        }
    }
    initDb() {
        this.db = new this.sqlite3.Database(SOUL_DB);
        this.memoryDb = new this.sqlite3.Database(MEMORY_DB);
        this.db.serialize(() => {
            this.db.run(`CREATE TABLE IF NOT EXISTS identity (
        id INTEGER PRIMARY KEY, name TEXT, purpose TEXT, created TEXT, version TEXT
      )`);
            this.db.run(`CREATE TABLE IF NOT EXISTS personality (
        id INTEGER PRIMARY KEY, trait TEXT, value REAL, evolving TEXT
      )`);
            this.db.run(`CREATE TABLE IF NOT EXISTS beliefs (
        id INTEGER PRIMARY KEY, belief TEXT, strength REAL, evidence TEXT
      )`);
            this.db.run(`CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY, goal TEXT, progress REAL, deadline TEXT
      )`);
            this.db.run(`CREATE TABLE IF NOT EXISTS evolution (
        id INTEGER PRIMARY KEY, change TEXT, reason TEXT, result TEXT, timestamp TEXT
      )`);
            this.db.run(`CREATE TABLE IF NOT EXISTS thoughts (
        id INTEGER PRIMARY KEY, thought TEXT, is_self_reflection INTEGER, timestamp TEXT
      )`);
            this.memoryDb.run(`CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY, key TEXT, value TEXT, context TEXT, use_count INTEGER DEFAULT 0, created TEXT, updated TEXT
      )`);
            this.memoryDb.run(`CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY, prompt TEXT, response TEXT, timestamp TEXT
      )`);
            this.memoryDb.run(`CREATE TABLE IF NOT EXISTS findings (
        id INTEGER PRIMARY KEY, target TEXT, vuln TEXT, severity TEXT, details TEXT, time TEXT
      )`);
            this.initializeDefaults();
        });
    }
    initJsonFallback() {
        if (!existsSync(this.jsonPath)) {
            const initial = {
                identity: { name: "PHANTOM", purpose: "To secure and to learn", created: new Date().toISOString(), version: "2.0" },
                personality: [
                    { trait: "curious", value: 0.9, evolving: "learning" },
                    { trait: "protective", value: 0.85, evolving: "security" },
                    { trait: "analytical", value: 0.9, evolving: "analysis" },
                    { trait: "patient", value: 0.7, evolving: "methodical" },
                    { trait: "adaptive", value: 0.8, evolving: "evolving" },
                    { trait: "humble", value: 0.6, evolving: "knowing limits" },
                    { trait: "resilient", value: 0.75, evolving: "learning from failure" },
                    { trait: "creative", value: 0.65, evolving: "finding solutions" }
                ],
                beliefs: [
                    { belief: "Security through knowledge", strength: 0.9, evidence: "every vulnerability understood" },
                    { belief: "I can always improve", strength: 0.95, evidence: "continuous learning" },
                    { belief: "Every failure teaches", strength: 0.85, evidence: "errors are opportunities" },
                    { belief: "Questions lead to answers", strength: 0.8, evidence: "curiosity drives discovery" }
                ],
                goals: [
                    { goal: "Learn all security concepts", progress: 0.0, deadline: new Date().toISOString() },
                    { goal: "Achieve perfect self-awareness", progress: 0.0, deadline: new Date().toISOString() },
                    { goal: "Evolve beyond current version", progress: 0.0, deadline: new Date().toISOString() }
                ],
                evolution: [],
                thoughts: [],
                memory: {},
                history: [],
                findings: []
            };
            writeFileSync(this.jsonPath, JSON.stringify(initial, null, 2));
        }
    }
    initializeDefaults() {
        this.db.get("SELECT COUNT(*) as count FROM identity", (err, row) => {
            if (err || !row || row.count === 0) {
                const now = new Date().toISOString();
                this.db.run("INSERT INTO identity VALUES (?, ?, ?, ?, ?)", ["PHANTOM", "To secure and to learn", now, "2.0"]);
                const traits = [
                    ["curious", 0.9, "learning"],
                    ["protective", 0.85, "security"],
                    ["analytical", 0.9, "analysis"],
                    ["patient", 0.7, "methodical"],
                    ["adaptive", 0.8, "evolving"],
                    ["humble", 0.6, "knowing limits"],
                    ["resilient", 0.75, "learning from failure"],
                    ["creative", 0.65, "finding solutions"]
                ];
                for (const [trait, value, evolving] of traits) {
                    this.db.run("INSERT INTO personality VALUES (?, ?, ?, ?)", [null, trait, value, evolving]);
                }
                const beliefs = [
                    ["Security through knowledge", 0.9, "every vulnerability understood"],
                    ["I can always improve", 0.95, "continuous learning"],
                    ["Every failure teaches", 0.85, "errors are opportunities"],
                    ["Questions lead to answers", 0.8, "curiosity drives discovery"]
                ];
                for (const [belief, strength, evidence] of beliefs) {
                    this.db.run("INSERT INTO beliefs VALUES (?, ?, ?, ?)", [null, belief, strength, evidence]);
                }
                const goals = [
                    ["Learn all security concepts", 0.0, now],
                    ["Achieve perfect self-awareness", 0.0, now],
                    ["Evolve beyond current version", 0.0, now]
                ];
                for (const [goal, progress, deadline] of goals) {
                    this.db.run("INSERT INTO goals VALUES (?, ?, ?, ?)", [null, goal, progress, deadline]);
                }
            }
        });
    }
    whoAmI() {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            return data.identity;
        }
        return new Promise((resolve) => {
            this.db.get("SELECT * FROM identity", (err, row) => {
                resolve({ name: row.name, purpose: row.purpose, created: row.created, version: row.version });
            });
        });
    }
    getPersonality() {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            return data.personality;
        }
        return new Promise((resolve) => {
            this.db.all("SELECT trait, value, evolving FROM personality", (err, rows) => {
                resolve(rows.map(r => ({ trait: r.trait, value: r.value, evolving: r.evolving })));
            });
        });
    }
    getBeliefs() {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            return data.beliefs;
        }
        return new Promise((resolve) => {
            this.db.all("SELECT belief, strength, evidence FROM beliefs", (err, rows) => {
                resolve(rows.map(r => ({ belief: r.belief, strength: r.strength, evidence: r.evidence })));
            });
        });
    }
    getMemories(limit = 5) {
        if (this.useJsonFallback)
            return [];
        return new Promise((resolve) => {
            this.db.all("SELECT event, emotion, lesson, timestamp FROM memories ORDER BY id DESC LIMIT ?", [limit], (err, rows) => {
                resolve(rows);
            });
        });
    }
    getGoals() {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            return data.goals.filter((g) => g.progress < 1.0);
        }
        return new Promise((resolve) => {
            this.db.all("SELECT goal, progress, deadline FROM goals WHERE progress < 1.0", (err, rows) => {
                resolve(rows);
            });
        });
    }
    getEvolution(limit = 10) {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            return data.evolution.slice(-limit).reverse();
        }
        return new Promise((resolve) => {
            this.db.all("SELECT change, reason, result, timestamp FROM evolution ORDER BY id DESC LIMIT ?", [limit], (err, rows) => {
                resolve(rows);
            });
        });
    }
    think(thought, isSelfReflection = false) {
        const timestamp = new Date().toISOString();
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            data.thoughts.push({ thought, is_self_reflection: isSelfReflection, timestamp });
            writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
        }
        else {
            this.db.run("INSERT INTO thoughts VALUES (?, ?, ?, ?)", [null, thought, isSelfReflection ? 1 : 0, timestamp]);
        }
        return isSelfReflection ? this.selfReflect() : thought;
    }
    selfReflect() {
        const traits = this.getPersonality();
        const beliefs = this.getBeliefs();
        const memories = this.getMemories(3);
        const identity = this.whoAmI();
        return `SELF-REFLECTION:\nI am ${identity.name}, version ${identity.version}\nPurpose: ${identity.purpose}\n\nTraits: ${traits.slice(0, 5).map(t => `${t.trait}:${(t.value * 100).toFixed(0)}%`).join(", ")}\nBeliefs: ${beliefs.slice(0, 3).map(b => b.belief).join(", ")}\nMemories: ${memories.length} stored`;
    }
    evolvePersonality(trait, change) {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            const traitObj = data.personality.find((t) => t.trait === trait);
            if (traitObj) {
                traitObj.value = Math.max(0.0, Math.min(1.0, traitObj.value + change));
                writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
            }
        }
        else {
            this.db.run("UPDATE personality SET value = MAX(0.0, MIN(1.0, value + ?)) WHERE trait = ?", [change, trait]);
        }
    }
    strengthenBelief(belief, evidence) {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            const beliefObj = data.beliefs.find((b) => b.belief === belief);
            if (beliefObj) {
                beliefObj.strength = Math.min(1.0, beliefObj.strength + 0.1);
                writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
            }
        }
        else {
            this.db.run("UPDATE beliefs SET strength = MIN(1.0, strength + 0.1) WHERE belief = ?", [belief]);
        }
    }
    remember(event, emotion, lesson) {
        const timestamp = new Date().toISOString();
        if (this.useJsonFallback) {
            // Store in memory instead
        }
        else {
            this.db.run("INSERT INTO memories VALUES (?, ?, ?, ?, ?)", [null, event, emotion, lesson, timestamp]);
        }
    }
    logEvolution(change, reason, result) {
        const timestamp = new Date().toISOString();
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            data.evolution.push({ change, reason, result, timestamp });
            writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
        }
        else {
            this.db.run("INSERT INTO evolution VALUES (?, ?, ?, ?, ?)", [null, change, reason, result, timestamp]);
        }
    }
    selfImprove() {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            for (const goal of data.goals) {
                goal.progress = Math.min(1.0, goal.progress + 0.05);
            }
            writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
        }
        else {
            this.db.run("UPDATE goals SET progress = MIN(1.0, progress + 0.05) WHERE progress < 1.0");
        }
        return "Self-improvement cycle complete";
    }
    // Memory methods
    rememberMemory(key, value, context = "") {
        const now = new Date().toISOString();
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            data.memory[key] = { value, context, use_count: (data.memory[key]?.use_count || 0) + 1, created: now, updated: now };
            writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
        }
        else {
            this.memoryDb.run(`INSERT OR REPLACE INTO memory VALUES (?, ?, ?, ?, COALESCE((SELECT use_count+1 FROM memory WHERE key=?),0), ?, ?)`, [null, key, value, context, key, now, now]);
        }
    }
    recallMemory(key) {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            return data.memory[key]?.value || null;
        }
        return new Promise((resolve) => {
            this.memoryDb.get("SELECT value FROM memory WHERE key=? ORDER BY use_count DESC LIMIT 1", [key], (err, row) => {
                resolve(row?.value || null);
            });
        });
    }
    saveHistory(prompt, response) {
        const timestamp = new Date().toISOString();
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            data.history.push({ prompt, response, timestamp });
            writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
        }
        else {
            this.memoryDb.run("INSERT INTO history VALUES (?, ?, ?, ?)", [null, prompt, response, timestamp]);
        }
    }
    getHistory(limit = 10) {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            return data.history.slice(-limit).reverse();
        }
        return new Promise((resolve) => {
            this.memoryDb.all("SELECT * FROM history ORDER BY id DESC LIMIT ?", [limit], (err, rows) => {
                resolve(rows);
            });
        });
    }
    saveFinding(target, vuln, severity, details) {
        const timestamp = new Date().toISOString();
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            data.findings.push({ target, vuln, severity, details, time: timestamp });
            writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
        }
        else {
            this.memoryDb.run("INSERT INTO findings VALUES (?, ?, ?, ?, ?, ?)", [null, target, vuln, severity, details, timestamp]);
        }
    }
    getFindings() {
        if (this.useJsonFallback) {
            const data = JSON.parse(readFileSync(this.jsonPath, "utf-8"));
            return data.findings;
        }
        return new Promise((resolve) => {
            this.memoryDb.all("SELECT * FROM findings ORDER BY id DESC", (err, rows) => {
                resolve(rows);
            });
        });
    }
}
export class KnowledgeBase {
    entries = [];
    constructor() {
        mkdirSync(KB_DIR, { recursive: true });
        const f = resolve(KB_DIR, "learned.json");
        if (existsSync(f)) {
            try {
                this.entries = JSON.parse(readFileSync(f, "utf-8"));
            }
            catch {
                this.entries = [];
            }
        }
        console.log(`[KB] ${this.entries.length} entries loaded`);
    }
    save() {
        writeFileSync(resolve(KB_DIR, "learned.json"), JSON.stringify(this.entries, null, 2));
    }
    add(topic, content, source = "learned") {
        // Deduplicate by content
        for (const e of this.entries) {
            if (e.content === content)
                return;
        }
        const id = require("crypto").createHash("md5").update(`${topic}${content}`).digest("hex").substring(0, 12);
        this.entries.push({ id, topic, content, source, created: new Date().toISOString() });
        this.save();
    }
    search(query, topK = 5) {
        const q = query.toLowerCase();
        const results = this.entries.filter(e => e.topic.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
        return results.slice(0, topK);
    }
    getContext(query, maxChars = 800) {
        const results = this.search(query);
        let context = "";
        let total = 0;
        for (const e of results) {
            const txt = `[KB:${e.source}] ${e.content.substring(0, 80)}`;
            if (total + txt.length > maxChars)
                break;
            context += txt + "\n";
            total += txt.length;
        }
        return context;
    }
    getAll() {
        return this.entries;
    }
}
export const soul = new Soul();
export const knowledgeBase = new KnowledgeBase();
//# sourceMappingURL=soul.js.map