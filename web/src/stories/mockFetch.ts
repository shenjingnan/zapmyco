import type { ReactNode } from 'react';
import { useEffect } from 'react';

/**
 * Storybook 辅助组件：mock fetch 使得特定 API 路径返回成功响应。
 *
 * 在 Storybook 中没有后端服务器，直接使用 fetch 的 API 调用会失败。
 * 此组件在挂载时拦截匹配的请求，并在卸载时恢复原始 fetch。
 *
 * @example
 * ```tsx
 * // 在 story decorator 中使用:
 * decorators: [
 *   (Story) => (
 *     <MockApiProvider>
 *       <Story />
 *     </MockApiProvider>
 *   ),
 * ]
 * ```
 */
export function MockApiProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      // 拦截 POST /api/tool/approve — 返回成功
      if (url.includes('/api/tool/approve') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 拦截 POST /api/ask/respond — 返回成功
      if (url.includes('/api/ask/respond') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return children;
}
