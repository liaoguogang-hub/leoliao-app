/**
 * 帮助面板 — 使用说明
 * V36: 加保存 / 搜索展开 / 三横图标 等 V36 新特性
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
              <h3>📚 怎么用知识库</h3>
              <ol>
                <li>点击左上角的 <b>☰</b> 按钮打开文件树</li>
                <li>浏览或搜索笔记,点文件名打开</li>
                <li>点阅读区域任意位置自动收起侧栏</li>
                <li>正文里的 <code>[[笔记名]]</code> 是 wikilink,点直接跳转</li>
              </ol>
              <p class="hint"><b>V36 新行为:</b>打开笔记后 ☰ 图标会自动半透明(opacity 0.25)避免挡住文件名;需要点侧栏时 hover 一下 ☰ 即可恢复显示。</p>
            </section>

            <section>
              <h3>🔍 搜索</h3>
              <ul>
                <li>顶部搜索框支持模糊匹配路径名</li>
                <li>输关键词后,<b>命中文件自动展开</b>(不用一个一个点开目录),<b>黄色边框高亮</b></li>
                <li>点击右上 <b>×</b> 清除立即恢复全部笔记</li>
                <li>wikilink 点击多匹配时,会自动用搜索框列出候选</li>
              </ul>
            </section>

            <section>
              <h3>💾 保存笔记到本地</h3>
              <ul>
                <li>打开任意笔记后,点顶部 <b>💾</b> 保存</li>
                <li>Web (Chrome/Edge):弹原生"另存为"对话框,可改文件名 + 选目录</li>
                <li>Android (V36.1+):直接写到 <code>Documents/knowledge-base/</code> 公共目录,用系统文件管理器查看</li>
                <li>成功显示绿色 <b>✅ 已保存: 文件名 + 📁 路径</b> 提示</li>
                <li>取消或选错不会报错,静默返回</li>
              </ul>
              <p class="hint"><b>Android 为什么不能选位置?</b> Android 11+ scoped storage 禁止 APP 写到 SAF 选中的文件(覆盖保存会失败)。所以退回固定路径,文件管理器 → 内部存储 → Documents → knowledge-base/ 找。</p>
            </section>

            <section>
              <h3>🔄 同步</h3>
              <ul>
                <li>点击底部 <b>🔄 重新同步</b> 按钮立即拉取最新笔记</li>
                <li>云端自动每天 03:20 / 15:20 同步两次</li>
              </ul>
            </section>

            <section>
              <h3>⚙️ 设置</h3>
              <ul>
                <li>5 套预设主题 (含白天/夜晚/护眼)</li>
                <li>每种颜色可单独调整</li>
                <li>字体族 (中文/衬线/等宽) + 字号自定义</li>
                <li>设置实时生效,自动保存</li>
              </ul>
            </section>

            <section>
              <h3>↗️ 分享</h3>
              <ul>
                <li>打开任意笔记,点右上角 <b>↗</b> 分享当前内容</li>
                <li>支持微信/飞书/邮件等系统分享面板</li>
              </ul>
            </section>

            <section>
              <h3>🔧 常见问题</h3>
              <p><b>笔记首次加载慢?</b> 因为 vault 一次性下载所有 .md 文件,首次几秒到几十秒,之后就缓存好了。</p>
              <p><b>wikilink 跳不过去?</b> 检查笔记名是否一字不差,或者点 × 看搜索框列出候选。</p>
              <p><b>同步失败?</b> 看 <code>~/.cc-connect/cc-connect.log</code> 或问我。</p>
            </section>

            <p class="version">知识库 APK v36.1 · 2026-07-11</p>
          </div>
        </div>
      </div>
    `;
  }
}
