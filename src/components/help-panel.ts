/**
 * 帮助面板 — 使用说明
 * v1.48.0: 反映 v1.23.0 → v1.48.0 全部新功能:
 *  - 侧栏三 Tab 搜索(📂 路径 / 📖 全文 / 🧠 语义)+ Rerank
 *  - 多 provider API Key 独立保存(切模型不用重输)
 *  - 关系列表视图(替代知识图谱,可筛选/分组)
 *  - 本地文件一键重索引 / 去重(🔄 / 🧹)
 *  - EPUB 章节级切分(heading 保留章节名)
 *  - 严格 RAG(不编造,KB 无原文会明说)
 */

import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('ll-help-panel')
export class LlHelpPanel extends LitElement {
  protected createRenderRoot() { return this; }

  render() {
    return html`
      <div class="modal-overlay" @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
      }}>
        <div class="modal">
          <div class="modal-header">
            <h2>❓ 使用帮助</h2>
            <button class="modal-close" @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>✕</button>
          </div>
          <div class="modal-body help-body">

            <section>
              <h3>📚 知识库基础</h3>
              <ol>
                <li>点击左上角 <b>☰</b> 打开文件树,浏览或搜索笔记</li>
                <li>点文件名打开,正文里 <code>[[笔记名]]</code> 是 wikilink,点直接跳转</li>
                <li>打开笔记后,顶部 toolbar 下方有 <b>✏️ 编辑</b> 按钮(原悬浮右上角已移到工具栏下方)</li>
                <li>点阅读区任意位置自动收起侧栏;☰ hover 时恢复满透明度</li>
              </ol>
            </section>

            <section>
              <h3>🔍 搜索</h3>
              <ul>
                <li>左侧顶部搜索框支持模糊匹配路径名</li>
                <li>输关键词后,命中文件<b>自动展开</b>(不用一个个点开目录),<b>黄色边框高亮</b></li>
                <li>点搜索框右侧 <b>×</b> 清除恢复全部笔记</li>
                <li>wikilink 点击多匹配时,自动用搜索框列出候选</li>
                <li>开启 <b>📂 包含本地文件</b> 后,搜索可召回已索引的本地 PDF/EPUB</li>
              </ul>
            </section>

            <section>
              <h3>🔍 搜索(三 Tab)</h3>
              <ul>
                <li>侧栏搜索框下方有 <b>📂 路径 / 📖 全文 / 🧠 语义</b> 三个 Tab</li>
                <li><b>📂 路径</b>:按文件名/路径子串匹配(最快)</li>
                <li><b>📖 全文</b>:搜 chunk 正文内容(BM25),结果卡片高亮命中词</li>
                <li><b>🧠 语义</b>:BM25 + 向量 + RRF 融合,支持自然语言问句</li>
                <li>全文/语义 Tab 可勾 <b>🎯 Rerank</b> 二次精排(更准,稍慢)</li>
                <li><b>Ctrl/Cmd+K</b> 快捷聚焦搜索框</li>
              </ul>
            </section>

            <section>
              <h3>🕸 关系列表(原知识图谱)</h3>
              <ul>
                <li>工具栏 <b>🕸</b> 打开"关系列表",按被引用数排序展示所有 wikilink</li>
                <li>每张卡片展开看 <b>🔗 引用了</b> 和 <b>⬅ 被引用</b>,点链接直接跳笔记</li>
                <li>顶部分组:<b>🔽 按被引数</b> / <b>📁 按目录</b></li>
                <li>筛选:<b>全部 / 被引≥1 / ≥3(枢纽) / ≥5(核心)</b></li>
                <li>若关系很少,用 <b>✨ 自动建立链接</b> 扫笔记标题注入 <code>[[xxx]]</code>;<b>↩️ 回滚注入</b> 撤销</li>
              </ul>
            </section>

            <section>
              <h3>⚙️ LLM 设置(多模型)</h3>
              <ul>
                <li>对话面板 <b>⚙️</b> 可配多个 provider(OpenAI 兼容 / MiniMax 等)</li>
                <li><b>API Key 按 provider 自动保存</b> — 切换模型/供应商不用重输 Key(V1.41+)</li>
                <li>切换 provider 时 baseUrl/model 自动切到该商默认值</li>
              </ul>
            </section>

            <section>
              <h3>📕 本地参考库(V51+)</h3>
              <ul>
                <li>顶部 <b>📖</b> 按钮打开"本地参考库"面板,列出已索引的本地 PDF / EPUB</li>
                <li><b>🔄 重索引全部(V1.34+)</b>:从已提取全文重切 chunk(EPUB 章节级),大文件也能处理</li>
                <li><b>🧹 清理重复(V1.39+)</b>:同一文件被索引成多份时(如 xxx.md / xxx.epub.md),保留最完整的一份,删其余</li>
                <li>同一本书若出现多次会导致检索被拆散 — 先"清理重复"再"重索引"</li>
                <li>点工具栏 <b>📂</b> 打开 PDF/EPUB 后,后台自动提取文字 + 切 chunk + 写库(<b>不用重启</b>)</li>
                <li>索引完成后自动存一份 <b>📕/📘 xxx.md</b> 进 vault + 上 OSS,文件树里也能搜到</li>
                <li>展开卡片看章节预览 + 字数 + 最近索引时间</li>
                <li><b>🗑 删除索引</b>:<b>V52.7+</b> 展开卡片后底部有红按钮,确认后清 IndexedDB 的 chunks / 向量 / notes / manifest</li>
                <li><b>PDF 中文乱码?</b> 部分 PDF 没 ToUnicode CMap,V52.6 已自动用本地 cMap 修复大部分</li>
              </ul>
            </section>

            <section>
              <h3>📂 文件树长按菜单(V52.7+)</h3>
              <ul>
                <li>长按文件 / 目录 600ms 出操作菜单</li>
                <li>文件菜单:<b>✏️ 重命名 / 📁 移动到… / 🗑 删除</b></li>
                <li>目录菜单:多一项 <b>➕ 新建子笔记</b></li>
                <li>长按位置在屏幕右半时菜单自动<b>向左展开</b>,不会溢出截断</li>
              </ul>
            </section>

            <section>
              <h3>✏️ 编辑笔记</h3>
              <ul>
                <li>打开笔记后,顶部 toolbar 下方一行就是 <b>✏️ 编辑</b> 按钮</li>
                <li>进入编辑模式后顶部出 markdown 工具栏:<b>H1/H2/B/I/🔗/•/代码块/引用</b></li>
                <li>实时显示字数 + 已保存 / 未保存</li>
                <li><b>💾 保存</b> 写回 Dexie 并刷新文件树</li>
                <li><b>取消</b> 弹确认("放弃当前修改?")避免误丢</li>
              </ul>
              <p class="hint"><b>光标停在阅读行(V52.11):</b> 点编辑时光标会按你在阅读模式滚到的百分比定位(不是跳末尾);阅读位置 25%/50%/75% → 编辑位置也是 25%/50%/75%。</p>
            </section>

            <section>
              <h3>📝 笔记能力(V43-V48)</h3>
              <ul>
                <li><b>Wiki 主页(V43):</b> 工具栏 <b>📖</b> 显示 vault 全貌 + 双向链接 + 标签索引</li>
                <li><b>长期记忆(V46):</b> 聊天时自动提取事实 / 引用 / 偏好,可在设置查看主题管理</li>
                <li><b>本地 Agent(V45):</b> 多步推理 + 工具调用(查 KB / 计算 / 写笔记)</li>
                <li><b>混合检索(V48):</b> BM25 + 向量 + RRF 融合,召回更准</li>
              </ul>
            </section>

            <section>
              <h3>💬 对话(V40-V42)</h3>
              <ul>
                <li>右下 <b>💬</b> 浮按钮打开对话</li>
                <li><b>V42+ 多会话:</b> 顶部 <b>+</b> 新建会话,左侧列表切换 / 重命名 / 删除</li>
                <li>每会话独立消息历史,默认 200 条滚动</li>
                <li>助手消息会带 <b>引用</b>(从哪几篇笔记 / 哪个 chunk 来)</li>
              </ul>
            </section>

            <section>
              <h3>🕐 历史记录(V39+)</h3>
              <ul>
                <li>工具栏 <b>🕐</b> 打开最近打开的 30 条(笔记 + 本地文件)</li>
                <li>本地文件 ≤512KB 会缓存快照,打开免重新选</li>
                <li>同笔记再开会更新 openedAt,不重复</li>
              </ul>
            </section>

            <section>
              <h3>💾 保存笔记到本地</h3>
              <ul>
                <li>打开笔记后,顶部 <b>💾</b> 保存</li>
                <li>Web:弹原生"另存为",可改文件名 + 选目录</li>
                <li>Android (V36.1+):直接写到 <code>Documents/knowledge-base/</code> 公共目录</li>
                <li>成功显示绿色 <b>✅ 已保存</b> 提示</li>
                <li>Android 为什么不能选位置? scoped storage 禁止覆盖 SAF 选中的文件,退回固定路径</li>
              </ul>
            </section>

            <section>
              <h3>🔄 同步</h3>
              <ul>
                <li>底部 <b>🔄 重新同步</b> 按钮立即拉取最新笔记</li>
                <li>云端自动每天 03:20 / 15:20 同步两次</li>
                <li>本地 PDF 自动入库的 <b>📕 xxx.md</b> 也走 sync 推到 OSS</li>
              </ul>
            </section>

            <section>
              <h3>↗️ 分享 / 设置</h3>
              <ul>
                <li><b>↗️</b> 分享:打开笔记 → 点 ↗ 弹系统分享面板,支持微信 / 飞书 / 邮件</li>
                <li><b>⚙️ 设置:</b> 主题 / 颜色微调 / 字体 / 字号 / LLM provider / RAG 检索范围</li>
              </ul>
            </section>

            <section>
              <h3>🔧 常见问题</h3>
              <p><b>首次加载慢?</b> vault 一次性下载所有 .md,首次几秒到几十秒,之后缓存就好。</p>
              <p><b>wikilink 跳不过去?</b> 笔记名一字不差,或者点 × 看搜索框候选。</p>
              <p><b>本地 PDF 打开空白?</b> 可能是扫描版(只有图没文字层),V52.6 cMap 救不了,需要 OCR。</p>
              <p><b>PDF 只有几个 chunks?</b> 先确认 PDF 总页数 —— 9 页 PDF = 9 chunks 正常;若几十页只有 9,是图文型 PDF(文字层少)。</p>
              <p><b>问某本书某章 Agent 说"没原文"?</b> 先确认该书已完整索引(本地参考库看 chunks 数),同一本书重复会拆散检索,先 🧹 清理。</p>
              <p><b>Agent 会编造吗?</b> 不会 —— 严格 RAG 模式,KB 无原文会如实说"未检索到",不拿训练知识冒充。</p>
              <p><b>工具栏按钮太多被裁?</b> V52.3 toolbar 自身横向可滚,从右向左滑即可看到所有按钮。</p>
              <p><b>同步失败?</b> 看 logcat 或问开发者。</p>
            </section>

            <p class="version">知识库 APK v1.48 · 2026-09-05 · 最近更新:三 Tab 搜索 + Rerank、关系列表、多模型 Key 独立保存、EPUB 章节切分、清理重复、严格 RAG</p>
          </div>
        </div>
      </div>
    `;
  }
}