export interface HackerTool {
    description: string;
    execute: (input: string) => Promise<string>;
}
export declare const hackerTools: Record<string, HackerTool>;
//# sourceMappingURL=hacker-tools.d.ts.map