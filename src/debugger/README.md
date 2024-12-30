# AI Agent Debugger for Solana 🔍

> A crucial debugging toolkit for Solana AI agents that provides real-time visibility, monitoring, and troubleshooting capabilities.

## Why This Matters 🎯

When AI agents interact with Solana protocols, things can go wrong in complex ways. This debugger solves critical problems:

### Problems Addressed:
* **Blind Spots**: Without debugging, you can't see why your AI agent made certain decisions
* **Error Mystery**: When transactions fail, you don't know what led to the failure
* **State Management**: No way to track or restore agent states during testing
* **Development Friction**: Difficult to test and improve AI agent behavior

### Solution:
The AI Agent Debugger provides:
* **Complete Visibility**: See every action your AI agent takes
* **Time Travel**: Create snapshots and restore states for testing
* **Error Insights**: Capture and analyze what went wrong
* **Easy Integration**: Works with any AI agent in the Solana ecosystem

## Real-World Example 🌟

Here's how it helps in practice:

```typescript
import { AgentDebugger } from 'solana-agent-kit';

// Create an AI trading agent with debugging
const tradingAgent = new TradingAgent();
const debugger = new AgentDebugger();
debugger.attachToAgent(tradingAgent);

async function executeSafeTrading() {
    // Save the current state
    debugger.createSnapshot('pre-trade');
    
    try {
        // Execute the trade
        await tradingAgent.executeTrade({
            tokenIn: 'SOL',
            tokenOut: 'USDC',
            amount: 1.0
        });
        
        // Review what happened
        const actions = debugger.getHistory();
        console.log('Trade sequence:', actions);
        
    } catch (error) {
        // Something went wrong - analyze it
        const errorEvents = debugger.getHistory()
            .filter(e => e.type === 'error');
        console.log('What went wrong:', errorEvents);
        
        // Restore to safe state
        debugger.restoreSnapshot('pre-trade');
    }
}
```

## 🚀 Features

* **Real-time Monitoring**: Track all AI agent actions as they happen
* **Event Logging**: Detailed history of all operations and their outcomes
* **State Snapshots**: Create and restore agent states for debugging
* **Error Tracking**: Comprehensive error capture and analysis
* **Type Safety**: Full TypeScript support with extensive type definitions

## How This Improves the Solana AI Agent Kit 🚀

This debugger enhances the toolkit by:
1. **Making Development Safer**: Test and verify AI agent behavior before deployment
2. **Reducing Debug Time**: Quickly identify and fix issues
3. **Improving Reliability**: Better understanding leads to more reliable agents
4. **Enabling Testing**: Create comprehensive test scenarios with state management
5. **Supporting Innovation**: Easier to experiment with new AI agent behaviors

## Integration with Existing Tools 🔧

Works seamlessly with:
- Jupiter Exchange operations
- NFT minting and management
- Token launches
- DeFi interactions
- All existing Solana AI Agent Kit features

## 📦 Installation

```bash
npm install solana-agent-kit
```

## 🛠️ Quick Start

Here's a simple example of how to use the debugger:

```typescript
import { AgentDebugger } from 'solana-agent-kit';

// Initialize debugger
const debugger = new AgentDebugger({
    enabled: true,
    logLevel: 'info',
    captureStackTrace: true
});

// Attach to your AI agent
debugger.attachToAgent(yourAgent);

// Monitor operations
try {
    // Create state snapshot
    const snapshot = debugger.createSnapshot('pre-operation');
    console.log(`Created snapshot: ${snapshot.id}`);
    
    // Execute agent operations
    await yourAgent.performOperation();
    
    // Check operation history
    const history = debugger.getHistory();
    console.log('Operation sequence:', history);
} catch (error) {
    // Analyze errors
    const errorEvents = debugger.getHistory()
        .filter(e => e.type === 'error');
    console.log('Error analysis:', errorEvents);
    
    // Restore to previous state
    debugger.restoreSnapshot('pre-operation');
}
```

## 📚 Key Components

### AgentDebugger Class

```typescript
class AgentDebugger {
    // Attach to an AI agent
    attachToAgent(agent: any): void;
    
    // Create state snapshot
    createSnapshot(description?: string): DebugSnapshot;
    
    // Get operation history
    getHistory(startTime?: number, endTime?: number): DebugEvent[];
    
    // Restore previous state
    restoreSnapshot(snapshotId: string): boolean;
}
```

### Event Types

```typescript
interface DebugEvent {
    type: 'action' | 'state' | 'error';
    data: any;
    timestamp: number;
}
```

### State Snapshots

```typescript
interface DebugSnapshot {
    id: string;
    timestamp: number;
    state: AgentState;
    description: string | undefined;
}
```

## 🔍 Advanced Usage

### Filtering Events

```typescript
// Get events from the last hour
const recentEvents = debugger.getHistory(
    Date.now() - 3600000,
    Date.now()
);

// Find error events
const errors = recentEvents.filter(e => e.type === 'error');
```

### State Management

```typescript
// Create checkpoints
debugger.createSnapshot('before-trade');
await agent.executeTrade();
debugger.createSnapshot('after-trade');

// Restore to specific checkpoint
debugger.restoreSnapshot('before-trade');
```

## 🧪 Testing

Run the test suite:

```bash
npm run test:jest
```

Expected output:
```
PASS  src/debugger/__tests__/AgentDebugger.test.ts
  AgentDebugger
    ✓ should attach to agent successfully
    ✓ should capture successful actions
    ✓ should capture action errors
    ✓ should create and restore snapshots
```

## 🙏 Acknowledgments

* Solana Foundation
* SendAI Team
* Contributors to the Solana AI Agent Kit
