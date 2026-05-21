import { describe, expect, it, vi } from 'vitest';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import {
  createToolFromCapability,
  createToolsFromCapabilities,
  toAgentTool,
  toAgentTools,
} from '@/core/agent-runtime/tool-bridge';
import { ToolSchemaCache } from '@/core/agent-runtime/tool-schema-cache';

describe('tool-bridge', () => {
  describe('toAgentTool', () => {
    it('should convert a complete ToolRegistration to AgentTool', () => {
      const execute = vi.fn();
      const registration: ToolRegistration = {
        id: 'test-tool',
        label: 'Test Tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        execute,
        executionMode: 'sequential',
      };

      const tool = toAgentTool(registration);

      expect(tool.name).toBe('test-tool');
      expect(tool.label).toBe('Test Tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.execute).toBe(execute);
    });

    it('should use default empty object schema when parameters is undefined', () => {
      const registration: ToolRegistration = {
        id: 'no-params-tool',
        label: 'No Params',
        description: 'No params',
        execute: vi.fn(),
      };

      const tool = toAgentTool(registration);

      expect(tool.parameters).toEqual({ type: 'object', properties: {} });
    });

    it('should not include executionMode when not specified', () => {
      const registration: ToolRegistration = {
        id: 'no-mode-tool',
        label: 'No Mode',
        description: 'No mode',
        execute: vi.fn(),
      };

      const tool = toAgentTool(registration);

      // executionMode should be undefined (not included)
      expect(tool).not.toHaveProperty('executionMode');
    });
  });

  describe('toAgentTools', () => {
    it('should convert multiple registrations', () => {
      const registrations: ToolRegistration[] = [
        {
          id: 'tool-a',
          label: 'Tool A',
          description: 'First tool',
          execute: vi.fn(),
        },
        {
          id: 'tool-b',
          label: 'Tool B',
          description: 'Second tool',
          execute: vi.fn(),
        },
      ];

      const tools = toAgentTools(registrations);

      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe('tool-a');
      expect(tools[1]?.name).toBe('tool-b');
    });

    it('should return empty array for empty input', () => {
      expect(toAgentTools([])).toEqual([]);
    });
  });

  describe('toAgentTools with schemaCache', () => {
    function makeRegistration(id: string, overrides?: Partial<ToolRegistration>): ToolRegistration {
      return {
        id,
        label: id,
        description: `Tool ${id}`,
        execute: vi.fn(),
        ...overrides,
      };
    }

    it('should return same parameters reference for same tool name', () => {
      const cache = new ToolSchemaCache();
      const reg = makeRegistration('read');
      const tools1 = toAgentTools([reg], cache);
      const tools2 = toAgentTools([reg], cache);
      expect(tools1[0]!.parameters).toBe(tools2[0]!.parameters);
    });

    it('should return different references without cache', () => {
      const reg = makeRegistration('read');
      const tools1 = toAgentTools([reg]);
      const tools2 = toAgentTools([reg]);
      expect(tools1[0]!.parameters).not.toBe(tools2[0]!.parameters);
      expect(tools1[0]!.parameters).toEqual(tools2[0]!.parameters);
    });

    it('cached tools should use first registration schema', () => {
      const cache = new ToolSchemaCache();
      const reg1 = makeRegistration('search', { description: 'Original description' });
      const reg2 = makeRegistration('search', { description: 'Updated description' });

      // 第一次注册填充缓存，第二次应使用缓存值
      toAgentTools([reg1], cache);
      const tools2 = toAgentTools([reg2], cache);

      expect(tools2[0]!.description).toBe('Original description');
    });

    it('should preserve execute function from each registration', () => {
      const cache = new ToolSchemaCache();
      const fn1 = vi.fn();
      const fn2 = vi.fn();

      toAgentTools([{ ...makeRegistration('calc'), execute: fn1 }], cache);
      const tools2 = toAgentTools([{ ...makeRegistration('calc'), execute: fn2 }], cache);

      expect(tools2[0]!.execute).toBe(fn2);
    });

    it('should sort tools by name when cache is used', () => {
      const cache = new ToolSchemaCache();
      const tools = toAgentTools(
        [makeRegistration('z-tool'), makeRegistration('a-tool'), makeRegistration('m-tool')],
        cache
      );

      expect(tools[0]!.name).toBe('a-tool');
      expect(tools[1]!.name).toBe('m-tool');
      expect(tools[2]!.name).toBe('z-tool');
    });

    it('cache stats should reflect cached tools', () => {
      const cache = new ToolSchemaCache();
      toAgentTools([makeRegistration('read'), makeRegistration('write')], cache);

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.tools).toContain('read');
      expect(stats.tools).toContain('write');
    });

    it('hasChanged should return false for cached tool with same schema', () => {
      const cache = new ToolSchemaCache();
      toAgentTools([makeRegistration('read', { description: 'Read files' })], cache);

      expect(
        cache.hasChanged('read', {
          description: 'Read files',
          parameters: { type: 'object', properties: {} },
        })
      ).toBe(false);
    });

    it('hasChanged should return true for tool with changed schema', () => {
      const cache = new ToolSchemaCache();
      toAgentTools([makeRegistration('read', { description: 'Read files' })], cache);

      expect(
        cache.hasChanged('read', {
          description: 'Different description',
          parameters: { type: 'object', properties: {} },
        })
      ).toBe(true);
    });
  });

  describe('createToolFromCapability', () => {
    it('should map Capability fields to ToolRegistration', () => {
      const capability = {
        id: 'cap-code-gen',
        name: 'Code Generation',
        description: 'Generates code from descriptions',
        category: 'code-generation' as const,
      };

      const execute = vi.fn();
      const registration = createToolFromCapability(capability, execute);

      expect(registration.id).toBe('cap-code-gen');
      expect(registration.label).toBe('Code Generation');
      expect(registration.description).toBe('Generates code from descriptions');
      expect(registration.execute).toBe(execute);
    });
  });

  describe('createToolsFromCapabilities', () => {
    it('should use executorFactory for each capability', () => {
      const capabilities = [
        {
          id: 'cap-1',
          name: 'Cap 1',
          description: 'First capability',
          category: 'chat' as const,
        },
        {
          id: 'cap-2',
          name: 'Cap 2',
          description: 'Second capability',
          category: 'research' as const,
        },
      ];

      const execute1 = vi.fn();
      const execute2 = vi.fn();
      const factory = vi.fn().mockReturnValueOnce(execute1).mockReturnValueOnce(execute2);

      const registrations = createToolsFromCapabilities(capabilities, factory);

      expect(registrations).toHaveLength(2);
      expect(registrations[0]?.id).toBe('cap-1');
      expect(registrations[0]?.execute).toBe(execute1);
      expect(registrations[1]?.id).toBe('cap-2');
      expect(registrations[1]?.execute).toBe(execute2);
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });
});
