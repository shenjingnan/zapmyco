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
        let path = crate::config::settings::get_settings_dir().join(NOTES_DIR);
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
    #[cfg(not(windows))]
    use std::os::unix::fs::PermissionsExt;

    // ─── 基础功能 ───────────────────────────────────────

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
    fn test_slug_only_special_chars() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id = notes.create("@#$%^&*()").unwrap();
            assert!(
                id.contains("untitled"),
                "全特殊字符应回退为 untitled: {}",
                id
            );
        });
    }

    #[test]
    fn test_slug_truncation() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            // 41 个字符，slug 应截取前 30 个
            let long = "这是一段超过三十个字符的笔记标题用来测试截断功能是否正确_extra";
            let id = notes.create(long).unwrap();
            // 直接从磁盘读取文件名，验证 slug 部分长度
            let file_path = notes.path.join(format!("{}.md", id));
            assert!(file_path.exists(), "笔记文件应存在");
            let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap();
            // 文件名格式: YYYY-MM-DD_HHMMSS_{slug}.md
            // slug 从第三个 _ 之后到 .md 之前
            let slug = file_name
                .strip_suffix(".md")
                .unwrap()
                .splitn(3, '_')
                .nth(2)
                .unwrap_or("");
            assert_eq!(
                slug.chars().count(),
                30,
                "slug 应被截断为 30 字符，实际为 {}: {}",
                slug.chars().count(),
                slug
            );
        });
    }

    // ─── 显示与搜索 ─────────────────────────────────────

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
    fn test_show_with_md_extension() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id = notes.create("扩展名测试").unwrap();
            // 用户可能输入带 .md 后缀的 id
            let content = notes.show(&format!("{}.md", id));
            assert!(content.is_ok());
            assert!(content.unwrap().contains("扩展名测试"));
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
    fn test_grep_case_insensitive() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            notes.create("Hello World").unwrap();
            let results = notes.grep("hello").unwrap();
            assert_eq!(results.len(), 1, "grep 应大小写不敏感");
        });
    }

    #[test]
    fn test_grep_match_in_id() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            // 创建一条内容不包含关键词但文件名（id）会包含的笔记
            notes.create("foobar").unwrap();
            // 文件名包含 foobar，搜索 foo 应匹配
            let results = notes.grep("foo").unwrap();
            assert_eq!(results.len(), 1, "应匹配文件名中的关键词");
        });
    }

    // ─── 删除 ────────────────────────────────────────────

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
    fn test_remove_with_md_extension() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let id = notes.create("带后缀删除").unwrap();
            // 传入带 .md 后缀也应能删除
            notes.remove(&format!("{}.md", id)).unwrap();
            assert!(notes.list(10, false).unwrap().is_empty());
        });
    }

    // ─── 列表与排序 ─────────────────────────────────────

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
    fn test_list_filters_non_md() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            notes.create("真实笔记").unwrap();
            // 在笔记目录中放入非 .md 文件
            std::fs::write(notes.path.join("junk.txt"), "not a note").unwrap();
            std::fs::write(notes.path.join(".hidden_file"), "hidden").unwrap();

            let entries = notes.list(10, false).unwrap();
            assert_eq!(entries.len(), 1, "非 .md 文件应被过滤");
        });
    }

    // ─── 文件名碰撞 ─────────────────────────────────────

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
    fn test_filename_collision_many() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let mut ids = Vec::new();
            // 同一秒内创建多条同名笔记
            for _ in 0..5 {
                ids.push(notes.create("并发笔记").unwrap());
            }
            let mut unique = ids.clone();
            unique.sort();
            unique.dedup();
            assert_eq!(unique.len(), 5, "5 条笔记应有 5 个不同的 id");
        });
    }

    // ─── 内容边界 ────────────────────────────────────────

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

    // ─── 交互式编辑器 ──────────────────────────────────

    #[test]
    fn test_interactive_editor_fallback() {
        // 不实际调用编辑器，只验证 NotesDir::new 正常
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            assert!(notes.path.exists());
        });
    }

    #[test]
    #[cfg(not(windows))]
    fn test_interactive_editor_empty_content() {
        // EDITOR=true → 退出码 0 但不修改文件 → 内容为空 → 应报错
        let orig_editor = std::env::var("EDITOR").ok();
        unsafe { std::env::set_var("EDITOR", "true") };

        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let result = notes.create_interactive();
            assert!(result.is_err());
            let msg = result.err().unwrap();
            assert!(
                msg.contains("不能为空") || msg.contains("笔记"),
                "空内容应报错: {}",
                msg
            );
        });

        match orig_editor {
            Some(v) => unsafe { std::env::set_var("EDITOR", v) },
            None => unsafe { std::env::remove_var("EDITOR") },
        }
    }

    #[test]
    fn test_interactive_editor_not_found() {
        // 不存在的编辑器路径 → 应报错
        let orig_editor = std::env::var("EDITOR").ok();
        unsafe { std::env::set_var("EDITOR", "/nonexistent/editor/binary") };

        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let result = notes.create_interactive();
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("启动编辑器"));
        });

        match orig_editor {
            Some(v) => unsafe { std::env::set_var("EDITOR", v) },
            None => unsafe { std::env::remove_var("EDITOR") },
        }
    }

    #[test]
    fn test_interactive_editor_non_zero_exit() {
        // false → 退出码非零 → 应报错
        let orig_editor = std::env::var("EDITOR").ok();
        unsafe { std::env::set_var("EDITOR", "false") };

        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            let result = notes.create_interactive();
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("异常退出"));
        });

        match orig_editor {
            Some(v) => unsafe { std::env::set_var("EDITOR", v) },
            None => unsafe { std::env::remove_var("EDITOR") },
        }
    }

    // ─── Frontmatter 边界 ──────────────────────────────

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

    #[test]
    #[cfg(not(windows))]
    fn test_list_ignores_unreadable_file() {
        run_with_temp_home(|_home| {
            let notes = NotesDir::new().unwrap();
            notes.create("可读笔记").unwrap();
            // 创建一个无权限的 .md 文件
            let bad_file = notes.path.join("broken_note.md");
            std::fs::write(&bad_file, "内容").unwrap();
            std::fs::set_permissions(&bad_file, std::fs::Permissions::from_mode(0o000)).ok();

            let entries = notes.list(10, false).unwrap();
            // 不可读文件应被静默跳过（read_entry 返回 None）
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].preview, "可读笔记");

            // 恢复权限以便清理
            std::fs::set_permissions(&bad_file, std::fs::Permissions::from_mode(0o644)).ok();
        });
    }
}
