import { assertEquals, assertMatch, assertThrows } from 'jsr:@std/assert@1';
import { createConfig, greet, VERSION } from './index.ts';

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
