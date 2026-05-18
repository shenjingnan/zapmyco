/**
 * Skill 文件变更监视器
 *
 * 使用 chokidar 监视技能目录中的 SKILL.md 文件变更，
 * 通过防抖机制触发外部回调，实现动态技能发现。
 *
 * @module cli/repl/skill-watcher
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { logger } from '@/infra/logger';

const log = logger.child('repl:skill-watcher');

/** 防抖延迟（毫秒） */
const DEBOUNCE_MS = 500;

export interface SkillWatcherOptions {
  /** 要监视的目录列表 */
  watchDirs: string[];
  /** 技能文件变更回调 */
  onChanged: () => void;
}

/**
 * Skill 文件变更监视器
 */
export class SkillWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _ready = false;

  /** 监视器是否已就绪 */
  get ready(): boolean {
    return this._ready;
  }

  /**
   * 启动监视
   *
   * 监视指定目录下 `**` 深层匹配 `SKILL.md` 文件变更。
   * 忽略隐藏目录，`ignoreInitial: true` 避免初始扫描触发 add 事件。
   */
  start(options: SkillWatcherOptions): void {
    if (this.watcher) return;

    this.watcher = chokidar.watch(
      options.watchDirs.map((dir) => `${dir}/**/SKILL.md`),
      {
        ignored: /(^|[/\\])\./,
        persistent: true,
        ignoreInitial: true,
        depth: 2,
      }
    );

    this.watcher
      .on('ready', () => {
        this._ready = true;
        log.info('技能文件监视已就绪', { dirs: options.watchDirs });
      })
      .on('add', (path: string) => {
        log.debug('技能文件新增', { path });
        this.debounceNotify(options.onChanged);
      })
      .on('change', (path: string) => {
        log.debug('技能文件修改', { path });
        this.debounceNotify(options.onChanged);
      })
      .on('unlink', (path: string) => {
        log.debug('技能文件删除', { path });
        this.debounceNotify(options.onChanged);
      });
  }

  /**
   * 停止监视并清理资源
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this._ready = false;
  }

  /**
   * 防抖通知：批量操作（如 git pull）时合并为一次回调
   */
  private debounceNotify(callback: () => void): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      callback();
    }, DEBOUNCE_MS);
  }
}
