import { describe, expect, it } from 'vitest';
import type { McpConfig } from '@/config/types';
import { normalizeMcpConfig } from '@/config/types';

describe('normalizeMcpConfig', () => {
  describe('Format B: servers array', () => {
    it('should return servers array directly when present and non-empty', () => {
      const servers = [
        { name: 'server-a', transport: 'stdio' as const, command: 'node' },
        { name: 'server-b', transport: 'stdio' as const, command: 'python' },
      ];
      const raw = { servers };
      expect(normalizeMcpConfig(raw as unknown as McpConfig)).toBe(servers);
    });

    it('should fall through to Format A when servers is empty array', () => {
      const raw = {
        servers: [],
        'my-server': { transport: 'stdio' as const, command: 'echo' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('my-server');
    });
  });

  describe('Format A: key-value entries', () => {
    it('should parse key-value entries with command field', () => {
      const raw = {
        'server-a': { transport: 'stdio' as const, command: 'node server.js' },
        'server-b': { transport: 'stdio' as const, command: 'python script.py' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('server-a');
      expect(result[0]?.command).toBe('node server.js');
      expect(result[1]?.name).toBe('server-b');
      expect(result[1]?.command).toBe('python script.py');
    });

    it('should skip entries without command field', () => {
      const raw = {
        'no-command': { transport: 'stdio' as const } as McpConfig[string],
        'has-command': { transport: 'stdio' as const, command: 'echo hello' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('has-command');
    });

    it('should skip null values', () => {
      const raw = {
        'null-server': null as unknown as McpConfig[string],
        'valid-server': { transport: 'stdio' as const, command: 'echo' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('valid-server');
    });

    it('should skip undefined values', () => {
      const raw = {
        'undefined-server': undefined as unknown as McpConfig[string],
        'valid-server': { transport: 'stdio' as const, command: 'echo' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('valid-server');
    });

    it('should skip non-object values', () => {
      const raw = {
        'string-server': 'not an object' as unknown as McpConfig[string],
        'number-server': 123 as unknown as McpConfig[string],
        'valid-server': { transport: 'stdio' as const, command: 'echo' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('valid-server');
    });

    it('should skip array values', () => {
      const raw = {
        'array-server': [{ transport: 'stdio', command: 'echo' }] as unknown as McpConfig[string],
        'valid-server': { transport: 'stdio' as const, command: 'echo' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('valid-server');
    });

    it('should skip the "servers" key', () => {
      const raw = {
        servers: undefined,
        'real-server': { transport: 'stdio' as const, command: 'echo' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('real-server');
    });

    it('should include optional args when present', () => {
      const raw = {
        'server-a': {
          transport: 'stdio' as const,
          command: 'node',
          args: ['--port', '3000'],
        },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result[0]?.args).toEqual(['--port', '3000']);
    });

    it('should include optional env when present', () => {
      const raw = {
        'server-a': {
          transport: 'stdio' as const,
          command: 'node',
          env: { NODE_ENV: 'production' },
        },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result[0]?.env).toEqual({ NODE_ENV: 'production' });
    });

    it('should include optional cwd when present', () => {
      const raw = {
        'server-a': {
          transport: 'stdio' as const,
          command: 'node',
          cwd: '/tmp',
        },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result[0]?.cwd).toBe('/tmp');
    });

    it('should include optional enabled when present', () => {
      const raw = {
        'server-a': {
          transport: 'stdio' as const,
          command: 'node',
          enabled: false,
        },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result[0]?.enabled).toBe(false);
    });

    it('should include optional connectTimeoutMs when present', () => {
      const raw = {
        'server-a': {
          transport: 'stdio' as const,
          command: 'node',
          connectTimeoutMs: 30000,
        },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result[0]?.connectTimeoutMs).toBe(30000);
    });

    it('should set default transport to stdio', () => {
      const raw = {
        'server-a': { transport: 'stdio' as const, command: 'node' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result[0]?.transport).toBe('stdio');
    });

    it('should return empty array for empty object', () => {
      const raw = {};
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toEqual([]);
    });

    it('should skip server entries that do not have command as string', () => {
      const raw = {
        'no-command': { transport: 'stdio' as const } as McpConfig[string],
        'number-command': {
          transport: 'stdio' as const,
          command: 123,
        } as unknown as McpConfig[string],
        valid: { transport: 'stdio' as const, command: 'node' },
      };
      const result = normalizeMcpConfig(raw as unknown as McpConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('valid');
    });
  });
});
