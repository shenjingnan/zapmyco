/**
 * zapmyco 全局常量定义
 */

/** 应用名称 */
export const APP_NAME = 'zapmyco';

/** 应用版本（由构建时注入，默认为 dev） */
export const __VERSION__ = '0.0.0-dev';

/** 默认最大并行任务数 */
export const DEFAULT_MAX_PARALLELISM = 5;

/** 默认单个 Agent 最大并发数 */
export const DEFAULT_MAX_PER_AGENT = 3;

/** 默认任务超时时间（毫秒）- 30 分钟 */
export const DEFAULT_TASK_TIMEOUT = 30 * 60 * 1000;

/** 默认最大重试次数 */
export const DEFAULT_MAX_RETRIES = 3;

/** 重试基础延迟（毫秒） */
export const RETRY_BASE_DELAY = 1000;

/** 最大重试延迟（毫秒）- 30s */
export const RETRY_MAX_DELAY = 30_000;

/** 进度事件环形缓冲区大小 */
export const PROGRESS_RING_BUFFER_SIZE = 1000;

/** 会话存储目录名 */
export const SESSION_DIR_NAME = '.zapmyco';

/** 配置文件名列表（按优先级搜索） */
export const CONFIG_FILE_NAMES = [
  'zapmyco.config.ts',
  'zapmyco.config.js',
  'zapmyco.config.mjs',
  'zapmyco.config.cjs',
  'zapmyco.config.json',
  '.zapmycorc',
  '.zapmycorc.json',
  '.zapmycorc.ts',
  '.zapmycorc.js',
] as const;
