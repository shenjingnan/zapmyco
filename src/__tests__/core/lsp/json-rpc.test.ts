/**
 * JSON-RPC 消息读写器测试
 */

import type { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createMessageReader, createMessageWriter } from '@/core/lsp/json-rpc';

describe('createMessageReader', () => {
  it('应解析单条完整的 request 消息', () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const reader = createMessageReader(onMessage, onError, onClose);

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    reader.feed(Buffer.from(header + body, 'utf-8'));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, method: 'initialize' })
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it('应解析分 chunk 到达的消息', () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const reader = createMessageReader(onMessage, onError, onClose);

    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'ok' });
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;

    // 分两次喂入
    reader.feed(Buffer.from(header.slice(0, 10), 'utf-8'));
    expect(onMessage).not.toHaveBeenCalled();

    reader.feed(Buffer.from(header.slice(10) + body, 'utf-8'));
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, result: 'ok' }));
  });

  it('连续多条消息应逐一回调', () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const reader = createMessageReader(onMessage, onError, onClose);

    const body1 = JSON.stringify({ jsonrpc: '2.0', method: 'notification1' });
    const body2 = JSON.stringify({ jsonrpc: '2.0', method: 'notification2' });
    const msg1 = `Content-Length: ${Buffer.byteLength(body1)}\r\n\r\n${body1}`;
    const msg2 = `Content-Length: ${Buffer.byteLength(body2)}\r\n\r\n${body2}`;

    reader.feed(Buffer.from(msg1 + msg2, 'utf-8'));
    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it('缺少 Content-Length 头应触发 onError', () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const reader = createMessageReader(onMessage, onError, onClose);

    reader.feed(Buffer.from('No-Header: value\r\n\r\n{"bad": true}', 'utf-8'));
    expect(onError).toHaveBeenCalled();
  });

  it('无效的 Content-Length 值应触发 onError', () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const reader = createMessageReader(onMessage, onError, onClose);

    reader.feed(Buffer.from('Content-Length: abc\r\n\r\n{}', 'utf-8'));
    expect(onError).toHaveBeenCalled();
  });

  it('body 不完整时应等待更多数据', () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const reader = createMessageReader(onMessage, onError, onClose);

    const body = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'test' });
    reader.feed(Buffer.from(`Content-Length: 999\r\n\r\n${body}`, 'utf-8'));
    // Content-Length 指定 999 但 body 不够长 → 不会回调
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('reset 应清空内部状态', () => {
    // 先 feed 部分消息
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const reader = createMessageReader(onMessage, onError, onClose);

    reader.feed(Buffer.from('Content-Length: 10\r\n', 'utf-8'));
    reader.reset();

    // reset 后应该能正常处理新消息
    const body = JSON.stringify({ jsonrpc: '2.0', id: 4, result: 'reset-ok' });
    reader.feed(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf-8'));
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('JSON 解析错误应触发 onError', () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const reader = createMessageReader(onMessage, onError, onClose);

    const invalidJson = '{not valid json';
    reader.feed(
      Buffer.from(
        `Content-Length: ${Buffer.byteLength(invalidJson)}\r\n\r\n${invalidJson}`,
        'utf-8'
      )
    );
    expect(onError).toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('trace 回调应被调用', () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const trace = vi.fn();
    const reader = createMessageReader(onMessage, onError, onClose, trace);

    const body = JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'test' });
    reader.feed(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf-8'));
    expect(trace).toHaveBeenCalled();
  });
});

describe('createMessageWriter', () => {
  it('应写入完整的 JSON-RPC 消息', async () => {
    let writtenData: Buffer | undefined;
    const mockWritable = {
      writable: true,
      write: vi.fn((data: Buffer, cb: (err?: Error) => void) => {
        writtenData = data;
        cb();
      }),
    } as unknown as Writable;

    const writer = createMessageWriter(mockWritable);
    await writer.write({ jsonrpc: '2.0', id: 1, method: 'test' });

    expect(mockWritable.write).toHaveBeenCalled();
    const text = writtenData?.toString('utf-8') ?? '';
    expect(text).toContain('Content-Length:');
    expect(text).toContain('Content-Type:');
    expect(text).toContain('"jsonrpc":"2.0"');
  });

  it('流不可写时应拒绝', async () => {
    const mockWritable = {
      writable: false,
      write: vi.fn(),
    } as unknown as Writable;

    const writer = createMessageWriter(mockWritable);
    await expect(writer.write({ jsonrpc: '2.0', id: 1, method: 'test' })).rejects.toThrow(
      'Stream is not writable'
    );
  });
});
