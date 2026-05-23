/**
 * ClickEvent — 点击事件
 *
 * 终端中鼠标点击触发。
 * col/row 为 0-indexed 屏幕坐标。
 * localCol/localRow 在每个处理器触发前由 dispatchClick 计算，
 * 为相对于当前处理器所在 Box 的位置。
 *
 * 注意：extends Event（不是 TerminalEvent）。
 * 完整 hit-test 功能在 PR9 中实现。
 */

import { Event } from './event.js';

export class ClickEvent extends Event {
  readonly col: number;
  readonly row: number;
  localCol = 0;
  localRow = 0;
  readonly cellIsBlank: boolean;

  constructor(col: number, row: number, cellIsBlank: boolean) {
    super();
    this.col = col;
    this.row = row;
    this.cellIsBlank = cellIsBlank;
  }
}
