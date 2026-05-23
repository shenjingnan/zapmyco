/**
 * useDeclaredCursor — IME/辅助功能光标声明 hook
 *
 * 声明终端光标应停放的位置，用于 IME 预编辑文本渲染
 * 和屏幕阅读器/放大器追踪。
 *
 * 返回一个 ref callback，附加到包含输入区域的 Box。
 * 声明的坐标相对于该 Box 的 Yoga 布局位置。
 *
 * 时序：useLayoutEffect 在 React layout 阶段触发 ——
 * 在 resetAfterCommit 调用 scheduleRender 之后。
 * scheduleRender 通过 queueMicrotask 延迟 onRender，
 * 因此 onRender 在 layout effect 提交后运行。
 * 测试环境使用 onImmediateRender（同步），测试需手动调用 onRender。
 */

import { useCallback, useContext, useLayoutEffect, useRef } from 'react';
import { CursorDeclarationContext } from '../components/CursorDeclarationContext';
import type { DOMElement } from '../dom';

/**
 * 声明终端光标位置。
 *
 * @param options.line - 输入区域内的行号
 * @param options.column - 输入区域内的列号
 * @param options.active - 是否激活声明
 * @returns ref callback 附加到目标 Box
 *
 * @example
 * const setRef = useDeclaredCursor({ line: 0, column: input.length, active: true });
 * return <Box ref={setRef}><Text>{input}</Text></Box>;
 */
export function useDeclaredCursor({
  line,
  column,
  active,
}: {
  line: number;
  column: number;
  active: boolean;
}): (element: DOMElement | null) => void {
  const setCursorDeclaration = useContext(CursorDeclarationContext);
  const nodeRef = useRef<DOMElement | null>(null);

  const setNode = useCallback((node: DOMElement | null) => {
    nodeRef.current = node;
  }, []);

  // 每个 commit 都重新声明，确保新聚焦实例能重新认领声明
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (active && node) {
      setCursorDeclaration({ relativeX: column, relativeY: line, node });
    } else {
      setCursorDeclaration(null, node);
    }
  });

  // 卸载时清除声明（条件是当前声明仍属于此实例）
  useLayoutEffect(() => {
    return () => {
      setCursorDeclaration(null, nodeRef.current);
    };
  }, [setCursorDeclaration]);

  return setNode;
}
