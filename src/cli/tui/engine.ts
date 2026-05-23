/**
 * TUI — 终端 UI 引擎
 *
 * 本地实现的 TUI 引擎（旧版，仅保留 Screen 管线）。
 * 管理渲染循环（事件驱动 + 16ms 节流）、组件树、焦点、Overlay 栈、差量渲染。
 *
 * ### 渲染流程
 * ```
 * 组件调用 requestRender() → dirty=true
 *   → queueMicrotask → flush() 被调度
 *   → 检查节流（距上次渲染 ≥ 16ms）
 *   → renderToScreen → diffScreens → applyPatches
 *   → 定位硬件光标
 * ```
 *
 * PR6: 移除旧字符串管线（doRenderLegacy/deltaUpdate/forceFullRedraw）。
 * 新 Ink 管线已完全取代旧管线功能。
 *
 * ### AnimationManager 兼容
 * doRender 为公共方法，可被 AnimationManager monkey-patch 替换，
 * 在渲染前插入动画帧推进回调。
 *
 * ### 光标标记
 * Editor 在渲染输出中嵌入光标标记（\\u001B_pi:c\\u0007），
 * TUI 扫描、移除标记并将硬件光标定位到对应位置。
 */

import { writeSync } from 'node:fs';
import { logger } from '@/infra/logger';
import { Container } from './container';
import {
  BSU,
  CSI,
  ESU,
  EXIT_ALT_SCREEN,
  RESET_SCROLL_REGION,
  scrollDown,
  scrollUp,
  setScrollRegion,
} from './dec';
import type { Patch } from './diff';
import { detectDecstbmScroll, diffScreens } from './diff';
import { Screen } from './screen';
import { StylePool } from './style-pool';
import type { ProcessTerminal } from './terminal';
import type {
  Component,
  OverlayHandle,
  OverlayMargin,
  OverlayOptions,
  Rect,
  SgrMouseEvent,
} from './types';

// ---------------------------------------------------------------------------
// 导出：ANSI 行 → Screen 缓冲区渲染
// ---------------------------------------------------------------------------

/**
 * 光标标记结果（通过可变对象传递，避免所有权和闭包问题）
 */
export interface CursorMarker {
  row: number;
  col: number;
}

/**
 * 将 ANSI 字符串行解析为 Screen 单元格。
 *
 * 解析 SGR 样式序列，写入 Screen buffer。
 * 可选地检测 Editor 嵌入的光标标记（\\u001B_pi:c\\u0007）并记录位置。
 *
 * @param screen      目标 Screen 缓冲区
 * @param stylePool   样式池
 * @param x           起始列
 * @param y           起始行
 * @param line        ANSI 格式化的字符串行
 * @param cursorMarker 可选，用于接收光标标记位置的可变对象
 */
export function renderAnsiLineToScreen(
  screen: Screen,
  stylePool: StylePool,
  x: number,
  y: number,
  line: string,
  cursorMarker?: CursorMarker
): void {
  let styleId = 0;
  let col = x;
  let i = 0;

  while (i < line.length) {
    if (line[i] === '\x1b' && line[i + 1] === '[') {
      // 查找 ANSI SGR 序列结束
      const end = line.indexOf('m', i + 2);
      if (end > 0) {
        const codeStr = line.slice(i + 2, end);
        // 重置码 → styleId = 0
        if (codeStr === '0' || codeStr === '' || codeStr.includes('39') || codeStr.includes('49')) {
          styleId = 0;
        } else if (codeStr.startsWith('38;5;') || codeStr.startsWith('48;5;')) {
          // 256 色
          styleId = stylePool.intern([codeStr]);
        } else if (codeStr.startsWith('38;2;') || codeStr.startsWith('48;2;')) {
          // 真彩色
          styleId = stylePool.intern([codeStr]);
        } else {
          styleId = stylePool.intern([codeStr]);
        }
        i = end + 1;
        continue;
      }
    }

    // 跳过 CURSOR_MARKER（新管线用其他方式定位光标）
    if (line[i] === '\x1b' && line.slice(i, i + 7) === '\x1b_pi:c\x07') {
      // 记录光标位置但不写入 screen
      const markerIdx = line.indexOf('\x07', i);
      if (markerIdx >= 0) {
        if (cursorMarker) {
          // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 序列含 ESC
          const plainBefore = line.slice(0, i).replace(/\x1b\[[\d;]*m/g, '');
          cursorMarker.row = y;
          cursorMarker.col = plainBefore.length;
        }
        i = markerIdx + 1;
        continue;
      }
    }

    // 普通字符
    const ch = line[i] ?? '';
    if (ch >= ' ') {
      screen.setCell(col, y, ch, styleId, 1);
      col++;
    }
    i++;
  }
}

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

interface OverlayEntry {
  component: Component;
  options: OverlayOptions;
}

interface OverlayRect {
  row: number;
  col: number;
  width: number;
  height: number;
}

/** 光标标记 — Editor 在渲染输出末尾嵌入，TUI 据此定位硬件光标 */
// 常量值保留在 renderAnsiLineToScreen 中内联使用

// ---------------------------------------------------------------------------
// TUI 引擎
// ---------------------------------------------------------------------------

export class TUI {
  readonly terminal: ProcessTerminal;

  /** 根容器（组件树的入口） */
  private root = new Container();

  /** Overlay 栈（后进先出） */
  private overlayStack: OverlayEntry[] = [];

  /** 是否有内容变化需要重绘 */
  private dirty = false;

  /** 是否强制全量重绘（resize / overlay 切换） */
  private force = false;

  /** 是否有已调度但未执行的 flush */
  private renderScheduled = false;

  /** 上一次渲染完成的时间戳（performance.now()） */
  private lastRenderTime = 0;

  /** 节流定时器引用（当 flush 被节流延迟时使用） */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** 引擎是否已停止 — 防止 flush 在 stop() 后误执行 */
  private stopped = false;

  /** 当前获得焦点的组件 */
  private focused: Component | null = null;

  /** 编辑器光标位置（从光标标记解析） */
  private cursorRow = -1;
  private cursorCol = -1;

  /** 上一帧的 Screen 缓冲区（用于差异计算） */
  private prevScreen: Screen | null = null;

  /** 样式池（跨帧共享） */
  private stylePool = new StylePool();

  /**
   * @deprecated 旧字符串管线已移除，始终使用 Screen 管线。
   * 此方法保留为空操作以确保向后兼容。
   */
  enableScreenPipeline(): void {
    this.prevScreen = null;
    this.force = true;
    this.requestRender();
  }

  /**
   * @deprecated 旧字符串管线已移除，始终使用 Screen 管线。
   * 此方法保留为空操作以确保向后兼容。
   */
  disableScreenPipeline(): void {
    this.requestRender();
  }

  constructor(terminal: ProcessTerminal) {
    this.terminal = terminal;
  }

  // -----------------------------------------------------------------------
  // 公共组件树 API
  // -----------------------------------------------------------------------

  /** 添加子组件到根容器 */
  addChild(child: Component): void {
    this.root.addChild(child);
  }

  /** 设置焦点组件（接收键盘输入），同时设置组件的 focused 属性 */
  setFocus(component: Component): void {
    // 取消前一个组件的焦点
    if (this.focused && 'focused' in this.focused) {
      (this.focused as { focused: boolean }).focused = false;
    }
    this.focused = component;
    // 设置新组件的焦点（Editor/Input 据此决定是否嵌入光标标记）
    if (component && 'focused' in component) {
      (component as { focused: boolean }).focused = true;
    }
    this.requestRender();
  }

  // -----------------------------------------------------------------------
  // 生命周期
  // -----------------------------------------------------------------------

  /** 启动 TUI — 清屏、隐藏光标、启用 raw mode、事件驱动渲染 */
  start(): void {
    this.stopped = false;
    this.lastRenderTime = 0;
    this.renderScheduled = false;

    // 启用 raw mode — 使 stdin 逐键送达而非行缓冲
    this.terminal.enableRawMode();

    // 隐藏硬件光标
    this.terminal.write('\x1b[?25l');
    this.terminal.clear();
    this.dirty = true;
    this.force = true;

    // 注册进程退出安全网 — 确保光标在任何退出路径下都能恢复
    process.on('exit', this.#exitHandler);

    // 注册 resize 回调
    this.terminal.onResize(() => {
      // 终端尺寸变化后强制全量重绘
      this.requestRender(true);
    });

    // stdin 读取 — 分发给 overlay 或焦点组件（含鼠标事件支持）
    this.terminal.stdin.on('data', (chunk: Buffer) => {
      let data = chunk.toString();

      // 检测并消费 SGR 编码的鼠标事件：ESC[<btn;col;rowM 或 ESC[<btn;col;rowm
      // 移除了 $ 锚点以支持同一 chunk 中包含多个事件（如 press + release）
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列需要匹配 \x1b
      const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
      let sgrMouseMatch: RegExpMatchArray | null;
      let hadMouseEvent = false;

      while (true) {
        sgrMouseMatch = data.match(SGR_MOUSE_RE);
        if (!sgrMouseMatch) break;
        hadMouseEvent = true;
        const btn = Number.parseInt(sgrMouseMatch[1] ?? '0', 10);
        const col = Number.parseInt(sgrMouseMatch[2] ?? '0', 10);
        const row = Number.parseInt(sgrMouseMatch[3] ?? '0', 10);
        const terminator = sgrMouseMatch[4] ?? 'M';

        this.#handleSgrMouseEvent(btn, col, row, terminator);

        // 消费已匹配的 SGR 序列
        data = data.slice(sgrMouseMatch[0].length);
      }

      // 如果 chunk 仅包含鼠标事件，不再转发给键盘处理器
      if (hadMouseEvent && data.length === 0) {
        return;
      }

      if (this.overlayStack.length > 0) {
        // Overlay 模式：顶层 overlay 接收输入
        // biome-ignore lint/style/noNonNullAssertion: guard ensures length > 0
        const top = this.overlayStack[this.overlayStack.length - 1]!;
        top.component.handleInput?.(data);
      } else if (this.focused) {
        this.focused.handleInput?.(data);
      }
    });
  }

  /** 停止 TUI — 恢复光标、清屏、清理定时器和事件 */
  stop(): void {
    this.stopped = true;

    // 清除待处理的节流定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    process.removeListener('exit', this.#exitHandler);

    // 恢复硬件光标
    this.terminal.write('\x1b[?25h');
    this.terminal.cursorTo(0, this.terminal.rows);

    this.terminal.destroy();
    this.terminal.stdin.removeAllListeners('data');
    this.dirty = false;
    this.force = false;
    this.renderScheduled = false;
    this.prevScreen = null;
  }

  // -----------------------------------------------------------------------
  // 渲染控制
  // -----------------------------------------------------------------------

  /**
   * 请求重绘。
   *
   * 通过 queueMicrotask 调度 flush()，在同一个微任务边界内多次调用会合并为一次渲染。
   * flush() 内部有 16ms 节流保障，确保渲染频率不超过 ~60fps。
   *
   * @param force 设为 true 时强制全量重绘（默认 false，仅差量更新）
   */
  requestRender(force?: boolean): void {
    this.dirty = true;
    if (force) {
      this.force = true;
    }
    // 幂等调度：已有待处理的 flush 则不再重复调度
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    queueMicrotask(() => this.flush());
  }

  /**
   * 公共渲染方法 — 供 AnimationManager monkey-patch。
   *
   * AnimationManager 通过替换此方法来插入动画帧推进回调：
   * ```
   * tuiObj.doRender = function() {
   *   // 推进动画帧
   *   for (const cb of callbacks) cb(now);
   *   // 调回原始 doRender
   *   originalDoRender.call(this);
   * };
   * ```
   */
  doRender(): void {
    this.doRenderScreen();
  }

  /**
   * 新版 Screen 管线。
   *
   * 流程：
   * 1. 创建当前帧的 Screen 缓冲区
   * 2. 组件树渲染到 Screen（优先 renderToScreen，回退 ANSI 解析）
   * 3. 检测并应用 DECSTBM 硬件滚动优化（流式输出场景）
   * 4. 与上一帧做差异计算（DECSTBM 后仅边缘行不同）
   * 5. 应用补丁到终端（含 DECSTBM 序列）
   * 6. 帧交换
   */
  private doRenderScreen(): void {
    const width = this.terminal.columns;
    const height = this.terminal.rows;

    // force=true 或 resize → 丢弃 prevScreen，强制全量渲染
    if (this.force) {
      this.prevScreen = null;
      this.force = false;
    }

    const screen = new Screen(height, width);

    // 1. 重置光标标记（组件通过 renderToScreen 设置）
    this.cursorRow = -1;
    this.cursorCol = -1;

    // 2. 渲染组件树到 Screen，同时获取可滚动区域
    const scrollableRect = this.renderComponentsToScreen(screen);

    // ==================================================================
    // 3. DECSTBM 硬件滚动优化（PR 6）
    //
    // 当可滚动区域内容发生 uniform shift（流式追加），用硬件滚动
    // 替换逐 cell 差异输出，减少传输量并提高终端渲染效率。
    //
    // 步骤：
    //   a. detectDecstbmScroll 判断是否 uniform shift
    //   b. 如果是，shiftRows 同步 prevScreen 缓冲区
    //   c. 将 scrollOpt 传给 applyScreenPatches 发射 DECSTBM 序列
    //   d. 后续 diffScreens 因 prevScreen 已同步，只产生边缘行补丁
    // ==================================================================
    let scrollOpt: { top: number; bottom: number; delta: number } | undefined;
    if (this.prevScreen && scrollableRect) {
      const delta = detectDecstbmScroll(this.prevScreen, screen, scrollableRect);
      if (delta !== null && delta !== 0) {
        const { y, height: h } = scrollableRect;
        // 同步 prevScreen 缓冲区：将 shiftRows 后的 prevScreen 作为 baseline
        // 使得 diffScreens 只发现边缘行的差异
        this.prevScreen.shiftRows(y, y + h - 1, delta);
        scrollOpt = { top: y, bottom: y + h - 1, delta };
      }
    }

    // 4. 差异计算（DECSTBM 优化时仅边缘行不同）
    const result = diffScreens(this.prevScreen, screen, this.stylePool);

    // 5. 应用补丁（含 DECSTBM 硬件滚动序列）
    this.applyScreenPatches(result.patches, scrollOpt);

    // 6. 帧交换（旧帧被 GC 回收）
    this.prevScreen = screen;

    // 7. 光标定位
    if (this.cursorRow >= 0) {
      this.terminal.write('\x1b[?25h');
    }
  }

  /**
   * 将组件树渲染到 Screen 缓冲区。
   * 优先使用 renderToScreen 新接口，回退到 ANSI 行解析。
   *
   * 布局逻辑（与旧的 computeOutput 一致）：
   * - 可滚动组件（scrollOffset 已定义）占用剩余高度
   * - 不可滚动组件占用 render(width) 返回的行数
   *
   * 注意：可滚动组件不再调用 render(width) 来测量，避免触发全量换行。
   * 固定组件（StatusBar/Editor）行数极少，调用 render(width) 测量成本可忽略。
   *
   * @returns 可滚动组件的矩形区域（如果没有可滚动组件则为 null）
   */
  private renderComponentsToScreen(screen: Screen): Rect | null {
    const children = this.getLayoutChildren();

    // Pass 1: 测量固定高度组件的高度（可滚动组件不测量）
    let fixedHeight = 0;
    const fixedChildHeights: number[] = [];

    for (const child of children) {
      if (child.scrollOffset !== undefined) {
        // 可滚动组件 — 不调用 render，分配剩余高度
        fixedChildHeights.push(0);
      } else {
        // 固定高度组件 — 调用 render 测量
        const h = child.render(screen.cols).length;
        fixedChildHeights.push(h);
        fixedHeight += h;
      }
    }

    // 可滚动区域可用行数
    const scrollableHeight = Math.max(1, screen.rows - fixedHeight);
    let y = 0;
    let scrollableRect: Rect | null = null;

    // Pass 2: 渲染每个子组件
    for (let i = 0; i < children.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: children[i] guaranteed by loop bounds
      const child = children[i]!;
      const isScrollable = child.scrollOffset !== undefined;

      let rect: Rect;
      if (isScrollable) {
        // 可滚动组件获得全部剩余高度，组件内部自行管理视口
        rect = { x: 0, y, width: screen.cols, height: scrollableHeight };
        scrollableRect = rect;
        y += scrollableHeight;
      } else {
        const h = fixedChildHeights[i] ?? 0;
        rect = { x: 0, y, width: screen.cols, height: h };
        y += h;
      }

      if (child.renderToScreen) {
        child.renderToScreen(screen, this.stylePool, rect);
      } else {
        this.renderChildToScreenFallback(child, screen, rect);
      }
    }

    // 应用 overlay（从底向上）
    for (const entry of this.overlayStack) {
      this.renderOverlayToScreen(screen, entry);
    }

    return scrollableRect;
  }

  /**
   * 旧接口回退：将组件 render(width) 的 ANSI 字符串行解析写入 Screen。
   *
   * 使用模块级 renderAnsiLineToScreen 并在找到光标标记时记录位置。
   */
  private renderChildToScreenFallback(child: Component, screen: Screen, rect: Rect): void {
    const lines = child.render(rect.width);
    const cursorMarker: CursorMarker = { row: -1, col: -1 };
    for (let i = 0; i < lines.length && i < screen.rows - rect.y; i++) {
      renderAnsiLineToScreen(screen, this.stylePool, 0, rect.y + i, lines[i] ?? '', cursorMarker);
    }
    if (cursorMarker.row >= 0) {
      this.cursorRow = cursorMarker.row;
      this.cursorCol = cursorMarker.col;
    }
  }

  /**
   * 将 overlay 渲染到 Screen。
   */
  private renderOverlayToScreen(screen: Screen, entry: OverlayEntry): void {
    const width = this.terminal.columns;
    const overlayLines = entry.component.render(width);
    const rect = this.calculateOverlayRect(entry, overlayLines.length);

    for (let i = 0; i < overlayLines.length && rect.row + i < screen.rows; i++) {
      renderAnsiLineToScreen(screen, this.stylePool, 0, rect.row + i, overlayLines[i] ?? '');
    }
  }

  /**
   * 将 Screen 差异补丁应用到终端。
   *
   * @param patches 差异补丁列表
   * @param scrollOpt 可选，硬件滚动参数 — 在常规补丁之前发射 DECSTBM + SU/SD 序列
   */
  private applyScreenPatches(
    patches: Patch[],
    scrollOpt?: { top: number; bottom: number; delta: number }
  ): void {
    let buf = BSU;

    // ====================================================================
    // 前置: DECSTBM 硬件滚动
    // 在 apply 常规补丁之前发射，使终端先完成行位移。
    // 配合 doRenderScreen 中的 prevScreen.shiftRows()，使得后续 diff
    // 只产生边缘行的补丁，大幅减少输出量。
    // ====================================================================
    if (scrollOpt && scrollOpt.delta !== 0) {
      const { top, bottom, delta } = scrollOpt;
      // 设置滚动区域 → 硬件滚动 → 重置滚动区域 → 光标归位
      buf += setScrollRegion(top + 1, bottom + 1);
      buf += delta > 0 ? scrollUp(delta) : scrollDown(-delta);
      buf += RESET_SCROLL_REGION;
      buf += `${CSI}H`; // 光标归位
    }

    for (const patch of patches) {
      switch (patch.type) {
        case 'move':
          buf += `\r${CSI}${patch.y + 1};${patch.x + 1}H`;
          break;
        case 'write':
          buf += patch.text;
          break;
        case 'style':
          buf += patch.style;
          break;
        case 'clearLine': {
          const y = patch.y;
          const count = patch.count ?? 1;
          if (count <= 1) {
            buf += `\r${CSI}${y + 1};1H${CSI}2K`;
          } else {
            for (let i = 0; i < count; i++) {
              buf += `\r${CSI}${y + 1 + i};1H${CSI}2K`;
            }
          }
          break;
        }
      }
    }

    // 硬件光标定位
    if (this.cursorRow >= 0 && this.cursorCol >= 0) {
      buf += `\r${CSI}${this.cursorRow + 1};${this.cursorCol + 1}H`;
    }

    buf += ESU;
    this.terminal.write(buf);
  }

  /**
   * 执行实际的渲染流程（由 requestRender 通过 queueMicrotask 调度）。
   *
   * 节流逻辑：
   * 1. 检查自上次渲染是否已过去至少 MIN_RENDER_INTERVAL 毫秒
   * 2. 如果否：用 setTimeout 延迟到剩余时间后重试
   * 3. 如果是且 dirty=true：执行 doRender()
   *
   * flush() 会被以下路径调用：
   * - requestRender() → queueMicrotask → flush()
   * - 节流延迟到期 → setTimeout → flush()
   * - start() 后首次 requestRender()（来自 ReplSession）
   */
  private flush(): void {
    // stop() 后不再执行 — 即使有残留的定时器或 microtask
    if (this.stopped) return;

    this.renderScheduled = false;

    const now = performance.now();
    const elapsed = now - this.lastRenderTime;

    if (elapsed < 16) {
      // 距离上次渲染不足 16ms → 延迟到剩余时间后再检查
      const delay = 16 - elapsed;
      this.flushTimer = setTimeout(() => this.flush(), delay);
      return;
    }

    if (this.dirty) {
      this.doRender();
      this.dirty = false;
      this.force = false;
      this.lastRenderTime = performance.now();
    }
  }

  // -----------------------------------------------------------------------
  // Overlay 系统
  // -----------------------------------------------------------------------

  /**
   * 显示 Overlay。
   * @returns OverlayHandle 包含 hide() 方法用于关闭 overlay
   */
  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
    const entry: OverlayEntry = { component, options: options ?? {} };
    this.overlayStack.push(entry);
    this.requestRender(true);
    return {
      hide: () => {
        const idx = this.overlayStack.indexOf(entry);
        if (idx >= 0) {
          this.overlayStack.splice(idx, 1);
        }
        this.requestRender(true);
      },
    };
  }

  // --------------------------------------------------
  // 硬件光标控制（可选，供 ZapmycoEditor 使用）
  // --------------------------------------------------

  setShowHardwareCursor(visible: boolean): void {
    if (visible) {
      this.terminal.write('\x1b[?25h');
    } else {
      this.terminal.write('\x1b[?25l');
    }
  }

  /**
   * 进程退出时的安全网 — 退出 alt screen、恢复光标。
   * 在 process.on('exit') 中只能使用同步操作。
   */
  readonly #exitHandler = () => {
    writeSync(1, `${EXIT_ALT_SCREEN}\x1b[?25h`);
  };

  // ======================================================================
  // 私有方法
  // ======================================================================

  /**
   * 解析并分发 SGR 编码的鼠标事件。
   *
   * 滚轮事件（btn===64/65）走现有 handleScroll 路径。
   * 其他事件构造 SgrMouseEvent，通过 handleMouseEvent 分发给组件。
   */
  #handleSgrMouseEvent(btn: number, col: number, row: number, terminator: string): void {
    // 滚轮事件（64=up, 65=down）
    if (btn === 64 || btn === 65) {
      const direction: 'up' | 'down' = btn === 64 ? 'up' : 'down';
      // 优先分发给焦点组件
      if (this.focused?.handleScroll) {
        this.focused.handleScroll(direction);
        this.requestRender();
        return;
      }
      // 其次查找根容器中的可滚动子组件
      const scrollableChildren = this.getLayoutChildren();
      for (const child of scrollableChildren) {
        if (child.handleScroll) {
          child.handleScroll(direction);
          this.requestRender();
          return;
        }
      }
      return;
    }

    // 非滚轮事件：构造 SgrMouseEvent 并分发
    const action = terminator === 'm' ? 'release' : (btn & 0x20) !== 0 ? 'drag' : 'press';

    logger.info(
      `SGR_MOUSE btn=${btn} col=${col} row=${row} action=${action} button=${btn & 3} meta=${(btn & 8) !== 0}`
    );

    const event: SgrMouseEvent = {
      btn,
      col,
      row,
      action,
      button: btn & 3,
      shiftKey: (btn & 4) !== 0,
      metaKey: (btn & 8) !== 0,
      ctrlKey: (btn & 16) !== 0,
    };

    // 优先分发给焦点组件
    if (this.focused?.handleMouseEvent) {
      this.focused.handleMouseEvent(event);
      this.requestRender();
      return;
    }

    // 其次查找子组件
    const children = this.getLayoutChildren();
    for (const child of children) {
      if (child.handleMouseEvent) {
        child.handleMouseEvent(event);
        this.requestRender();
        return;
      }
    }
  }

  /**
   * 计算 overlay 的矩形区域（位置 + 尺寸）
   *
   * 所有现有 overlay 均使用 anchor: 'top-left'，布局逻辑：
   *  - width：百分比 → terminal.columns * pct；数字 → 直接使用；默认 100%
   *  - height：由内容决定，maxHeight 限制
   *  - row：margin.top（默认 0）
   *  - col：0
   */
  private calculateOverlayRect(entry: OverlayEntry, contentHeight: number): OverlayRect {
    const opts = entry.options;
    const tw = this.terminal.columns;
    const th = this.terminal.rows;

    // --- 宽度 ---
    let width = tw; // 默认 100%
    if (typeof opts.width === 'string' && opts.width.endsWith('%')) {
      const pct = Number.parseInt(opts.width, 10) / 100;
      width = Math.floor(tw * pct);
    } else if (typeof opts.width === 'number') {
      width = opts.width;
    }
    if (opts.minWidth) {
      width = Math.max(width, opts.minWidth);
    }
    width = Math.min(width, tw);

    // --- 高度 ---
    let height = contentHeight;
    if (opts.maxHeight) {
      if (typeof opts.maxHeight === 'string' && opts.maxHeight.endsWith('%')) {
        const pct = Number.parseInt(opts.maxHeight, 10) / 100;
        height = Math.min(height, Math.floor(th * pct));
      } else if (typeof opts.maxHeight === 'number') {
        height = Math.min(height, opts.maxHeight);
      }
    }
    height = Math.min(height, th);

    // --- 位置 ---
    let row = 0;
    if (opts.anchor === 'top-left' || !opts.anchor) {
      const margin = opts.margin;
      if (typeof margin === 'number') {
        row = margin;
      } else if (margin) {
        row = (margin as OverlayMargin).top ?? 0;
      }
    }
    const col = 0;

    return { row, col, width, height };
  }

  /**
   * 获取布局子组件列表
   *
   * TUI.root 可能只有一层包装容器（如 ReplSession 创建的根 Container），
   * 实际渲染组件在包装容器的 children 中。此方法解一层包装直接获取实际子组件。
   */
  private getLayoutChildren(): Component[] {
    const outerChildren = this.root.getChildren();
    if (outerChildren.length === 1 && outerChildren[0] instanceof Container) {
      return outerChildren[0].getChildren();
    }
    return outerChildren;
  }
}
