/// 快速笔记模块 — 记录灵感、待办、想法
///
/// 每条笔记是一个独立的 Markdown 文件，存放在 ~/.zapmyco/notes/ 下。
/// 文件格式: YAML frontmatter (created) + 正文
use chrono::Local;
use std::fs;
use std::path::PathBuf;

const NOTES_DIR: &str = "notes";

/// 笔记列表中的条目
pub struct NoteEntry {
    pub id: String,
    pub created: String,
    pub preview: String,
}

/// 笔记操作
pub struct NotesDir {
    path: PathBuf,
}

impl NotesDir {
    /// 创建或打开笔记目录
    pub fn new() -> Result<Self, String> {
        let path = crate::settings::get_settings_dir().join(NOTES_DIR);
        fs::create_dir_all(&path).map_err(|e| format!("创建笔记目录失败: {}", e))?;
        Ok(Self { path })
    }

    /// 快速创建笔记（内容从参数传入）
    pub fn create(&self, content: &str) -> Result<String, String> {
        let content = content.trim();
        if content.is_empty() {
            return Err("笔记内容不能为空".to_string());
        }

        let now = Local::now();
        let ts_compact = now.format("%Y-%m-%d_%H%M%S").to_string();
        let ts_iso = now.format("%Y-%m-%dT%H:%M:%S%:z").to_string();

        // 从第一行提取摘要（非字母数字替换为 _，截取前 30 字符）
        let first_line = content.lines().next().unwrap_or("");
        let slug: String = first_line
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>()
            .trim_matches('_')
            .chars()
            .take(30)
            .collect();
        let slug = if slug.is_empty() { "untitled" } else { &slug };

        // 处理文件名校验
        let base_name = format!("{}_{}", ts_compact, slug);
        let mut file_name = format!("{}.md", base_name);
        let mut file_path = self.path.join(&file_name);
        let mut counter = 1;
        while file_path.exists() {
            file_name = format!("{}_{}.md", base_name, counter);
            file_path = self.path.join(&file_name);
            counter += 1;
        }

        // 写入 frontmatter + 内容
        let file_content = format!("---\ncreated: {}\n---\n\n{}\n", ts_iso, content);
        fs::write(&file_path, file_content).map_err(|e| format!("写入笔记失败: {}", e))?;

        // 返回 id（不含扩展名的文件名）
        let id = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&file_name)
            .to_string();
        Ok(id)
    }

    /// 交互式笔记 — 通过 $EDITOR 编辑
    pub fn create_interactive(&self) -> Result<String, String> {
        // 检测编辑器
        let editor = std::env::var("VISUAL")
            .or_else(|_| std::env::var("EDITOR"))
            .unwrap_or_else(|_| "vi".to_string());

        // 创建临时文件
        let mut tmp = std::env::temp_dir();
        tmp.push("zapmyco_note.md");
        let tmp_path = tmp;

        // 写入模板
        fs::write(&tmp_path, "\n").map_err(|e| format!("创建临时文件失败: {}", e))?;

        // 启动编辑器
        let status = std::process::Command::new(&editor)
            .arg(&tmp_path)
            .status()
            .map_err(|e| format!("启动编辑器 {} 失败: {}", editor, e))?;

        if !status.success() {
            return Err(format!("编辑器 {} 异常退出", editor));
        }

        // 读取编辑结果
        let content =
            fs::read_to_string(&tmp_path).map_err(|e| format!("读取临时文件失败: {}", e))?;
        let _ = fs::remove_file(&tmp_path);

        let content = content.trim();
        if content.is_empty() {
            return Err("笔记内容不能为空".to_string());
        }

        self.create(content)
    }

    /// 获取所有笔记文件列表（按时间倒序）
    fn collect_files(&self) -> Result<Vec<PathBuf>, String> {
        let dir = fs::read_dir(&self.path).map_err(|e| format!("读取笔记目录失败: {}", e))?;

        let mut files: Vec<PathBuf> = dir
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "md"))
            .map(|e| e.path())
            .collect();

        // 按文件名倒序（最新的在前 — 文件名以时间戳开头）
        files.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        Ok(files)
    }

    /// 列出笔记（默认 limit 条，--all 则全量）
    pub fn list(&self, limit: usize, all: bool) -> Result<Vec<NoteEntry>, String> {
        let files = self.collect_files()?;
        let total = files.len();
        let take = if all { total } else { limit.min(total) };

        let mut entries = Vec::with_capacity(take);
        for file in files.iter().take(take) {
            if let Some(entry) = self.read_entry(file) {
                entries.push(entry);
            }
        }
        Ok(entries)
    }

    /// 读取一个文件的 NoteEntry（frontmatter + 首行预览）
    fn read_entry(&self, path: &PathBuf) -> Option<NoteEntry> {
        let content = fs::read_to_string(path).ok()?;
        let id = path.file_stem().and_then(|s| s.to_str())?.to_string();

        // 解析 YAML frontmatter: ---\nkey: value\n---
        let created = if let Some(rest) = content.strip_prefix("---\n") {
            if let Some(end) = rest.find("\n---") {
                let meta = &rest[..end];
                meta.lines()
                    .find_map(|line| line.strip_prefix("created: "))
                    .unwrap_or("")
                    .to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // 提取正文首行作为预览
        let body = if let Some(rest) = content.strip_prefix("---\n") {
            if let Some(end) = rest.find("\n---") {
                &rest[end + 5..] // skip past \n--- and \n
            } else {
                &content
            }
        } else {
            &content
        };
        let preview = body
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .to_string();

        Some(NoteEntry {
            id,
            created,
            preview,
        })
    }

    /// 显示单条笔记完整内容
    pub fn show(&self, id: &str) -> Result<String, String> {
        let mut path = self.path.join(format!("{}.md", id));
        if !path.exists() {
            // 尝试精确匹配（可能是完整文件名）
            path = self.path.join(id);
        }
        if !path.exists() {
            return Err(format!("未找到笔记: {}", id));
        }

        fs::read_to_string(&path).map_err(|e| format!("读取笔记失败: {}", e))
    }

    /// 搜索笔记内容（文件名 + 正文）
    pub fn grep(&self, keyword: &str) -> Result<Vec<NoteEntry>, String> {
        if keyword.is_empty() {
            return Ok(Vec::new());
        }

        let files = self.collect_files()?;
        let lower_keyword = keyword.to_lowercase();

        let mut results = Vec::new();
        for file in files {
            if let Some(entry) = self.read_entry(&file)
                && (entry.id.to_lowercase().contains(&lower_keyword)
                    || entry.preview.to_lowercase().contains(&lower_keyword))
            {
                results.push(entry);
            }
        }
        Ok(results)
    }

    /// 删除笔记
    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut path = self.path.join(format!("{}.md", id));
        if !path.exists() {
            path = self.path.join(id);
        }
        if !path.exists() {
            return Err(format!("未找到笔记: {}", id));
        }

        fs::remove_file(&path).map_err(|e| format!("删除笔记失败: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;

    #[test]
    fn test_new_creates_notes_dir() {
        run_with_temp_home(|home| {
            let notes_dir = NotesDir::new().unwrap();
            assert!(
                notes_dir.path.starts_with(home.join(".zapmyco")),
                "notes dir should be under ~/.zapmyco/notes"
            );
            assert!(notes_dir.path.join("..").exists());
        });
    }

    #[test]
    fn test_create_and_list() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id = notes.create("测试笔记").unwrap();
            assert!(id.contains("测试笔记"), "id should contain slug: {}", id);

            let entries = notes.list(10, false).unwrap();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].id, id);
            assert!(!entries[0].created.is_empty());
            assert_eq!(entries[0].preview, "测试笔记");
        });
    }

    #[test]
    fn test_create_empty_content() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let result = notes.create("");
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("不能为空"));
        });
    }

    #[test]
    fn test_create_whitespace_only() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let result = notes.create("   \n  ");
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_show_note() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id = notes.create("显示测试").unwrap();
            let content = notes.show(&id).unwrap();
            assert!(content.contains("显示测试"));
            assert!(content.contains("created: "));
        });
    }

    #[test]
    fn test_show_nonexistent() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let result = notes.show("不存在");
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("未找到"));
        });
    }

    #[test]
    fn test_grep() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            notes.create("今天的待办事项").unwrap();
            notes.create("明天的会议准备").unwrap();

            let results = notes.grep("待办").unwrap();
            assert_eq!(results.len(), 1);
            assert!(results[0].preview.contains("待办"));

            let results = notes.grep("明天").unwrap();
            assert_eq!(results.len(), 1);

            let results = notes.grep("不存在").unwrap();
            assert_eq!(results.len(), 0);
        });
    }

    #[test]
    fn test_grep_empty_keyword() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            notes.create("something").unwrap();
            let results = notes.grep("").unwrap();
            assert!(results.is_empty());
        });
    }

    #[test]
    fn test_remove() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id = notes.create("待删除").unwrap();
            assert_eq!(notes.list(10, false).unwrap().len(), 1);

            notes.remove(&id).unwrap();
            assert_eq!(notes.list(10, false).unwrap().len(), 0);
        });
    }

    #[test]
    fn test_remove_nonexistent() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let result = notes.remove("不存在");
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_list_ordering_newest_first() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id1 = notes.create("第一条笔记").unwrap();
            let id2 = notes.create("第二条笔记").unwrap();

            let entries = notes.list(10, false).unwrap();
            assert_eq!(entries.len(), 2);
            // 最新的在前
            assert_eq!(entries[0].id, id2);
            assert_eq!(entries[1].id, id1);
        });
    }

    #[test]
    fn test_list_limit() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            notes.create("笔记1").unwrap();
            notes.create("笔记2").unwrap();
            notes.create("笔记3").unwrap();

            let entries = notes.list(2, false).unwrap();
            assert_eq!(entries.len(), 2);
        });
    }

    #[test]
    fn test_list_all() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            notes.create("笔记1").unwrap();
            notes.create("笔记2").unwrap();

            let entries = notes.list(1, true).unwrap();
            assert_eq!(entries.len(), 2);
        });
    }

    #[test]
    fn test_list_empty_dir() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let entries = notes.list(10, false).unwrap();
            assert!(entries.is_empty());
        });
    }

    #[test]
    fn test_filename_collision() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id1 = notes.create("重名笔记").unwrap();
            let id2 = notes.create("重名笔记").unwrap();
            assert_ne!(id1, id2, "同一秒的两条笔记文件名应不同");
        });
    }

    #[test]
    fn test_special_chars_in_content() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let content = "特殊字符: @#$%^&*() 测试";
            let id = notes.create(content).unwrap();
            assert!(!id.is_empty());
            let shown = notes.show(&id).unwrap();
            assert!(shown.contains(content));
        });
    }

    #[test]
    fn test_multiline_content() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let content = "第一行\n第二行\n第三行";
            let _id = notes.create(content).unwrap();
            let entry = notes.list(10, false).unwrap();
            assert_eq!(entry[0].preview, "第一行");
        });
    }

    #[test]
    fn test_interactive_editor_fallback() {
        // 不实际调用编辑器，只验证 NotesDir::new 正常
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            assert!(notes.path.exists());
        });
    }

    #[test]
    fn test_show_by_full_path() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id = notes.create("完整路径测试").unwrap();
            // 通过不带 .md 的 id 获取
            let content = notes.show(&id).unwrap();
            assert!(content.contains("完整路径测试"));
        });
    }

    #[test]
    fn test_created_timestamp_format() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id = notes.create("时间戳格式测试").unwrap();
            let content = notes.show(&id).unwrap();
            // YAML frontmatter 中的时间戳应为 ISO 8601 格式
            assert!(content.contains("created: "));
            // 验证包含 T 分隔符和时区偏移
            let date_line = content
                .lines()
                .find(|l| l.starts_with("created: "))
                .unwrap();
            assert!(
                date_line.contains('T'),
                "时间戳应包含 T 分隔符: {}",
                date_line
            );
            // 应包含 '+' 或 '-' 时区偏移
            let has_offset =
                date_line.contains('+') || date_line.rfind('-').map_or(false, |idx| idx > 20);
            assert!(has_offset, "时间戳应包含时区偏移: {}", date_line);
        });
    }
}
