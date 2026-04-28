import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock functions via hoisted helper（必须在此定义，vi.mock 会将其提升到文件顶部）
const {
  searchMock,
  loadMock,
  debugMock,
  infoMock,
  warnMock,
  existsSyncMock,
  readFileMock,
  writeFileMock,
  mkdirMock,
} = vi.hoisted(() => ({
  searchMock: vi.fn(),
  loadMock: vi.fn(),
  debugMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  existsSyncMock: vi.fn(() => false),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
  mkdirMock: vi.fn(),
}));

vi.mock('cosmiconfig', () => ({
  cosmiconfig: vi.fn(() => ({ search: searchMock, load: loadMock })),
}));

vi.mock('@/infra/logger', () => ({
  logger: {
    debug: debugMock,
    info: infoMock,
    warn: warnMock,
  },
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  mkdir: mkdirMock,
}));

import { DEFAULT_CONFIG } from '@/config/defaults';
import { loadConfig } from '@/config/loader';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchMock.mockResolvedValue(null);
    loadMock.mockResolvedValue(null);
    // 默认模拟家目录配置文件不存在
    existsSyncMock.mockReturnValue(false);
    // 模拟 writeFile 成功（创建模板文件）
    writeFileMock.mockResolvedValue(undefined);
    // 模拟 readFile 返回 null（模板创建后读取失败，回退到默认值）
    readFileMock.mockRejectedValue(new Error('ENOENT'));
  });

  describe('happy path - config found', () => {
    it('should merge user config with defaults when config file found', async () => {
      searchMock.mockResolvedValue({
        config: { llm: { defaultModel: 'anthropic/claude-opus-4-20250514' } },
        filepath: '/test/zapmyco.config.json',
      });

      const result = await loadConfig();
      expect(result.llm.defaultModel).toBe('anthropic/claude-opus-4-20250514');
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

      await loadConfig('/custom/path');
      expect(loadMock).toHaveBeenCalledWith('/custom/path');
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

  describe('no config found - falls back to defaults', () => {
    it('should return DEFAULT_CONFIG-like structure when no config found anywhere', async () => {
      searchMock.mockResolvedValue(null);
      const result = await loadConfig();
      // 核心字段应与默认值一致
      expect(result.llm.defaultModel).toBe(DEFAULT_CONFIG.llm.defaultModel);
      expect(result.scheduler.maxConcurrency).toBe(DEFAULT_CONFIG.scheduler.maxConcurrency);
      expect(result.cli.color).toBe(DEFAULT_CONFIG.cli.color);
    });

    it('should return DEFAULT_CONFIG copy when result.config is null', async () => {
      searchMock.mockResolvedValue({
        config: null,
        filepath: '/empty.json',
      });
      const result = await loadConfig();
      expect(result.llm.defaultModel).toBe(DEFAULT_CONFIG.llm.defaultModel);
      expect(result.scheduler).toEqual(DEFAULT_CONFIG.scheduler);
    });
  });

  describe('error handling', () => {
    it('should catch error and return defaults when cosmiconfig throws Error', async () => {
      searchMock.mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await loadConfig();
      expect(result.llm.defaultModel).toBe(DEFAULT_CONFIG.llm.defaultModel);
    });

    it('should catch non-Error thrown value and return defaults', async () => {
      searchMock.mockRejectedValue('string error');

      const result = await loadConfig();
      expect(result.llm.defaultModel).toBe(DEFAULT_CONFIG.llm.defaultModel);
    });

    it('should handle error in explicit path mode', async () => {
      loadMock.mockRejectedValue(new Error('file not found'));

      const result = await loadConfig('/bad/path');
      expect(result.llm.defaultModel).toBe(DEFAULT_CONFIG.llm.defaultModel);
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
        config: { llm: { defaultModel: undefined } },
        filepath: '/test.json',
      });

      const result = await loadConfig();
      expect(result.llm.defaultModel).toBe(DEFAULT_CONFIG.llm.defaultModel);
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

  describe('home directory config fallback', () => {
    it('should load config from ~/.zapmyco/zapmyco.json when project config not found', async () => {
      searchMock.mockResolvedValue(null);
      // 模拟家目录配置文件存在
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify({ llm: { defaultModel: 'openai/gpt-4o' } }));

      const result = await loadConfig();
      expect(result.llm.defaultModel).toBe('openai/gpt-4o');
    });

    it('should resolve environment variables in home config', async () => {
      searchMock.mockResolvedValue(null);
      existsSyncMock.mockReturnValue(true);
      vi.stubEnv('TEST_API_KEY', 'resolved-key-123');
      readFileMock.mockResolvedValue(
        JSON.stringify({
          llm: {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试环境变量引用语法
            providers: { anthropic: { apiKey: '${TEST_API_KEY}' } },
          },
        })
      );

      const result = await loadConfig();
      expect(result.llm.providers.anthropic?.apiKey).toBe('resolved-key-123');
      vi.unstubAllEnvs();
    });

    it('should create template config when home dir does not exist', async () => {
      searchMock.mockResolvedValue(null);
      existsSyncMock.mockReturnValue(false);

      await loadConfig();

      expect(mkdirMock).toHaveBeenCalled();
      expect(writeFileMock).toHaveBeenCalled();
    });
  });
});
