export interface SoulIdentity {
    name: string;
    purpose: string;
    created: string;
    version: string;
}
export interface PersonalityTrait {
    trait: string;
    value: number;
    evolving: string;
}
export interface Belief {
    belief: string;
    strength: number;
    evidence: string;
}
export interface Memory {
    event: string;
    emotion: string;
    lesson: string;
    timestamp: string;
}
export interface Goal {
    goal: string;
    progress: number;
    deadline: string;
}
export interface Evolution {
    change: string;
    reason: string;
    result: string;
    timestamp: string;
}
export interface KnowledgeEntry {
    id: string;
    topic: string;
    content: string;
    source: string;
    created: string;
}
export declare class Soul {
    private db;
    private memoryDb;
    private sqlite3;
    private useJsonFallback;
    private jsonPath;
    constructor();
    private initDb;
    private initJsonFallback;
    private initializeDefaults;
    whoAmI(): SoulIdentity;
    getPersonality(): PersonalityTrait[];
    getBeliefs(): Belief[];
    getMemories(limit?: number): Memory[];
    getGoals(): Goal[];
    getEvolution(limit?: number): Evolution[];
    think(thought: string, isSelfReflection?: boolean): string;
    selfReflect(): string;
    evolvePersonality(trait: string, change: number): void;
    strengthenBelief(belief: string, evidence: string): void;
    remember(event: string, emotion: string, lesson: string): void;
    logEvolution(change: string, reason: string, result: string): void;
    selfImprove(): string;
    rememberMemory(key: string, value: string, context?: string): void;
    recallMemory(key: string): string | null;
    saveHistory(prompt: string, response: string): void;
    getHistory(limit?: number): any[];
    saveFinding(target: string, vuln: string, severity: string, details: string): void;
    getFindings(): any[];
}
export declare class KnowledgeBase {
    private entries;
    constructor();
    private save;
    add(topic: string, content: string, source?: string): void;
    search(query: string, topK?: number): KnowledgeEntry[];
    getContext(query: string, maxChars?: number): string;
    getAll(): KnowledgeEntry[];
}
export declare const soul: Soul;
export declare const knowledgeBase: KnowledgeBase;
//# sourceMappingURL=soul.d.ts.map