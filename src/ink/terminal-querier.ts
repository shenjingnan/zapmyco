/**
 * terminal-querier — 终端能力查询
 *
 * 基于 DA1 sentinel 的免超时查询机制。
 * 原理：终端始终回答 DA1 请求，并且按顺序回答查询。
 * 如果查询的响应在 DA1 之前到达，说明终端支持该查询；
 * 否则 resolve 为 undefined（终端不支持）。
 *
 * 使用场景：
 *   await querier.send(kittyKeyboard())
 *   await querier.flush()
 *   // 如果 flush 先 resolve，则 kittyKeyboard 的结果为 undefined
 *
 * 参考 claude-code src/ink/terminal-querier.ts
 */

import type {
  CursorPosResponse,
  Da1Response,
  Da2Response,
  DecrpmResponse,
  KittyKeyboardResponse,
  OscResponse,
  TerminalResponse,
  XtversionResponse,
} from './parse-keypress.js';
import { csi } from './termio/csi.js';
import { osc } from './termio/osc.js';

// ---------------------------------------------------------------------------
// TerminalQuery
// ---------------------------------------------------------------------------

export type TerminalQuery<T extends TerminalResponse> = {
  request: string;
  match: (r: TerminalResponse) => r is T;
};

// ---------------------------------------------------------------------------
// 查询构建器
// ---------------------------------------------------------------------------

/** DECRQM — 查询 DEC 私有模式状态 */
export function decrqm(mode: number): TerminalQuery<DecrpmResponse> {
  return {
    request: csi('?', mode, '$p'),
    match: (r): r is DecrpmResponse => r.kind === 'decrpm' && r.mode === mode,
  };
}

/** DA1 — 主设备属性 */
export function da1(): TerminalQuery<Da1Response> {
  return {
    request: csi('c'),
    match: (r): r is Da1Response => r.kind === 'da1',
  };
}

/** DA2 — 次设备属性 */
export function da2(): TerminalQuery<Da2Response> {
  return {
    request: csi('>c'),
    match: (r): r is Da2Response => r.kind === 'da2',
  };
}

/** Kitty 键盘协议标志查询 */
export function kittyKeyboard(): TerminalQuery<KittyKeyboardResponse> {
  return {
    request: csi('?u'),
    match: (r): r is KittyKeyboardResponse => r.kind === 'kittyKeyboard',
  };
}

/** 光标位置查询 (DECXCPR) */
export function cursorPosition(): TerminalQuery<CursorPosResponse> {
  return {
    request: csi('?6n'),
    match: (r): r is CursorPosResponse => r.kind === 'cursorPosition',
  };
}

/** OSC 颜色查询 */
export function oscColor(code: number): TerminalQuery<OscResponse> {
  return {
    request: osc(code, '?'),
    match: (r): r is OscResponse => r.kind === 'osc' && r.code === code,
  };
}

/** XTVERSION — 终端名称/版本查询 */
export function xtversion(): TerminalQuery<XtversionResponse> {
  return {
    request: csi('>0q'),
    match: (r): r is XtversionResponse => r.kind === 'xtversion',
  };
}

// ---------------------------------------------------------------------------
// Pending 队列
// ---------------------------------------------------------------------------

type PendingQuery = {
  kind: 'query';
  query: TerminalQuery<TerminalResponse>;
  resolve: (value: TerminalResponse | undefined) => void;
};

type PendingSentinel = {
  kind: 'sentinel';
  resolve: () => void;
};

type Pending = PendingQuery | PendingSentinel;

// ---------------------------------------------------------------------------
// TerminalQuerier
// ---------------------------------------------------------------------------

export class TerminalQuerier {
  private readonly stdout: NodeJS.WriteStream;
  private readonly queue: Pending[] = [];

  constructor(stdout: NodeJS.WriteStream) {
    this.stdout = stdout;
  }

  /**
   * 发送查询请求。返回 Promise，在收到匹配响应时 resolve。
   * 如果 flush() 的 sentinel 先到达，resolve 为 undefined。
   */
  send<T extends TerminalResponse>(query: TerminalQuery<T>): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      this.queue.push({
        kind: 'query',
        query: query as TerminalQuery<TerminalResponse>,
        resolve: resolve as (v: TerminalResponse | undefined) => void,
      });
      this.stdout.write(query.request);
    });
  }

  /**
   * 刷新查询批处理。发送 DA1 sentinel。
   * 返回在所有 padding 查询都已 resolve 后 resolve 的 Promise。
   */
  flush(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push({ kind: 'sentinel', resolve });
      // DA1 sentinel: CSI c
      this.stdout.write(csi('c'));
    });
  }

  /**
   * 响应回调 — 由 App.tsx 对每个 kind: 'response' 的输入项调用。
   * FIFO 匹配 pending 查询，DA1 路由到 sentinel。
   */
  onResponse(r: TerminalResponse): void {
    // 先尝试匹配 pending 查询
    for (let i = 0; i < this.queue.length; i++) {
      const pending = this.queue[i];
      if (pending === undefined) continue;
      if (pending.kind !== 'query') continue;

      if (pending.query.match(r)) {
        // 匹配成功
        this.queue.splice(i, 1);
        pending.resolve(pending.query.match(r) ? r : undefined);
        return;
      }
    }

    // 如果是 DA1 响应，查找并触发第一个 sentinel
    if (r.kind === 'da1') {
      for (let i = 0; i < this.queue.length; i++) {
        const pending = this.queue[i];
        if (pending === undefined) continue;
        if (pending.kind !== 'sentinel') continue;

        // 从队列头部到 sentinel（含）的所有元素
        const sentinel = pending;
        const queries = this.queue.splice(0, i + 1);

        // sentinel 前的所有 query resolve 为 undefined（终端不支持）
        for (const item of queries) {
          if (item.kind === 'query') {
            item.resolve(undefined);
          }
        }

        sentinel.resolve();
        return;
      }
    }

    // 未匹配的响应静默丢弃
  }
}
