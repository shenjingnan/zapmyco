/**
 * 自定义编辑器组件
 *
 * 继承自 pi-tui 的 Editor，添加 zapmyco 特有的快捷键处理：
 * - Ctrl+C: 取消任务 / 二次退出
 * - Ctrl+D: 退出
 * - Escape: 取消当前输入
 */

import { Editor, Key, matchesKey } from '@mariozechner/pi-tui';

export class ZapmycoEditor extends Editor {
  /** Escape 键回调 */
  onEscape?: () => void;

  /** Ctrl+C 回调 */
  onCtrlC?: () => void;

  /** Ctrl+D 回调 */
  onCtrlD?: () => void;

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
}
