export type EventHandler = (data: any) => void;
export declare class EventBus {
    private static instance;
    private handlers;
    private constructor();
    static getInstance(): EventBus;
    on(event: string, handler: EventHandler): void;
    off(event: string, handler: EventHandler): void;
    emit(event: string, data?: unknown): void;
    clear(): void;
}
//# sourceMappingURL=eventbus.d.ts.map