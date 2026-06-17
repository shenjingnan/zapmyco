//! 单选/多选选择器组件。
//!
//! 基于 crossterm 原始模式，提供支持 vim 快捷键（j/k）的终端选择器。
//! 被 ask_user 和 shell_exec 工具共用。

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::style::Stylize;

use crate::output::{self, Message};
use crate::tui::types::{MultiSelectResult, SelectOption, SingleSelectResult};

use std::io::{IsTerminal, Write};

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
            match event {
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
                Event::Key(KeyEvent {
                    code: KeyCode::Char('c'),
                    modifiers: KeyModifiers::CONTROL,
                    ..
                }) => {
                    clear_lines(list_height);
                    drop(guard);
                    return None;
                }
                Event::Key(KeyEvent {
                    code: KeyCode::Backspace,
                    ..
                }) => {
                    input_buf.pop();
                    render_single_list(question, options, selected, false, Some(&input_buf));
                }
                Event::Key(KeyEvent {
                    code: KeyCode::Up, ..
                }) if selected > 0 => {
                    selected -= 1;
                    render_single_list(question, options, selected, false, Some(&input_buf));
                }
                Event::Key(KeyEvent {
                    code: KeyCode::Down,
                    ..
                }) if selected < options.len() - 1 => {
                    selected += 1;
                    render_single_list(question, options, selected, false, Some(&input_buf));
                }
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
                Event::Key(KeyEvent {
                    code: KeyCode::Char('c'),
                    modifiers: KeyModifiers::CONTROL,
                    ..
                }) => {
                    clear_lines(list_height);
                    drop(guard);
                    return None;
                }
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
                Ok(Event::Key(KeyEvent {
                    code: KeyCode::Char(' '),
                    ..
                })) => {
                    if options[selected].custom_input {
                        clear_lines(list_height);
                        drop(guard);
                        let text = read_custom_input(question);
                        if text.is_empty() {
                            captured_custom = None;
                            toggled[selected] = false;
                        } else {
                            captured_custom = Some(text);
                            toggled[selected] = true;
                        }
                        continue 'outer;
                    }
                    toggled[selected] = !toggled[selected];
                    if selected < options.len() - 1 {
                        selected += 1;
                    }
                    render_multi_list(question, options, selected, &toggled, false);
                }
                Ok(Event::Key(KeyEvent {
                    code: KeyCode::Char('c'),
                    modifiers: KeyModifiers::CONTROL,
                    ..
                })) => {
                    clear_lines(list_height);
                    drop(guard);
                    return None;
                }
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
fn read_custom_input(question: &str) -> String {
    let mut stderr = std::io::stderr();
    let _ = writeln!(stderr, "{} {}", "?".green().bold(), question);
    let _ = write!(stderr, "{} ", "请输入:".green().bold());
    let _ = stderr.flush();

    output::send(&Message::result(String::new()));

    let mut input = String::new();
    match std::io::stdin().read_line(&mut input) {
        Ok(_) => input.trim().to_string(),
        Err(_) => String::new(),
    }
}

/// 渲染单选列表
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
        let display_num = if i == options.len() - 1 && options.len() > 2 {
            "0".to_string()
        } else {
            (i + 1).to_string()
        };
        let is_sel = i == selected;

        if opt.custom_input {
            if is_sel {
                let preview = input_preview.unwrap_or("");
                if preview.is_empty() {
                    writeln!(stderr, "\r  ▸ {}. █\x1b[0K", display_num).ok();
                } else {
                    writeln!(stderr, "\r  ▸ {}. {}█\x1b[0K", display_num, preview).ok();
                }
            } else {
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

    // -- render_single_list --

    #[test]
    fn test_render_single_list_non_terminal() {
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
        render_single_list("测试?", &options, 1, true, Some("hello"));
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
        clear_lines(0);
        clear_lines(3);
    }

    // -- render_single_list 末项编号 '0' --

    #[test]
    fn test_render_single_list_two_options_unchanged() {
        let options = [
            SelectOption {
                label: "A",
                description: "desc A",
                custom_input: false,
            },
            SelectOption {
                label: "B",
                description: "desc B",
                custom_input: false,
            },
        ];
        render_single_list("测试?", &options, 0, true, None);
    }

    #[test]
    fn test_render_single_list_three_options_last_is_zero() {
        let options = [
            SelectOption {
                label: "允许",
                description: "执行",
                custom_input: false,
            },
            SelectOption {
                label: "始终允许",
                description: "加入白名单",
                custom_input: false,
            },
            SelectOption {
                label: "拒绝",
                description: "取消",
                custom_input: false,
            },
        ];
        render_single_list("是否确认执行？", &options, 0, true, None);
        render_single_list("是否确认执行？", &options, 2, false, None);
    }

    #[test]
    fn test_render_single_list_four_options_last_is_zero() {
        let options = [
            SelectOption {
                label: "A",
                description: "",
                custom_input: false,
            },
            SelectOption {
                label: "B",
                description: "",
                custom_input: false,
            },
            SelectOption {
                label: "C",
                description: "",
                custom_input: false,
            },
            SelectOption {
                label: "D",
                description: "",
                custom_input: false,
            },
        ];
        render_single_list("测试?", &options, 0, true, None);
        render_single_list("测试?", &options, 3, false, None);
    }

    #[test]
    fn test_render_single_list_one_option() {
        let options = [SelectOption {
            label: "唯一选项",
            description: "desc",
            custom_input: false,
        }];
        render_single_list("测试?", &options, 0, true, None);
    }

    #[test]
    fn test_render_single_list_zero_options() {
        let options: [SelectOption; 0] = [];
        render_single_list("测试?", &options, 0, true, None);
    }

    #[test]
    fn test_render_single_list_zero_key_with_custom_input() {
        let options = [
            SelectOption {
                label: "A",
                description: "opt A",
                custom_input: false,
            },
            SelectOption {
                label: "B",
                description: "opt B",
                custom_input: true,
            },
        ];
        render_single_list("测试?", &options, 1, false, Some(""));
        render_single_list("测试?", &options, 1, false, Some("用户输入"));
    }
}
