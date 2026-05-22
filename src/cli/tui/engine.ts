/**
 * TUI — 终端 UI 引擎
 *
 * 本地实现的 TUI 引擎。
 * 管理渲染循环（事件驱动 + 16ms 节流）、组件树、焦点、Overlay 栈、差量渲染。
 *
 * ### 渲染流程
 * ```
 * 组件调用 requestRender() → dirty=true
 *   → queueMicrotask → flush() 被调度
 *   → 检查节流（距上次渲染 ≥ 16ms）
 *   → [Screen 管线]: renderToScreen → diffScreens → applyPatches
 *   → [旧管线]:    computeOutput → deltaUpdate / forceFullRedraw
 *   → 定位硬件光标
 * ```
 *
 * ### 双管线架构
 * useScreenPipeline 标志控制使用哪条渲染路径：
 * - true  (新管线): Screen 缓冲区 + Cell 级 Diff → Patch → applyPatches
 * - false (旧管线): render(width) → string[] → deltaUpdate（逐行比较）
 *
 * 组件逐步迁移到 renderToScreen 新接口后切换标志。
 *
 * 空闲时无任何定时器运行。
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
import { Container } from './container';
import { BSU, CSI, ESU, EXIT_ALT_SCREEN } from './dec';
import type { Patch } from './diff';
import { diffScreens } from './diff';
import { Screen } from './screen';
import { StylePool } from './style-pool';
import type { ProcessTerminal } from './terminal';
import type { Component, OverlayHandle, OverlayMargin, OverlayOptions, Rect } from './types';

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
const CURSOR_MARKER = '\u001B_pi:c\u0007';
// biome-ignore lint/suspicious/noControlCharactersInRegex: CURSOR_MARKER 包含 ESC 和 BEL 控制字符
const CURSOR_MARKER_RE = /\u001B_pi:c\u0007/g;

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

  /** 上一帧的输出行数组，用于逐行 diff */
  private lastOutput: string[] = [];

  /** 当前获得焦点的组件 */
  private focused: Component | null = null;

  /** 编辑器光标位置（从光标标记解析） */
  private cursorRow = -1;
  private cursorCol = -1;

  // -----------------------------------------------------------------------
  // Screen 管线字段
  // -----------------------------------------------------------------------

  /** 上一帧的 Screen 缓冲区（用于差异计算） */
  private prevScreen: Screen | null = null;

  /** 样式池（跨帧共享） */
  private stylePool = new StylePool();

  /** 是否使用新 Screen 管线（true = 新管线, false = 旧字符串管线） */
  private useScreenPipeline = false;

  /** 启用 Screen 管线（供测试和逐步迁移使用） */
  enableScreenPipeline(): void {
    this.useScreenPipeline = true;
    this.prevScreen = null;
    this.force = true;
    this.requestRender();
  }

  /** 禁用 Screen 管线，回退到旧字符串管线 */
  disableScreenPipeline(): void {
    this.useScreenPipeline = false;
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
    this.lastOutput = [];
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
        // 仅处理滚轮事件（64=up, 65=down），忽略按钮释放等事件
        if (btn === 64 || btn === 65) {
          this.handleSgrMouseEvent(btn);
        }
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
    this.lastOutput = [];
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
    if (this.useScreenPipeline) {
      this.doRenderScreen();
    } else {
      this.doRenderLegacy();
    }
  }

  /**
   * 旧版渲染管线（字符串比较）。
   * 作为新管线的回退。
   */
  private doRenderLegacy(): void {
    const lines = this.computeOutput();

    if (this.force || this.lastOutput.length === 0) {
      this.forceFullRedraw(lines);
    } else {
      this.deltaUpdate(lines);
    }

    // 如果编辑器在渲染中嵌入了光标标记，定位硬件光标后重新显示
    if (this.cursorRow >= 0) {
      this.terminal.write('\x1b[?25h');
    }

    this.lastOutput = lines;
  }

  /**
   * 新版 Screen 管线。
   *
   * 流程：
   * 1. 创建当前帧的 Screen 缓冲区
   * 2. 组件树渲染到 Screen（优先 renderToScreen，回退 ANSI 解析）
   * 3. 与上一帧做差异计算
   * 4. 应用补丁到终端
   * 5. 帧交换
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

    // 2. 渲染组件树到 Screen
    this.renderComponentsToScreen(screen);

    // 3. 差异计算
    const result = diffScreens(this.prevScreen, screen, this.stylePool);

    // 4. 应用补丁
    this.applyScreenPatches(result.patches);

    // 5. 帧交换（旧帧被 GC 回收）
    this.prevScreen = screen;

    // 6. 光标定位
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
   */
  private renderComponentsToScreen(screen: Screen): void {
    const children = this.getLayoutChildren();
    const outputs: { lines: string[]; scrollable: boolean }[] = [];
    let scrollOffset = 0;
    let fixedHeight = 0;

    for (const child of children) {
      const childLines = child.render(screen.cols);
      const isScrollable = child.scrollOffset !== undefined;
      if (isScrollable) {
        scrollOffset = child.scrollOffset;
      } else {
        fixedHeight += childLines.length;
      }
      outputs.push({ lines: childLines, scrollable: isScrollable });
    }

    // 可滚动区域可用行数
    const scrollableHeight = Math.max(1, screen.rows - fixedHeight);
    let y = 0;

    for (let i = 0; i < children.length; i++) {
      const child =
        children[i] ??
        (() => {
          throw new Error('unreachable');
        })();
      const entry =
        outputs[i] ??
        (() => {
          throw new Error('unreachable');
        })();

      let rect: Rect;

      if (entry.scrollable) {
        // 可滚动组件：计算 slices 后的可见区域
        const maxStart = Math.max(0, entry.lines.length - scrollableHeight);
        const visibleStart = Math.max(0, maxStart - scrollOffset);
        const visibleCount = Math.min(scrollableHeight, entry.lines.length - visibleStart);
        // 使用 y=0 并让组件写入到顶行（因为实际切片后的行从 0 开始渲染）
        rect = { x: 0, y, width: screen.cols, height: visibleCount };
        y += scrollableHeight;
      } else {
        rect = { x: 0, y, width: screen.cols, height: entry.lines.length };
        y += entry.lines.length;
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
  }

  /**
   * 旧接口回退：将组件 render(width) 的 ANSI 字符串行解析写入 Screen。
   */
  private renderChildToScreenFallback(child: Component, screen: Screen, rect: Rect): void {
    const lines = child.render(rect.width);
    for (let i = 0; i < lines.length && i < screen.rows - rect.y; i++) {
      this.renderAnsiLineToScreen(screen, 0, rect.y + i, lines[i] ?? '');
    }
  }

  /**
   * 将 ANSI 字符串行解析为 Screen 单元格。
   */
  private renderAnsiLineToScreen(screen: Screen, x: number, y: number, line: string): void {
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
          if (
            codeStr === '0' ||
            codeStr === '' ||
            codeStr.includes('39') ||
            codeStr.includes('49')
          ) {
            styleId = 0;
          } else if (codeStr.startsWith('38;5;') || codeStr.startsWith('48;5;')) {
            // 256 色
            styleId = this.stylePool.intern([codeStr]);
          } else if (codeStr.startsWith('38;2;') || codeStr.startsWith('48;2;')) {
            // 真彩色
            styleId = this.stylePool.intern([codeStr]);
          } else {
            styleId = this.stylePool.intern([codeStr]);
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
          // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 序列含 ESC
          const plainBefore = line.slice(0, i).replace(/\x1b\[[\d;]*m/g, '');
          this.cursorRow = y;
          this.cursorCol = plainBefore.length;
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

  /**
   * 将 overlay 渲染到 Screen。
   */
  private renderOverlayToScreen(screen: Screen, entry: OverlayEntry): void {
    const width = this.terminal.columns;
    const overlayLines = entry.component.render(width);
    const rect = this.calculateOverlayRect(entry, overlayLines.length);

    for (let i = 0; i < overlayLines.length && rect.row + i < screen.rows; i++) {
      this.renderAnsiLineToScreen(screen, 0, rect.row + i, overlayLines[i] ?? '');
    }
  }

  /**
   * 将 Screen 差异补丁应用到终端。
   */
  private applyScreenPatches(patches: Patch[]): void {
    let buf = BSU;

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
   * 处理 SGR 编码的鼠标事件
   * @returns true 如果事件已处理
   */
  private handleSgrMouseEvent(btn: number): boolean {
    // 64 = wheel up, 65 = wheel down
    if (btn === 64 || btn === 65) {
      const direction: 'up' | 'down' = btn === 64 ? 'up' : 'down';
      // 优先分发给焦点组件
      if (this.focused?.handleScroll) {
        this.focused.handleScroll(direction);
        this.requestRender();
        return true;
      }
      // 其次查找根容器中的可滚动子组件
      const scrollableChildren = this.getLayoutChildren();
      for (const child of scrollableChildren) {
        if (child.handleScroll) {
          child.handleScroll(direction);
          this.requestRender();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 计算完整输出 — 渲染组件树 → 应用 overlay → 限制行数
   *
   * 当有组件处于滚动状态（scrollOffset > 0）时，切片会保留更多历史内容，
   * 而非仅保留末尾 height 行。
   */
  private computeOutput(): string[] {
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    this.cursorRow = -1;
    this.cursorCol = -1;

    // 1. 获取实际布局子组件（跳过 Container 包装层）
    const children = this.getLayoutChildren();

    const outputs: { lines: string[]; scrollable: boolean }[] = [];
    let scrollOffset = 0;
    let fixedHeight = 0;

    for (const child of children) {
      const childLines = child.render(width);
      const isScrollable = child.scrollOffset !== undefined;
      if (isScrollable) {
        scrollOffset = child.scrollOffset;
      } else {
        fixedHeight += childLines.length;
      }
      outputs.push({ lines: childLines, scrollable: isScrollable });
    }

    // 2. 计算可滚动区域可用行数
    const scrollableHeight = Math.max(1, height - fixedHeight);

    // 3. 按顺序组装输出，可滚动组件按 scrollOffset 切片
    let lines: string[] = [];
    for (const entry of outputs) {
      if (entry.scrollable && entry.lines.length > scrollableHeight) {
        // 有滚动偏移时从更早位置切片
        const maxStart = entry.lines.length - scrollableHeight;
        const start = Math.max(0, maxStart - scrollOffset);
        lines.push(...entry.lines.slice(start, start + scrollableHeight));
      } else {
        lines.push(...entry.lines);
      }
    }

    // 安全网：确保总行数不超过终端高度
    if (lines.length > height) {
      lines = lines.slice(0, height);
    }

    // 3. 应用 overlay（从底向上，栈顶在最上面）
    for (const entry of this.overlayStack) {
      lines = this.applyOverlay(lines, entry);
    }

    // 4. 扫描并移除光标标记
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const markerIdx = line.indexOf(CURSOR_MARKER);
      if (markerIdx >= 0) {
        // 移除标记
        lines[i] = line.replace(CURSOR_MARKER_RE, '');
        // 计算标记位置的可见宽度（不含 ANSI 码）
        this.cursorRow = i;
        this.cursorCol = visibleWidth(line.substring(0, markerIdx));
      }
    }

    return lines;
  }

  /**
   * 将 overlay 渲染结果叠加到基础输出上
   */
  private applyOverlay(base: string[], entry: OverlayEntry): string[] {
    const width = this.terminal.columns;
    const overlayLines = entry.component.render(width);
    const rect = this.calculateOverlayRect(entry, overlayLines.length);

    const result = [...base];

    // 限制 overlay 高度不超过终端可用行数
    const clampedHeight = Math.min(rect.height, this.terminal.rows - rect.row);

    for (let i = 0; i < clampedHeight; i++) {
      const targetRow = rect.row + i;
      // 确保目标行存在
      while (targetRow >= result.length) {
        result.push('');
      }
      const overlayLine = i < overlayLines.length ? (overlayLines[i] ?? '') : '';
      // 截断或填充到指定宽度
      result[targetRow] = overlayLine.padEnd(rect.width).slice(0, rect.width);
    }

    return result;
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
   * 差量更新 — 逐行比较 lastOutput 与新输出，仅变更的行
   *
   * 输出用 BSU/ESU 包裹以实现原子帧刷新，消除终端撕裂。
   */
  private deltaUpdate(newOutput: string[]): void {
    const oldOutput = this.lastOutput;
    if (oldOutput.length === 0) {
      this.forceFullRedraw(newOutput);
      return;
    }

    const maxLen = Math.max(newOutput.length, oldOutput.length);
    let buf = BSU;

    for (let i = 0; i < maxLen; i++) {
      if (i >= newOutput.length) {
        // 行被删除 → 清空
        buf += `\r\x1b[${i + 1};1H\x1b[2K`;
      } else if (i >= oldOutput.length || newOutput[i] !== oldOutput[i]) {
        // 新行或内容变化 → 覆写后清行尾（确保旧行无残留）
        buf += `\r\x1b[${i + 1};1H`;
        buf += newOutput[i] ?? '';
        buf += '\x1b[0K';
      }
    }

    // 定位硬件光标
    if (this.cursorRow >= 0 && this.cursorCol >= 0) {
      buf += `\r\x1b[${this.cursorRow + 1};${this.cursorCol + 1}H`;
    }

    buf += ESU;
    this.terminal.write(buf);
  }

  /**
   * 全量重绘 — 清屏后重新写入所有行
   *
   * 输出用 BSU/ESU 包裹以实现原子帧刷新，消除终端撕裂。
   */
  private forceFullRedraw(lines: string[]): void {
    let buf = BSU;
    buf += '\r\x1b[1;1H'; // cursorTo(0, 0) 内联

    // 写入所有行，每行后 \r\n（raw mode 下 \n 不回行首）
    for (let i = 0; i < lines.length; i++) {
      buf += `${lines[i] ?? ''}\x1b[0K`;
      if (i < lines.length - 1) {
        buf += '\r\n';
      }
    }

    // 清空多余行
    if (this.lastOutput.length > lines.length) {
      for (let i = lines.length; i < this.lastOutput.length; i++) {
        buf += `\r\x1b[${i + 1};1H\x1b[2K`;
      }
    }

    // 定位硬件光标
    if (this.cursorRow >= 0 && this.cursorCol >= 0) {
      buf += `\r\x1b[${this.cursorRow + 1};${this.cursorCol + 1}H`;
    }

    buf += ESU;
    this.terminal.write(buf);
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

// ======================================================================
// 工具函数
// ======================================================================

/** ANSI 转义序列正则（用于计算可见宽度时排除） */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列包含 ESC 控制字符
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** 计算字符串的可见宽度（排除 ANSI 码） */
function visibleWidth(text: string): number {
  // 简单实现：排除 ANSI 控制序列后取长度
  // 不考虑 CJK 双宽字符（因为用于光标定位列号，不影响正确性）
  return text.replace(ANSI_RE, '').length;
}
