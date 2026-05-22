/**
 * Ink 验证应用。
 *
 * 最小验证：渲染 "Hello from zapmyco Ink!"，2 秒后退出。
 * 验证 React + Ink + JSX 编译和终端渲染管线正常。
 *
 * 运行方式: npx tsx src/cli/repl/test-ink.tsx
 */
import type React from 'react';
import { Box, render, Text } from '@/ink';

function App(): React.ReactElement {
  return (
    <Box padding={1}>
      <Text color="green">Hello from zapmyco Ink!</Text>
    </Box>
  );
}

const { unmount, waitUntilExit } = render(<App />);

// 2 秒后自动退出
setTimeout(() => {
  unmount();
}, 2000);

await waitUntilExit();
