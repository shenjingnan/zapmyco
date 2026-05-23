/**
 * searchHighlight — 搜索高亮叠加
 *
 * 在 Screen buffer 上应用搜索匹配的高亮显示。
 * 使用 SGR 7（反转色）标记匹配文本。
 * 大小写不敏感，宽字符感知，跳过 noSelect 区域。
 *
 * 参考 claude-code src/ink/searchHighlight.ts
 */

import type { Screen } from './screen';
import { withInverse } from './style-cache';

/**
 * 在 Screen buffer 上应用搜索高亮。
 *
 * @param screen    - 屏幕缓冲区
 * @param query     - 搜索查询（空字符串 = 清除高亮）
 * @param stylePool - 样式池（用于 withInverse）
 * @returns 是否有任何匹配（caller 可用此触发全帧 damage）
 */
export function applySearchHighlight(screen: Screen, query: string): boolean {
  if (!query) return false;

  const lq = query.toLowerCase();
  const qlen = lq.length;
  const rows = screen.rows;
  const cols = screen.cols;
  let hasMatch = false;

  for (let row = 0; row < rows; row++) {
    const rowOff = row * cols;

    // 构建小写文本行和平行列映射
    const text: string[] = [];
    const colOf: number[] = [];
    const codeUnitToCell: number[] = [];

    for (let col = 0; col < cols; col++) {
      const cell = screen.getCell(col, row);
      // 跳过 noSelect、spacer tail（宽字符第二格）和 spacer head（行尾填充）
      if (screen.noSelect[rowOff + col] === 1) continue;
      if (cell.width === 2 && cell.char === '') continue; // SpacerTail
      if (cell.char === '') continue; // SpacerHead

      const charLower = cell.char.toLowerCase();
      text.push(charLower);
      colOf.push(col);
      for (let u = 0; u < cell.char.length; u++) {
        codeUnitToCell.push(col);
      }
    }

    const lineText = text.join('');
    if (lineText.length < qlen) continue;

    // 查找所有匹配
    let pos = 0;
    for (;;) {
      pos = lineText.indexOf(lq, pos);
      if (pos === -1) break;
      hasMatch = true;

      // 将字符位置映射回屏幕列
      for (let ci = 0; ci < qlen; ci++) {
        const cellCol = colOf[pos + ci];
        if (cellCol === undefined) break;
        const cell = screen.getCell(cellCol, row);
        const invStyleId = withInverse(cell.styleId);
        screen.setCellStyleId(cellCol, row, invStyleId);
      }

      pos += qlen;
    }
  }

  return hasMatch;
}
