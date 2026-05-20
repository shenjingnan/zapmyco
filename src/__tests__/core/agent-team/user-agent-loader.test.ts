/**
 * user-agent-loader 单元测试
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAgentTypeRegistry,
  resetAgentTypeRegistry,
} from '@/core/agent-team/agent-type-registry';
import { loadProjectAgents, reloadAgents } from '@/core/agent-team/user-agent-loader';

describe('user-agent-loader', () => {
  let tmpDir: string;

  function createAgentFile(dir: string, filename: string, content: string): string {
    const filePath = join(dir, filename);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  function setupProjectDir(): string {
    const dir = mkdtempSync('zapmyco-agent-test-project-');
    const agentsDir = join(dir, '.zapmyco', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    return dir;
  }

  beforeEach(() => {
    resetAgentTypeRegistry();
    tmpDir = mkdtempSync('zapmyco-agent-test-');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    resetAgentTypeRegistry();
  });

  describe('loadProjectAgents', () => {
    it('should return empty result when directory does not exist', async () => {
      const dir = mkdtempSync('zapmyco-agent-test-no-agents-');
      try {
        const result = await loadProjectAgents(dir);
        expect(result.loaded).toBe(0);
        expect(result.errors).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('should load valid agent definition files', async () => {
      const projectDir = setupProjectDir();
      const agentsDir = join(projectDir, '.zapmyco', 'agents');

      createAgentFile(
        agentsDir,
        'my-agent.md',
        `---
typeId: my-agent
displayName: My Agent
whenToUse: for testing
tools: safe
---

My agent system prompt.
`
      );

      try {
        const result = await loadProjectAgents(projectDir);
        expect(result.loaded).toBe(1);
        expect(result.typeIds).toContain('my-agent');
        expect(result.errors).toHaveLength(0);

        // Verify registered in registry
        const registry = getAgentTypeRegistry();
        const def = registry.get('my-agent');
        expect(def).toBeDefined();
        expect(def?.source).toBe('project');
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('should skip invalid files', async () => {
      const projectDir = setupProjectDir();
      const agentsDir = join(projectDir, '.zapmyco', 'agents');

      createAgentFile(
        agentsDir,
        'bad-agent.md',
        `---
role: worker
---

Missing required fields.
`
      );

      try {
        const result = await loadProjectAgents(projectDir);
        expect(result.loaded).toBe(0);
        expect(result.errors.length).toBeGreaterThan(0);
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('should not override builtin types', async () => {
      const projectDir = setupProjectDir();
      const agentsDir = join(projectDir, '.zapmyco', 'agents');

      // Try to override builtin researcher
      createAgentFile(
        agentsDir,
        'researcher.md',
        `---
typeId: researcher
displayName: Custom Researcher
whenToUse: for custom research
tools: standard
---

Custom researcher prompt.
`
      );

      try {
        const result = await loadProjectAgents(projectDir);
        // Should fail because researcher is a builtin type
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.loaded).toBe(0);

        // Builtin researcher should still be intact
        const registry = getAgentTypeRegistry();
        const def = registry.get('researcher');
        expect(def).toBeDefined();
        expect(def?.source).toBe('builtin');
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('should load multiple agent files', async () => {
      const projectDir = setupProjectDir();
      const agentsDir = join(projectDir, '.zapmyco', 'agents');

      createAgentFile(
        agentsDir,
        'agent-a.md',
        `---
typeId: agent-a
displayName: Agent A
whenToUse: for task A
---

Agent A body.
`
      );

      createAgentFile(
        agentsDir,
        'agent-b.md',
        `---
typeId: agent-b
displayName: Agent B
whenToUse: for task B
tools:
  - ReadFile
  - Grep
---

Agent B body.
`
      );

      try {
        const result = await loadProjectAgents(projectDir);
        expect(result.loaded).toBe(2);
        expect(result.typeIds).toContain('agent-a');
        expect(result.typeIds).toContain('agent-b');

        const registry = getAgentTypeRegistry();
        expect(registry.has('agent-a')).toBe(true);
        expect(registry.has('agent-b')).toBe(true);
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });

  describe('reloadAgents', () => {
    it('should clear and reload custom types', async () => {
      const projectDir = setupProjectDir();
      const agentsDir = join(projectDir, '.zapmyco', 'agents');

      createAgentFile(
        agentsDir,
        'reload-test.md',
        `---
typeId: reload-test
displayName: Reload Test
whenToUse: for reload testing
---

Reload test body.
`
      );

      try {
        // First load
        await loadProjectAgents(projectDir);
        expect(getAgentTypeRegistry().has('reload-test')).toBe(true);

        // Reload
        const result = await reloadAgents(projectDir);
        expect(result.project.loaded).toBe(1);
        expect(getAgentTypeRegistry().has('reload-test')).toBe(true);
        // Builtin types should still exist
        expect(getAgentTypeRegistry().has('researcher')).toBe(true);
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('should remove types that no longer exist', async () => {
      const projectDir = setupProjectDir();
      const agentsDir = join(projectDir, '.zapmyco', 'agents');

      createAgentFile(
        agentsDir,
        'temp-agent.md',
        `---
typeId: temp-agent
displayName: Temp Agent
whenToUse: for temp testing
---

Temp agent body.
`
      );

      try {
        // First load
        await loadProjectAgents(projectDir);
        expect(getAgentTypeRegistry().has('temp-agent')).toBe(true);

        // Remove the file
        rmSync(join(agentsDir, 'temp-agent.md'));

        // Reload
        await reloadAgents(projectDir);
        expect(getAgentTypeRegistry().has('temp-agent')).toBe(false);
        // Builtin types should still exist
        expect(getAgentTypeRegistry().has('researcher')).toBe(true);
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });
});
