/**
 * REPL 模块入口
 *
 * 导出 startRepl() 函数作为 REPL 交互模式的启动入口。
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { ReplSession } from '@/cli/repl/session';
import { loadConfig } from '@/config/loader';
import { ConversationLogger } from '@/infra/conversation-logger';
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
  if (config.logging?.maxFileSize !== undefined) {
    configureLogger({ maxFileSize: config.logging.maxFileSize });
  }
  if (config.logging?.retentionDays !== undefined) {
    configureLogger({ retentionDays: config.logging.retentionDays });
  }

  // --verbose 标志或环境变量：启用 debug 级别 + 对话记录
  const isVerbose = process.env.ZAPMYCO_LOG_CONVERSATION === '1';
  if (isVerbose && !config.logging?.level) {
    configureLogger({ level: 'debug' });
  }

  // 初始化对话日志（默认关闭，通过 config 或环境变量开启）
  const recordConversation = config.logging?.recordConversation ?? isVerbose;
  const convLogger = new ConversationLogger({
    sessionId: `session-${Date.now()}`,
    enabled: recordConversation,
  });

  const session = new ReplSession(config, convLogger);
  await session.start();
}
