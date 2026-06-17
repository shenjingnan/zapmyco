//! 多选选择器可视化验收示例。
//!
//! 在真实终端中运行此示例可手动验证多选选择器的外观和交互行为：
//!
//! ```bash
//! cargo run --example select-multi
//! ```
//!
//! 验证要点：
//! - 选项列表正确显示（带 [ ] 复选框）
//! - j/k 或 ↑/↓ 可以导航
//! - Space 切换选中状态
//! - 数字快捷键 1-9 跳转选项
//! - Enter 提交后输出选中的索引列表
//! - Ctrl+C 取消返回 None

use zapmyco::tui::{MultiSelectResult, SelectOption, prompt_multi_select};

fn main() {
    let options = [
        SelectOption {
            label: "跑步",
            description: "有氧运动，锻炼心肺",
            custom_input: false,
        },
        SelectOption {
            label: "游泳",
            description: "全身运动，低冲击",
            custom_input: false,
        },
        SelectOption {
            label: "阅读",
            description: "安静的个人提升",
            custom_input: false,
        },
        SelectOption {
            label: "其他",
            description: "自己输入爱好",
            custom_input: true,
        },
    ];

    match prompt_multi_select("你的爱好有哪些？（Space 多选，Enter 确认）", &options)
    {
        Some(MultiSelectResult {
            indices,
            custom_text,
        }) => {
            println!("选中的索引: {:?}", indices);
            if let Some(text) = custom_text {
                println!("自定义输入: {}", text);
            }
        }
        None => println!("已取消"),
    }
}
