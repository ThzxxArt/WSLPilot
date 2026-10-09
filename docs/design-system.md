# 设计系统 Design System

> 唯一事实源：`packages/ui/src/tokens/` · 生成物：`packages/ui/src/styles/tokens.generated.scss`

## 三层令牌

```
Primitive（原始色板/渐变）
    ↓
Semantic（bg / text / accent / border / status）
    ↓
Component（button-bg / input-border …）
```

Naive UI 通过 `themeOverrides` 消费语义令牌；业务样式通过 CSS 变量消费同一套。

## 色彩

- **浅色为唯一主调**，不提供深色主题。
- 品牌色 **Aurora**：`linear-gradient(135deg, #22D3EE, #6366F1, #A855F7)`
- 强调色可切换：`aurora` / `sunset` / `ocean` / `forest`

关键语义色：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--color-bg-canvas` | `#F7F8FB` | 画布底 |
| `--color-bg-surface` | `#FFFFFF` | 卡片/面板 |
| `--color-text-primary` | `#0F172A` | 主文字 |
| `--color-accent` | `#6366F1` | 强调（随主题切换） |
| `--color-danger` | `#DC2626` | 危险 |

## 字体

```css
--font-sans: 'Inter Variable', 'HarmonyOS Sans SC', 'PingFang SC', system-ui, sans-serif;
--font-mono: 'Cascadia Mono', 'JetBrains Mono', Consolas, monospace;
```

字号阶梯（1.25 比例）：32 / 24 / 19 / 16 / 14 / 13 / 12

## 间距 · 圆角 · 阴影

- 间距 4px 基准：`--space-1` … `--space-16`
- 圆角：6 / 8 / 12 / 16 / 20 / 9999
- 阴影：柔和多层带蓝色调，`--shadow-glow` 用于强调

## 动效

| 令牌 | 值 |
|---|---|
| `--dur-fast` | 140ms |
| `--dur-base` | 220ms |
| `--dur-slow` | 320ms |
| `--ease-standard` | `cubic-bezier(.2, 0, 0, 1)` |
| `--ease-spring` | `cubic-bezier(.34, 1.56, .64, 1)` |

`prefers-reduced-motion` 或设置 `reduceMotion` 开启时，时长降为 `0.01ms`。

## 组件策略

- **直接用 Naive UI**：Button / Card / Form / Modal / DataTable …
- **自研业务组件**（基于 Naive 封装）：DistroCard、MetricCard、StatusDot、CommandPalette、TerminalPane、EmptyState …

## 修改令牌

1. 编辑 `scripts/gen-tokens.ts` 中的表
2. 运行 `npm run tokens`
3. 同步更新 `packages/ui/src/tokens/theme.ts`（TS 侧）
