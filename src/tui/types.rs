//! TUI 组件共享类型定义——选项、单选结果、多选结果。

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

#[cfg(test)]
mod tests {
    use super::*;

    // -- SingleSelectResult --

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
    fn test_single_select_result_index_zero_key() {
        let r = SingleSelectResult::Index(2);
        match r {
            SingleSelectResult::Index(i) => assert_eq!(i, 2),
            _ => panic!("expected Index"),
        }
    }

    // -- MultiSelectResult --

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

    // -- SelectOption --

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
}
