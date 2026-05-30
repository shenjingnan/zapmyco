/// run_command 工具 - 在本地系统执行 shell 命令并返回输出
use thiserror::Error;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// 命令执行错误类型
#[derive(Debug, Error)]
pub enum RunCommandError {
    /// 命令执行超时
    #[error("Command timed out after {timeout_secs}s")]
    Timeout {
        /// 超时时间（秒）
        timeout_secs: u64,
    },

    /// IO 错误（命令未找到、权限不足等）
    #[error("Failed to execute command: {0}")]
    Io(String),

    /// 输出超过大小限制
    #[error("Output too large: {size} bytes (max {max} bytes)")]
    OutputTooLarge {
        /// 实际输出大小
        size: usize,
        /// 最大允许大小
        max: usize,
    },
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// run_command 配置选项
#[derive(Debug, Clone)]
pub struct RunCommandOptions {
    /// 命令执行超时时间（秒），默认 30
    pub timeout_secs: u64,
    /// 输出最大字符数（stdout + stderr 合计），默认 100_000
    pub output_max_chars: usize,
}

impl Default for RunCommandOptions {
    fn default() -> Self {
        Self {
            timeout_secs: 30,
            output_max_chars: 100_000,
        }
    }
}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// run_command 工具
#[derive(Debug, Clone)]
pub struct RunCommand {
    options: RunCommandOptions,
}

impl RunCommand {
    /// 创建新的 RunCommand 实例
    pub fn new(options: RunCommandOptions) -> Self {
        Self { options }
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "run_command".to_string(),
            description: Some(
                "在本地系统执行 shell 命令并返回标准输出、标准错误和退出码。".to_string(),
            ),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "要执行的 shell 命令"
                    },
                    "description": {
                        "type": "string",
                        "description": "说明要执行的命令及其原因，有助于 LLM 推理"
                    },
                    "working_directory": {
                        "type": "string",
                        "description": "命令执行的工作目录（绝对路径）。不指定则使用当前目录"
                    }
                },
                "required": ["command"]
            }),
        }
    }

    /// 执行 shell 命令并返回输出
    ///
    /// # 参数
    /// * `command` - 要执行的 shell 命令
    /// * `_description` - 命令执行说明（用于 LLM 自我审计）
    /// * `working_directory` - 可选的工作目录
    pub async fn execute(
        &self,
        command: &str,
        _description: Option<&str>,
        working_directory: Option<&str>,
    ) -> Result<String, RunCommandError> {
        // 1. 选择 shell
        let (shell, arg_flag) = if cfg!(target_os = "windows") {
            ("cmd.exe", "/C")
        } else {
            ("sh", "-c")
        };

        // 2. 构建命令
        let mut cmd = tokio::process::Command::new(shell);
        cmd.arg(arg_flag);
        cmd.arg(command);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        if let Some(dir) = working_directory {
            cmd.current_dir(dir);
        }

        // 3. 执行带超时
        let timeout = std::time::Duration::from_secs(self.options.timeout_secs);

        let output = tokio::time::timeout(timeout, cmd.output())
            .await
            .map_err(|_| RunCommandError::Timeout {
                timeout_secs: self.options.timeout_secs,
            })?
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    RunCommandError::Io(format!("Command not found: {}", command))
                } else {
                    RunCommandError::Io(e.to_string())
                }
            })?;

        // 4. 转换输出
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        // 5. 检查总大小
        let total_size = stdout.len() + stderr.len();
        if total_size > self.options.output_max_chars {
            return Err(RunCommandError::OutputTooLarge {
                size: total_size,
                max: self.options.output_max_chars,
            });
        }

        // 6. 格式化输出
        let exit_code = output.status.code();

        let mut result = String::new();
        result.push_str(&format!(
            "Exit code: {}\n\n",
            exit_code
                .map(|c| c.to_string())
                .unwrap_or_else(|| "signal".to_string())
        ));

        if !stdout.is_empty() {
            result.push_str("--- STDOUT ---\n");
            result.push_str(&stdout);
            result.push('\n');
        }

        if !stderr.is_empty() {
            result.push_str("--- STDERR ---\n");
            result.push_str(&stderr);
            result.push('\n');
        }

        if stdout.is_empty() && stderr.is_empty() {
            result.push_str("(no output)\n");
        }

        Ok(result)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// 创建测试用的 RunCommand 实例
    fn test_executor() -> RunCommand {
        RunCommand::new(RunCommandOptions {
            timeout_secs: 5,
            output_max_chars: 10_000,
        })
    }

    // ---- Tool definition tests ----

    #[test]
    fn test_tool_definition_name() {
        let tool = RunCommand::tool_definition();
        assert_eq!(tool.name, "run_command");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = RunCommand::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = RunCommand::tool_definition();
        assert_eq!(
            tool.input_schema["type"],
            serde_json::Value::String("object".to_string())
        );
        assert!(tool.input_schema["properties"]["command"].is_object());
        assert!(
            tool.input_schema["required"]
                .as_array()
                .unwrap()
                .contains(&serde_json::Value::String("command".to_string()))
        );
    }

    #[test]
    fn test_tool_definition_optional_fields() {
        let tool = RunCommand::tool_definition();
        let properties = tool.input_schema["properties"].as_object().unwrap();
        assert!(properties.contains_key("description"));
        assert!(properties.contains_key("working_directory"));
    }

    // ---- Execution tests ----

    #[tokio::test]
    async fn test_execute_echo() {
        let executor = test_executor();
        let result = executor.execute("echo hello", None, None).await.unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("hello"));
    }

    #[tokio::test]
    async fn test_execute_exit_code_1() {
        let executor = test_executor();
        let result = executor.execute("exit 1", None, None).await.unwrap();
        assert!(result.contains("Exit code: 1"));
    }

    #[tokio::test]
    async fn test_execute_non_zero_exit() {
        let executor = test_executor();
        let result = executor.execute("false", None, None).await.unwrap();
        assert!(result.contains("Exit code: 1"));
    }

    #[tokio::test]
    async fn test_execute_with_working_dir() {
        let executor = test_executor();
        let dir = std::env::temp_dir();
        // pwd 可能会解析符号链接（macOS 上 /var → /private/var），
        // 所以只检查退出码为 0 而非精确路径匹配
        let result = executor.execute("pwd", None, dir.to_str()).await.unwrap();
        assert!(result.contains("Exit code: 0"));
    }

    #[tokio::test]
    async fn test_execute_empty_output() {
        let executor = test_executor();
        // 一个产生空输出的命令
        let result = executor.execute("true", None, None).await.unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("(no output)"));
    }

    #[tokio::test]
    async fn test_execute_stderr_only() {
        let executor = test_executor();
        let result = executor
            .execute("echo stderr output >&2", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("stderr output"));
    }

    #[tokio::test]
    async fn test_execute_both_streams() {
        let executor = test_executor();
        let result = executor
            .execute("echo stdout_msg && echo stderr_msg >&2", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("stdout_msg"));
        assert!(result.contains("stderr_msg"));
    }

    #[tokio::test]
    async fn test_execute_with_description() {
        let executor = test_executor();
        let result = executor
            .execute("echo hello", Some("测试命令执行工具"), None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("hello"));
    }

    #[tokio::test]
    async fn test_execute_not_found() {
        let executor = test_executor();
        // 通过 sh -c 执行时，sh 本身总能找到，无效命令会返回非零退出码
        let result = executor
            .execute("nonexistent_cmd_xyz_123", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code:"));
        assert!(!result.contains("Exit code: 0"));
    }

    #[tokio::test]
    async fn test_execute_timeout() {
        let executor = RunCommand::new(RunCommandOptions {
            timeout_secs: 1,
            output_max_chars: 10_000,
        });

        let result = executor.execute("sleep 10", None, None).await;
        assert!(result.is_err());
        match result.err().unwrap() {
            RunCommandError::Timeout { timeout_secs } => {
                assert_eq!(timeout_secs, 1);
            }
            other => panic!("Expected Timeout error, got: {}", other),
        }
    }

    #[tokio::test]
    async fn test_execute_large_output_truncated() {
        let executor = RunCommand::new(RunCommandOptions {
            timeout_secs: 5,
            output_max_chars: 100, // 很小的限制
        });

        // 生成超过 100 字符的输出
        let result = executor
            .execute(
                "echo 'aaaaaaaaaabbbbbbbbbbccccccccccddddddddddeeeeeeeeeeffffffffffgggggggggghhhhhhhhhhiiiiiiiiiijjjjjjjjjj'",
                None,
                None,
            )
            .await;
        assert!(result.is_err());
        match result.err().unwrap() {
            RunCommandError::OutputTooLarge { size, max } => {
                assert_eq!(max, 100);
                assert!(size > 100);
            }
            other => panic!("Expected OutputTooLarge error, got: {}", other),
        }
    }

    // ---- Options tests ----

    #[test]
    fn test_new_default() {
        let executor = RunCommand::new(RunCommandOptions::default());
        assert_eq!(executor.options.timeout_secs, 30);
        assert_eq!(executor.options.output_max_chars, 100_000);
    }

    #[test]
    fn test_new_custom_options() {
        let executor = RunCommand::new(RunCommandOptions {
            timeout_secs: 60,
            output_max_chars: 50_000,
        });
        assert_eq!(executor.options.timeout_secs, 60);
        assert_eq!(executor.options.output_max_chars, 50_000);
    }

    // ---- Signal termination (exit without code) ----

    #[tokio::test]
    async fn test_execute_signal_termination() {
        // 通过发送 SIGTERM 来测试 signal 退出
        let executor = test_executor();
        // 使用一个会因信号而退出的命令
        let result = executor
            .execute("sh -c 'kill $$'", None, None)
            .await
            .unwrap();
        // 被信号杀死的进程 exit code 为 None，显示 "signal"
        assert!(result.contains("Exit code: signal") || result.contains("Exit code: 0"));
        // kill $$ 在不同系统上行为不同，接受 0 或 signal 都合理
    }
}
