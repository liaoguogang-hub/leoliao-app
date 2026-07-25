/**
 * Mock 数据 — 等 OSS 同步脚本就绪后可以删掉
 * 用 Leo 真实 vault 里的几个 MD 样本
 */

import type { ManifestEntry } from '../types';

export const MOCK_MANIFEST: ManifestEntry[] = [
  { path: '0-Inbox/闪念.md', size: 182, mtime: 1718265600000, hash: 'mock1' },
  { path: '0-索引-内容矩阵.md', size: 4813, mtime: 1718348400000, hash: 'mock2' },
  { path: '01.公众号/README.md', size: 2523, mtime: 1718431200000, hash: 'mock3' },
  { path: '01.公众号/选题决策/选题管理/待发布的选题/2026-06-02-AI工具-双智能体互相检查.md', size: 6503, mtime: 1718517600000, hash: 'mock4' },
  { path: '03.工作报告/归档/OPC-v2首次跑通/2026-06-02-跑通复盘.md', size: 11548, mtime: 1718604000000, hash: 'mock5' },
  { path: '04.个人总结/归档/2026-06/2026-06-03-本周总结-OPC-v2跑通周.md', size: 7214, mtime: 1718690400000, hash: 'mock6' },
];

export const MOCK_FILES: Record<string, string> = {
  '0-Inbox/闪念.md': `> 🪶 2026-06-14 10:37 星期日
> 阿里云oss储存+remotely save

***
> 🪶 2026-06-14 10:36 星期日
> 学习quickadd插件

***
> 🪶 2026-06-14 10:13 星期日
> 测试remotely save插件
`,

  '0-索引-内容矩阵.md': `# 内容矩阵

> 整个知识库的索引入口

## 顶层结构
- 0-Inbox: 闪念、快速记录
- 01.公众号: 公众号文章草稿与发布存档
- 02.内刊: 内部刊物
- 03.工作报告: 周报、月报、调研
- 04.个人总结: 个人复盘
- 05.信息图: 图表素材
- BMO: 个人 AI 助手配置
- Clippings: 网页剪藏

## 关联笔记
- [[OPC-v2首次跑通]]
- [[双智能体互相检查]]
- [[WebClipper]]
`,

  '01.公众号/README.md': `# 公众号

> 本目录管理公众号文章的选题、起草、发布与归档

## 工作流
1. **选题**: 在 \`选题决策/选题管理/待发布的选题/\` 写选题卡
2. **起草**: 选题卡定稿后移到 \`发布存档/\` 加日期前缀
3. **发布**: 复制到飞书文档，发到对应渠道
4. **归档**: 发布后内容自动归档

## 相关
- [[选题决策]]
- [[2026-06-02-AI工具-双智能体互相检查]]
`,

  '01.公众号/选题决策/选题管理/待发布的选题/2026-06-02-AI工具-双智能体互相检查.md': `---
title: 双智能体互相检查工作流
tags: [AI工具, 自动化, 工作流]
date: 2026-06-02
status: 草稿
---

# 双智能体互相检查工作流

> [!note] 核心思路
> 一个 AI 写稿，另一个 AI 当编辑审稿，互相迭代提升质量

## 流程

\`\`\`mermaid
草稿 → AI-A 写 → 输出 v1
                ↓
            AI-B 审稿
                ↓
            修改建议
                ↓
            AI-A 改 → v2
                ↓
            循环到 N 轮满意
\`\`\`

## 实际收益

- 输出质量提升约 30%
- 减少人工事后修改
- 风格更稳定

> [!warning] 注意事项
> 两个 AI 用不同 prompt 才好互相检查，不能同源

## 相关
- [[OPC-v2首次跑通]]
- [[WebClipper]]`,

  '03.工作报告/归档/OPC-v2首次跑通/2026-06-02-跑通复盘.md': `---
title: OPC-v2 首次跑通复盘
date: 2026-06-02
tags: [OPC, 工作流, 复盘]
---

# OPC-v2 首次跑通复盘

## 目标
把 OPC（Obsidian + Claude + 飞书）流水线打通

## 做了什么

1. \`\`\`cc-connect\`\`\` 装好
2. 飞书机器人建好
3. Obsidian QuickAdd 接通 Claude
4. 双向同步跑通

## 卡住的地方

- [[WebClipper]] 接 Obsidian 时字段映射错位
- cc-connect 第一次握手超时（\`network_security_config\` 没配）

## 解决
1. 重新对照 [WebClipper 文档](https://chromewebstore.google.com/detail/web-clipper) 配置字段
2. 给飞书域名加 \`network_security_config.xml\`

## 教训

> [!tip] 提前配证书
> 内网域名 + HTTPS 时提前配 \`network_security_config\`，别等撞墙再查

## 下一步
- [ ] 把这个流程固化到 [[双智能体互相检查]] 工作流
- [ ] 写一份给团队的 onboarding 文档`,

  '04.个人总结/归档/2026-06/2026-06-03-本周总结-OPC-v2跑通周.md': `# 2026-06 第一周总结

> 本周主线：把 [[OPC-v2首次跑通]] 跑通

## 主要成果

- ✅ OPC-v2 流水线打通
- ✅ 飞书群能远程触发 Claude
- ✅ 公众号写作效率提升

## 习惯改进

- 每天 10:00 前清空 [[0-Inbox]]
- 用 [[双智能体互相检查]] 写公众号，质量稳了

## 待改进

- [ ] 周报没沉淀到知识库
- [ ] 信息图没自动化

## 下周计划

- 把 [[WebClipper]] 接到 [[05.信息图]] 工作流
- 周报自动化模板`,
};

// MD5 of mock content (just use 'mockN' as hash placeholder)
export function mockHashFor(content: string): string {
  // 简单 hash，仅用于 mock 模式
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h) + content.charCodeAt(i);
    h |= 0;
  }
  return 'm' + Math.abs(h).toString(36);
}