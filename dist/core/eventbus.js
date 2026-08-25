export class EventBus {
    static instance;
    handlers = new Map();
    constructor() { }
    static getInstance() {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event).push(handler);
    }
    off(event, handler) {
        const handlers = this.handlers.get(event);
        if (handlers) {
            this.handlers.set(event, handlers.filter((h) => h !== handler));
        }
    }
    emit(event, data) {
        this.handlers.get(event)?.forEach((handler) => handler(data));
    }
    clear() {
        this.handlers.clear();
    }
}
//# sourceMappingURL=eventbus.js.map