import { AgentDebugger } from './AgentDebugger';

export * from './types';
export * from './AgentDebugger';

// Export a default debugger instance
export const defaultDebugger = new AgentDebugger();