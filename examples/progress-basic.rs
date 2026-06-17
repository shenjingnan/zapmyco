//! ProgressTracker 基本用法示例。
//!
//! 演示 API 的基本操作：创建 tracker、添加条目、状态转换、关闭清理。
//!
//! ```bash
//! cargo run --example progress-basic
//! ```

use std::time::Duration;
use zapmyco::tui::progress::ProgressTracker;

fn main() {
    let mut tracker = ProgressTracker::new();

    // 添加 3 个条目，初始均为 Pending（灰色文字，无 spinner）
    let h1 = tracker.add("[任务] 扫描文件系统");
    let h2 = tracker.add("[任务] 解析配置文件");
    let h3 = tracker.add("[任务] 生成输出报告");

    std::thread::sleep(Duration::from_millis(800));

    // 逐个启动 spinner
    h1.set_running(Some("scanning /usr/src..."));
    std::thread::sleep(Duration::from_millis(400));
    h2.set_running(Some("parsing config.toml..."));
    std::thread::sleep(Duration::from_millis(400));
    h3.set_running(None);

    // 模拟完成（不同时间点）
    std::thread::sleep(Duration::from_millis(1200));
    h1.set_success(Some("342 个文件"));

    std::thread::sleep(Duration::from_millis(600));
    h3.set_success(None);

    std::thread::sleep(Duration::from_millis(400));
    h2.set_failed("config.toml: 第 42 行语法错误");

    // 关闭进度显示，清理终端行
    std::thread::sleep(Duration::from_millis(500));
    tracker.close();

    // 普通 println 不受进度行影响
    println!("\n任务执行完毕。");
}
