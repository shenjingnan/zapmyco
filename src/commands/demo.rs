use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use std::time::Duration;

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

    // ratatui 渲染展示
    stage_ratatui_demo()?;
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

/// 基于 ratatui 的内联选择+输入
fn prompt_task_approval() -> Result<TaskDecision, String> {
    use ratatui::crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};

    crossterm::terminal::enable_raw_mode().map_err(|e| e.to_string())?;

    let mut textarea = ratatui_textarea::TextArea::default();
    textarea.set_placeholder_text("自定义输入");

    let backend = ratatui::backend::CrosstermBackend::new(std::io::stdout());
    let mut terminal = ratatui::Terminal::with_options(
        backend,
        ratatui::TerminalOptions {
            viewport: ratatui::Viewport::Inline(14),
        },
    )
    .map_err(|e| e.to_string())?;

    let items = ["同意", "拒绝", ""]; // "" = 自定义输入
    let mut selected = 0;
    let result = loop {
        // 选中自定义输入时高亮
        if selected == 2 {
            textarea.set_style(ratatui::style::Style::default().fg(ratatui::style::Color::Green));
        } else {
            textarea.set_style(ratatui::style::Style::default());
        }

        let _ = terminal.draw(|f| {
            use ratatui::{
                layout::{Constraint, Layout},
                style::{Color, Style},
                text::{Line, Span},
                widgets::{Block, BorderType, Paragraph},
            };

            let area = f.area();

            let block = Block::bordered()
                .title(" 请确认或补充需求 ")
                .border_type(BorderType::Rounded);
            let inner = block.inner(area);
            f.render_widget(block, area);

            // TextArea 高度随行数动态变化
            let ta_lines = textarea.lines().len() as u16;
            let input_h = ta_lines.clamp(1, 8);

            let rows = Layout::vertical([
                Constraint::Length(1),       // 空行
                Constraint::Length(1),       // 选项 1
                Constraint::Length(1),       // 选项 2
                Constraint::Length(input_h), // 自定义输入（自适应）
                Constraint::Length(1),       // 空行
                Constraint::Length(1),       // 帮助行
                Constraint::Min(0),          // 填充剩余空间
            ])
            .split(inner);

            for (i, label) in items[..2].iter().enumerate() {
                let is_sel = i == selected;
                let prefix = if is_sel { "▸" } else { " " };
                let line = if is_sel {
                    Line::styled(
                        format!("  {} {}. {}", prefix, i + 1, label),
                        Style::default().fg(Color::Green),
                    )
                } else {
                    Line::from(format!("  {} {}. {}", prefix, i + 1, label))
                };
                f.render_widget(Paragraph::new(line), rows[i + 1]);
            }

            if selected == 2 {
                let input_cols =
                    Layout::horizontal([Constraint::Length(7), Constraint::Min(1)]).split(rows[3]);
                f.render_widget(
                    Paragraph::new(Line::styled("  ▸ 3.", Style::default().fg(Color::Green))),
                    input_cols[0],
                );
                f.render_widget(&textarea, input_cols[1]);
            } else {
                f.render_widget(Paragraph::new(Line::from("    3. 自定义输入")), rows[3]);
            }

            f.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    "  ↑↓ 切换 · Enter 确认 · Ctrl+C 取消",
                    Style::default().fg(Color::DarkGray),
                ))),
                rows[5],
            );
        });

        match event::read().map_err(|e| e.to_string())? {
            Event::Key(KeyEvent {
                code: KeyCode::Up | KeyCode::Char('k'),
                ..
            }) if selected > 0 => {
                selected -= 1;
            }
            Event::Key(KeyEvent {
                code: KeyCode::Down | KeyCode::Char('j'),
                ..
            }) if selected < 2 => {
                selected += 1;
            }
            Event::Key(KeyEvent {
                code: KeyCode::Char('1'),
                ..
            }) => {
                break TaskDecision::Continue;
            }
            Event::Key(KeyEvent {
                code: KeyCode::Char('2'),
                ..
            }) => {
                break TaskDecision::Cancel;
            }
            Event::Key(KeyEvent {
                code: KeyCode::Char('3'),
                ..
            }) => {
                selected = 2;
            }
            // Shift+Enter → 换行（交给 TextArea）
            Event::Key(KeyEvent {
                code: KeyCode::Enter,
                modifiers: KeyModifiers::SHIFT,
                ..
            }) if selected == 2 => {
                textarea.input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            }
            // Enter → 提交
            Event::Key(KeyEvent {
                code: KeyCode::Enter,
                ..
            }) => {
                if selected == 2 {
                    let text = textarea.lines()[0].trim().to_string();
                    if !text.is_empty() {
                        break TaskDecision::Supplement(text);
                    }
                } else {
                    break match selected {
                        0 => TaskDecision::Continue,
                        _ => TaskDecision::Cancel,
                    };
                }
            }
            // 自定义输入 — 其他按键交给 TextArea 处理
            Event::Key(key) if selected == 2 => {
                textarea.input(key);
            }
            Event::Key(KeyEvent {
                code: KeyCode::Char('c'),
                modifiers: KeyModifiers::CONTROL,
                ..
            }) => {
                break TaskDecision::Cancel;
            }
            _ => {}
        }
    };

    drop(terminal);
    crossterm::terminal::disable_raw_mode().ok();

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

/// ratatui 渲染展示 — 独立演示 ratatui 的 UI 渲染能力
fn stage_ratatui_demo() -> Result<(), String> {
    println!("{}", "─".repeat(48));
    println!("  ratatui 渲染展示");
    println!("{}", "─".repeat(48));
    println!();

    crossterm::terminal::enable_raw_mode().map_err(|e| e.to_string())?;

    let backend = ratatui::backend::CrosstermBackend::new(std::io::stdout());
    let mut terminal = ratatui::Terminal::with_options(
        backend,
        ratatui::TerminalOptions {
            viewport: ratatui::Viewport::Inline(10),
        },
    )
    .map_err(|e| e.to_string())?;

    terminal
        .draw(|f| {
            use ratatui::{
                layout::{Constraint, Layout},
                style::{Color, Style},
                text::{Line, Span, Text},
                widgets::{Block, BorderType, Paragraph},
            };

            let rows = Layout::vertical([Constraint::Length(1); 5]).split(f.area());

            let block = Block::bordered()
                .title(" ratatui 演示面板 ")
                .border_type(BorderType::Rounded);
            f.render_widget(block, f.area());

            f.render_widget(
                Paragraph::new(Text::from(Line::from(Span::styled(
                    "  ratatui 是一个 Rust TUI 渲染框架",
                    Style::default().fg(Color::Cyan),
                )))),
                rows[0],
            );
            f.render_widget(
                Paragraph::new(Text::from(Line::from(Span::styled(
                    "  支持块、列表、段落、表格等组件",
                    Style::default().fg(Color::Green),
                )))),
                rows[1],
            );
            f.render_widget(
                Paragraph::new(Text::from(Line::from(Span::styled(
                    "  跨平台终端渲染，无需手动管理 ANSI 码",
                    Style::default().fg(Color::Yellow),
                )))),
                rows[2],
            );
            f.render_widget(
                Paragraph::new(Text::from(Line::from(Span::styled(
                    "  Viewport::Inline 实现内联模式",
                    Style::default().fg(Color::Magenta),
                )))),
                rows[3],
            );
            f.render_widget(
                Paragraph::new(Text::from(Line::from(Span::styled(
                    "  Enter 继续",
                    Style::default().fg(Color::DarkGray),
                )))),
                rows[4],
            );
        })
        .map_err(|e| e.to_string())?;

    // 等待用户按 Enter 继续
    loop {
        match crossterm::event::read().map_err(|e| e.to_string())? {
            crossterm::event::Event::Key(crossterm::event::KeyEvent {
                code: crossterm::event::KeyCode::Enter,
                ..
            })
            | crossterm::event::Event::Key(crossterm::event::KeyEvent {
                code: crossterm::event::KeyCode::Char('c'),
                modifiers: crossterm::event::KeyModifiers::CONTROL,
                ..
            }) => break,
            _ => {}
        }
    }

    drop(terminal);
    crossterm::terminal::disable_raw_mode().ok();
    Ok(())
}
