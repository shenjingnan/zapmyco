#!/usr/bin/env node

/**
 * zapmyco CLI 入口
 *
 * AI 总管命令行界面。
 *
 * 使用方式：
 *   zapmyco              进入交互式 REPL 模式
 *   zapmyco run <goal>    直接执行单次目标
 *   zapmyco agents       列出可用 Agent
 *   zapmyco config       管理配置
 *   zapmyco version      显示版本号
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { __VERSION__, APP_NAME } from '../infra/constants.js';

/**
 * 显示欢迎信息
 */
function printWelcome(): void {
  console.log(
    chalk.gray(`  v${__VERSION__}  · `) +
      chalk.bold('AI 总管') +
      chalk.gray('  · ') +
      chalk.green('就绪')
  );
  console.log();
}

// ============ 主程序 ============

const program = new Command();

program
  .name(APP_NAME)
  .description('AI 原生并行任务编排系统 -- AI 总管')
  .version(__VERSION__, '-v, --version', '显示版本号')
  .helpOption('-h, --help', '显示帮助信息');

// 默认命令：进入 REPL 模式
program.action(() => {
  printWelcome();
  console.log(chalk.yellow('  交互式 REPL 模式即将推出，敬请期待！'));
  console.log();
  console.log(chalk.gray(`  当前可用命令：`));
  console.log(chalk.gray(`  ${APP_NAME} run <目标>     执行单个目标`));
  console.log(chalk.gray(`  ${APP_NAME} agents        查看可用 Agent`));
  console.log(chalk.gray(`  ${APP_NAME} --help         查看所有命令`));
  console.log();
});

// run 命令：直接执行目标
program
  .command('run')
  .description('直接执行一个目标（非交互模式）')
  .argument('<goal>', '要执行的目标描述')
  .option('-j, --json', '以 JSON 格式输出结果')
  .option('--no-color', '禁用颜色输出')
  .action((goal, _options) => {
    console.log(`🎯 目标: ${goal}`);
    console.log(chalk.yellow('\n  任务执行引擎即将推出，敬请期待！\n'));
  });

// agents 命令：列出可用 Agent
program
  .command('agents')
  .description('列出已注册的 Agent 及其状态')
  .action(() => {
    console.log(chalk.cyan('\n  已注册 Agent:\n'));
    console.log(chalk.gray('  · code-agent      代码专家'));
    console.log(chalk.gray('  · security-scanner 安全扫描'));
    console.log(chalk.gray('  · research-agent   信息搜集'));
    console.log(chalk.gray('  · planning-agent   规划安排'));
    console.log(chalk.yellow('\n  Agent 注册中心即将完全启用\n'));
  });

// config 命令
program
  .command('config')
  .description('管理配置')
  .action(() => {
    console.log(chalk.cyan('配置管理功能即将推出'));
  });

// 解析命令行参数
program.parse();
