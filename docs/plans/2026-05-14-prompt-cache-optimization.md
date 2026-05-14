# Prompt Cache Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Significantly improve Anthropic prompt cache hit rate by restructuring system prompt, stabilizing tool schemas, and adding cache monitoring.

**Architecture:** The current system sends a monolithic system prompt (mixing stable identity/rules with dynamic memory/skills) to the LLM, causing frequent cache invalidation. We split it into stable/dynamic parts, sort tools deterministically, cache tool schemas session-wide, set sessionId for provider-side affinity, and add cache break monitoring.

**Tech Stack:** TypeScript, pi-ai v0.74.0, Anthropic Messages API

**Root Cause:** pi-ai Anthropic provider places `cache_control: {type: "ephemeral"}` on the single system prompt block. Since `buildSystemPrompt()` in agent-adapter.ts concatenates ALL content (identity + memory snapshot + skill prompt + task rules + workdir) into one string, any change to ANY part invalidates the ENTIRE system prompt cache.

---

## Phase 1: Split System Prompt into Stable + Dynamic Parts (P0)

**Goal:** Move frequently-changing content (memory snapshot, skill prompt, upstream results) OUT of system prompt into pre-pended user messages, so the system prompt becomes stable and cacheable across turns.

### Task 1.1: Refactor buildSystemPrompt() — extract stable parts

**Files:**
- Modify: `src/core/agent-runtime/agent-adapter.ts:548-689`

**Step 1: Understand current code**

Read `buildSystemPrompt()` in agent-adapter.ts (lines 548-689). It currently builds 9 sections in order:
1. Identity + capabilities (stable)
2. Memory snapshot (dynamic — per session freeze, but same within a session)
3. Memory management rules (stable — conditionally included based on tool registration)
4. Skill prompt (dynamic — loaded at session start)
5. Task management rules (stable)
6. Parallel execution rules (stable)
7. AskUserQuestion rules (stable)
8. Upstream results (dynamic — per-call)
9. Workdir (stable-ish — per project)

**Step 2: Split into two methods**

Replace `buildSystemPrompt()` with two methods:

```typescript
// Stable parts only — returned as system prompt string
private buildStableSystemPrompt(request: AgentExecuteRequest): string {
  const parts: string[] = [
    `你是 ${this.displayName}，一个专业的 AI 助手。`,
    `你的能力包括：${this.capabilities.map((c) => c.name).join('、')}。`,
  ];

  const hasTaskManage = this.toolRegistrations.some((t) => t.id === 'TaskManage');
  const hasMemory = this.toolRegistrations.some((t) => t.id === 'Memory');
  const hasSkill = this.toolRegistrations.some((t) => t.id === 'Skill');
  const hasSpawnSubAgents = this.toolRegistrations.some((t) => t.id === 'SpawnSubAgents');
  const hasAskUserQuestion = this.toolRegistrations.some((t) => t.id === 'AskUserQuestion');

  // Memory management rules (not the snapshot itself)
  if (hasMemory) {
    parts.push('', '## 记忆管理规范', '', '...'); // content from current lines 576-594
  }

  // Task management rules
  if (hasTaskManage) {
    parts.push('', '## 任务管理规范（最高优先级）', '', '...');
    if (hasSpawnSubAgents) {
      parts.push('', '## 并行执行规范', '', '...');
    }
  }

  // AskUserQuestion rules
  if (hasAskUserQuestion) {
    parts.push('', '## 交互式提问规范', '', '...');
  }

  // Workdir (stable within a session for the same project)
  if (request.workdir) {
    parts.push('', `## 工作目录\n${request.workdir}`);
  }

  return parts.join('\n');
}

// Dynamic parts only — returned as context messages to prepend
private buildDynamicContextMessages(request: AgentExecuteRequest): AgentMessage[] {
  const messages: AgentMessage[] = [];
  const parts: string[] = [];

  const hasMemory = this.toolRegistrations.some((t) => t.id === 'Memory');
  const hasSkill = this.toolRegistrations.some((t) => t.id === 'Skill');

  // Memory snapshot
  if (hasMemory && this.memorySnapshot) {
    parts.push('## 持久化记忆（快照）', '', this.memorySnapshot);
  }

  // Skill prompt
  if (hasSkill && this.skillPrompt) {
    parts.push('', this.skillPrompt);
  }

  // Upstream results
  if (request.upstreamResults?.length) {
    parts.push(
      '', '## 上游任务结果',
      ...request.upstreamResults.map((r, i) => `[上游任务 ${i + 1}] ${JSON.stringify(r.output)}`)
    );
  }

  if (parts.length > 0) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: parts.join('\n') }],
      timestamp: Date.now(),
    });
  }

  return messages;
}
```

**Key design decision:** The dynamic context is injected as a single `user` message prepended BEFORE the actual user request. This means:
- System prompt becomes STABLE → `cache_control` on system block hits
- Dynamic content message is part of `messages` array, after system prompt
- Within a session, dynamic content is the same → subsequent turns reuse it from KV cache

**Step 3: Update execute() to use both**

Modify `execute()` (around line 229-331):

```typescript
// BEFORE:
this.inner.state.systemPrompt = this.buildSystemPrompt(request);
// ...
await this.inner.prompt(request.taskDescription);

// AFTER:
this.inner.state.systemPrompt = this.buildStableSystemPrompt(request);
// ...
const dynamicMessages = this.buildDynamicContextMessages(request);
const promptMessages: AgentMessage[] = [
  ...dynamicMessages,
  { role: 'user', content: [{ type: 'text', text: request.taskDescription }], timestamp: Date.now() },
];
await this.inner.prompt(promptMessages);
```

**Step 4: Run tests to verify**

Run: `pnpm run test -- --run src/__tests__/core/agent-runtime/`
Expected: All existing tests pass (behavior should be identical since dynamic content is still sent to LLM, just in a different position)

### Task 1.2: Handle systemPromptOverride for sub-agents

**Files:**
- Verify: `src/core/agent-runtime/agent-adapter.ts:548-557`

The current `systemPromptOverride` path (lines 549-557) appends workdir directly. This path is used by sub-agents. We need to ensure sub-agents also benefit from the split.

Check the sub-agent factory (`src/core/sub-agent/sub-agent-factory.ts`) and agent-team factory (`src/core/agent-team/agent-factory.ts`) to confirm they use `systemPromptOverride` or build their own system prompt.

**Step 1: Check sub-agent system prompt path**

Read `sub-agent-factory.ts:buildSubAgentSystemPrompt()` and `agent-factory.ts:buildSystemPrompt()` to ensure they also separate stable/dynamic content.

**Step 2: Apply same split if needed**

If sub-agents build their own system prompt with dynamic content mixed in, apply the same stable/dynamic split pattern.

---

## Phase 2: Sort Tools Alphabetically (P1)

**Goal:** Ensure deterministic tool ordering across calls so tool definitions produce identical byte sequences for cache matching.

### Task 2.1: Sort tools in toAgentTools()

**Files:**
- Modify: `src/core/agent-runtime/tool-bridge.ts:109-111`

**Step 1: Modify toAgentTools to sort by name**

```typescript
export function toAgentTools(registrations: ToolRegistration[]): AgentTool[] {
  return registrations
    .map(toAgentTool)
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

This mirrors OpenCode's approach (`llm.ts` line 228):
```typescript
const sortedTools = Object.fromEntries(
  Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b))
)
```

**Step 2: Run tests to verify**

Run: `pnpm run test -- --run src/__tests__/core/agent-runtime/tool-bridge.test.ts`
Expected: Tools returned in alphabetical order

---

## Phase 3: Tool Schema Caching (P2)

**Goal:** Prevent mid-session tool schema changes from invalidating the ~3-5K token tool definitions cache block.

### Task 3.1: Implement ToolSchemaCache

**Files:**
- Create: `src/core/agent-runtime/tool-schema-cache.ts`

**Step 1: Implement cache**

```typescript
/**
 * Tool Schema Cache — Session-scoped tool schema cache
 *
 * Caches rendered tool definitions by name to prevent
 * mid-session changes (e.g., from config reload, MCP tool updates)
 * from busting the Anthropic prompt cache.
 *
 * Reference: claude-code's toolSchemaCache in
 * src/utils/toolSchemaCache.ts
 */

interface CachedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Hash of the rendered schema — for cache break detection */
  hash: string;
}

export class ToolSchemaCache {
  private cache = new Map<string, CachedTool>();

  /**
   * Get cached tool schema, or compute and cache it
   */
  getOrCompute(
    name: string,
    compute: () => { description: string; parameters: Record<string, unknown> }
  ): CachedTool {
    const existing = this.cache.get(name);
    if (existing) return existing;

    const schema = compute();
    const cached: CachedTool = {
      name,
      description: schema.description,
      parameters: schema.parameters,
      hash: this.computeHash(description, schema.parameters),
    };
    this.cache.set(name, cached);
    return cached;
  }

  /**
   * Check if a tool's schema has changed since it was cached
   */
  hasChanged(
    name: string,
    current: { description: string; parameters: Record<string, unknown> }
  ): boolean {
    const existing = this.cache.get(name);
    if (!existing) return true;
    return existing.hash !== this.computeHash(current.description, current.parameters);
  }

  /** Clear cache (on /clear or /compact) */
  clear(): void {
    this.cache.clear();
  }

  private computeHash(description: string, parameters: Record<string, unknown>): string {
    // Simple content hash — stable across same schema
    const content = `${description}|${JSON.stringify(parameters)}`;
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const chr = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return hash.toString(36);
  }
}
```

**Step 2: Integrate into agent-adapter**

In `src/core/agent-runtime/agent-adapter.ts`:
- Add a `ToolSchemaCache` instance as a class field
- In `registerTools()`, when re-registering tools, check cache before creating new AgentTool
- Only create new tool schema if cache miss

### Task 3.2: Wire cache clearing on /compact

**Files:**
- Modify: `src/cli/repl/session.ts` (around compact command)

After compact, call `this.agent.toolSchemaCache.clear()` to reset state.

---

## Phase 4: Set sessionId and cacheRetention (P3)

**Goal:** Enable pi-ai's session-level caching features by setting `sessionId` and allowing `cacheRetention` configuration.

### Task 4.1: Add cacheRetention to AgentOptions and AgentLoopConfig

**Files:**
- Modify: `src/core/agent-runtime/agent-types.ts:206-242`

```typescript
export interface AgentLoopConfig {
  // ... existing fields
  cacheRetention?: 'none' | 'short' | 'long';  // ADD
}
```

Also add to `AgentOptions` (line 247):
```typescript
export interface AgentOptions {
  // ... existing fields
  cacheRetention?: 'none' | 'short' | 'long';  // ADD
}
```

### Task 4.2: Pass cacheRetention through Agent → Loop → streamFn

**Files:**
- Modify: `src/core/agent-runtime/agent.ts:416-450` (createLoopConfig)
- Modify: `src/core/agent-runtime/agent.ts:166-218` (Agent class — add cacheRetention field/property)

```typescript
// In Agent class:
public cacheRetention: 'none' | 'short' | 'long' | undefined;

constructor(options: AgentOptions = {}) {
  // ... existing
  this.cacheRetention = options.cacheRetention as never;
}

// In createLoopConfig():
return {
  // ... existing
  cacheRetention: this.cacheRetention as never,  // ADD
};
```

The `AgentLoopConfig` gets spread into `streamFn` options in `agent-loop.ts:249`:
```typescript
const response = await streamFunction(config.model, llmContext, {
  ...config,  // ← cacheRetention is now included
  apiKey: resolvedApiKey,
  signal,
} as Record<string, unknown>);
```

pi-ai's Anthropic provider already handles `cacheRetention` in `StreamOptions` — it defaults to `"short"`. By passing it through, we enable:
- `"none"` → disable caching (debug mode)
- `"short"` → ephemeral caching (default, works today)
- `"long"` → 1-hour TTL (for supported models)

### Task 4.3: Set sessionId in LlmBasedAgent

**Files:**
- Modify: `src/core/agent-runtime/agent-adapter.ts:130-153`

```typescript
constructor(options: AgentAdapterOptions) {
  super();
  // ...
  
  // Generate session ID for prompt cache affinity
  const sessionId = `zapmyco-${this.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  this.inner = new Agent({
    toolExecution: this.config.toolExecution,
    sessionId,  // ADD
  });
  
  // Also mark it for Agent runtime config
  this.inner.sessionId = sessionId;
}
```

**Why this matters:** pi-ai's Anthropic provider uses `sessionId` (when available) to set session affinity headers. This helps the server maintain cache locality — different sessions get routed to different servers, but within a session, requests hit the same server where the KV cache is warm.

### Task 4.4: Add cacheRetention to ZapmycoConfig

**Files:**
- Read: `src/config/types.ts` — find LlmConfig or AgentRuntimeConfig
- Modify: Add `cacheRetention?: 'none' | 'short' | 'long'` to appropriate config type

**Step 1: Find the config type**

Check `src/config/types.ts` for the agent runtime or LLM config types.

**Step 2: Add to config type**

```typescript
export interface AgentRuntimeConfig {
  // ... existing
  cacheRetention?: 'none' | 'short' | 'long';
}
```

**Step 3: Pass through in session.ts**

In `createReplAgent()`, read `this.config.agentRuntime?.cacheRetention` and set it on the Agent:

```typescript
// In session.ts createReplAgent():
agent.innerAgent.cacheRetention = this.config.agentRuntime?.cacheRetention;
```

---

## Phase 5: Cache Monitoring (P4)

**Goal:** Provide visibility into cache hit rate and detect cache breaks with root cause analysis.

### Task 5.1: Add cache hit rate tracking to TokenTracker

**Files:**
- Modify: `src/core/context/token-tracker.ts:78-173`

```typescript
export class TokenTracker {
  // ... existing fields
  
  /** Per-call cache metrics for hit rate calculation */
  private _callMetrics: Array<{
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    timestamp: number;
  }> = [];

  recordUsage(usage: Usage): void {
    // ... existing accumulation
    this._callMetrics.push({
      inputTokens: usage.input,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      timestamp: Date.now(),
    });
  }

  /**
   * Get cache hit rate for recent calls
   * 
   * cacheHitRate = cacheReadTokens / (cacheReadTokens + cacheWriteTokens + non-cached input)
   * A hit rate > 80% is excellent, < 50% suggests optimization needed
   */
  getCacheHitRate(windowSize = 5): number {
    const window = this._callMetrics.slice(-windowSize);
    if (window.length === 0) return 0;
    
    const totalInput = window.reduce((sum, m) => sum + m.inputTokens, 0);
    const totalCacheRead = window.reduce((sum, m) => sum + m.cacheReadTokens, 0);
    
    if (totalInput === 0) return 0;
    return totalCacheRead / totalInput;
  }

  /**
   * Detect sudden cache break
   * Returns true if the latest call shows a significant drop in cache reads
   * compared to the previous call.
   */
  detectCacheBreak(): { broken: boolean; previousRead: number; currentRead: number } | null {
    if (this._callMetrics.length < 2) return null;
    
    const prev = this._callMetrics[this._callMetrics.length - 2];
    const curr = this._callMetrics[this._callMetrics.length - 1];
    
    // A break is when cache_read drops significantly (>50%) while input stays similar
    if (prev.cacheReadTokens > 2000 && curr.cacheReadTokens < prev.cacheReadTokens * 0.5) {
      return {
        broken: true,
        previousRead: prev.cacheReadTokens,
        currentRead: curr.cacheReadTokens,
      };
    }
    
    return { broken: false, previousRead: prev.cacheReadTokens, currentRead: curr.cacheReadTokens };
  }

  /**
   * Get average cache read ratio (0-1) for recent calls
   */
  getAverageCacheRatio(windowSize = 5): number {
    const window = this._callMetrics.slice(-windowSize);
    if (window.length === 0) return 0;
    
    const validCalls = window.filter(m => m.inputTokens > 0);
    if (validCalls.length === 0) return 0;
    
    const totalRatio = validCalls.reduce((sum, m) => sum + (m.cacheReadTokens / m.inputTokens), 0);
    return totalRatio / validCalls.length;
  }
}
```

### Task 5.2: Expose cache metrics in Agent health/status

**Files:**
- Modify: `src/core/agent-runtime/agent-adapter.ts` (healthCheck or add getCacheStats method)

```typescript
/** Get cache performance statistics */
getCacheStats(): {
  hitRate: number;
  averageCacheRatio: number;
  lastBreak: { broken: boolean; previousRead: number; currentRead: number } | null;
  totalCalls: number;
} {
  return {
    hitRate: this.tokenTracker.getCacheHitRate(),
    averageCacheRatio: this.tokenTracker.getAverageCacheRatio(),
    lastBreak: this.tokenTracker.detectCacheBreak(),
    totalCalls: this.tokenTracker.turnCount,
  };
}
```

### Task 5.3: Add /cache command to REPL

**Files:**
- Create/Modify: `src/cli/repl/commands/cache-cmd.ts`

```typescript
// New command to display cache statistics
export function createCacheCommand(): CommandDefinition {
  return {
    name: 'cache',
    aliases: [],
    description: '显示 prompt 缓存状态',
    usage: '/cache',
    handler: async (_args, session) => {
      const agent = (session as any).agent as LlmBasedAgent;
      const stats = agent.getCacheStats();
      // Display: hit rate, cache ratio, last break info
    },
  };
}
```

---

## Verification Plan

### Per-Task Verification

Each task's tests should pass independently:

| Task | Test Command | Expected Result |
|------|-------------|----------------|
| 1.1 | `pnpm run test -- --run src/__tests__/core/agent-runtime/` | All pass |
| 2.1 | `pnpm run test -- --run src/__tests__/core/agent-runtime/tool-bridge.test.ts` | Tools sorted alphabetically |
| 3.1 | `pnpm run test -- --run src/__tests__/` | New cache tests pass |
| 4.1-4.3 | `pnpm run test -- --run src/__tests__/` | Config/loop tests pass |
| 5.1 | `pnpm run test -- --run src/__tests__/context/token-tracker.test.ts` | Cache metrics tests pass |

### End-to-End Verification

1. **Start REPL:** `pnpm run dev`
2. **Send a request:** Type a natural language goal
3. **Observe:** Check output for correct behavior
4. **Send a follow-up:** Same conversation, observe cache behavior
5. **Check logs:** `~/.zapmyco/logs/` for cache metrics output

### Cache Effectiveness Verification

To validate the optimization:

1. Before: Run a multi-turn conversation, log `cache_read_input_tokens` vs `input_tokens` per turn
2. After: Run the same conversation pattern, compare cache hit ratios
3. Expected improvement: cache hit rate should increase significantly on turns 2+ in the same session

---

## Summary of Changes

| Task | File(s) | Type | Effort | Impact |
|------|---------|------|--------|--------|
| 1.1 | `agent-adapter.ts` | Modify | Medium | **Highest** — splits system prompt |
| 1.2 | `sub-agent-factory.ts`, `agent-factory.ts` | Verify/Modify | Low | Ensures sub-agents benefit |
| 2.1 | `tool-bridge.ts` | Modify | Low | Tool ordering stability |
| 3.1 | `tool-schema-cache.ts` (new), `agent-adapter.ts` | Create + Modify | Medium | Schema stability |
| 3.2 | `session.ts` | Modify | Low | Cache clearing on compact |
| 4.1 | `agent-types.ts` | Modify | Low | Type definitions |
| 4.2 | `agent.ts`, `agent-loop.ts` | Modify | Low | Pass-through |
| 4.3 | `agent-adapter.ts` | Modify | Low | sessionId generation |
| 4.4 | `config/types.ts`, `session.ts` | Modify | Low | Config binding |
| 5.1 | `token-tracker.ts` | Modify | Low | Cache metrics |
| 5.2 | `agent-adapter.ts` | Modify | Low | Expose stats |
| 5.3 | `cache-cmd.ts` (new) | Create | Low | /cache command |
