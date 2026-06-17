//! 多命令并行执行进度示例。
//!
//! 模拟多个构建/检查命令并发执行，演示命令启动、实时状态更新、
//! 结果汇总的完整流程。
//!
//! ```bash
//! cargo run --example progress-multi-command
//! ```

use std::time::Duration;
use zapmyco::output::{self, Message, ROUTER, TerminalTarget};
use zapmyco::tui::progress::ProgressTracker;

fn main() {
    ROUTER.add_target(Box::new(TerminalTarget));

    let mut tracker = ProgressTracker::new();

    // 模拟一组并发命令
    let commands: [(&str, &str); 5] = [
        ("cargo build --release", "编译 Rust 后端"),
        ("npm run build", "构建前端资源"),
        ("cargo clippy", "静态代码分析"),
        ("cargo test", "运行测试套件"),
        ("eslint src/", "前端代码检查"),
    ];

    let handles: Vec<_> = commands
        .iter()
        .map(|(cmd, desc)| tracker.add(format!("[命令] {} ({})", cmd, desc)))
        .collect();

    // ---- 全部启动 ----
    output::send(&Message::info("[Executor] 开始执行 5 个命令"));
    for h in &handles {
        h.set_running(None);
        std::thread::sleep(Duration::from_millis(100));
    }

    // ---- 模拟执行过程，逐步输出结果 ----
    // eslint 最快完成（失败）
    std::thread::sleep(Duration::from_millis(800));
    handles[4].set_failed("3 个错误, 12 个警告");

    // clippy 完成
    std::thread::sleep(Duration::from_millis(600));
    handles[2].set_success(Some("0 warnings"));

    // npm build 完成（更新状态后完成）
    std::thread::sleep(Duration::from_millis(300));
    handles[1].set_running(Some("building for production..."));
    std::thread::sleep(Duration::from_millis(1500));
    handles[1].set_success(Some("12s, 342 packages"));

    // cargo test 完成
    std::thread::sleep(Duration::from_millis(400));
    handles[3].set_success(Some("42 passed, 0 failed"));

    // cargo build 最慢
    std::thread::sleep(Duration::from_millis(2000));
    handles[0].set_success(Some("35s, release target"));

    // ---- 关闭进度显示 ----
    tracker.close();

    // ---- 通过 Output Bus 输出最终结果 ----
    output::send(&Message::result("\n==== 命令执行摘要 ===="));
    output::send(&Message::info("[结果] cargo build --release:  [✓] 35s"));
    output::send(&Message::info("[结果] npm run build:          [✓] 12s"));
    output::send(&Message::info(
        "[结果] cargo clippy:           [✓] 0 warnings",
    ));
    output::send(&Message::info(
        "[结果] cargo test:             [✓] 42 passed",
    ));
    output::send(&Message::info(
        "[结果] eslint src/:            [✗] 3 errors",
    ));
    output::send(&Message::result("==== 4 passed, 1 failed ===="));
}
