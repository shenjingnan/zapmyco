/**
 * LSP 配置解析测试
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_LSP_SERVERS,
  filterAvailableServers,
  isCommandAvailable,
  resolveLspConfig,
} from '@/core/lsp/lsp-config';
import type { LspServerConfig } from '@/core/lsp/types';

// Mock execFile
const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null) => void;
    mockExecFile(...args);
    cb(null);
  },
}));

describe('BUILTIN_LSP_SERVERS', () => {
  it('应包含 typescript 内置服务器', () => {
    const ts = BUILTIN_LSP_SERVERS.find((s) => s.name === 'typescript');
    expect(ts).toBeDefined();
    expect(ts?.command).toBe('typescript-language-server');
    expect(ts?.languageIds).toContain('typescript');
    expect(ts?.extensions).toContain('.ts');
  });
});

describe('resolveLspConfig', () => {
  it('无配置时应返回内置服务器', () => {
    const result = resolveLspConfig();
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.find((s) => s.name === 'typescript')).toBeDefined();
  });

  it('空对象配置应返回内置服务器', () => {
    const result = resolveLspConfig({ enabled: true });
    expect(result.find((s) => s.name === 'typescript')).toBeDefined();
  });

  it('enabled=false 应返回空数组', () => {
    const result = resolveLspConfig({ enabled: false });
    expect(result).toEqual([]);
  });

  it('用户服务器应覆盖同名内置服务器', () => {
    const userServer: LspServerConfig = {
      name: 'typescript',
      command: 'custom-ts-server',
      args: ['--custom'],
      languageIds: ['typescript'],
      extensions: ['.ts'],
    };
    const result = resolveLspConfig({ enabled: true, servers: [userServer] });
    const ts = result.find((s) => s.name === 'typescript');
    expect(ts).toBeDefined();
    expect(ts?.command).toBe('custom-ts-server');
    expect(ts?.args).toEqual(['--custom']);
  });

  it('enabled=false 的用户服务器应禁用内置服务器', () => {
    const result = resolveLspConfig({
      enabled: true,
      servers: [{ name: 'typescript', command: 'ts-server', enabled: false }],
    });
    const ts = result.find((s) => s.name === 'typescript');
    expect(ts).toBeUndefined();
  });

  it('新服务器应追加到列表', () => {
    const newServer: LspServerConfig = {
      name: 'rust-analyzer',
      command: 'rust-analyzer',
      languageIds: ['rust'],
      extensions: ['.rs'],
    };
    const result = resolveLspConfig({ enabled: true, servers: [newServer] });
    expect(result.find((s) => s.name === 'rust-analyzer')).toBeDefined();
    expect(result.find((s) => s.name === 'typescript')).toBeDefined();
  });

  it('enabled=false 的服务器应被过滤', () => {
    const result = resolveLspConfig({
      enabled: true,
      servers: [
        { name: 'typescript', command: 'ts-server', enabled: false },
        {
          name: 'rust-analyzer',
          command: 'rust-analyzer',
          languageIds: ['rust'],
          extensions: ['.rs'],
        },
      ],
    });
    expect(result.find((s) => s.name === 'typescript')).toBeUndefined();
    expect(result.find((s) => s.name === 'rust-analyzer')).toBeDefined();
  });
});

describe('isCommandAvailable', () => {
  it('命令存在时应返回 true', async () => {
    mockExecFile.mockImplementationOnce((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null) => void;
      cb(null);
    });
    const result = await isCommandAvailable('existing-cmd');
    expect(result).toBe(true);
  });

  it('命令不存在时应返回 false', async () => {
    mockExecFile.mockImplementationOnce((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error) => void;
      cb(new Error('not found'));
    });
    const result = await isCommandAvailable('missing-cmd');
    expect(result).toBe(false);
  });
});

describe('filterAvailableServers', () => {
  it('应过滤掉不可用的内置服务器', async () => {
    // typescript-language-server 不存在
    mockExecFile.mockImplementationOnce((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error) => void;
      cb(new Error('not found'));
    });
    const { available, unavailable } = await filterAvailableServers(BUILTIN_LSP_SERVERS);
    expect(available).toHaveLength(0);
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]).toContain('typescript');
  });

  it('应保留可用的内置服务器', async () => {
    mockExecFile.mockImplementationOnce((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null) => void;
      cb(null);
    });
    const { available, unavailable } = await filterAvailableServers(BUILTIN_LSP_SERVERS);
    expect(available).toHaveLength(1);
    expect(unavailable).toHaveLength(0);
  });

  it('用户自定义服务器应直接加入可用列表', async () => {
    const customServer: LspServerConfig = {
      name: 'custom-lsp',
      command: 'custom-lsp-server',
      languageIds: ['custom'],
      extensions: ['.custom'],
    };
    const { available, unavailable } = await filterAvailableServers([customServer]);
    expect(available).toHaveLength(1);
    expect(available[0]?.name).toBe('custom-lsp');
    expect(unavailable).toHaveLength(0);
  });

  it('混合内置和自定义服务器', async () => {
    mockExecFile.mockImplementationOnce((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error) => void;
      cb(new Error('not found'));
    });
    const customServer: LspServerConfig = {
      name: 'custom-lsp',
      command: 'custom-lsp-server',
      languageIds: ['custom'],
      extensions: ['.custom'],
    };
    const { available, unavailable } = await filterAvailableServers([
      ...BUILTIN_LSP_SERVERS,
      customServer,
    ]);
    // 内置 typescript 不可用，自定义直接加入
    expect(available).toHaveLength(1);
    expect(available[0]?.name).toBe('custom-lsp');
    expect(unavailable).toHaveLength(1);
  });
});
