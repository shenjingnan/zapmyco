import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZapmycoError, ZapmycoErrorCode } from '@/infra/errors';
import { Logger, logger } from '@/infra/logger';

describe('Logger', () => {
  let log: Logger;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = new Logger('debug');
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as ReturnType<
      typeof vi.spyOn
    >;
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as ReturnType<
      typeof vi.spyOn
    >;
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    stderrWriteSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should default minLevel to info', () => {
      const defaultLogger = new Logger();
      defaultLogger.debug('should not appear');
      expect(defaultLogger.getEntries()).toHaveLength(0);
    });

    it('should accept custom minLevel', () => {
      const debugLogger = new Logger('debug');
      debugLogger.debug('hello');
      expect(debugLogger.getEntries()).toHaveLength(1);
    });
  });

  describe('setLevel()', () => {
    it('should change minimum log level', () => {
      const l = new Logger('warn');
      l.info('filtered');
      expect(l.getEntries()).toHaveLength(0);

      l.setLevel('debug');
      l.info('now visible');
      expect(l.getEntries()).toHaveLength(1);
    });
  });

  describe('child()', () => {
    it('should create child logger with prefix', () => {
      const child = log.child('agent');
      child.info('task started');
      const entries = child.getEntries();
      expect(entries[0]?.message).toBe('[agent] task started');
    });

    it('should inherit parent minLevel', () => {
      const parent = new Logger('warn');
      const child = parent.child('sub');
      child.info('filtered by parent level');
      expect(child.getEntries()).toHaveLength(0);

      child.warn('passes warn level');
      expect(child.getEntries()).toHaveLength(1);
    });

    it('should prefix all log levels', () => {
      const child = log.child('worker');
      child.debug('d');
      child.info('i');
      child.warn('w');
      child.error('e');

      const entries = child.getEntries();
      expect(entries).toHaveLength(4);
      expect(entries[0]?.message).toBe('[worker] d');
      expect(entries[1]?.message).toBe('[worker] i');
      expect(entries[2]?.message).toBe('[worker] w');
      expect(entries[3]?.message).toBe('[worker] e');
    });
  });

  describe('log() - core method', () => {
    it('should record entry when level >= minLevel', () => {
      log.info('hello world');
      const entries = log.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe('info');
      expect(entries[0]?.message).toBe('hello world');
      expect(entries[0]).toHaveProperty('timestamp');
    });

    it('should NOT record entry when level < minLevel', () => {
      const infoLogger = new Logger('info');
      infoLogger.debug('filtered out');
      expect(infoLogger.getEntries()).toHaveLength(0);
    });

    it('should include context in entry when provided', () => {
      log.info('with context', { key: 'value', num: 42 });
      const entry = log.getEntries()[0];
      expect(entry?.context).toEqual({ key: 'value', num: 42 });
    });

    it('should exclude context property when undefined', () => {
      log.info('no context');
      const entry = log.getEntries()[0];
      expect(entry?.context).toBeUndefined();
    });

    it('should format timestamp as local time string', () => {
      log.info('ts test');
      const entry = log.getEntries()[0];
      expect(entry?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it('should include ZapmycoError code in output', () => {
      log.error('fail', {}, new ZapmycoError(ZapmycoErrorCode.AGENT_NOT_FOUND, 'agent missing'));
      const output = stderrWriteSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('(AGENT_NOT_FOUND)');
      expect(output).toContain('agent missing');
    });

    it('should include plain Error message in output', () => {
      log.error('oops', {}, new Error('something broke'));
      const output = stderrWriteSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('something broke');
    });

    it('should write to stdout for non-error levels', () => {
      log.info('stdout test');
      expect(stdoutWriteSpy).toHaveBeenCalledOnce();
    });

    it('should write to stderr for error level', () => {
      log.error('stderr test');
      expect(stderrWriteSpy).toHaveBeenCalledOnce();
    });

    it('should serialize context as JSON in output', () => {
      log.info('ctx msg', { foo: 'bar' });
      const output = stdoutWriteSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain(JSON.stringify({ foo: 'bar' }));
    });
  });

  describe('convenience methods', () => {
    it('debug() should call log with debug level', () => {
      log.debug('dbg');
      expect(log.getEntries()[0]?.level).toBe('debug');
    });

    it('info() should call log with info level', () => {
      log.info('inf');
      expect(log.getEntries()[0]?.level).toBe('info');
    });

    it('warn() should call log with warn level', () => {
      log.warn('wrn');
      expect(log.getEntries()[0]?.level).toBe('warn');
    });

    it('error() should call log with error level and pass error', () => {
      const err = new Error('test err');
      log.error('err msg', {}, err);
      const entry = log.getEntries()[0];
      expect(entry?.level).toBe('error');
      expect(entry?.message).toBe('err msg');
      expect(entry?.error).toBe(err);
    });
  });

  describe('getEntries()', () => {
    it('should return defensive copy (not reference)', () => {
      log.info('a');
      const entries1 = log.getEntries();
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      (entries1 as Array<unknown>).push({});
      expect(log.getEntries()).toHaveLength(1);
    });

    it('should return empty array initially', () => {
      expect(new Logger().getEntries()).toEqual([]);
    });

    it('should accumulate multiple entries', () => {
      log.info('a');
      log.warn('b');
      log.error('c');
      expect(log.getEntries()).toHaveLength(3);
    });
  });

  describe('clear()', () => {
    it('should remove all entries', () => {
      log.info('a');
      log.info('b');
      log.info('c');
      log.clear();
      expect(log.getEntries()).toHaveLength(0);
    });
  });
});

describe('global logger instance', () => {
  it('should be an instance of Logger', () => {
    expect(logger).toBeInstanceOf(Logger);
  });

  it('should have default minLevel of info (debug filtered)', () => {
    logger.debug('test');
    expect(logger.getEntries()).toHaveLength(0);
  });
});
