//! 多 Agent 并行执行进度示例。
//!
//! 模拟多个子代理（Agent）并行执行各项分析任务，完成后通过 Output Bus
//! 输出结构化摘要报告。展示真实项目中 agent 编排场景的使用模式。
//!
//! ```bash
//! cargo run --example progress-multi-agent
//! ```

use std::time::Duration;
use zapmyco::output::{self, Message, ROUTER, TerminalTarget};
use zapmyco::tui::progress::ProgressTracker;

fn main() {
    // 注册 TerminalTarget，使 output::send 能显示到终端
    ROUTER.add_target(Box::new(TerminalTarget));

    let mut tracker = ProgressTracker::new();

    // Agent 列表
    let agents: [(&str, &str); 4] = [
        ("代码分析", "分析项目结构，识别模块依赖"),
        ("依赖审查", "检查第三方依赖的安全漏洞"),
        ("测试执行", "运行单元测试和集成测试"),
        ("文档检查", "检查 API 文档完整性"),
    ];

    let handles: Vec<_> = agents
        .iter()
        .map(|(name, desc)| tracker.add(format!("[Agent] {} — {}", name, desc)))
        .collect();

    // ---- Phase 1: 全部启动 ----
    output::send(&Message::info("[Pipeline] Phase 1/2: 启动所有 Agent"));
    for (i, h) in handles.iter().enumerate() {
        let status = match i {
            0 => Some("扫描 42 个源文件..."),
            1 => Some("检查 156 个依赖..."),
            2 => Some("15 个测试用例"),
            3 => Some("检查 8 个文档文件..."),
            _ => None,
        };
        h.set_running(status);
        std::thread::sleep(Duration::from_millis(200));
    }

    // ---- Phase 2: 逐步收集结果 ----
    output::send(&Message::info("[Pipeline] Phase 2/2: 收集 Agent 结果"));

    std::thread::sleep(Duration::from_millis(1500));
    handles[0].set_success(Some("12 模块, 0 循环依赖"));

    std::thread::sleep(Duration::from_millis(800));
    handles[3].set_success(Some("全部通过"));

    std::thread::sleep(Duration::from_millis(600));
    handles[1].set_failed("lodash@4.17.20: CVE-2023-??? (高危)");

    std::thread::sleep(Duration::from_millis(1200));
    handles[2].set_success(Some("14 passed, 1 skipped"));

    // ---- 关闭进度显示 ----
    tracker.close();

    // ---- 通过 Output Bus 输出最终报告 ----
    output::send(&Message::result("\n==== Agent 执行报告 ===="));
    output::send(&Message::info("[报告] 代码分析:   [✓] 12 模块, 0 循环依赖"));
    output::send(&Message::info(
        "[报告] 依赖审查:   [✗] lodash CVE-2023-??? (高危)",
    ));
    output::send(&Message::info(
        "[报告] 测试执行:   [✓] 14 passed, 1 skipped",
    ));
    output::send(&Message::info("[报告] 文档检查:   [✓] 全部通过"));
    output::send(&Message::result("==== 2 passed, 2 failed ===="));
}
