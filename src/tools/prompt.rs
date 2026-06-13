use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::style::Stylize;

use crate::output::{self, Message};

/// 交互式选择提示组件
///
/// 基于 crossterm 原始模式，提供支持 vim 快捷键（j/k）的终端选择器。
/// 被 ask_user 和 shell_exec 工具共用。
use std::io::{IsTerminal, Write};

/// 选择器选项
pub struct SelectOption<'a> {
    /// 选项标签（短文本，如 "性能优化"）
    pub label: &'a str,
    /// 选项描述（详细说明，如 "减少内存使用和执行时间"）
    pub description: &'a str,
    /// 选中此项后进入文本输入模式，让用户自行输入
    pub custom_input: bool,
}

/// 单选结果
pub enum SingleSelectResult {
    /// 选择了预定义选项（索引）
    Index(usize),
    /// 用户自行输入的内容
    Custom(String),
}

/// 多选结果
pub struct MultiSelectResult {
    /// 选中的预定义选项索引列表
    pub indices: Vec<usize>,
    /// 用户自行输入的内容（如有）
    pub custom_text: Option<String>,
}

/// 显示单选选择器
///
/// **快捷键**：
/// - `j` / `↓`：向下移动
/// - `k` / `↑`：向上移动
/// - `1`-`9`：直接选择对应编号的选项
/// - `Enter`：确认当前选中项
/// - `Ctrl+C`：取消
pub fn prompt_single_select(
    question: &str,
    options: &[SelectOption],
) -> Option<SingleSelectResult> {
    if !std::io::stdin().is_terminal() || options.is_empty() {
        return None;
    }

    let guard = RawModeGuard::new()?;
    let mut selected: usize = 0;
    let mut input_buf = String::new();
    let list_height = 1 + options.len();

    render_single_list(question, options, selected, true, None);

    loop {
        let event = match crossterm::event::read() {
            Ok(e) => e,
            Err(_) => continue,
        };

        if options[selected].custom_input {
            // ---- 内联输入模式 ----
            // 在选项行内直接输入，支持 ↑/k 切换选项。
            // IME 拼音可能显示在光标下一行（终端 raw mode 固有限制）。
            match event {
                // Enter → 提交
                Event::Key(KeyEvent {
                    code: KeyCode::Enter,
                    ..
                }) => {
                    clear_lines(list_height);
                    drop(guard);
                    return if input_buf.is_empty() {
                        Some(SingleSelectResult::Index(selected))
                    } else {
                        Some(SingleSelectResult::Custom(input_buf.trim().to_string()))
                    };
                }
                // Ctrl+C → 取消
                Event::Key(KeyEvent {
                    code: KeyCode::Char('c'),
                    modifiers: KeyModifiers::CONTROL,
                    ..
                }) => {
                    clear_lines(list_height);
                    drop(guard);
                    return None;
                }
                // Backspace → 删除
                Event::Key(KeyEvent {
                    code: KeyCode::Backspace,
                    ..
                }) => {
                    input_buf.pop();
                    render_single_list(question, options, selected, false, Some(&input_buf));
                }
                // ↑ → 上移退出输入模式（保留输入内容）
                Event::Key(KeyEvent {
                    code: KeyCode::Up, ..
                }) if selected > 0 => {
                    selected -= 1;
                    render_single_list(question, options, selected, false, Some(&input_buf));
                }
                // ↓ → 下移退出输入模式（保留输入内容）
                Event::Key(KeyEvent {
                    code: KeyCode::Down,
                    ..
                }) if selected < options.len() - 1 => {
                    selected += 1;
                    render_single_list(question, options, selected, false, Some(&input_buf));
                }
                // 普通字符 → 追加
                Event::Key(KeyEvent {
                    code: KeyCode::Char(c),
                    ..
                }) => {
                    input_buf.push(c);
                    render_single_list(question, options, selected, false, Some(&input_buf));
                }
                _ => {}
            }
        } else {
            // ---- 普通导航模式 ----
            match event {
                // 数字快捷键 1-9
                Event::Key(KeyEvent {
                    code: KeyCode::Char(c @ '1'..='9'),
                    ..
                }) => {
                    let idx = (c as usize) - ('1' as usize);
                    if idx < options.len() {
                        if options[idx].custom_input {
                            selected = idx;
                            let preview = if input_buf.is_empty() { "" } else { &input_buf };
                            render_single_list(question, options, selected, false, Some(preview));

                            continue;
                        }
                        clear_lines(list_height);
                        drop(guard);
                        return Some(SingleSelectResult::Index(idx));
                    }
                }
                // 数字快捷键 0 → 最后一个选项（拒绝/取消）
                Event::Key(KeyEvent {
                    code: KeyCode::Char('0'),
                    ..
                }) => {
                    let idx = options.len() - 1;
                    if options[idx].custom_input {
                        selected = idx;
                        let preview = if input_buf.is_empty() { "" } else { &input_buf };
                        render_single_list(question, options, selected, false, Some(preview));
                        continue;
                    }
                    clear_lines(list_height);
                    drop(guard);
                    return Some(SingleSelectResult::Index(idx));
                }
                // Ctrl+C → 取消
                Event::Key(KeyEvent {
                    code: KeyCode::Char('c'),
                    modifiers: KeyModifiers::CONTROL,
                    ..
                }) => {
                    clear_lines(list_height);
                    drop(guard);
                    return None;
                }
                // ↑ / k → 上移
                Event::Key(KeyEvent {
                    code: KeyCode::Up, ..
                })
                | Event::Key(KeyEvent {
                    code: KeyCode::Char('k'),
                    ..
                }) if selected > 0 => {
                    selected -= 1;
                    render_single_list(question, options, selected, false, Some(&input_buf));
                }
                // ↓ / j → 下移
                Event::Key(KeyEvent {
                    code: KeyCode::Down,
                    ..
                })
                | Event::Key(KeyEvent {
                    code: KeyCode::Char('j'),
                    ..
                }) if selected < options.len() - 1 => {
                    selected += 1;
                    if options[selected].custom_input {
                        let preview = if input_buf.is_empty() { "" } else { &input_buf };
                        render_single_list(question, options, selected, false, Some(preview));
                    } else {
                        render_single_list(question, options, selected, false, Some(&input_buf));
                    }
                }
                // Enter → 确认
                Event::Key(KeyEvent {
                    code: KeyCode::Enter,
                    ..
                }) => {
                    clear_lines(list_height);
                    drop(guard);
                    return Some(SingleSelectResult::Index(selected));
                }
                _ => {}
            }
        }
    }
}

/// 显示多选选择器
///
/// **快捷键**：
/// - `j` / `↓`：向下移动
/// - `k` / `↑`：向上移动
/// - `Space`：切换当前项的选中状态
/// - `1`-`9`：直接跳转到对应编号的选项
/// - `Enter`：确认选择（提交所有已选中的项）
/// - `Ctrl+C`：取消
pub fn prompt_multi_select(question: &str, options: &[SelectOption]) -> Option<MultiSelectResult> {
    if !std::io::stdin().is_terminal() || options.is_empty() {
        return None;
    }

    let mut selected: usize = 0;
    let mut toggled: Vec<bool> = vec![false; options.len()];
    let mut captured_custom: Option<String> = None;
    let list_height = 1 + options.len();

    'outer: loop {
        let guard = RawModeGuard::new()?;
        render_multi_list(question, options, selected, &toggled, true);

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
                        if options[selected].custom_input {
                            clear_lines(list_height);
                            drop(guard);
                            let text = read_custom_input(question);
                            return Some(MultiSelectResult {
                                indices: toggled
                                    .iter()
                                    .enumerate()
                                    .filter(|&(ref i, &v)| v && !options[*i].custom_input)
                                    .map(|(i, _)| i)
                                    .collect(),
                                custom_text: if text.is_empty() { None } else { Some(text) },
                            });
                        }
                        render_multi_list(question, options, selected, &toggled, false);
                    }
                }
                // Space → 切换选中
                Ok(Event::Key(KeyEvent {
                    code: KeyCode::Char(' '),
                    ..
                })) => {
                    if options[selected].custom_input {
                        // 勾选自定义选项 → 立即进入输入模式
                        clear_lines(list_height);
                        drop(guard); // 退出 raw 模式
                        let text = read_custom_input(question);
                        if text.is_empty() {
                            captured_custom = None;
                            toggled[selected] = false;
                        } else {
                            captured_custom = Some(text);
                            toggled[selected] = true;
                        }
                        // 重新进入 outer loop，重建 guard
                        continue 'outer;
                    }
                    toggled[selected] = !toggled[selected];
                    if selected < options.len() - 1 {
                        selected += 1;
                    }
                    render_multi_list(question, options, selected, &toggled, false);
                }
                // Ctrl+C → 取消
                Ok(Event::Key(KeyEvent {
                    code: KeyCode::Char('c'),
                    modifiers: KeyModifiers::CONTROL,
                    ..
                })) => {
                    clear_lines(list_height);
                    drop(guard);
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
                    render_multi_list(question, options, selected, &toggled, false);
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
                    render_multi_list(question, options, selected, &toggled, false);
                }
                // Enter → 确认提交
                Ok(Event::Key(KeyEvent {
                    code: KeyCode::Enter,
                    ..
                })) => {
                    clear_lines(list_height);
                    drop(guard);

                    let indices: Vec<usize> = toggled
                        .iter()
                        .enumerate()
                        .filter(|&(ref i, &v)| v && !options[*i].custom_input)
                        .map(|(i, _)| i)
                        .collect();

                    return Some(MultiSelectResult {
                        indices,
                        custom_text: captured_custom,
                    });
                }
                _ => {}
            }
        }
    }
}

/// 退出 raw 模式后读取用户文本输入
///
/// 终端恢复正常模式，在 stderr 显示提示，从 stdin 读取一行。
fn read_custom_input(question: &str) -> String {
    // stderr 提示：换行后显示问题
    let mut stderr = std::io::stderr();
    let _ = writeln!(stderr, "{} {}", "?".green().bold(), question);
    let _ = write!(stderr, "{} ", "请输入:".green().bold());
    let _ = stderr.flush();

    // stdout 也需要换行，否则后续输出可能错位
    output::send(&Message::result(String::new()));

    // 从 stdin 读取一行
    let mut input = String::new();
    match std::io::stdin().read_line(&mut input) {
        Ok(_) => input.trim().to_string(),
        Err(_) => String::new(),
    }
}

/// 渲染单选列表
///
/// `input_preview`: 自定义选项上的内联输入内容，`None` 表示无内联输入
fn render_single_list(
    question: &str,
    options: &[SelectOption],
    selected: usize,
    initial: bool,
    input_preview: Option<&str>,
) {
    let mut stderr = std::io::stderr();
    let list_height = 1 + options.len();

    if !initial {
        for _ in 0..list_height {
            let _ = write!(stderr, "\x1b[1F");
        }
    }

    writeln!(stderr, "\r{} {}\x1b[0K", "?".green().bold(), question).ok();

    for (i, opt) in options.iter().enumerate() {
        // 末项且选项数 ≥3 时显示为 "0"，其余显示 i+1
        let display_num = if i == options.len() - 1 && options.len() > 2 {
            "0".to_string()
        } else {
            (i + 1).to_string()
        };
        let is_sel = i == selected;

        if opt.custom_input {
            if is_sel {
                // 选中状态：只显示内联输入，不显示描述
                let preview = input_preview.unwrap_or("");
                if preview.is_empty() {
                    writeln!(stderr, "\r  ▸ {}. █\x1b[0K", display_num).ok();
                } else {
                    writeln!(stderr, "\r  ▸ {}. {}█\x1b[0K", display_num, preview).ok();
                }
            } else {
                // 未选中：有内容显示内容，无内容显示"自定义输入"占位
                let content = input_preview.unwrap_or("");
                if content.is_empty() {
                    let display = format!("{}. 自定义输入", display_num);
                    writeln!(stderr, "\r    {}\x1b[0K", display.dark_grey()).ok();
                } else {
                    writeln!(stderr, "\r    {}. {}\x1b[0K", display_num, content).ok();
                }
            }
        } else if is_sel {
            writeln!(
                stderr,
                "\r  ▸ {}. {}  ─ {}\x1b[0K",
                display_num,
                opt.label.green(),
                opt.description
            )
            .ok();
        } else {
            writeln!(
                stderr,
                "\r    {}. {}  ─ {}\x1b[0K",
                display_num, opt.label, opt.description
            )
            .ok();
        }
    }
}

/// 渲染多选列表
fn render_multi_list(
    question: &str,
    options: &[SelectOption],
    selected: usize,
    toggled: &[bool],
    initial: bool,
) {
    let mut stderr = std::io::stderr();
    let list_height = 1 + options.len();

    if !initial {
        for _ in 0..list_height {
            let _ = write!(stderr, "\x1b[1F");
        }
    }

    writeln!(stderr, "\r{} {}", "?".green().bold(), question).ok();

    for (i, opt) in options.iter().enumerate() {
        let is_sel = i == selected;
        let checked = if toggled[i] { "✓" } else { " " };
        let prefix = if is_sel { "▸" } else { " " };

        if opt.custom_input && toggled[i] {
            // 自定义选项勾选后，显示输入提示
            writeln!(
                stderr,
                "\r  {} [{}] {}  ─ {}  {}",
                prefix,
                checked,
                opt.label.green(),
                opt.description,
                "(Enter 后输入)".green()
            )
            .ok();
        } else if is_sel {
            writeln!(
                stderr,
                "\r  {} [{}] {}  ─ {}",
                prefix,
                checked,
                opt.label.green(),
                opt.description
            )
            .ok();
        } else {
            writeln!(
                stderr,
                "\r  {} [{}] {}  ─ {}",
                prefix, checked, opt.label, opt.description
            )
            .ok();
        }
    }
}

/// 清除列表区域的 N 行（从下往上）
fn clear_lines(count: usize) {
    let mut stderr = std::io::stderr();
    for _ in 0..count {
        let _ = write!(stderr, "\x1b[1F\x1b[2K");
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
            custom_input: false,
        }];
        assert!(prompt_single_select("test?", &options).is_none());
    }

    #[test]
    fn test_non_terminal_multi_select() {
        let options = [SelectOption {
            label: "A",
            description: "desc A",
            custom_input: false,
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

    #[test]
    fn test_custom_input_option_single_select_non_tty() {
        let options = [
            SelectOption {
                label: "A",
                description: "desc A",
                custom_input: false,
            },
            SelectOption {
                label: "其他",
                description: "自定义",
                custom_input: true,
            },
        ];
        // 非 TTY 下返回 None
        assert!(prompt_single_select("test?", &options).is_none());
    }

    #[test]
    fn test_custom_input_option_multi_select_non_tty() {
        let options = [
            SelectOption {
                label: "A",
                description: "desc A",
                custom_input: false,
            },
            SelectOption {
                label: "其他",
                description: "自定义",
                custom_input: true,
            },
        ];
        assert!(prompt_multi_select("test?", &options).is_none());
    }

    #[test]
    fn test_single_select_result_index() {
        let r = SingleSelectResult::Index(0);
        match r {
            SingleSelectResult::Index(i) => assert_eq!(i, 0),
            _ => panic!("expected Index"),
        }
    }

    #[test]
    fn test_single_select_result_custom() {
        let r = SingleSelectResult::Custom("hello".to_string());
        match r {
            SingleSelectResult::Custom(s) => assert_eq!(s, "hello"),
            _ => panic!("expected Custom"),
        }
    }

    #[test]
    fn test_multi_select_result_both() {
        let r = MultiSelectResult {
            indices: vec![0, 2],
            custom_text: Some("自定义值".to_string()),
        };
        assert_eq!(r.indices, vec![0, 2]);
        assert_eq!(r.custom_text.as_deref(), Some("自定义值"));
    }

    #[test]
    fn test_multi_select_result_indices_only() {
        let r = MultiSelectResult {
            indices: vec![1],
            custom_text: None,
        };
        assert_eq!(r.indices, vec![1]);
        assert!(r.custom_text.is_none());
    }

    #[test]
    fn test_multi_select_result_empty_indices() {
        let r = MultiSelectResult {
            indices: vec![],
            custom_text: Some("text".to_string()),
        };
        assert!(r.indices.is_empty());
        assert_eq!(r.custom_text.as_deref(), Some("text"));
    }

    #[test]
    fn test_select_option_construction() {
        let opt = SelectOption {
            label: "测试选项",
            description: "描述",
            custom_input: true,
        };
        assert_eq!(opt.label, "测试选项");
        assert_eq!(opt.description, "描述");
        assert!(opt.custom_input);
    }

    #[test]
    fn test_select_option_not_custom() {
        let opt = SelectOption {
            label: "普通A",
            description: "desc A",
            custom_input: false,
        };
        assert!(!opt.custom_input);
    }

    #[test]
    fn test_render_single_list_non_terminal() {
        // render_single_list 写入 stderr 不应 panic
        let options = [SelectOption {
            label: "A",
            description: "desc A",
            custom_input: false,
        }];
        render_single_list("测试?", &options, 0, true, None);
        render_single_list("测试?", &options, 0, false, None);
    }

    #[test]
    fn test_render_single_list_with_input_preview() {
        let options = [
            SelectOption {
                label: "A",
                description: "desc A",
                custom_input: false,
            },
            SelectOption {
                label: "其他",
                description: "",
                custom_input: true,
            },
        ];
        // 选中自定义选项且有输入内容
        render_single_list("测试?", &options, 1, true, Some("hello"));
        // 选中自定义选项但无输入
        render_single_list("测试?", &options, 1, false, Some(""));
    }

    #[test]
    fn test_render_multi_list_non_terminal() {
        let options = [SelectOption {
            label: "A",
            description: "desc A",
            custom_input: false,
        }];
        let toggled = [false];
        render_multi_list("测试?", &options, 0, &toggled, true);
        render_multi_list("测试?", &options, 0, &toggled, false);
    }

    #[test]
    fn test_clear_lines_non_terminal() {
        // clear_lines 写入 stderr 不应 panic
        clear_lines(0);
        clear_lines(3);
    }
}
