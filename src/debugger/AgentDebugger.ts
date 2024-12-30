import { EventEmitter } from 'events';
import { DebuggerConfig, AgentAction, AgentState, DebugSnapshot, DebugEvent } from './types';

export class AgentDebugger extends EventEmitter {
    private state: AgentState;
    private config: DebuggerConfig;
    private snapshots: Map<string, DebugSnapshot>;
    private eventLog: DebugEvent[];

    constructor(config: Partial<DebuggerConfig> = {}) {
        super();
        this.config = {
            enabled: true,
            logLevel: 'info',
            captureStackTrace: true,
            ...config
        };

        this.state = {
            actions: [],
            currentStatus: 'idle',
            memory: {}
        };

        this.snapshots = new Map();
        this.eventLog = [];
    }

    public attachToAgent(agent: any): void {
        if (!this.config.enabled) return;

        for (const methodName of Object.keys(agent)) {
            if (typeof agent[methodName] === 'function') {
                const originalMethod = agent[methodName];
                agent[methodName] = async (...args: any[]) => {
                    try {
                        // Log start of action
                        const startEvent: DebugEvent = {
                            type: 'action',
                            data: { methodName, args },
                            timestamp: Date.now()
                        };
                        this.eventLog.push(startEvent);

                        // Execute original method
                        const result = await originalMethod.apply(agent, args);

                        // Log successful completion
                        const successEvent: DebugEvent = {
                            type: 'state',
                            data: { methodName, result },
                            timestamp: Date.now()
                        };
                        this.eventLog.push(successEvent);

                        return result;
                    } catch (error) {
                        // Log error
                        const errorEvent: DebugEvent = {
                            type: 'error',
                            data: { methodName, error },
                            timestamp: Date.now()
                        };
                        this.eventLog.push(errorEvent);
                        throw error;
                    }
                };
            }
        }
    }

    public createSnapshot(description?: string): DebugSnapshot {
        const snapshot: DebugSnapshot = {
            id: this.generateEventId(),
            timestamp: Date.now(),
            state: { ...this.state },
            description: description || undefined
        };

        this.snapshots.set(snapshot.id, snapshot);
        return snapshot;
    }

    public getHistory(startTime?: number, endTime?: number): DebugEvent[] {
        return this.eventLog.filter(event => {
            if (startTime && event.timestamp < startTime) return false;
            if (endTime && event.timestamp > endTime) return false;
            return true;
        });
    }

    public restoreSnapshot(snapshotId: string): boolean {
        const snapshot = this.snapshots.get(snapshotId);
        if (!snapshot) return false;

        this.state = { ...snapshot.state };
        return true;
    }

    private generateEventId(): string {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}