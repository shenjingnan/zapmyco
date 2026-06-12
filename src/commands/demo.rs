use crossterm::cursor;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::{execute, terminal};
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use std::io::{IsTerminal, Write};
use std::time::{Duration, Instant};

/// demo 命令 — 模拟 Agent 工作流全过程（含用户交互）
pub(crate) fn cmd_demo() -> Result<(), String> {
    let divider = "─".repeat(48);

    println!("{}", divider);
    println!("  zapmyco Agent 工作流演示");
    println!("{}", divider);
    println!();

    // 模拟用户输入
    let user_goal = "分析项目代码结构并生成 API 文档";
    println!("  用户目标: \"{}\"", user_goal);
    println!("{}", divider);
    println!();

    // 阶段 1
    stage_analyze()?;
    println!();
    if !prompt_continue("分析完成，是否继续拆分子任务？") {
        return Ok(());
    }
    println!();

    // 阶段 2: 任务拆分 → 审批循环
    stage_split()?;
    println!();
    loop {
        match prompt_task_approval()? {
            TaskDecision::Continue => break,
            TaskDecision::Cancel => {
                println!("    └─ 已取消，演示结束");
                return Ok(());
            }
            TaskDecision::Supplement(feedback) => {
                println!();
                println!("  ▸ 收到补充需求: \"{}\"", feedback);
                stage_reanalyze()?;
                println!();
                stage_split()?;
                println!();
            }
        }
    }
    println!();

    // 阶段 3
    stage_execute_agents()?;
    println!();
    if !prompt_continue("子任务执行完毕，是否进入 LLM 汇总？") {
        return Ok(());
    }
    println!();

    // 阶段 4
    stage_llm_sessions()?;
    println!();
    if !prompt_continue("LLM 汇总完成，是否生成最终结果？") {
        return Ok(());
    }
    println!();

    // 阶段 5
    stage_finalize()?;
    println!();

    println!("{}", divider);
    println!("  ✔ Agent 工作流演示完成");
    println!("{}", divider);
    Ok(())
}

/// 后续操作决策
enum TaskDecision {
    Continue,
    Cancel,
    Supplement(String),
}

/// 内联选项选择器 — 支持在最后一项直接输入文字
///
/// 快捷键: ↑↓/jk 导航, 1-9 跳转, Enter 确认, Ctrl+C 取消
fn prompt_task_approval() -> Result<TaskDecision, String> {
    if !std::io::stderr().is_terminal() {
        return Ok(TaskDecision::Cancel);
    }

    let question = "请确认或补充需求";
    let items: [&str; 3] = ["同意", "拒绝", ""]; // "" = 自定义输入
    let descriptions: [&str; 3] = ["按当前拆分的子任务执行", "终止当前任务", ""];
    let list_height = 1 + items.len();

    let mut stderr = std::io::stderr();

    // 进入原始模式
    terminal::enable_raw_mode().map_err(|e| e.to_string())?;
    let _ = execute!(stderr, cursor::Hide);

    let mut selected = 0;
    let mut input = String::new();
    let mut moved_up = false;
    let mut show_cursor = true;
    let mut need_render = true;
    let mut last_key_time = Instant::now();
    let mut initial = true;
    let cursor_debounce = Duration::from_millis(400);

    let result = loop {
        let has_event =
            crossterm::event::poll(Duration::from_millis(100)).map_err(|e| e.to_string())?;

        if has_event {
            match crossterm::event::read().map_err(|e| e.to_string())? {
                // 导航
                Event::Key(KeyEvent {
                    code: KeyCode::Up, ..
                })
                | Event::Key(KeyEvent {
                    code: KeyCode::Char('k'),
                    ..
                }) if selected > 0 => {
                    selected -= 1;
                    need_render = true;
                }
                Event::Key(KeyEvent {
                    code: KeyCode::Down,
                    ..
                })
                | Event::Key(KeyEvent {
                    code: KeyCode::Char('j'),
                    ..
                }) if selected < items.len() - 1 => {
                    selected += 1;
                    need_render = true;
                }
                // 数字快捷键
                Event::Key(KeyEvent {
                    code: KeyCode::Char(c @ '1'..='9'),
                    ..
                }) => {
                    let idx = (c as usize) - ('1' as usize);
                    if idx < items.len() {
                        if items[idx].is_empty() {
                            selected = idx;
                            need_render = true;
                        } else {
                            break match idx {
                                0 => TaskDecision::Continue,
                                1 => TaskDecision::Cancel,
                                _ => TaskDecision::Cancel,
                            };
                        }
                    }
                }
                // Enter 确认
                Event::Key(KeyEvent {
                    code: KeyCode::Enter,
                    ..
                }) => {
                    if items[selected].is_empty() {
                        let text = input.trim().to_string();
                        if text.is_empty() {
                            need_render = true;
                            continue;
                        }
                        break TaskDecision::Supplement(text);
                    }
                    break match selected {
                        0 => TaskDecision::Continue,
                        _ => TaskDecision::Cancel,
                    };
                }
                // 自定义输入 — 打字
                Event::Key(KeyEvent {
                    code: KeyCode::Char(c),
                    ..
                }) if selected == items.len() - 1 => {
                    input.push(c);
                    last_key_time = Instant::now();
                    show_cursor = false;
                    need_render = true;
                }
                // 自定义输入 — 退格
                Event::Key(KeyEvent {
                    code: KeyCode::Backspace,
                    ..
                }) if selected == items.len() - 1 => {
                    input.pop();
                    last_key_time = Instant::now();
                    show_cursor = false;
                    need_render = true;
                }
                // Ctrl+C 取消
                Event::Key(KeyEvent {
                    code: KeyCode::Char('c'),
                    modifiers: KeyModifiers::CONTROL,
                    ..
                }) => {
                    break TaskDecision::Cancel;
                }
                _ => {}
            }
        }

        // 打字停顿 debounce：400ms 无输入重新显示 █
        if !show_cursor && last_key_time.elapsed() > cursor_debounce {
            show_cursor = true;
            need_render = true;
        }

        if !need_render {
            continue;
        }
        need_render = false;

        // ── 重新渲染（首次不清理） ──
        if !initial {
            if moved_up {
                let _ = execute!(stderr, terminal::Clear(terminal::ClearType::CurrentLine));
                for _ in 0..list_height - 1 {
                    let _ = execute!(
                        stderr,
                        cursor::MoveUp(1),
                        terminal::Clear(terminal::ClearType::CurrentLine)
                    );
                }
            } else {
                for _ in 0..list_height {
                    let _ = execute!(
                        stderr,
                        cursor::MoveUp(1),
                        terminal::Clear(terminal::ClearType::CurrentLine)
                    );
                }
            }
        }
        initial = false;

        // 问题行
        let _ = write!(stderr, "\r? ");
        let _ = stderr.flush();
        let _ = execute!(
            stderr,
            crossterm::style::SetForegroundColor(crossterm::style::Color::Green)
        );
        let _ = write!(stderr, "{}", question);
        let _ = execute!(stderr, crossterm::style::ResetColor);
        let _ = writeln!(stderr);

        // 选项行
        for (i, label) in items.iter().enumerate() {
            let num = i + 1;
            let prefix = if i == selected { "▸" } else { " " };

            if label.is_empty() {
                if !input.is_empty() {
                    let cursor = if show_cursor { "█" } else { "" };
                    let _ = writeln!(stderr, "\r  {} {}. {}{}", prefix, num, input, cursor);
                } else {
                    let _ = writeln!(stderr, "\r  {} {}. 自定义输入", prefix, num);
                }
            } else {
                let desc = descriptions[i];
                if i == selected {
                    let _ = execute!(
                        stderr,
                        crossterm::style::SetForegroundColor(crossterm::style::Color::Green)
                    );
                    let _ = writeln!(stderr, "\r  {} {}. {}  ─ {}", prefix, num, label, desc);
                    let _ = execute!(stderr, crossterm::style::ResetColor);
                } else {
                    let _ = writeln!(stderr, "\r  {} {}. {}  ─ {}", prefix, num, label, desc);
                }
            }
        }
        let _ = stderr.flush();

        // 光标上移一行：输入法在此位置弹出拼音候选框
        moved_up = if selected == items.len() - 1 {
            let _ = execute!(stderr, cursor::MoveUp(1));
            true
        } else {
            false
        };
    };

    // 清理终端（与渲染逻辑一致）
    if moved_up {
        let _ = execute!(stderr, terminal::Clear(terminal::ClearType::CurrentLine));
        for _ in 0..list_height - 1 {
            let _ = execute!(
                stderr,
                cursor::MoveUp(1),
                terminal::Clear(terminal::ClearType::CurrentLine)
            );
        }
    } else {
        for _ in 0..list_height {
            let _ = execute!(
                stderr,
                cursor::MoveUp(1),
                terminal::Clear(terminal::ClearType::CurrentLine)
            );
        }
    }
    let _ = execute!(stderr, cursor::Show);
    let _ = terminal::disable_raw_mode();

    Ok(result)
}

/// 询问用户是否继续（用于非拆分的阶段过渡）
fn prompt_continue(msg: &str) -> bool {
    match inquire::Confirm::new(msg).with_default(true).prompt() {
        Ok(true) => true,
        Ok(false) => {
            println!("    └─ 已取消，演示结束");
            false
        }
        Err(_) => {
            println!();
            false
        }
    }
}

/// 阶段 1: 任务分析 — Agent 理解用户意图
fn stage_analyze() -> Result<(), String> {
    println!("  ▸ 阶段 1/5: 任务分析");

    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::default_spinner()
            .template("    {spinner:.green} {msg}")
            .map_err(|e| format!("模板错误: {}", e))?
            .tick_chars("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"),
    );
    pb.enable_steady_tick(Duration::from_millis(80));

    let steps: [&str; 5] = [
        "Analyzer: 正在解析用户意图...",
        "Analyzer: 识别关键需求 (代码分析 + 文档生成)",
        "Analyzer: 评估所需资源 (文件系统读取、代码解析、Markdown 渲染)",
        "Analyzer: 确定执行策略 → 先扫描后分析再生成",
        "✔ 分析完成，共识别 3 个关键需求",
    ];

    for msg in &steps {
        pb.set_message(msg.to_string());
        std::thread::sleep(Duration::from_millis(700));
    }

    pb.finish_and_clear();
    println!("    └─ 准备拆解为子任务");
    Ok(())
}

/// 阶段 2: 任务拆分 — 将目标分解为可执行的子任务
fn stage_split() -> Result<(), String> {
    println!("  ▸ 阶段 2/5: 任务拆分");

    let task_descs: [&str; 5] = [
        "读取项目目录结构",
        "分析各模块职责",
        "提取公共 API 端点",
        "生成 API 文档内容",
        "格式化并输出文档",
    ];

    let pb = ProgressBar::new(task_descs.len() as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("    {spinner:.cyan} [{bar:30.cyan/blue}] {pos}/{len}  {msg}")
            .map_err(|e| format!("模板错误: {}", e))?
            .progress_chars("█▓▒░ "),
    );

    for (i, desc) in task_descs.iter().enumerate() {
        pb.set_message(format!(
            "Planner: 拆分子任务 ({}/{}) {}",
            i + 1,
            task_descs.len(),
            desc
        ));
        pb.set_position((i + 1) as u64);
        std::thread::sleep(Duration::from_millis(600));
    }

    pb.finish_with_message("✔ 拆分完成");
    println!();
    println!("    Planner 拆分的子任务清单:");
    for (i, desc) in task_descs.iter().enumerate() {
        println!("      [{0}] {1}", i + 1, desc);
    }
    Ok(())
}

/// 根据用户补充需求重新分析
fn stage_reanalyze() -> Result<(), String> {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::default_spinner()
            .template("    {spinner:.green} {msg}")
            .map_err(|e| format!("模板错误: {}", e))?
            .tick_chars("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"),
    );
    pb.enable_steady_tick(Duration::from_millis(80));

    let steps: [&str; 4] = [
        "Planner: 收到补充需求，正在整合...",
        "Planner: 重新评估子任务划分...",
        "Planner: 调整子任务优先级...",
        "✔ 重新分析完成",
    ];

    for msg in &steps {
        pb.set_message(msg.to_string());
        std::thread::sleep(Duration::from_millis(600));
    }

    pb.finish_and_clear();
    println!("    └─ 子任务已更新");
    Ok(())
}

/// 阶段 3: 并发执行 — 多个 Agent 同时工作
fn stage_execute_agents() -> Result<(), String> {
    println!("  ▸ 阶段 3/5: 并发执行子任务");

    let mp = MultiProgress::new();

    // Agent 定义: (名称, 总步骤数)
    let agents: [(&str, u64); 4] = [
        ("Agent-1  扫描模块", 8),
        ("Agent-2  分析代码", 6),
        ("Agent-3  提取 API", 10),
        ("Agent-4  质量检查", 5),
    ];

    let bars: Vec<ProgressBar> = agents
        .iter()
        .map(|(name, max)| {
            let pb = mp.add(ProgressBar::new(*max));
            pb.set_style(
                ProgressStyle::default_bar()
                    .template("    {msg} [{bar:24.cyan/blue}] {pos}/{len}")
                    .map_err(|e| format!("模板错误: {}", e))
                    .unwrap(),
            );
            pb.set_message(name.to_string());
            pb
        })
        .collect();

    // 模拟不同速度并发推进
    let speeds: [u64; 4] = [1, 2, 3, 3];
    for step in 1..=30 {
        for (idx, pb) in bars.iter().enumerate() {
            let max = agents[idx].1;
            let current = pb.position();
            if current < max && step % speeds[idx] == 0 {
                pb.inc(1);
            }
        }
        std::thread::sleep(Duration::from_millis(180));
    }

    for pb in &bars {
        pb.finish_with_message("✔ 完成");
    }

    println!("    └─ 子任务全部执行完毕");
    Ok(())
}

/// 阶段 4: 多轮 LLM 会话 — Agent 循环推理
fn stage_llm_sessions() -> Result<(), String> {
    println!("  ▸ 阶段 4/5: 多轮 LLM 会话");

    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::default_spinner()
            .template("    {spinner:.yellow} {msg}")
            .map_err(|e| format!("模板错误: {}", e))?
            .tick_chars("▹▸▪"),
    );
    pb.enable_steady_tick(Duration::from_millis(120));

    let rounds: [&str; 6] = [
        "LLM Round 1: 汇总各 Agent 的初步结果...",
        "LLM Round 1: 发现模块间依赖关系 → 请求补充数据",
        "LLM Round 2: 收到补充数据，正在整合分析...",
        "LLM Round 2: 生成 API 文档初稿",
        "LLM Round 3: 检查文档完整性与格式...",
        "LLM Round 3: 应用格式优化，文档完善",
    ];

    for msg in &rounds {
        pb.set_message(msg.to_string());
        std::thread::sleep(Duration::from_millis(700));
    }

    pb.finish_and_clear();
    println!("    └─ 共 {} 轮 LLM 调用，结果已收敛", 3);
    Ok(())
}

/// 阶段 5: 最终输出 — 生成结果
fn stage_finalize() -> Result<(), String> {
    println!("  ▸ 阶段 5/5: 结果汇总输出");

    let pb = ProgressBar::new(100);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("    {spinner:.green} [{bar:40.green/yellow}] {pos}%  {msg}")
            .map_err(|e| format!("模板错误: {}", e))?
            .progress_chars("█▓▒░ "),
    );

    let steps: [(&str, u64); 5] = [
        ("正在生成 API 文档...", 30),
        ("正在渲染 Markdown 格式...", 55),
        ("正在校验文档链接...", 75),
        ("正在写入输出文件...", 90),
        ("✔ 任务完成！", 100),
    ];

    for (msg, pos) in &steps {
        pb.set_message(msg.to_string());
        pb.set_position(*pos);
        std::thread::sleep(Duration::from_millis(700));
    }

    pb.finish_with_message("✔ 全部完成");
    Ok(())
}
