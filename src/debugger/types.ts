export interface DebuggerConfig {
    enabled: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    captureStackTrace: boolean;
}

export interface AgentAction {
    id: string;
    type: string;
    timestamp: number;
    data: any;
    status: 'pending' | 'success' | 'error';
    duration?: number;
    error?: Error;
}

export interface AgentState {
    actions: AgentAction[];
    currentStatus: 'idle' | 'processing' | 'error';
    lastAction?: AgentAction;
    memory: Record<string, any>;
}

export interface DebugSnapshot {
    id: string;
    timestamp: number;
    state: AgentState;
    description: string | undefined;
}

export interface DebugEvent {
    type: 'action' | 'state' | 'error';
    data: any;
    timestamp: number;
}