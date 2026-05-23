/**
 * useSearchHighlight — 搜索高亮 hook
 *
 * 提供设置搜索查询、扫描元素和定位匹配的方法。
 * 高层封装：setQuery → 反转所有可见匹配，setPositions → 黄色高亮当前匹配。
 *
 * 参考 claude-code src/ink/hooks/use-search-highlight.ts
 */

import { useContext, useMemo } from 'react';
import { StdinContext } from '../components/StdinContext';
import type { DOMElement } from '../dom';
import instances from '../instances';
import type { MatchPosition } from '../render-to-screen';

/**
 * Hook 返回搜索高亮操作方法。
 *
 * @returns { setQuery, scanElement, setPositions }
 */
export function useSearchHighlight(): {
  setQuery: (query: string) => void;
  /** 将 DOM 子树绘制到独立 Screen 并扫描匹配 */
  scanElement: (el: DOMElement) => MatchPosition[];
  /** 设置当前位置高亮（黄色+加粗+下划线） */
  setPositions: (
    state: {
      positions: MatchPosition[];
      rowOffset: number;
      currentIdx: number;
    } | null
  ) => void;
} {
  // 锚定到 App 子树（确保 hook 规则正确）
  useContext(StdinContext);
  const ink = instances.get(process.stdout);

  return useMemo(() => {
    if (!ink) {
      return {
        setQuery: () => {},
        scanElement: () => [],
        setPositions: () => {},
      };
    }
    return {
      setQuery: (query: string) => ink.setSearchHighlight(query),
      scanElement: (el: DOMElement) => ink.scanElementSubtree(el),
      setPositions: (state) => ink.setSearchPositions(state),
    };
  }, [ink]);
}
