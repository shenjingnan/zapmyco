import { describe, expect, it, vi } from 'vitest';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import {
  createToolFromCapability,
  createToolsFromCapabilities,
  toAgentTool,
  toAgentTools,
} from '@/core/agent-runtime/tool-bridge';

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
