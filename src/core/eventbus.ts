// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventHandler = (data: any) => void;

export class EventBus {
  private static instance: EventBus;
  private handlers: Map<string, EventHandler[]> = new Map();

  private constructor() {}

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      this.handlers.set(
        event,
        handlers.filter((h) => h !== handler)
      );
    }
  }

  emit(event: string, data?: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(data));
  }

  clear(): void {
    this.handlers.clear();
  }
}
