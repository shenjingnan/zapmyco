use serde_json::Value;
/// ask_user 工具 - 向用户提出一个问题并获取回答
///
/// 当 LLM 需要用户做出决策、澄清需求、确认操作或选择偏好时使用。
/// 使用共享的 SelectPrompt 组件（支持 j/k vim 快捷键）。
use std::io::IsTerminal;
use zapmyco_anthropic_ai_sdk::types::message::Tool;

use crate::tools::prompt;

/// 内部选项项，用于 JSON 解析中转
#[derive(Debug)]
struct OptionItem {
    label: String,
    description: String,
}

/// ask_user 工具
pub struct AskUser;

impl AskUser {
    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> Tool {
        Tool {
            name: "ask_user".to_string(),
            description: Some(
                "向用户提出一个带有选项的问题并获取回答。\
                 当需要用户做出决策、澄清需求、确认操作或选择偏好时使用。\
                 注意：一次只能问一个问题，不要在 question 中包含多个问题。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "要向用户提出的问题，应清晰明确并以问号结尾"
                    },
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {
                                    "type": "string",
                                    "description": "选项的简短标签（1-5个字），将显示在选择列表中"
                                },
                                "description": {
                                    "type": "string",
                                    "description": "选项的详细说明，帮助用户理解每个选项的含义"
                                }
                            },
                            "required": ["label", "description"]
                        },
                        "minItems": 1,
                        "maxItems": 6,
                        "description": "提供给用户的可选选项列表"
                    },
                    "multi_select": {
                        "type": "boolean",
                        "description": "是否允许多选，默认为 false。设为 true 时用户可以选择多个选项。"
                    }
                },
                "required": ["question", "options"]
            })),
            ..Default::default()
        }
    }

    /// 解析并验证工具输入参数
    ///
    /// 返回 (question, items, multi_select) 元组。
    /// 此方法与 TTY 无关，可独立测试。
    fn parse_and_validate_input(input: &Value) -> Result<(&str, Vec<OptionItem>, bool), String> {
        let question = input
            .get("question")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'question'".to_string())?;

        let options = input
            .get("options")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "缺少必填参数 'options'".to_string())?;

        if options.is_empty() {
            return Err("'options' 参数不能为空数组".to_string());
        }

        let multi_select = input
            .get("multi_select")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // 提取选项 label 和 description
        let items: Vec<OptionItem> = options
            .iter()
            .filter_map(|o| {
                let label = o.get("label").and_then(|v| v.as_str())?;
                let description = o.get("description").and_then(|v| v.as_str()).unwrap_or("");
                Some(OptionItem {
                    label: label.to_string(),
                    description: description.to_string(),
                })
            })
            .collect();

        if items.is_empty() {
            return Err("'options' 中的 'label' 字段不能为空".to_string());
        }

        Ok((question, items, multi_select))
    }

    /// 执行 ask_user 工具
    ///
    /// 在交互式终端中用共享的 SelectPrompt 组件显示选项，等待用户选择后返回结果。
    /// 支持 j/k、↑/↓ 导航，1-9 快捷键和 Enter 确认。
    pub async fn execute(&self, input: &Value) -> Result<String, String> {
        let (question, items, multi_select) = Self::parse_and_validate_input(input)?;

        // 检查是否为交互式终端
        if !std::io::stdin().is_terminal() {
            return Err("ask_user 工具只能在交互式终端中使用，当前不是终端环境。".to_string());
        }

        // 转换为 prompt::SelectOption，最后一个选项标记为 custom_input
        let last_idx = items.len() - 1;
        let prompt_opts: Vec<prompt::SelectOption> = items
            .iter()
            .enumerate()
            .map(|(i, item)| prompt::SelectOption {
                label: &item.label,
                description: &item.description,
                custom_input: i == last_idx,
            })
            .collect();

        if multi_select {
            match prompt::prompt_multi_select(question, &prompt_opts) {
                Some(result) => {
                    let mut parts: Vec<String> = Vec::new();
                    if !result.indices.is_empty() {
                        let labels: Vec<&str> = result
                            .indices
                            .iter()
                            .map(|&i| items[i].label.as_str())
                            .collect();
                        parts.push(labels.join(", "));
                    }
                    if let Some(text) = &result.custom_text
                        && !text.is_empty()
                    {
                        if !parts.is_empty() {
                            parts.push(format!("自定义输入: {}", text));
                        } else {
                            parts.push(text.clone());
                        }
                    }
                    if parts.is_empty() {
                        Ok("[用户取消了选择]".to_string())
                    } else {
                        Ok(format!("用户选择了: {}", parts.join("，")))
                    }
                }
                None => Ok("[用户取消了选择]".to_string()),
            }
        } else {
            match prompt::prompt_single_select(question, &prompt_opts) {
                Some(prompt::SingleSelectResult::Index(idx)) => {
                    Ok(format!("用户选择了: {}", items[idx].label))
                }
                Some(prompt::SingleSelectResult::Custom(text)) => {
                    if text.is_empty() {
                        Ok("[用户取消了选择]".to_string())
                    } else {
                        Ok(format!("用户输入: {}", text))
                    }
                }
                None => Ok("[用户取消了选择]".to_string()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_tool_definition_has_required_fields() {
        let def = AskUser::tool_definition();
        assert_eq!(def.name, "ask_user");
        assert!(def.description.is_some());
        assert!(def.input_schema.is_some());

        let schema = def.input_schema.unwrap();
        let props = schema.get("properties").unwrap();
        assert!(props.get("question").is_some());
        assert!(props.get("options").is_some());

        let required = schema.get("required").unwrap().as_array().unwrap();
        let req_names: Vec<&str> = required.iter().filter_map(|v| v.as_str()).collect();
        assert!(req_names.contains(&"question"));
        assert!(req_names.contains(&"options"));
    }

    #[test]
    fn test_parse_missing_question() {
        let input = json!({
            "options": [{"label": "A", "description": "desc A"}]
        });
        let result: Result<(&str, Vec<OptionItem>, bool), String> =
            AskUser::parse_and_validate_input(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("question"));
    }

    #[test]
    fn test_parse_missing_options() {
        let input = json!({
            "question": "测试?"
        });
        let result: Result<(&str, Vec<OptionItem>, bool), String> =
            AskUser::parse_and_validate_input(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("options"));
    }

    #[test]
    fn test_parse_empty_options() {
        let input = json!({
            "question": "测试?",
            "options": []
        });
        let result: Result<(&str, Vec<OptionItem>, bool), String> =
            AskUser::parse_and_validate_input(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("空"));
    }

    #[test]
    fn test_parse_options_without_label() {
        let input = json!({
            "question": "测试?",
            "options": [{"description": "desc only"}]
        });
        let result: Result<(&str, Vec<OptionItem>, bool), String> =
            AskUser::parse_and_validate_input(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("label"));
    }

    #[test]
    fn test_non_terminal_environment() {
        // 在非 TTY 环境下应该返回错误
        let tool = AskUser;
        let input = json!({
            "question": "测试?",
            "options": [{"label": "A", "description": "desc A"}]
        });
        // 测试环境中 stdin 通常是非 TTY 的
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(tool.execute(&input));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("交互式终端") || err.contains("终端"));
    }

    #[test]
    fn test_tool_definition_multi_select_field() {
        let def = AskUser::tool_definition();
        let schema = def.input_schema.unwrap();
        let props = schema.get("properties").unwrap();

        let multi_select = props.get("multi_select").unwrap();
        assert_eq!(
            multi_select.get("type").and_then(|v| v.as_str()),
            Some("boolean")
        );
    }

    #[test]
    fn test_options_max_items_six() {
        let def = AskUser::tool_definition();
        let schema = def.input_schema.unwrap();
        let props = schema.get("properties").unwrap();
        let options_schema = props.get("options").unwrap();
        assert_eq!(
            options_schema.get("maxItems").and_then(|v| v.as_u64()),
            Some(6)
        );
    }
}
