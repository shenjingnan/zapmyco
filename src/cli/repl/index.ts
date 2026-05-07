/**
 * REPL 模块入口
 *
 * 导出 startRepl() 函数作为 REPL 交互模式的启动入口。
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { ReplSession } from '@/cli/repl/session';
import { loadConfig } from '@/config/loader';
import { configureLogger } from '@/infra/logger';

/**
 * 启动 REPL 交互模式
 *
 * 加载配置 → 创建会话 → 进入输入循环
 */
export async function startRepl(): Promise<void> {
  // 在加载配置之前设置日志文件，确保所有启动日志都写入文件
  const defaultLogPath = join(homedir(), '.zapmyco', 'logs', 'zapmyco.log');
  configureLogger({
    logFilePath: defaultLogPath,
    quiet: true,
  });

  const config = await loadConfig();

  // 如果配置文件指定了自定义日志路径或级别，应用配置
  if (config.logging?.level) {
    configureLogger({ level: config.logging.level });
  }
  if (config.logging?.file) {
    configureLogger({ logFilePath: config.logging.file });
  }

  const session = new ReplSession(config);
  await session.start();
}
