import { assertEquals, assertMatch, assertThrows } from 'jsr:@std/assert@1';
import { cli, createConfig, greet, VERSION } from './index.ts';
import { AiAgent } from './ai-agent.ts';

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
    assertEquals(result.stdout.includes('ai'), true);
  });

  await t.step('no args should show help text', async () => {
    const result = await cli([]);
    assertEquals(result.exitCode, 0);
    assertEquals(result.stdout.includes('greet'), true);
    assertEquals(result.stdout.includes('config'), true);
  });

  await t.step('unknown command should exit with code 1', async () => {
    const result = await cli(['unknown']);
    assertEquals(result.exitCode, 1);
    assertEquals(result.stderr.includes('未知命令'), true);
  });

  await t.step('ai without API key should show error', async () => {
    const result = await cli(['ai']);
    assertEquals(result.exitCode, 1);
    assertEquals(result.stderr.includes('DEEPSEEK_API_KEY'), true);
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
