/**
 * 设置面板 — 主题/字体/字号/链接色 等
 * V29
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ThemeSettings, PRESETS, DEFAULT_SETTINGS, saveSettings, applySettings } from '../services/settings';

@customElement('ll-settings-panel')
export class LlSettingsPanel extends LitElement {
  protected createRenderRoot() { return this; }

  @property({ type: Object }) settings!: ThemeSettings;

  private updateSetting<K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) {
    const next = { ...this.settings, [key]: value };
    saveSettings(next);
    applySettings(next);
    this.settings = next;
    // V31-fix: 通知 main.ts 同步更新 this.theme,否则关掉再开设置会看到旧值(被 main.ts 旧 theme 覆盖)
    this.dispatchEvent(new CustomEvent('settings-changed', { detail: next, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  private applyPreset(name: keyof typeof PRESETS) {
    const preset = PRESETS[name];
    const next = { ...DEFAULT_SETTINGS, ...preset };
    saveSettings(next);
    applySettings(next);
    this.settings = next;
    // V31-fix: 同上
    this.dispatchEvent(new CustomEvent('settings-changed', { detail: next, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  private reset() {
    saveSettings(DEFAULT_SETTINGS);
    applySettings(DEFAULT_SETTINGS);
    this.settings = { ...DEFAULT_SETTINGS };
    // V31-fix: 同上
    this.dispatchEvent(new CustomEvent('settings-changed', { detail: { ...DEFAULT_SETTINGS }, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  render() {
    if (!this.settings) return null;
    const s = this.settings;
    return html`
      <div class="modal-overlay" @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
      }}>
        <div class="modal">
          <div class="modal-header">
            <h2>⚙️ 设置</h2>
            <button class="modal-close" @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>✕</button>
          </div>
          <div class="modal-body">
            <section class="setting-section">
              <h3>🎨 主题预设</h3>
              <div class="preset-grid">
                ${Object.keys(PRESETS).map(name => html`
                  <button class="preset-btn" @click=${() => this.applyPreset(name as keyof typeof PRESETS)}>
                    <span class="preset-dot" style="background:${PRESETS[name].bgColor};border-color:${PRESETS[name].accentColor}"></span>
                    ${name}
                  </button>
                `)}
              </div>
            </section>

            <section class="setting-section">
              <h3>🎨 自定义颜色</h3>
              <label>背景色 (正文区) <input type="color" .value=${s.bgColor} @input=${(e: Event) => this.updateSetting('bgColor', (e.target as HTMLInputElement).value)} /></label>
              <label>面板背景 (侧栏/Toolbar) <input type="color" .value=${s.bg2Color} @input=${(e: Event) => this.updateSetting('bg2Color', (e.target as HTMLInputElement).value)} /></label>
              <label>正文字色 <input type="color" .value=${s.fgColor} @input=${(e: Event) => this.updateSetting('fgColor', (e.target as HTMLInputElement).value)} /></label>
              <label>次要文字色 (meta/timestamp) <input type="color" .value=${s.dimColor} @input=${(e: Event) => this.updateSetting('dimColor', (e.target as HTMLInputElement).value)} /></label>
              <label>主色 (按钮/标题栏) <input type="color" .value=${s.accentColor} @input=${(e: Event) => this.updateSetting('accentColor', (e.target as HTMLInputElement).value)} /></label>
              <label>链接色 <input type="color" .value=${s.linkColor} @input=${(e: Event) => this.updateSetting('linkColor', (e.target as HTMLInputElement).value)} /></label>
              <label>Wiki 链接色 ([[wikilink]]) <input type="color" .value=${s.wikilinkColor} @input=${(e: Event) => this.updateSetting('wikilinkColor', (e.target as HTMLInputElement).value)} /></label>
              <label>正文标题色 (h1/h2/h3) <input type="color" .value=${s.headingColor} @input=${(e: Event) => this.updateSetting('headingColor', (e.target as HTMLInputElement).value)} /></label>
              <label>分隔线 <input type="color" .value=${s.borderColor.startsWith('rgba') ? '#888888' : s.borderColor} @input=${(e: Event) => {
                // 简化输入:用 hex,存储时转 rgba
                const v = (e.target as HTMLInputElement).value;
                this.updateSetting('borderColor', `rgba(${parseInt(v.slice(1,3),16)}, ${parseInt(v.slice(3,5),16)}, ${parseInt(v.slice(5,7),16)}, 0.18)`);
              }} /></label>
            </section>

            <section class="setting-section">
              <h3>📝 字体</h3>
              <label>
                字体族
                <select @change=${(e: Event) => this.updateSetting('fontFamily', (e.target as HTMLSelectElement).value)}>
                  <option value="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif" ?selected=${s.fontFamily.includes('PingFang')}>系统默认 (中易读)</option>
                  <option value='Georgia, "Source Han Serif SC", "Songti SC", serif' ?selected=${s.fontFamily.includes('Serif')}>衬线 (宋体)</option>
                  <option value='"SF Mono", Menlo, Consolas, monospace' ?selected=${s.fontFamily.includes('Mono')}>等宽 (代码)</option>
                </select>
              </label>
              <label>
                字号 (px)
                <input type="number" min="12" max="28" .value=${String(s.fontSize)} @input=${(e: Event) => this.updateSetting('fontSize', parseInt((e.target as HTMLInputElement).value) || 15)} />
              </label>
            </section>

            <button class="reset-btn" @click=${() => this.reset()}>🔄 恢复默认</button>
          </div>
        </div>
      </div>
    `;
  }
}
