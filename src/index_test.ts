import { assertEquals, assertMatch, assertThrows } from 'jsr:@std/assert@1';
import { cli, createConfig, greet, VERSION } from './index.ts';
import { AiAgent } from './ai-agent.ts';
import { loadSettings, resolveEnvRef } from './settings.ts';

Deno.test('greet', async (t) => {
  await t.step('should return greeting message with the given name', () => {
    assertEquals(greet('World'), 'Hello, World!');
    assertEquals(greet('TypeScript'), 'Hello, TypeScript!');
  });

  await t.step('should throw TypeError when name is empty', () => {
    assertThrows(() => greet(''), TypeError);
    assertThrows(() => greet(''), TypeError, 'name cannot be empty');
  });

  await t.step('should handle names with spaces', () => {
    assertEquals(greet('John Doe'), 'Hello, John Doe!');
  });

  await t.step('should handle unicode characters', () => {
    assertEquals(greet('世界'), 'Hello, 世界!');
    assertEquals(greet('🎉'), 'Hello, 🎉!');
  });
});

Deno.test('createConfig', async (t) => {
  await t.step('should return default config when no options provided', () => {
    const config = createConfig();
    assertEquals(config.debug, false);
    assertEquals(config.logLevel, 'info');
    assertEquals(config.createdAt instanceof Date, true);
  });

  await t.step('should return config with provided options', () => {
    const config = createConfig({ debug: true, logLevel: 'debug' });
    assertEquals(config.debug, true);
    assertEquals(config.logLevel, 'debug');
  });

  await t.step('should allow partial options', () => {
    const config = createConfig({ debug: true });
    assertEquals(config.debug, true);
    assertEquals(config.logLevel, 'info');
  });

  await t.step('should accept all log levels', () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const;
    for (const level of levels) {
      const config = createConfig({ logLevel: level });
      assertEquals(config.logLevel, level);
    }
  });

  await t.step('should have readonly properties', () => {
    const config = createConfig();
    assertEquals(config.debug, false);
    assertEquals(config.logLevel, 'info');
  });
});

Deno.test('VERSION', async (t) => {
  await t.step('should be a string', () => {
    assertEquals(typeof VERSION, 'string');
  });

  await t.step('should match semver format', () => {
    assertMatch(VERSION, /^\d+\.\d+\.\d+/);
  });
});

Deno.test('cli', async (t) => {
  await t.step('greet with name should return greeting', async () => {
    const result = await cli(['greet', 'World']);
    assertEquals(result.exitCode, 0);
    assertEquals(result.stdout, 'Hello, World!');
    assertEquals(result.stderr, '');
  });

  await t.step('greet without name should exit with code 1', async () => {
    const result = await cli(['greet']);
    assertEquals(result.exitCode, 1);
    assertEquals(result.stdout, '');
    assertEquals(result.stderr, '请指定名称');
  });

  await t.step('config should print config JSON', async () => {
    const result = await cli(['config']);
    assertEquals(result.exitCode, 0);
    const config = JSON.parse(result.stdout);
    assertEquals(config.debug, false);
    assertEquals(config.logLevel, 'info');
  });

  await t.step('--version should print version', async () => {
    const result = await cli(['--version']);
    assertEquals(result.exitCode, 0);
    assertEquals(result.stdout, `v${VERSION}`);
  });

  await t.step('-v should print version', async () => {
    const result = await cli(['-v']);
    assertEquals(result.exitCode, 0);
    assertEquals(result.stdout, `v${VERSION}`);
  });

  await t.step('-V should print version', async () => {
    const result = await cli(['-V']);
    assertEquals(result.exitCode, 0);
    assertEquals(result.stdout, `v${VERSION}`);
  });

  await t.step('--help should show help text', async () => {
    const result = await cli(['--help']);
    assertEquals(result.exitCode, 0);
    assertEquals(result.stdout.includes('greet'), true);
    assertEquals(result.stdout.includes('config'), true);
    assertEquals(result.stdout.includes('init'), true);
    assertEquals(result.stdout.includes('ai'), true);
  });

  await t.step('no args should show help text', async () => {
    const result = await cli([]);
    assertEquals(result.exitCode, 0);
    assertEquals(result.stdout.includes('greet'), true);
    assertEquals(result.stdout.includes('config'), true);
    assertEquals(result.stdout.includes('init'), true);
  });

  await t.step('unknown command should exit with code 1', async () => {
    const result = await cli(['unknown']);
    assertEquals(result.exitCode, 1);
    assertEquals(result.stderr.includes('未知命令'), true);
  });

  await t.step('ai without settings file should prompt init', async () => {
    const origHome = Deno.env.get('HOME');
    const testDir = Deno.makeTempDirSync();
    Deno.env.set('HOME', testDir);
    try {
      const result = await cli(['ai']);
      assertEquals(result.exitCode, 1);
      assertEquals(result.stderr.includes('zapmyco init'), true);
    } finally {
      Deno.env.set('HOME', origHome ?? '');
      Deno.removeSync(testDir, { recursive: true });
    }
  });
});

Deno.test('AiAgent', async (t) => {
  await t.step('should throw when no API key provided', () => {
    assertThrows(
      () => new AiAgent({ apiKey: '' }),
      Error,
      'DEEPSEEK_API_KEY',
    );
  });

  await t.step('should accept custom options', () => {
    const agent = new AiAgent({
      apiKey: 'test-key',
      baseURL: 'https://custom.example.com',
      model: 'test-model',
    });
    assertEquals(agent.getMessages(), []);
  });

  await t.step('should manage context messages', () => {
    const agent = new AiAgent({ apiKey: 'test-key' });
    assertEquals(agent.getMessages(), []);
    agent.clearContext();
    assertEquals(agent.getMessages(), []);
  });
});

Deno.test('resolveEnvRef', async (t) => {
  await t.step('should return plain value as-is', () => {
    assertEquals(resolveEnvRef('sk-test-key'), 'sk-test-key');
    assertEquals(resolveEnvRef('https://example.com'), 'https://example.com');
  });

  await t.step('should resolve ${env.VAR} from environment', () => {
    Deno.env.set('TEST_MY_VAR', 'test-resolved-value');
    assertEquals(resolveEnvRef('${env.TEST_MY_VAR}'), 'test-resolved-value');
    Deno.env.delete('TEST_MY_VAR');
  });

  await t.step('should throw when ${env.VAR} env var is not set', () => {
    assertThrows(
      () => resolveEnvRef('${env.NONEXISTENT_VAR_XYZ}'),
      Error,
      'NONEXISTENT_VAR_XYZ',
    );
  });

  await t.step('should return plain ${VAR} as-is (without env. prefix)', () => {
    assertEquals(resolveEnvRef('${SOME_VAR}'), '${SOME_VAR}');
  });
});

/** 辅助函数：在临时 HOME 目录中执行测试 */
function withTempHome(fn: (homeDir: string) => void): void {
  const origHome = Deno.env.get('HOME');
  const testDir = Deno.makeTempDirSync();
  Deno.env.set('HOME', testDir);
  try {
    fn(testDir);
  } finally {
    Deno.env.set('HOME', origHome ?? '');
    Deno.removeSync(testDir, { recursive: true });
  }
}

Deno.test('loadSettings', async (t) => {
  await t.step('should return null when file not found', () => {
    withTempHome(() => {
      const result = loadSettings();
      assertEquals(result, null);
    });
  });

  await t.step('should return null when HOME is not set', () => {
    const origHome = Deno.env.get('HOME');
    Deno.env.set('HOME', '');
    try {
      const result = loadSettings();
      assertEquals(result, null);
    } finally {
      Deno.env.set('HOME', origHome ?? '');
    }
  });

  await t.step('should load settings from file', () => {
    withTempHome((home) => {
      Deno.mkdirSync(`${home}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${home}/.zapmyco/settings.json`,
        JSON.stringify({
          llm: {
            apiKey: 'test-key',
            baseURL: 'https://test.com',
            model: 'test-model',
          },
        }),
      );

      const result = loadSettings();
      assertEquals(result?.llm?.apiKey, 'test-key');
      assertEquals(result?.llm?.baseURL, 'https://test.com');
      assertEquals(result?.llm?.model, 'test-model');
    });
  });

  await t.step('should handle partial fields', () => {
    withTempHome((home) => {
      Deno.mkdirSync(`${home}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${home}/.zapmyco/settings.json`,
        JSON.stringify({ llm: { apiKey: 'only-key' } }),
      );

      const result = loadSettings();
      assertEquals(result?.llm?.apiKey, 'only-key');
      assertEquals(result?.llm?.baseURL, undefined);
      assertEquals(result?.llm?.model, undefined);
    });
  });

  await t.step('should handle empty llm object', () => {
    withTempHome((home) => {
      Deno.mkdirSync(`${home}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${home}/.zapmyco/settings.json`,
        JSON.stringify({ llm: {} }),
      );

      const result = loadSettings();
      assertEquals(result?.llm?.apiKey, undefined);
      assertEquals(result?.llm?.baseURL, undefined);
      assertEquals(result?.llm?.model, undefined);
    });
  });

  await t.step('should return {} when llm is not an object', () => {
    withTempHome((home) => {
      Deno.mkdirSync(`${home}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${home}/.zapmyco/settings.json`,
        JSON.stringify({ llm: 123 }),
      );

      const result = loadSettings();
      assertEquals(result, {});
    });
  });

  await t.step('should skip non-string fields', () => {
    withTempHome((home) => {
      Deno.mkdirSync(`${home}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${home}/.zapmyco/settings.json`,
        JSON.stringify({ llm: { apiKey: 123, baseURL: true, model: null } }),
      );

      const result = loadSettings();
      assertEquals(result?.llm?.apiKey, undefined);
      assertEquals(result?.llm?.baseURL, undefined);
      assertEquals(result?.llm?.model, undefined);
    });
  });

  await t.step('should throw on invalid JSON', () => {
    withTempHome((home) => {
      Deno.mkdirSync(`${home}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(`${home}/.zapmyco/settings.json`, '{invalid}');

      assertThrows(() => loadSettings(), Error, 'JSON 格式错误');
    });
  });

  await t.step('should ignore unknown fields', () => {
    withTempHome((home) => {
      Deno.mkdirSync(`${home}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${home}/.zapmyco/settings.json`,
        JSON.stringify({
          llm: { apiKey: 'key', unknownField: 'ignored' },
          otherSection: { foo: 'bar' },
        }),
      );

      const result = loadSettings();
      assertEquals(result?.llm?.apiKey, 'key');
    });
  });
});

Deno.test('AiAgent with settings', async (t) => {
  await t.step('should load apiKey from settings file', () => {
    withTempHome((home) => {
      Deno.mkdirSync(`${home}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${home}/.zapmyco/settings.json`,
        JSON.stringify({
          llm: { apiKey: 'from-settings', baseURL: 'https://test.com', model: 'test-model' },
        }),
      );

      const agent = new AiAgent();
      assertEquals(agent.getMessages(), []);
    });
  });

  await t.step('options should override settings file', () => {
    withTempHome((home) => {
      Deno.mkdirSync(`${home}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${home}/.zapmyco/settings.json`,
        JSON.stringify({
          llm: { apiKey: 'from-settings' },
        }),
      );

      const agent = new AiAgent({ apiKey: 'explicit-key' });
      assertEquals(agent.getMessages(), []);
    });
  });
});

Deno.test('CLI settings command', async (t) => {
  await t.step('settings path should return file path', async () => {
    const result = await cli(['settings', 'path']);
    assertEquals(result.exitCode, 0);
    assertEquals(result.stdout.includes('.zapmyco/settings.json'), true);
  });

  await t.step('settings with unknown subcommand should show error', async () => {
    const result = await cli(['settings', 'unknown']);
    assertEquals(result.exitCode, 1);
    assertEquals(result.stderr.includes('未知子命令'), true);
  });

  await t.step('settings without file should show error', async () => {
    const origHome = Deno.env.get('HOME');
    const testDir = Deno.makeTempDirSync();
    Deno.env.set('HOME', testDir);
    try {
      const result = await cli(['settings']);
      assertEquals(result.exitCode, 1);
      assertEquals(result.stderr.includes('不存在'), true);
    } finally {
      Deno.env.set('HOME', origHome ?? '');
      Deno.removeSync(testDir, { recursive: true });
    }
  });

  await t.step('settings should display config with masked apiKey', async () => {
    const origHome = Deno.env.get('HOME');
    const testDir = Deno.makeTempDirSync();
    Deno.env.set('HOME', testDir);
    try {
      Deno.mkdirSync(`${testDir}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${testDir}/.zapmyco/settings.json`,
        JSON.stringify({
          llm: { apiKey: 'sk-test-key-value', baseURL: 'https://test.com', model: 'test-model' },
        }),
      );

      const result = await cli(['settings']);
      assertEquals(result.exitCode, 0);
      assertEquals(result.stdout.includes('sk-***'), true);
      assertEquals(result.stdout.includes('sk-test-key-value'), false);
    } finally {
      Deno.env.set('HOME', origHome ?? '');
      Deno.removeSync(testDir, { recursive: true });
    }
  });

  await t.step('settings should handle invalid JSON', async () => {
    const origHome = Deno.env.get('HOME');
    const testDir = Deno.makeTempDirSync();
    Deno.env.set('HOME', testDir);
    try {
      Deno.mkdirSync(`${testDir}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(`${testDir}/.zapmyco/settings.json`, 'not valid json');

      const result = await cli(['settings']);
      assertEquals(result.exitCode, 1);
      assertEquals(result.stderr.includes('JSON 格式错误'), true);
    } finally {
      Deno.env.set('HOME', origHome ?? '');
      Deno.removeSync(testDir, { recursive: true });
    }
  });

  await t.step('settings should display ${env.VAR} apiKey as-is', async () => {
    const origHome = Deno.env.get('HOME');
    const testDir = Deno.makeTempDirSync();
    Deno.env.set('HOME', testDir);
    try {
      Deno.mkdirSync(`${testDir}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(
        `${testDir}/.zapmyco/settings.json`,
        JSON.stringify({
          llm: { apiKey: '${env.DEEPSEEK_API_KEY}' },
        }),
      );

      const result = await cli(['settings']);
      assertEquals(result.exitCode, 0);
      assertEquals(result.stdout.includes('${env.DEEPSEEK_API_KEY}'), true);
    } finally {
      Deno.env.set('HOME', origHome ?? '');
      Deno.removeSync(testDir, { recursive: true });
    }
  });
});

Deno.test('CLI init command', async (t) => {
  await t.step('init with existing file should error', async () => {
    const origHome = Deno.env.get('HOME');
    const testDir = Deno.makeTempDirSync();
    Deno.env.set('HOME', testDir);
    try {
      Deno.mkdirSync(`${testDir}/.zapmyco`, { recursive: true });
      Deno.writeTextFileSync(`${testDir}/.zapmyco/settings.json`, '{}');

      const result = await cli(['init']);
      assertEquals(result.exitCode, 1);
      assertEquals(result.stderr.includes('已存在'), true);
    } finally {
      Deno.env.set('HOME', origHome ?? '');
      Deno.removeSync(testDir, { recursive: true });
    }
  });

  await t.step('init command should be listed in help', async () => {
    const result = await cli(['--help']);
    assertEquals(result.stdout.includes('init'), true);
  });
});
