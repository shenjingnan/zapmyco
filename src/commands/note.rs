use crate::cli::NoteCommands;
use crate::output::{self, Message};

/// note 命令 — 快速记录笔记
pub(crate) fn cmd_note(command: NoteCommands) -> Result<(), String> {
    let notes = crate::notes::NotesDir::new()?;

    match command {
        NoteCommands::Add { content } => {
            if content.is_empty() {
                let id = notes.create_interactive()?;
                output::send(&Message {
                    kind: output::MessageKind::NoteInfo,
                    text: format!("📝 已创建笔记: {}", id),
                    data: None,
                });
            } else {
                let content = content.join(" ");
                let id = notes.create(&content)?;
                output::send(&Message {
                    kind: output::MessageKind::NoteInfo,
                    text: format!("📝 已创建笔记: {}", id),
                    data: None,
                });
            }
            Ok(())
        }
        NoteCommands::Ls { all, limit } => {
            let limit = limit.unwrap_or(20);
            let entries = notes.list(limit, all)?;
            if entries.is_empty() {
                output::send(&Message::result("暂无笔记".to_string()));
                return Ok(());
            }
            for entry in &entries {
                output::send(&Message::result(format!(
                    "{}  {}  {}",
                    entry.id, entry.created, entry.preview
                )));
            }
            Ok(())
        }
        NoteCommands::Show { id } => {
            let content = notes.show(&id)?;
            if let Some(body) = content.split("\n---\n").nth(1) {
                output::send(&Message::result_block(body.trim().to_string()));
            } else {
                output::send(&Message::result_block(content.trim().to_string()));
            }
            Ok(())
        }
        NoteCommands::Grep { keyword } => {
            let entries = notes.grep(&keyword)?;
            if entries.is_empty() {
                output::send(&Message::result(format!("未找到包含「{}」的笔记", keyword)));
                return Ok(());
            }
            for entry in &entries {
                output::send(&Message::result(format!(
                    "{}  {}  {}",
                    entry.id, entry.created, entry.preview
                )));
            }
            Ok(())
        }
        NoteCommands::Rm { id } => {
            notes.remove(&id)?;
            output::send(&Message::result(format!("已删除笔记: {}", id)));
            Ok(())
        }
    }
}
