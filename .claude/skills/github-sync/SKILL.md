---
name: github-sync
description: 提交并 push 本地改动到 GitHub(leoliao-app 项目,双副本环境 + 编码陷阱 + SHA 校验)
---

# GitHub Sync Skill

把 leoliao-app 项目本地的代码改动同步到 GitHub。完整流程:改文件 → 双副本同步 → git commit → git push → SHA 校验。

## 触发场景

用户说以下任一话时使用本 skill:
- "同步到 github"
- "push 一下"
- "提交并推送"
- "同步 git"
- "github 同步"
- "commit and push"

## 项目约定(必须知道)

### 双副本结构
| 路径 | 角色 |
|---|---|
| `D:\leoliao-app` | **真实项目根**(git 仓库所在,构建在这里跑) |
| `C:\Users\guoga\Documents\DSH\leoliao-app` | DSH 工具的工作目录副本 |

两副本必须保持一致。每次改动都要双向 Copy-Item 同步(`write` 工具落 D 后,**额外** Copy-Item 到 C)。否则 DSH 端看到的内容和实际构建/推送的内容会漂移。

### remote 配置
```
git@ssh.github.com:liaoguogang-hub/leoliao-app.git
```
- **SSH 协议**(不是 HTTPS)
- 认证用本机 `~/.ssh/` 私钥(gh CLI 的 token 失效不影响 push)

## 编码陷阱(踩过的坑)

| 文件类型 | 必须用 | 绝对不要 |
|---|---|---|
| `.ps1`(Windows PowerShell 5.1 执行) | UTF-8 with BOM | 无 BOM —— PS 5.1 按 GBK 解码,中文/emoji 字节序列破坏字符串引号,7+ 语法错误 |
| `.bat`(cmd.exe 解析) | ASCII,无 BOM | UTF-8 BOM —— `@echo off` 前面有 BOM 会乱 |
| `.md`(SKILL/README/CHANGELOG) | 普通 UTF-8 | 不用特殊处理 |
| `.ts/.mjs`(node) | 普通 UTF-8 | 不用特殊处理 |

**写文件的正确方式**:
```powershell
# PS1(带 BOM)
[System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($true)))

# BAT/纯 ASCII(无 BOM)
[System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.ASCIIEncoding))
```

`write` 工具默认是 UTF-8 无 BOM —— **写 .ps1 后必须用上面的 PowerShell 重写一次**,否则本次又会踩坑。

写完后用以下命令校验编码:
```powershell
$b = [System.IO.File]::ReadAllBytes($path)
$bom = if ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { 'UTF-8 BOM' } else { '无 BOM' }
$na = @($b | Where-Object { $_ -gt 127 }).Count
```

## 工作流程

### 步骤 1:扫描工作区状态

```powershell
Set-Location D:\leoliao-app
git status --short 2>&1
git diff --stat 2>&1 | Select-Object -Last 12
```

把改动列给用户,确认是否真的要把这些 push 上去。

### 步骤 2:检测编码陷阱(自动)

如果有 `.ps1` / `.bat` 被改动或新增,**先确认编码**:
```powershell
$new = git status --short | Where-Object { $_ -match '^\?\?|\sM\s' } | ForEach-Object { ($_ -split '\s+', 2)[1] }
foreach ($f in $new) {
  if ($f -notmatch '\.(ps1|bat|md)$') { continue }
  $b = [System.IO.File]::ReadAllBytes($f)
  if ($f -like '*.ps1' -and $b[0] -ne 0xEF) {
    Write-Host "⚠️ $f 无 BOM(PS5.1 会乱码)" -ForegroundColor Yellow
  }
  if ($f -like '*.bat' -and $b[0] -eq 0xEF) {
    Write-Host "⚠️ $f 有 BOM(bat 会乱)" -ForegroundColor Yellow
  }
}
```

发现违规 → 用上面的 `.NET WriteAllText` 重写正确编码。

### 步骤 3:同步两个副本

```powershell
$files = git status --short | ForEach-Object { ($_ -split '\s+', 2)[1] }
foreach ($f in $files) {
  if (Test-Path "D:\leoliao-app\$f") {
    $dstDir = Split-Path "C:\Users\guoga\Documents\DSH\leoliao-app\$f"
    if (-not (Test-Path $dstDir)) { New-Item $dstDir -ItemType Directory -Force | Out-Null }
    Copy-Item "D:\leoliao-app\$f" "C:\Users\guoga\Documents\DSH\leoliao-app\$f" -Force
  }
}
```

### 步骤 4:git add + commit + push

```powershell
Set-Location D:\leoliao-app
git add -A 2>&1 | Out-Null
git commit -m "<type>(scope): <subject>

<body>" 2>&1 | Select-Object -Last 3
git push origin main 2>&1 | Select-Object -Last 2
```

**Commit message 格式**(Conventional Commits):
- `feat(scope):` 新功能
- `fix(scope):` 修 bug
- `chore(scope):` 杂项(脚本、重构)
- `docs(scope):` 文档
- `refactor(scope):` 重构

subject 中文/英文都行,但要简洁(50 字内)。body 写改了什么、为什么、怎么验证。

### 步骤 5:三层验证(必须全部通过才算成功)

```powershell
# 验证 1:本地 HEAD 与 origin/main 一致
$local  = git rev-parse HEAD
$remote = git ls-remote origin main | ForEach-Object { ($_ -split "`t")[0] }
if ($local -eq $remote) { Write-Host "✅ 提交层一致" -ForegroundColor Green }
else { throw "❌ 本地 $local ≠ 远端 $remote" }

# 验证 2:ahead/behind 为 0/0
git status -sb
$cmp = git rev-list --left-right --count origin/main...main
if ($cmp -eq "0`t0") { Write-Host "✅ 同步层一致" -ForegroundColor Green }

# 验证 3:关键文件字节级一致(选改动的文件,不是所有)
$changed = git diff-tree --no-commit-id --name-only -r HEAD | Select-Object -First 5
foreach ($f in $changed) {
  $localHash = git hash-object $f
  $remoteHash = gh api repos/liaoguogang-hub/leoliao-app/contents/$f --jq .sha
  if ($localHash -eq $remoteHash) { Write-Host "  ✅ $f 字节级一致" -ForegroundColor Green }
  else { Write-Host "  ❌ $f 不一致" -ForegroundColor Red }
}
```

**任何一层不一致都必须停下来**,不能宣称"同步成功"。

### 步骤 6:报告

告诉用户:
- 推送的 commit SHA
- `local → remote` 的进度(如 `aa7162d..ba2b04b`)
- 验证结果(3 层)
- 远端 URL: `https://github.com/liaoguogang-hub/leoliao-app`

## 不要做的事

- **不要在没管理员权限时尝试 `Set-ScheduledTask`** —— 直接说"需要双击 .bat 提权"。
- **不要把暂存区里没看过的内容一起 commit** —— 先 `git status` 看清楚,避免把无关改动带上去。
- **不要因为 `gh auth` 报错就以为 git push 会失败** —— `gh` 用 HTTPS token,`git push` 用 SSH 密钥,两套独立。
- **不要 force push**(`git push -f`)—— 会丢掉远端历史。Leoliao-app 的 main 是协作主线,没有 force push 的必要。
- **不要把大文件直接 commit**(>1MB 的二进制,如 APK)—— 应走 GitHub Releases。先用 `git status` 检查暂存区,确认 `*.apk`、`*.png`、`.log` 没有意外进入。

## 验证失败的应急

如果步骤 5 任何一层失败:
1. **提交层失败**(local ≠ remote) —— 网络问题。`git push` 没成功。等几秒重试。
2. **同步层失败**(ahead ≠ 0) —— push 过程中断(SSH 超时/网络抖动)。重跑 `git push origin main`,加 `git fsck` 检查仓库完整性。
3. **字节层失败** —— 几乎不会发生,除非远端被人改过(GitHub Web UI 直接编辑)。先 `git fetch origin` 再 diff。

## 退出码速查

| 情况 | 现象 | 处理 |
|---|---|---|
| 无改动 | `git status` 空 | 告知"无内容可提交" |
| PS1 编码错 | 7+ 语法错误 | 用 .NET WriteAllText 重写带 BOM |
| 同步失败 | `git push` non-zero | 检查网络/SSH,重试 |
| 验证失败 | SHA 不一致 | 见上"验证失败的应急" |

---

**调用方式**: 用户说"同步到 github"或类似 → assistant 跑这套流程,不要省略任何步骤。
