use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
/// 交互式选择提示组件
///
/// 基于 crossterm 原始模式，提供支持 vim 快捷键（j/k）的终端选择器。
/// 被 ask_user 和 shell_exec 工具共用。
use std::io::IsTerminal;

/// 选择器选项
pub struct SelectOption<'a> {
    /// 选项标签（短文本，如 "性能优化"）
    pub label: &'a str,
    /// 选项描述（详细说明，如 "减少内存使用和执行时间"）
    pub description: &'a str,
}

/// 显示单选选择器
///
/// 返回选中项的索引（从 0 开始），用户取消（Ctrl+C）则返回 `None`。
///
/// **快捷键**：
/// - `j` / `↓`：向下移动
/// - `k` / `↑`：向上移动
/// - `1`-`9`：直接选择对应编号的选项
/// - `Enter`：确认当前选中项
/// - `Ctrl+C`：取消
pub fn prompt_single_select<'a>(question: &str, options: &[SelectOption<'a>]) -> Option<usize> {
    if !std::io::stdin().is_terminal() {
        return None;
    }

    let _guard = RawModeGuard::new()?;
    let mut selected: usize = 0;
    let list_height = 1 + options.len();

    render_list(question, options, selected, None, true);

    loop {
        match crossterm::event::read() {
            // 数字快捷键：1-9
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Char(c @ '1'..='9'),
                ..
            })) => {
                let idx = (c as usize) - ('1' as usize);
                if idx < options.len() {
                    clear_lines(list_height);
                    println!();
                    return Some(idx);
                }
            }
            // Ctrl+C → 取消
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Char('c'),
                modifiers: KeyModifiers::CONTROL,
                ..
            })) => {
                clear_lines(list_height);
                println!();
                return None;
            }
            // 上 / k → 上移
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Up, ..
            }))
            | Ok(Event::Key(KeyEvent {
                code: KeyCode::Char('k'),
                ..
            })) if selected > 0 => {
                selected -= 1;
                render_list(question, options, selected, None, false);
            }
            // 下 / j → 下移
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Down,
                ..
            }))
            | Ok(Event::Key(KeyEvent {
                code: KeyCode::Char('j'),
                ..
            })) if selected < options.len() - 1 => {
                selected += 1;
                render_list(question, options, selected, None, false);
            }
            // Enter → 确认
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Enter,
                ..
            })) => {
                clear_lines(list_height);
                println!();
                return Some(selected);
            }
            _ => {}
        }
    }
}

/// 显示多选选择器
///
/// 返回选中项的索引列表（从 0 开始），用户取消（Ctrl+C）则返回 `None`。
///
/// **快捷键**：
/// - `j` / `↓`：向下移动
/// - `k` / `↑`：向上移动
/// - `Space`：切换当前项的选中状态
/// - `1`-`9`：直接跳转到对应编号的选项
/// - `Enter`：确认选择（提交所有已选中的项）
/// - `Ctrl+C`：取消
pub fn prompt_multi_select<'a>(question: &str, options: &[SelectOption<'a>]) -> Option<Vec<usize>> {
    if !std::io::stdin().is_terminal() {
        return None;
    }

    let _guard = RawModeGuard::new()?;
    let mut selected: usize = 0;
    let mut toggled: Vec<bool> = vec![false; options.len()];
    let list_height = 1 + options.len();

    render_list(question, options, selected, Some(&toggled), true);

    loop {
        match crossterm::event::read() {
            // 数字快捷键：1-9 → 跳转
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Char(c @ '1'..='9'),
                ..
            })) => {
                let idx = (c as usize) - ('1' as usize);
                if idx < options.len() {
                    selected = idx;
                    render_list(question, options, selected, Some(&toggled), false);
                }
            }
            // Space → 切换选中
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Char(' '),
                ..
            })) => {
                toggled[selected] = !toggled[selected];
                // 如果下方还有选项，自动下移一格
                if selected < options.len() - 1 {
                    selected += 1;
                }
                render_list(question, options, selected, Some(&toggled), false);
            }
            // Ctrl+C → 取消
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Char('c'),
                modifiers: KeyModifiers::CONTROL,
                ..
            })) => {
                clear_lines(list_height);
                println!();
                return None;
            }
            // 上 / k
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Up, ..
            }))
            | Ok(Event::Key(KeyEvent {
                code: KeyCode::Char('k'),
                ..
            })) if selected > 0 => {
                selected -= 1;
                render_list(question, options, selected, Some(&toggled), false);
            }
            // 下 / j
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Down,
                ..
            }))
            | Ok(Event::Key(KeyEvent {
                code: KeyCode::Char('j'),
                ..
            })) if selected < options.len() - 1 => {
                selected += 1;
                render_list(question, options, selected, Some(&toggled), false);
            }
            // Enter → 确认提交
            Ok(Event::Key(KeyEvent {
                code: KeyCode::Enter,
                ..
            })) => {
                clear_lines(list_height);
                println!();
                let result: Vec<usize> = toggled
                    .iter()
                    .enumerate()
                    .filter(|&(_, &v)| v)
                    .map(|(i, _)| i)
                    .collect();
                return Some(result);
            }
            _ => {}
        }
    }
}

/// 渲染选项列表
///
/// - `initial=true`：首次渲染，直接输出；`false`：从底部上移覆盖重绘
/// - `toggled`: 多选模式下已选中的项，`None` 表示单选模式
fn render_list(
    question: &str,
    options: &[SelectOption],
    selected: usize,
    toggled: Option<&[bool]>,
    initial: bool,
) {
    use crossterm::style::Stylize;
    use std::io::Write;
    let mut stderr = std::io::stderr();

    let list_height = 1 + options.len();

    if !initial {
        for _ in 0..list_height {
            write!(stderr, "\x1b[1F").ok();
        }
    }

    // 标题行
    writeln!(stderr, "\r{} {}", "?".green().bold(), question).ok();

    // 选项行
    for (i, opt) in options.iter().enumerate() {
        let num = i + 1;
        let is_selected = i == selected;

        if let Some(toggled_states) = toggled {
            // 多选模式：显示复选框
            let checked = if toggled_states[i] { "✓" } else { " " };
            if is_selected {
                writeln!(
                    stderr,
                    "\r  ▸ [{checked}] {}  ─ {}",
                    opt.label.green(),
                    opt.description
                )
                .ok();
            } else {
                writeln!(
                    stderr,
                    "\r    [{checked}] {}  ─ {}",
                    opt.label, opt.description
                )
                .ok();
            }
        } else {
            // 单选模式：显示编号
            if is_selected {
                writeln!(
                    stderr,
                    "\r  ▸ {}. {}  ─ {}",
                    num,
                    opt.label.green(),
                    opt.description
                )
                .ok();
            } else {
                writeln!(
                    stderr,
                    "\r    {}. {}  ─ {}",
                    num, opt.label, opt.description
                )
                .ok();
            }
        }
    }
}

/// 清除列表区域的 N 行（从下往上）
fn clear_lines(count: usize) {
    use std::io::Write;
    let mut stderr = std::io::stderr();
    for _ in 0..count {
        write!(stderr, "\x1b[1F\x1b[2K").ok();
    }
}

/// RAII guard：创建时进入原始模式 + 隐藏光标，drop 时恢复
struct RawModeGuard;
impl RawModeGuard {
    fn new() -> Option<Self> {
        crossterm::terminal::enable_raw_mode().ok()?;
        _ = crossterm::execute!(std::io::stderr(), crossterm::cursor::Hide);
        Some(Self)
    }
}
impl Drop for RawModeGuard {
    fn drop(&mut self) {
        _ = crossterm::execute!(std::io::stderr(), crossterm::cursor::Show);
        _ = crossterm::terminal::disable_raw_mode();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_non_terminal_single_select() {
        let options = [SelectOption {
            label: "A",
            description: "desc A",
        }];
        // 非 TTY 环境应返回 None
        assert!(prompt_single_select("test?", &options).is_none());
    }

    #[test]
    fn test_non_terminal_multi_select() {
        let options = [SelectOption {
            label: "A",
            description: "desc A",
        }];
        assert!(prompt_multi_select("test?", &options).is_none());
    }

    #[test]
    fn test_empty_options_single_select() {
        assert!(prompt_single_select("test?", &[]).is_none());
    }

    #[test]
    fn test_empty_options_multi_select() {
        assert!(prompt_multi_select("test?", &[]).is_none());
    }
}
