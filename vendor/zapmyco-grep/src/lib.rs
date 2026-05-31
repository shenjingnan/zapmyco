/// zapmyco-grep — 基于 ignore + grep-regex + grep-searcher 的搜索引擎
///
/// 本 crate 封装了 ripgrep 的核心搜索能力，提供简单的 search() API。
/// 行为与 ripgrep 命令行工具一致（使用相同底层库）。
use std::io;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// 搜索错误
#[derive(Debug, Error)]
pub enum GrepError {
    /// 正则表达式无效
    #[error("无效的正则表达式: {0}")]
    InvalidPattern(String),

    /// 搜索超时（由调用方处理）
    #[error("搜索超时 ({timeout_secs}s)")]
    Timeout {
        /// 超时时间（秒）
        timeout_secs: u64,
    },

    /// 搜索路径无效
    #[error("搜索路径无效: {0}")]
    InvalidPath(String),

    /// 搜索执行失败
    #[error("搜索失败: {0}")]
    SearchError(String),

    /// I/O 错误
    #[error("I/O 错误: {0}")]
    Io(#[from] io::Error),
}

/// 搜索配置
#[derive(Debug, Clone)]
pub struct SearchOptions {
    /// 搜索模式（正则表达式）
    pub pattern: String,
    /// 搜索路径
    pub path: String,
    /// Glob 过滤模式
    pub glob: Option<String>,
    /// 忽略大小写
    pub ignore_case: bool,
    /// 多行模式
    pub multiline: bool,
    /// 文件类型过滤（如 "rust", "py", "js"）
    pub file_type: Option<String>,
    /// 匹配行后显示的上下文行数
    pub after_context: usize,
    /// 匹配行前显示的上下文行数
    pub before_context: usize,
}

/// 单条匹配结果
#[derive(Debug, Clone)]
pub struct SearchMatch {
    /// 文件路径
    pub path: String,
    /// 行号（从 1 开始）
    pub line_number: u64,
    /// 行内容
    pub content: String,
}

/// 搜索结果集合
#[derive(Debug, Clone)]
pub struct SearchResults {
    /// 所有匹配行
    pub matches: Vec<SearchMatch>,
    /// 匹配的文件数量
    pub file_count: usize,
    /// 匹配行总数
    pub match_count: usize,
}

// ---------------------------------------------------------------------------
// Sink implementation
// ---------------------------------------------------------------------------

use grep_searcher::{Sink, SinkMatch};

/// 收集搜索结果的 Sink 实现
///
/// 注意：grep-searcher 0.1 的 SinkMatch 不包含文件路径信息，
/// 路径通过 `set_current_path()` 在每次 search_path 调用前设置。
struct MatchCollector {
    matches: Vec<SearchMatch>,
    files: std::collections::BTreeSet<String>,
    match_count: usize,
    current_path: String,
}

impl MatchCollector {
    fn new() -> Self {
        Self {
            matches: Vec::new(),
            files: std::collections::BTreeSet::new(),
            match_count: 0,
            current_path: String::new(),
        }
    }

    fn set_current_path(&mut self, path: String) {
        self.current_path = path;
    }

    fn into_results(self) -> SearchResults {
        SearchResults {
            matches: self.matches,
            file_count: self.files.len(),
            match_count: self.match_count,
        }
    }
}

impl Sink for MatchCollector {
    type Error = io::Error;

    fn matched(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        mat: &SinkMatch,
    ) -> Result<bool, io::Error> {
        let path = self.current_path.clone();
        let line_number = mat.line_number().unwrap_or(0);
        let content = String::from_utf8_lossy(mat.bytes()).to_string();

        self.files.insert(path.clone());
        self.match_count += 1;
        self.matches.push(SearchMatch {
            path,
            line_number,
            content,
        });

        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// Core search function
// ---------------------------------------------------------------------------

use globset::Glob;
use ignore::WalkBuilder;

/// 执行文件内容搜索
///
/// 使用 ignore + grep-regex + grep-searcher 进行搜索，行为与 ripgrep 一致。
/// 搜索是同步的，建议在 spawn_blocking 中调用以避免阻塞异步运行时。
pub fn search(options: SearchOptions) -> Result<SearchResults, GrepError> {
    // 1. 验证路径
    let search_path = std::path::Path::new(&options.path);
    if !search_path.exists() {
        return Err(GrepError::InvalidPath(format!(
            "路径不存在: {}",
            options.path
        )));
    }

    // 2. 构建正则匹配器
    let pattern_str = if options.ignore_case {
        format!("(?i){}", options.pattern)
    } else {
        options.pattern.clone()
    };

    let matcher = grep_regex::RegexMatcher::new(&pattern_str)
        .map_err(|e| GrepError::InvalidPattern(e.to_string()))?;

    // 3. 构建搜索引擎
    let mut searcher_builder = grep_searcher::SearcherBuilder::new();
    searcher_builder.line_number(true);
    if options.multiline {
        searcher_builder.multi_line(true);
    }
    if options.before_context > 0 {
        searcher_builder.before_context(options.before_context);
    }
    if options.after_context > 0 {
        searcher_builder.after_context(options.after_context);
    }
    let mut searcher = searcher_builder.build();

    // 4. 构建文件遍历器
    let mut walker_builder = WalkBuilder::new(&options.path);
    walker_builder.standard_filters(true);
    walker_builder.hidden(true); // 跳过隐藏文件（同 rg 默认行为）

    // 解析 glob 和 file_type 为 globset
    let all_globs = resolve_globs(&options.glob, &options.file_type);
    let matchers: Vec<globset::GlobMatcher> = all_globs
        .iter()
        .filter_map(|g| Glob::new(g).ok().map(|glob| glob.compile_matcher()))
        .collect();

    if !matchers.is_empty() {
        walker_builder.filter_entry(move |entry| {
            // 总是允许目录（需要进入子目录）
            if entry.file_type().is_some_and(|t| t.is_dir()) {
                return true;
            }
            // 文件需要匹配 glob 模式
            matchers.iter().any(|m| m.is_match(entry.path()))
        });
    }

    // 5. 执行搜索
    let mut collector = MatchCollector::new();

    for result in walker_builder.build() {
        let entry = result.map_err(|e| GrepError::SearchError(e.to_string()))?;

        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }

        let path_str = entry.path().to_string_lossy().to_string();
        collector.set_current_path(path_str);

        searcher
            .search_path(&matcher, entry.path(), &mut collector)
            .map_err(|e| GrepError::SearchError(e.to_string()))?;
    }

    Ok(collector.into_results())
}

// ---------------------------------------------------------------------------
// Helper: resolve globs
// ---------------------------------------------------------------------------

/// 将 glob 和 file_type 参数解析为 glob 模式列表
fn resolve_globs(glob: &Option<String>, file_type: &Option<String>) -> Vec<String> {
    let mut result = Vec::new();

    // 添加用户指定的 glob
    if let Some(g) = glob {
        result.push(g.clone());
    }

    // 将 file_type 转为 glob
    if let Some(ft) = file_type
        && let Some(g) = file_type_to_glob(ft)
    {
        result.push(g);
    }

    result
}

/// 将常见文件类型名转为 glob 模式
fn file_type_to_glob(file_type: &str) -> Option<String> {
    match file_type {
        "rust" | "rs" => Some("*.rs".to_string()),
        "py" | "python" => Some("*.py".to_string()),
        "js" | "javascript" => Some("*.js".to_string()),
        "ts" | "typescript" => Some("*.ts".to_string()),
        "tsx" => Some("*.tsx".to_string()),
        "jsx" => Some("*.jsx".to_string()),
        "md" | "markdown" => Some("*.md".to_string()),
        "json" => Some("*.json".to_string()),
        "toml" => Some("*.toml".to_string()),
        "yaml" | "yml" => Some("*.{yaml,yml}".to_string()),
        "html" => Some("*.html".to_string()),
        "css" => Some("*.css".to_string()),
        "java" => Some("*.java".to_string()),
        "go" | "golang" => Some("*.go".to_string()),
        "rb" | "ruby" => Some("*.rb".to_string()),
        "c" => Some("*.c".to_string()),
        "cpp" | "cc" | "cxx" => Some("*.{cpp,cc,cxx}".to_string()),
        "h" | "header" => Some("*.h".to_string()),
        "hpp" => Some("*.hpp".to_string()),
        "sh" | "bash" | "zsh" => Some("*.sh".to_string()),
        "sql" => Some("*.sql".to_string()),
        "dockerfile" => Some("Dockerfile*".to_string()),
        "makefile" | "mk" => Some("Makefile*".to_string()),
        // 未知类型：使用名称本身作为扩展名
        other => Some(format!("*.{}", other)),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// 创建临时目录并写入测试文件
    fn setup_temp_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();

        // test.rs
        std::fs::write(
            dir.path().join("test.rs"),
            "fn hello() {\n    println!(\"hello world\");\n}\n\nfn world() {\n    println!(\"hello again\");\n}\n",
        )
        .unwrap();

        // test.py
        std::fs::write(
            dir.path().join("test.py"),
            "def hello():\n    print(\"hello world\")\n\ndef world():\n    print(\"hello again\")\n",
        )
        .unwrap();

        // subdir/mod.rs
        std::fs::create_dir(dir.path().join("subdir")).unwrap();
        std::fs::write(
            dir.path().join("subdir").join("mod.rs"),
            "pub fn hidden() {}\n",
        )
        .unwrap();

        // .hidden_file (隐藏文件，不应被搜索到)
        std::fs::write(dir.path().join(".hidden_file"), "this is hidden").unwrap();

        dir
    }

    // ---- Basic search ----

    #[test]
    fn test_search_basic() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: "hello".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: None,
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert!(results.match_count >= 2, "should find at least 2 matches");
        assert!(results.file_count >= 1, "should find files");
        assert!(results.matches.iter().any(|m| m.content.contains("hello")));
    }

    #[test]
    fn test_search_no_matches() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: "NONEXISTENT_PATTERN_XYZ".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: None,
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert_eq!(results.match_count, 0);
        assert_eq!(results.file_count, 0);
    }

    #[test]
    fn test_search_invalid_path() {
        let result = search(SearchOptions {
            pattern: "hello".to_string(),
            path: "/nonexistent/path/xyz123".to_string(),
            glob: None,
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        });

        assert!(result.is_err());
        match result.err().unwrap() {
            GrepError::InvalidPath(msg) => {
                assert!(msg.contains("路径不存在"), "Got: {}", msg);
            }
            other => panic!("Expected InvalidPath, got: {}", other),
        }
    }

    #[test]
    fn test_search_invalid_pattern() {
        let dir = setup_temp_dir();
        let result = search(SearchOptions {
            pattern: "[invalid".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: None,
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        });

        assert!(result.is_err());
        match result.err().unwrap() {
            GrepError::InvalidPattern(msg) => {
                assert!(!msg.is_empty());
            }
            other => panic!("Expected InvalidPattern, got: {}", other),
        }
    }

    #[test]
    fn test_search_empty_pattern() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: String::new(),
            path: dir.path().to_string_lossy().to_string(),
            glob: None,
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert!(
            results.match_count > 0,
            "empty pattern should match all lines"
        );
    }

    // ---- Case sensitivity ----

    #[test]
    fn test_search_case_sensitive() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: "HELLO".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: None,
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert_eq!(results.match_count, 0);
    }

    #[test]
    fn test_search_ignore_case() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: "HELLO".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: None,
            ignore_case: true,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert!(
            results.match_count >= 2,
            "case-insensitive search should find matches, got {}",
            results.match_count
        );
    }

    // ---- Glob filter ----

    #[test]
    fn test_search_with_glob() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: "hello".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: Some("*.rs".to_string()),
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert!(results.file_count > 0, "should find rust files");
        for m in &results.matches {
            assert!(
                m.path.ends_with(".rs"),
                "all matched files should be .rs, got: {}",
                m.path
            );
        }
    }

    // ---- File type filter ----

    #[test]
    fn test_search_with_file_type() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: "hello".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: None,
            ignore_case: false,
            multiline: false,
            file_type: Some("py".to_string()),
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert!(results.file_count > 0, "should find py files");
        for m in &results.matches {
            assert!(
                m.path.ends_with(".py"),
                "all matched files should be .py, got: {}",
                m.path
            );
        }
    }

    // ---- Hidden files ----

    #[test]
    fn test_search_skips_hidden() {
        // 创建一个仅 .hidden_file 包含的独有模式
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".hidden_file"), "HIDDEN_SENTINEL_XYZ").unwrap();
        std::fs::write(dir.path().join("visible.txt"), "visible content").unwrap();

        let results = search(SearchOptions {
            pattern: "HIDDEN_SENTINEL_XYZ".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: None,
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        // 隐藏文件不应被搜索
        assert_eq!(results.match_count, 0);
    }

    // ---- Subdirectory ----

    #[test]
    fn test_search_searches_subdirs() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: "hidden".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: Some("*.rs".to_string()),
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert!(results.match_count >= 1, "should find in subdir");
        assert!(
            results.matches.iter().any(|m| m.path.contains("subdir")),
            "should include subdir in results"
        );
    }

    // ---- Result structure ----

    #[test]
    fn test_search_match_fields() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: "fn hello".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: Some("*.rs".to_string()),
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert_eq!(results.match_count, 1, "should find exactly one 'fn hello'");
        let m = &results.matches[0];
        assert!(m.path.ends_with("test.rs"), "should be in test.rs");
        assert_eq!(m.line_number, 1, "should be line 1");
        assert!(m.content.contains("fn hello()"), "should contain the match");
    }

    // ---- Multiple files ----

    #[test]
    fn test_search_multiple_files() {
        let dir = setup_temp_dir();
        let results = search(SearchOptions {
            pattern: "hello world".to_string(),
            path: dir.path().to_string_lossy().to_string(),
            glob: None,
            ignore_case: false,
            multiline: false,
            file_type: None,
            after_context: 0,
            before_context: 0,
        })
        .unwrap();

        assert!(
            results.file_count >= 2,
            "should find in both files, got {} files",
            results.file_count
        );
    }
}
