import { AgentDebugger } from '../AgentDebugger';

describe('AgentDebugger', () => {
    let debuggerInstance: AgentDebugger;
    let mockAgent: any;

    beforeEach(() => {
        debuggerInstance = new AgentDebugger();
        mockAgent = {
            someAction: async () => 'result',
            failingAction: async () => {
                throw new Error('Test error');
            }
        };
        debuggerInstance.attachToAgent(mockAgent);
    });

    it('should attach to agent successfully', () => {
        expect(mockAgent.someAction).toBeDefined();
    });

    it('should capture successful actions', async () => {
        await mockAgent.someAction();
        const history = debuggerInstance.getHistory();
        expect(history.length).toBeGreaterThan(0);
        expect(history[0].type).toBe('action');
    });

    it('should capture action errors', async () => {
        try {
            await mockAgent.failingAction();
        } catch (error) {
            // Expected error
        }
        const history = debuggerInstance.getHistory();
        const errorEvents = history.filter(e => e.type === 'error');
        expect(errorEvents.length).toBe(1);
    });

    it('should create and restore snapshots', () => {
        const snapshot = debuggerInstance.createSnapshot('Test snapshot');
        expect(snapshot).toBeDefined();
        expect(snapshot.description).toBe('Test snapshot');

        const restored = debuggerInstance.restoreSnapshot(snapshot.id);
        expect(restored).toBe(true);
    });
});