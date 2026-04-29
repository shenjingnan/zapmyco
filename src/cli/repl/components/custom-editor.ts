/**
 * 自定义编辑器组件
 *
 * 继承自 pi-tui 的 Editor，添加 zapmyco 特有的快捷键处理：
 * - Ctrl+C: 取消任务 / 二次退出
 * - Ctrl+D: 退出
 * - Escape: 取消当前输入
 *
 * 同时 override render() 以：
 * - 去掉 Editor 默认的上下边框（───）
 * - 添加简洁的输入提示符（❯ ）
 * - 执行中时显示 loading spinner
 */

import { Editor, Key, matchesKey, truncateToWidth } from '@mariozechner/pi-tui';

/** 输入提示符 */
const PROMPT_PREFIX = '\u276f '; // "❯ "

/** loading 动画帧 */
const LOADING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** ANSI 转义码正则（用于从渲染行中剥离颜色标记） */
// biome-ignore lint/complexity/useRegexLiterals: 避免正则字面量中的控制字符
const ANSI_RE = new RegExp(`\\x1b\\[[0-9;]*m`, 'g');

/** 判断一行是否为 Editor 的 border 行（去除 ANSI 转义码后判断） */
function isBorderLine(line: string): boolean {
  const stripped = line.replace(ANSI_RE, '');
  return /^[\s─┌┐├┤└┘↑↓\-0-9a-zA-Z]+$/.test(stripped);
}

export class ZapmycoEditor extends Editor {
  /** Escape 键回调 */
  onEscape?: () => void;

  /** Ctrl+C 回调 */
  onCtrlC?: () => void;

  /** Ctrl+D 回调 */
  onCtrlD?: () => void;

  /** 是否正在执行（用于显示 loading） */
  #executing = false;

  /** loading 动画帧索引 */
  #loadingFrame = 0;

  /** loading 动画定时器 */
  #loadingTimer?: ReturnType<typeof setInterval> | undefined;

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) && this.onEscape) {
      this.onEscape();
      return;
    }
    if (matchesKey(data, Key.ctrl('c')) && this.onCtrlC) {
      this.onCtrlC();
      return;
    }
    if (matchesKey(data, Key.ctrl('d'))) {
      if (this.getText().length === 0 && this.onCtrlD) {
        this.onCtrlD();
      }
      return;
    }
    super.handleInput(data);
  }

  /**
   * 设置执行状态（控制 loading spinner 显示）
   */
  setExecuting(executing: boolean): void {
    if (this.#executing === executing) return;
    this.#executing = executing;
    if (executing) {
      this.#loadingFrame = 0;
      this.#loadingTimer = setInterval(() => {
        this.#loadingFrame = (this.#loadingFrame + 1) % LOADING_FRAMES.length;
        this.tui?.requestRender();
      }, 100);
    } else {
      if (this.#loadingTimer) {
        clearInterval(this.#loadingTimer);
        this.#loadingTimer = undefined;
      }
    }
    this.tui?.requestRender();
  }

  get executing(): boolean {
    return this.#executing;
  }

  /**
   * Override render(): 去掉默认的上下边框，添加输入提示符和 loading 状态。
   *
   * 策略：调用 super.render() 获取完整的带边框输出，
   * 然后移除首尾 border 行，再在内容行前添加提示符前缀。
   */
  override render(width: number): string[] {
    const rawLines = super.render(width);

    // Editor 至少有 top-border + content + bottom-border
    if (rawLines.length < 3) {
      return rawLines;
    }

    // 识别并移除 top border 和 bottom border 行
    let startIndex = 0;
    if (isBorderLine(rawLines[0] ?? '')) {
      startIndex = 1;
    }

    let endIndex = rawLines.length;
    if (isBorderLine(rawLines[rawLines.length - 1] ?? '')) {
      endIndex = rawLines.length - 1;
    }

    const contentLines = rawLines.slice(startIndex, endIndex);

    // 计算提示符宽度（grapheme 数量）
    const promptWidth = [...PROMPT_PREFIX].length;

    // 在每行前面添加提示符（续行用空格对齐），并截断到终端宽度
    for (let i = 0; i < contentLines.length; i++) {
      const prefix = i === 0 ? PROMPT_PREFIX : ' '.repeat(promptWidth);

      let line: string;
      // 第一行：如果正在执行，在提示符后追加 loading spinner
      if (i === 0 && this.#executing) {
        const frame = LOADING_FRAMES[this.#loadingFrame];
        line = `${prefix}${frame} ${contentLines[i]}`;
      } else {
        line = prefix + contentLines[i];
      }

      // 截断到终端宽度，避免超宽报错
      contentLines[i] = truncateToWidth(line, width);
    }

    return contentLines;
  }
}
