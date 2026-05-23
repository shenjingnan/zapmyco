/** 可聚焦组件 */
export interface Focusable {
  id: string;
  isActive: boolean;
}

/** 焦点变化回调 */
export type FocusChangeCallback = (id: string | undefined) => void;

/**
 * FocusManager — 焦点管理。
 *
 * 追踪当前拥有键盘焦点的组件，处理 Tab/Shift+Tab 焦点遍历。
 *
 * Focusable 按 add() 调用的顺序维护隐式顺序。
 * 当一个组件被移除时，聚焦会回退到列表中的上一个元素。
 */
export class FocusManager {
  private focusables: Map<string, Focusable> = new Map();
  /** 维护 add 顺序的有序 id 列表 */
  private orderedIds: string[] = [];
  private activeId: string | undefined;
  private changeCallbacks: Set<FocusChangeCallback> = new Set();

  add(id: string, autoFocus = false): void {
    if (!this.focusables.has(id)) {
      this.orderedIds.push(id);
    }
    this.focusables.set(id, { id, isActive: true });
    if (autoFocus && !this.activeId) {
      this.activeId = id;
    }
  }

  remove(id: string): void {
    this.focusables.delete(id);
    const idx = this.orderedIds.indexOf(id);
    if (idx !== -1) {
      this.orderedIds.splice(idx, 1);
    }
    if (this.activeId === id) {
      // 回到前一个元素
      this.activeId =
        this.orderedIds.length > 0
          ? this.orderedIds[Math.min(idx, this.orderedIds.length - 1)]
          : undefined;
      this.notifyChange();
    }
  }

  /**
   * 将焦点移到下一个可聚焦组件。
   * 如果当前没有焦点，聚焦第一个。
   * 如果已在最后一个，回到第一个（循环）。
   */
  focusNext(): void {
    if (this.orderedIds.length === 0) return;

    if (!this.activeId) {
      // 没有焦点 → 聚焦第一个
      this.activeId = this.orderedIds[0];
      this.notifyChange();
      return;
    }

    const currentIdx = this.orderedIds.indexOf(this.activeId);
    if (currentIdx === -1) {
      this.activeId = this.orderedIds[0];
      this.notifyChange();
      return;
    }

    // 找下一个 isActive 的元素
    for (let i = 1; i <= this.orderedIds.length; i++) {
      const nextIdx = (currentIdx + i) % this.orderedIds.length;
      const nextId = this.orderedIds[nextIdx];
      if (nextId && this.focusables.get(nextId)?.isActive) {
        this.activeId = nextId;
        this.notifyChange();
        return;
      }
    }
  }

  /**
   * 将焦点移到上一个可聚焦组件。
   * 如果当前没有焦点，聚焦最后一个。
   * 如果已在第一个，回到最后一个（循环）。
   */
  focusPrevious(): void {
    if (this.orderedIds.length === 0) return;

    if (!this.activeId) {
      this.activeId = this.orderedIds[this.orderedIds.length - 1];
      this.notifyChange();
      return;
    }

    const currentIdx = this.orderedIds.indexOf(this.activeId);
    if (currentIdx === -1) {
      this.activeId = this.orderedIds[this.orderedIds.length - 1];
      this.notifyChange();
      return;
    }

    // 找上一个 isActive 的元素
    for (let i = 1; i <= this.orderedIds.length; i++) {
      const prevIdx = (currentIdx - i + this.orderedIds.length) % this.orderedIds.length;
      const prevId = this.orderedIds[prevIdx];
      if (prevId && this.focusables.get(prevId)?.isActive) {
        this.activeId = prevId;
        this.notifyChange();
        return;
      }
    }
  }

  /** 设置指定 id 为焦点 */
  focus(id: string): void {
    if (this.focusables.has(id) && this.activeId !== id) {
      this.activeId = id;
      this.notifyChange();
    }
  }

  get activeFocusId(): string | undefined {
    return this.activeId;
  }

  /** 订阅焦点变化 */
  onChange(cb: FocusChangeCallback): () => void {
    this.changeCallbacks.add(cb);
    return () => {
      this.changeCallbacks.delete(cb);
    };
  }

  private notifyChange(): void {
    for (const cb of this.changeCallbacks) {
      cb(this.activeId);
    }
  }
}
