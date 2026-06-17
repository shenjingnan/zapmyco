//! 单选选择器可视化验收示例。
//!
//! 在真实终端中运行此示例可手动验证单选选择器的外观和交互行为：
//!
//! ```bash
//! cargo run --example select-single
//! ```
//!
//! 验证要点：
//! - 选项列表正确显示
//! - j/k 或 ↑/↓ 可以导航
//! - 选中项高亮为绿色
//! - 超过 2 个选项时最后一项编号显示为 0
//! - 数字快捷键 1-9 直接选中
//! - Enter 确认后输出正确结果
//! - Ctrl+C 取消返回 None

use zapmyco::tui::{SelectOption, SingleSelectResult, prompt_single_select};

fn main() {
    let options = [
        SelectOption {
            label: "苹果",
            description: "红色的水果",
            custom_input: false,
        },
        SelectOption {
            label: "香蕉",
            description: "黄色的水果",
            custom_input: false,
        },
        SelectOption {
            label: "橙子",
            description: "富含维生素 C",
            custom_input: false,
        },
    ];

    match prompt_single_select("你喜欢什么水果？", &options) {
        Some(SingleSelectResult::Index(i)) => println!("你选择了: {}", options[i].label),
        Some(SingleSelectResult::Custom(s)) => {
            if s.is_empty() {
                println!("已取消");
            } else {
                println!("你输入了: {}", s);
            }
        }
        None => println!("已取消"),
    }
}
