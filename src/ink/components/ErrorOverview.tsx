/**
 * ErrorOverview — 错误边界 UI
 *
 * 渲染错误信息、文件位置和堆栈跟踪。
 * 简化版：避免 stack-utils 和 code-excerpt 依赖，手动解析堆栈。
 *
 * 参考 claude-code src/ink/components/ErrorOverview.tsx
 */

import { Box } from './Box';
import { Text } from './Text';

type Props = {
  readonly error: Error;
};

/** 清理 file:// 路径 */
function cleanupPath(path: string | undefined): string | undefined {
  return path?.replace(`file://${process.cwd()}/`, '');
}

/** 从堆栈行解析文件路径和行号 */
function parseStackLine(
  line: string
): { file: string; line: number; column: number; function: string } | null {
  // 格式: "    at fnName (/path/to/file.ts:10:5)"
  // 格式: "    at /path/to/file.ts:10:5"
  const atMatch = line.match(/^\s+at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+)\)?)$/);
  if (atMatch) {
    return {
      function: atMatch[1] ?? '<anonymous>',
      file: atMatch[2] ?? '',
      line: Number(atMatch[3]),
      column: Number(atMatch[4]),
    };
  }
  return null;
}

export default function ErrorOverview({ error }: Props) {
  const stack = error.stack ? error.stack.split('\n').slice(1) : undefined;
  const firstLine = stack?.[0];
  const origin = firstLine ? parseStackLine(firstLine) : undefined;

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text backgroundColor="ansi:red" color="ansi:white">
          {' ERROR '}
        </Text>
        <Text> {error.message}</Text>
      </Box>

      {origin && (
        <Box marginTop={1}>
          <Text dim>
            {cleanupPath(origin.file) ?? origin.file}:{origin.line}:{origin.column}
          </Text>
        </Box>
      )}

      {stack && (
        <Box marginTop={1} flexDirection="column">
          {stack.map((line) => {
            const parsed = parseStackLine(line);
            if (!parsed) {
              return (
                <Box key={line}>
                  <Text dim>- </Text>
                  <Text bold>{line}</Text>
                </Box>
              );
            }
            return (
              <Box key={line}>
                <Text dim>- </Text>
                <Text bold>{parsed.function}</Text>
                <Text dim>
                  {' '}
                  ({cleanupPath(parsed.file) ?? parsed.file}:{parsed.line}:{parsed.column})
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
