/** 可聚焦组件 */
export interface Focusable {
  id: string;
  isActive: boolean;
}

/**
 * FocusManager — 焦点管理。
 *
 * 追踪当前拥有键盘焦点的组件，处理 Tab/Shift+Tab 焦点遍历。
 * PR1: 骨架，完整实现在后续 PR。
 */
export class FocusManager {
  private focusables: Map<string, Focusable> = new Map();
  private activeId: string | undefined;

  add(id: string, autoFocus = false): void {
    this.focusables.set(id, { id, isActive: true });
    if (autoFocus && !this.activeId) {
      this.activeId = id;
    }
  }

  remove(id: string): void {
    this.focusables.delete(id);
    if (this.activeId === id) {
      this.activeId = undefined;
    }
  }

  /** PR1: 预留 */
  focusNext(): void {
    // TODO
  }

  /** PR1: 预留 */
  focusPrevious(): void {
    // TODO
  }

  get activeFocusId(): string | undefined {
    return this.activeId;
  }
}
