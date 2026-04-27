import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock functions via hoisted helper
const { searchMock, loadMock, debugMock, infoMock, warnMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  loadMock: vi.fn(),
  debugMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('cosmiconfig', () => ({
  cosmiconfig: vi.fn(() => ({ search: searchMock, load: loadMock })),
}));

vi.mock('../../infra/logger.js', () => ({
  logger: {
    debug: debugMock,
    info: infoMock,
    warn: warnMock,
  },
}));

import { DEFAULT_CONFIG } from '../../config/defaults.js';
import { loadConfig } from '../../config/loader.js';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchMock.mockResolvedValue(null);
    loadMock.mockResolvedValue(null);
  });

  describe('happy path - config found', () => {
    it('should merge user config with defaults when config file found', async () => {
      searchMock.mockResolvedValue({
        config: { llm: { model: 'claude-opus-4-20250514' } },
        filepath: '/test/zapmyco.config.json',
      });

      const result = await loadConfig();
      expect(result.llm.model).toBe('claude-opus-4-20250514');
      expect(result.scheduler.maxConcurrency).toBe(DEFAULT_CONFIG.scheduler.maxConcurrency);
    });

    it('should call explorer.search() when no configPath provided', async () => {
      searchMock.mockResolvedValue({
        config: {},
        filepath: '/found/config',
      });

      await loadConfig();
      expect(searchMock).toHaveBeenCalledOnce();
      expect(loadMock).not.toHaveBeenCalled();
    });

    it('should call explorer.load(configPath) when configPath provided', async () => {
      loadMock.mockResolvedValue({
        config: { cli: { color: false } },
        filepath: '/custom/path.json',
      });

      await loadConfig('/custom/path.json');
      expect(loadMock).toHaveBeenCalledWith('/custom/path.json');
      expect(searchMock).not.toHaveBeenCalled();
    });

    it('should log info with filepath when config loaded', async () => {
      searchMock.mockResolvedValue({
        config: {},
        filepath: '/found/.zapmycorc',
      });

      await loadConfig();
      expect(infoMock).toHaveBeenCalledWith('已加载配置文件', {
        filepath: '/found/.zapmycorc',
      });
    });
  });

  describe('no config found', () => {
    it('should return DEFAULT_CONFIG copy when result is null', async () => {
      searchMock.mockResolvedValue(null);
      const result = await loadConfig();
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('should return DEFAULT_CONFIG copy when result.config is null', async () => {
      searchMock.mockResolvedValue({
        config: null,
        filepath: '/empty.json',
      });
      const result = await loadConfig();
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('should log debug message when no config found', async () => {
      searchMock.mockResolvedValue(null);
      await loadConfig();
      expect(debugMock).toHaveBeenCalledWith('未找到配置文件，使用默认配置');
    });
  });

  describe('error handling', () => {
    it('should catch error and return defaults when cosmiconfig throws Error', async () => {
      searchMock.mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await loadConfig();
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('should catch non-Error thrown value and return defaults', async () => {
      searchMock.mockRejectedValue('string error');

      const result = await loadConfig();
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('should log warning with error message on failure', async () => {
      searchMock.mockRejectedValue(new Error('permission denied'));

      await loadConfig();
      expect(warnMock).toHaveBeenCalledWith('配置加载失败，使用默认配置', {
        error: 'permission denied',
      });
    });

    it('should handle error in explicit path mode', async () => {
      loadMock.mockRejectedValue(new Error('file not found'));

      const result = await loadConfig('/bad/path');
      expect(result).toEqual(DEFAULT_CONFIG);
      expect(warnMock).toHaveBeenCalled();
    });
  });

  describe('deepMerge behavior (tested via loadConfig)', () => {
    it('should deep merge nested objects', async () => {
      searchMock.mockResolvedValue({
        config: { scheduler: { maxConcurrency: 10 } },
        filepath: '/test.json',
      });

      const result = await loadConfig();
      expect(result.scheduler.maxConcurrency).toBe(10);
      expect(result.scheduler.maxPerAgent).toBe(DEFAULT_CONFIG.scheduler.maxPerAgent);
    });

    it('should overwrite primitive values', async () => {
      searchMock.mockResolvedValue({
        config: { cli: { debug: true } },
        filepath: '/test.json',
      });

      const result = await loadConfig();
      expect(result.cli.debug).toBe(true);
    });

    it('should skip undefined source values', async () => {
      searchMock.mockResolvedValue({
        config: { llm: { model: undefined } },
        filepath: '/test.json',
      });

      const result = await loadConfig();
      expect(result.llm.model).toBe(DEFAULT_CONFIG.llm.model);
    });

    it('should add new keys from source that are not in target', async () => {
      searchMock.mockResolvedValue({
        config: { llm: { customKey: 'new-value' } },
        filepath: '/test.json',
      });

      const result = await loadConfig();
      expect((result.llm as unknown as Record<string, unknown>).customKey).toBe('new-value');
    });
  });
});
