---
name: spellcheck
description: 运行拼写检查，扫描 TypeScript 和 Markdown 文件
---

# Spellcheck

使用 cspell 对项目文件进行拼写检查。

## 执行步骤

1. 运行拼写检查: `pnpm run spellcheck`

## 配置

| 配置项 | 值 |
|--------|-----|
| 工具 | cspell |
| 检查范围 | `**/*.ts` `**/*.md` |
| 自定义词典 | `cspell.json` |

## 快捷命令

```bash
pnpm run spellcheck
```

## 注意事项

- 如需添加项目特有词汇，编辑 `cspell.json` 中的 `words` 字段
- 可在文件中使用 `// cspell:disable-line` 跳过单行检查
