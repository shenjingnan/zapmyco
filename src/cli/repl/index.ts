/**
 * REPL 模块入口
 *
 * 导出 startRepl() 函数作为 REPL 交互模式的启动入口。
 */

import { loadConfig } from '../../config/loader.js';
import { ReplSession } from './session.js';

/**
 * 启动 REPL 交互模式
 *
 * 加载配置 → 创建会话 → 进入输入循环
 */
export async function startRepl(): Promise<void> {
  const config = await loadConfig();
  const session = new ReplSession(config);
  await session.start();
}
