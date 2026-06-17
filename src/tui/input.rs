//! 内联输入组件——在 raw 模式下捕获键盘输入的状态机。
//!
//! 提供无渲染的输入缓冲区管理，供 [`select`](super::select) 等 TUI 组件使用。
//! 调用者负责渲染和根据返回的动作决定业务逻辑。

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

/// 内联输入状态机
pub struct InlineInput {
    buf: String,
}

/// 输入事件处理结果
pub enum InputAction {
    /// 用户按下 Enter，提交当前文本
    Confirm(String),
    /// 用户按下 Ctrl+C，取消
    Cancel,
    /// 用户按下 ↑/k，导航上移
    Up,
    /// 用户按下 ↓/j，导航下移
    Down,
    /// 缓冲区内容已更新，调用者需要重新渲染
    Updated,
    /// 无关事件，不需要处理
    Nothing,
}

impl InlineInput {
    /// 创建新的输入状态机
    pub fn new() -> Self {
        Self { buf: String::new() }
    }

    /// 获取当前输入文本
    pub fn text(&self) -> &str {
        &self.buf
    }

    /// 输入是否为空
    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    /// 清空输入缓冲区
    pub fn clear(&mut self) {
        self.buf.clear();
    }

    /// 处理键盘事件，返回对应的动作
    ///
    /// 调用者根据返回的 [`InputAction`] 决定渲染和业务逻辑：
    /// - [`InputAction::Confirm`]：用户确认输入，附带最终文本
    /// - [`InputAction::Cancel`]：用户取消，应退出选择器
    /// - [`InputAction::Up`] / [`InputAction::Down`]：用户切换选项
    /// - [`InputAction::Updated`]：缓冲区变更，应调用 `text()` 获取新内容并重新渲染
    /// - [`InputAction::Nothing`]：忽略
    pub fn handle_event(&mut self, event: &Event) -> InputAction {
        match event {
            Event::Key(KeyEvent {
                code: KeyCode::Enter,
                ..
            }) => InputAction::Confirm(self.buf.trim().to_string()),

            Event::Key(KeyEvent {
                code: KeyCode::Char('c'),
                modifiers: KeyModifiers::CONTROL,
                ..
            }) => InputAction::Cancel,

            Event::Key(KeyEvent {
                code: KeyCode::Backspace,
                ..
            }) => {
                self.buf.pop();
                InputAction::Updated
            }

            Event::Key(KeyEvent {
                code: KeyCode::Char('k'),
                ..
            })
            | Event::Key(KeyEvent {
                code: KeyCode::Up, ..
            }) => InputAction::Up,

            Event::Key(KeyEvent {
                code: KeyCode::Char('j'),
                ..
            })
            | Event::Key(KeyEvent {
                code: KeyCode::Down,
                ..
            }) => InputAction::Down,

            Event::Key(KeyEvent {
                code: KeyCode::Char(c),
                ..
            }) => {
                self.buf.push(*c);
                InputAction::Updated
            }

            _ => InputAction::Nothing,
        }
    }
}

impl Default for InlineInput {
    fn default() -> Self {
        Self::new()
    }
}
