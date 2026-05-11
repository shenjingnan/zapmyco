import { beforeEach, describe, expect, it } from 'vitest';
import {
  AgentTypeRegistry,
  getAgentTypeRegistry,
  resetAgentTypeRegistry,
} from '@/core/agent-team/agent-type-registry';
import type { AgentTypeDefinition } from '@/core/agent-team/types';

function makeMockType(overrides: Partial<AgentTypeDefinition> = {}): AgentTypeDefinition {
  return {
    typeId: 'mock-type',
    displayName: 'Mock',
    whenToUse: 'Mocking',
    role: 'worker',
    capabilities: [{ id: 'mock-cap', name: 'Mock Cap', description: 'Mock', category: 'testing' }],
    toolPolicy: { mode: 'safe' },
    permissionMode: 'restricted',
    source: 'builtin',
    maxTurns: 30,
    maxSpawnDepth: 0,
    getSystemPrompt: () => 'mock prompt',
    ...overrides,
  };
}

describe('AgentTypeRegistry', () => {
  beforeEach(() => {
    resetAgentTypeRegistry();
  });

  describe('singleton', () => {
    it('getAgentTypeRegistry should return the same instance', () => {
      const r1 = getAgentTypeRegistry();
      const r2 = getAgentTypeRegistry();
      expect(r1).toBe(r2);
    });

    it('resetAgentTypeRegistry should create a new instance', () => {
      const r1 = getAgentTypeRegistry();
      resetAgentTypeRegistry();
      const r2 = getAgentTypeRegistry();
      expect(r1).not.toBe(r2);
    });
  });

  describe('builtin types loading', () => {
    it('should load 6 builtin types on construction', () => {
      const registry = new AgentTypeRegistry();
      expect(registry.size).toBe(6);
    });

    it('should have all expected builtin typeIds', () => {
      const registry = new AgentTypeRegistry();
      expect(registry.has('researcher')).toBe(true);
      expect(registry.has('coder')).toBe(true);
      expect(registry.has('reviewer')).toBe(true);
      expect(registry.has('planner')).toBe(true);
      expect(registry.has('general-purpose')).toBe(true);
    });
  });

  describe('register', () => {
    it('should register a new type', () => {
      const registry = new AgentTypeRegistry();
      const customType = makeMockType({ typeId: 'custom-type' });
      registry.register(customType);

      expect(registry.has('custom-type')).toBe(true);
      expect(registry.size).toBe(7);
    });

    it('should override existing type with same typeId', () => {
      const registry = new AgentTypeRegistry();
      const customType = makeMockType({
        typeId: 'researcher',
        displayName: 'Custom Researcher',
        source: 'user',
      });
      registry.register(customType);

      const retrieved = registry.get('researcher');
      expect(retrieved?.displayName).toBe('Custom Researcher');
      expect(retrieved?.source).toBe('user');
    });

    it('should maintain overridden type in registry', () => {
      const registry = new AgentTypeRegistry();
      const original = registry.get('coder');
      expect(original?.toolPolicy).toEqual({ mode: 'standard' });

      const customCoder = makeMockType({
        typeId: 'coder',
        toolPolicy: { mode: 'safe' },
        source: 'user',
      });
      registry.register(customCoder);

      const updated = registry.get('coder');
      expect(updated?.toolPolicy).toEqual({ mode: 'safe' });
      expect(updated?.source).toBe('user');
    });
  });

  describe('registerAll', () => {
    it('should register multiple types', () => {
      const registry = new AgentTypeRegistry();
      registry.registerAll([
        makeMockType({ typeId: 'type-a' }),
        makeMockType({ typeId: 'type-b' }),
        makeMockType({ typeId: 'type-c' }),
      ]);

      expect(registry.has('type-a')).toBe(true);
      expect(registry.has('type-b')).toBe(true);
      expect(registry.has('type-c')).toBe(true);
      expect(registry.size).toBe(9); // 6 builtin + 3 custom
    });
  });

  describe('unregister', () => {
    it('should unregister an existing type', () => {
      const registry = new AgentTypeRegistry();
      expect(registry.unregister('coder')).toBe(true);
      expect(registry.has('coder')).toBe(false);
      expect(registry.size).toBe(5);
    });

    it('should return false for non-existent type', () => {
      const registry = new AgentTypeRegistry();
      expect(registry.unregister('non-existent')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return the type definition for existing type', () => {
      const registry = new AgentTypeRegistry();
      const type = registry.get('researcher');
      expect(type).toBeDefined();
      expect(type?.typeId).toBe('researcher');
    });

    it('should return undefined for non-existent type', () => {
      const registry = new AgentTypeRegistry();
      expect(registry.get('non-existent')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should list all non-hidden types', () => {
      const registry = new AgentTypeRegistry();
      const types = registry.list();
      expect(types.length).toBe(6);
    });

    it('should exclude hidden types', () => {
      const registry = new AgentTypeRegistry();
      registry.register(makeMockType({ typeId: 'hidden-type', hidden: true }));
      const types = registry.list();
      expect(types.find((t) => t.typeId === 'hidden-type')).toBeUndefined();
    });
  });

  describe('listAll', () => {
    it('should include hidden types', () => {
      const registry = new AgentTypeRegistry();
      registry.register(makeMockType({ typeId: 'hidden-type', hidden: true }));
      const all = registry.listAll();
      expect(all.find((t) => t.typeId === 'hidden-type')).toBeDefined();
    });
  });

  describe('listByRole', () => {
    it('should return only workers for worker role', () => {
      const registry = new AgentTypeRegistry();
      const workers = registry.listByRole('worker');
      for (const w of workers) {
        expect(['worker', 'universal']).toContain(w.role);
      }
    });

    it('should include universal types for any role filter', () => {
      const registry = new AgentTypeRegistry();
      const workers = registry.listByRole('worker');
      const universalType = workers.find((t) => t.role === 'universal');
      expect(universalType).toBeDefined();
    });
  });

  describe('match', () => {
    it('should return universal types when no capabilities required', () => {
      const registry = new AgentTypeRegistry();
      const matched = registry.match([]);
      expect(matched.length).toBeGreaterThan(0);
      expect(matched.every((t) => t.role === 'universal')).toBe(true);
    });

    it('should match by capability id', () => {
      const registry = new AgentTypeRegistry();
      registry.register(
        makeMockType({
          typeId: 'web-expert',
          role: 'worker',
          capabilities: [
            { id: 'web-research', name: 'Web', description: '', category: 'research' },
          ],
        })
      );

      const matched = registry.match(['web-research']);
      expect(matched.some((t) => t.typeId === 'web-expert')).toBe(true);
      expect(matched.some((t) => t.typeId === 'researcher')).toBe(true);
    });

    it('should not include coordinator in match results', () => {
      const registry = new AgentTypeRegistry();
      registry.register(
        makeMockType({
          typeId: 'my-coordinator',
          role: 'coordinator',
          capabilities: [{ id: 'planning', name: 'Plan', description: '', category: 'planning' }],
        })
      );

      const matched = registry.match(['planning']);
      expect(matched.some((t) => t.role === 'coordinator')).toBe(false);
    });

    it('should fallback to universal when no match', () => {
      const registry = new AgentTypeRegistry();
      const matched = registry.match(['non-existent-capability']);
      expect(matched.length).toBeGreaterThan(0);
      expect(matched.every((t) => t.role === 'universal')).toBe(true);
    });

    it('should sort by match score (higher first)', () => {
      resetAgentTypeRegistry();
      const cleanRegistry = new AgentTypeRegistry();

      // A type with exact capability ID match scores 2
      cleanRegistry.register(
        makeMockType({
          typeId: 'exact-match',
          role: 'worker',
          capabilities: [
            { id: 'target-cap', name: 'Exact', description: '', category: 'research' },
          ],
        })
      );

      // A type with only category match scores 1
      cleanRegistry.register(
        makeMockType({
          typeId: 'category-match',
          role: 'worker',
          capabilities: [{ id: 'other-cap', name: 'Other', description: '', category: 'research' }],
        })
      );

      const matched = cleanRegistry.match(['target-cap', 'research']);
      expect(matched.length).toBeGreaterThan(0);
      // exact-match should be first (score: 2+1=3 vs category-match: 1)
      expect(matched[0]?.typeId).toBe('exact-match');
    });
  });

  describe('getDefault', () => {
    it('should return general-purpose type', () => {
      const registry = new AgentTypeRegistry();
      const defaultType = registry.getDefault();
      expect(defaultType.typeId).toBe('general-purpose');
    });

    it('should throw when general-purpose is unregistered', () => {
      const registry = new AgentTypeRegistry();
      registry.unregister('general-purpose');
      expect(() => registry.getDefault()).toThrow('general-purpose');
    });
  });
});
