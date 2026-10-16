/**
 * 帮助面板 — 使用说明
 * v1.71 重写:
 *  - 版本号改为构建时自动读取 package.json(不再手写,避免过期)
 *  - 合并原先重复的两个"搜索"段落
 *  - 新增:图片显示(OSS)、返回键行为(确认退出)、数学公式、阅读位置记忆
 */

import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import pkg from '../../package.json';

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
              <h3>📚 基础操作</h3>
              <ol>
                <li>点左上角 <b>☰</b> 打开文件树,浏览或搜索笔记</li>
                <li>点文件名打开笔记;正文里 <code>[[笔记名]]</code> 是 wikilink,点按直接跳转</li>
                <li>打开笔记后,工具栏下方有 <b>✏️ 编辑</b> 按钮</li>
                <li>点阅读区任意位置自动收起侧栏</li>
                <li><b>🔙 返回键</b>:逐层后退(关弹窗 → 收侧栏),在主界面再按会弹<b>确认退出</b>,防止误触退出</li>
              </ol>
            </section>

            <section>
              <h3>🔍 搜索(三 Tab)</h3>
              <ul>
                <li>侧栏搜索框下方有 <b>📂 路径 / 📖 全文 / 🧠 语义</b> 三个 Tab</li>
                <li><b>📂 路径</b>:按文件名/路径匹配,命中文件自动展开 + 黄色边框高亮(最快)</li>
                <li><b>📖 全文</b>:搜笔记正文(BM25),结果卡片高亮命中词</li>
                <li><b>🧠 语义</b>:BM25 + 向量 + RRF 融合,支持自然语言问句</li>
                <li>全文/语义 Tab 可勾 <b>🎯 Rerank</b> 二次精排(更准,稍慢)</li>
                <li>开启 <b>📂 包含本地文件</b> 后,搜索可召回已索引的本地 PDF/EPUB</li>
                <li><b>Ctrl/Cmd+K</b> 快捷聚焦搜索框</li>
              </ul>
            </section>

            <section>
              <h3>🖼 图片与公式</h3>
              <ul>
                <li>笔记里的图片(含 SVG)渲染时自动转为 OSS 绝对地址加载</li>
                <li><b>首次打开需联网</b>;加载过的图片有缓存,断网也能看</li>
                <li>裂图通常是该图片还没同步到 OSS(在 Obsidian 端确认 remotely-save 已上传附件)</li>
                <li>支持 LaTeX 数学公式:<code>$行内$</code> 和 <code>$$块级$$</code>(KaTeX 渲染)</li>
              </ul>
            </section>

            <section>
              <h3>📖 阅读体验</h3>
              <ul>
                <li><b>记住阅读位置</b>:重开 App 自动回到上次的笔记与滚动位置</li>
                <li>顶部细条显示阅读进度(0-100%)</li>
                <li>支持 Obsidian callout(<code>&gt; [!note]</code>)、表格、行内注释 <code>%%xx%%</code></li>
              </ul>
            </section>

            <section>
              <h3>🕸 关系列表</h3>
              <ul>
                <li>工具栏 <b>🕸</b> 打开"关系列表",按被引用数排序展示所有 wikilink</li>
                <li>每张卡片展开看 <b>🔗 引用了</b> 和 <b>⬅ 被引用</b>,点链接直接跳笔记</li>
                <li>顶部分组:<b>按被引数 / 按目录</b>;筛选:全部 / ≥1 / ≥3(枢纽) / ≥5(核心)</li>
                <li>关系很少时,用 <b>✨ 自动建立链接</b> 扫笔记标题注入 <code>[[xxx]]</code>;<b>↩️ 回滚注入</b> 可撤销</li>
              </ul>
            </section>

            <section>
              <h3>💬 AI 对话</h3>
              <ul>
                <li>右下 <b>💬</b> 浮按钮打开对话,顶部 <b>+</b> 新建会话,左侧列表切换 / 重命名 / 删除</li>
                <li>助手消息带 <b>引用</b>(标注来自哪几篇笔记 / 哪个段落)</li>
                <li><b>严格 RAG</b>:知识库没有原文会明说"未检索到",不拿训练知识冒充</li>
                <li>对话面板 <b>⚙️</b> 配多个模型 provider;<b>API Key 按 provider 独立保存</b>,切模型不用重输</li>
                <li>长期记忆:聊天时自动提取事实 / 偏好,可在设置里查看管理</li>
              </ul>
            </section>

            <section>
              <h3>📕 本地参考库(PDF / EPUB)</h3>
              <ul>
                <li>工具栏 <b>📂</b> 打开本地 PDF/EPUB 后,后台自动提取文字 + 切 chunk + 写索引(不用重启)</li>
                <li>顶部 <b>📖</b> 按钮打开"本地参考库"面板,看章节预览 + 字数 + 索引时间</li>
                <li><b>🔄 重索引全部</b>:从已提取全文重切 chunk(EPUB 按章节切)</li>
                <li><b>🧹 清理重复</b>:同一本书被索引成多份时保留最完整的一份 — 检索被拆散时先清理再重索引</li>
                <li>展开卡片底部 <b>🗑 删除索引</b> 可清掉该书的 chunks / 向量 / 笔记</li>
                <li>索引完成后自动存一份 <b>📕/📘 xxx.md</b> 进 vault 并上 OSS,文件树也能搜到</li>
              </ul>
            </section>

            <section>
              <h3>📂 文件树长按菜单</h3>
              <ul>
                <li>长按文件 / 目录 600ms 出操作菜单</li>
                <li>文件:<b>✏️ 重命名 / 📁 移动到… / 🗑 删除</b>;目录多一项 <b>➕ 新建子笔记</b></li>
                <li>长按位置在屏幕右半时菜单自动向左展开,不会溢出</li>
              </ul>
            </section>

            <section>
              <h3>✏️ 编辑笔记</h3>
              <ul>
                <li>编辑模式顶部有 markdown 工具栏:<b>H1/H2/B/I/🔗/•/代码块/引用</b></li>
                <li>实时显示字数 + 已保存 / 未保存;<b>取消</b> 会弹确认避免误丢</li>
                <li>点编辑时,光标按阅读位置百分比定位(读到中间,光标也在中间)</li>
              </ul>
            </section>

            <section>
              <h3>🔄 同步与保存</h3>
              <ul>
                <li>底部 <b>🔄 重新同步</b> 手动拉取最新笔记;云端每天 03:20 / 15:20 自动同步两次</li>
                <li>打开笔记后点 <b>💾</b> 可存到本地:Android 写到 <code>Documents/knowledge-base/</code>,Web 弹"另存为"</li>
                <li><b>🕐</b> 历史记录:最近打开的 30 条(笔记 + 本地文件)</li>
                <li><b>↗️</b> 分享:打开笔记 → 点 ↗ 弹系统分享面板(微信 / 飞书 / 邮件)</li>
              </ul>
            </section>

            <section>
              <h3>🔧 常见问题</h3>
              <p><b>怎么看版本号?</b> 本页底部;或系统 设置 → 应用 → 知识库 → 版本。</p>
              <p><b>首次加载慢?</b> vault 一次性下载所有 .md,首次几秒到几十秒,之后走缓存。</p>
              <p><b>图片裂图?</b> 先联网打开一次;仍裂说明图片没传到 OSS,去 Obsidian 端跑 remotely-save。</p>
              <p><b>wikilink 跳不过去?</b> 笔记名需一字不差;多匹配时看搜索框候选。</p>
              <p><b>本地 PDF 打开空白?</b> 可能是扫描版(无文字层),需要 OCR。</p>
              <p><b>问某本书某章 Agent 说"没原文"?</b> 确认该书已完整索引(本地参考库看 chunks 数),重复索引先 🧹 清理。</p>
              <p><b>工具栏按钮被裁?</b> 工具栏可横向滑动,从右向左滑看全部按钮。</p>
              <p><b>误触返回退出了?</b> 已加确认退出弹窗;在主界面按返回需再点一次"退出"才会关闭。</p>
            </section>

            <p class="version">知识库 v${pkg.version} · 版本号与系统应用信息一致</p>
          </div>
        </div>
      </div>
    `;
  }
}
