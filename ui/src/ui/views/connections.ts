import { html } from "lit";
import type { ChannelUiMetaEntry } from "../types.ts";

export type ConnectionItem = {
  id: string;
  name: string;
  icon: string;
  description?: string;
  connected: boolean;
  configurable: boolean;
};

export type ConnectionsProps = {
  channels: ChannelUiMetaEntry[];
  onConnect: (id: string) => void;
  onConfigure: (id: string) => void;
};

const KNOWN_CONNECTIONS: ConnectionItem[] = [
  { id: "telegram", name: "Telegram", icon: "✈️", description: "Чат-бот в Telegram", connected: false, configurable: true },
  { id: "gmail", name: "Gmail", icon: "📧", description: "Получение и отправка писем", connected: false, configurable: true },
  { id: "google-calendar", name: "Google Calendar", icon: "📅", description: "События и напоминания", connected: false, configurable: true },
  { id: "google-drive", name: "Google Drive", icon: "📁", description: "Работа с файлами", connected: false, configurable: true },
  { id: "instagram", name: "Instagram", icon: "📸", description: "Посты, DM, статистика", connected: false, configurable: false },
  { id: "whatsapp", name: "WhatsApp", icon: "💬", description: "Мессенджер", connected: false, configurable: true },
  { id: "discord", name: "Discord", icon: "🎮", description: "Сервер Discord", connected: false, configurable: true },
  { id: "signal", name: "Signal", icon: "🔒", description: "Защищённый мессенджер", connected: false, configurable: false },
];

export function renderConnections(props: ConnectionsProps) {
  const { channels, onConnect, onConfigure } = props;

  // Mark connected channels
  const connectedIds = new Set(channels.map(c => c.provider ?? c.channel ?? ""));
  const items = KNOWN_CONNECTIONS.map(item => ({
    ...item,
    connected: connectedIds.has(item.id),
  }));

  const connected = items.filter(i => i.connected);
  const available = items.filter(i => !i.connected);

  return html`
    <div class="connections-root">
      <style>
        .connections-root {
          max-width: 780px;
          margin: 0 auto;
          padding: 0 0 32px;
        }
        .conn-section-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--c-muted, #6b6b8a);
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin: 0 0 12px;
        }
        .conn-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 12px;
          margin-bottom: 28px;
        }
        .conn-card {
          background: var(--c-surface, #13131a);
          border: 1px solid var(--c-border, #2a2a3d);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          transition: border-color 0.15s;
        }
        .conn-card.connected {
          border-color: rgba(34, 197, 94, 0.3);
        }
        .conn-card:hover { border-color: var(--c-accent, #6366f1); }

        .conn-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .conn-icon { font-size: 28px; }
        .conn-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 10px;
        }
        .conn-badge.on {
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        .conn-badge.off {
          background: rgba(107, 107, 138, 0.1);
          color: var(--c-muted, #6b6b8a);
        }
        .conn-name {
          font-size: 14px;
          font-weight: 600;
        }
        .conn-desc {
          font-size: 12px;
          color: var(--c-muted, #6b6b8a);
        }
        .conn-actions {
          display: flex;
          gap: 6px;
          margin-top: 4px;
        }
        .conn-btn {
          flex: 1;
          padding: 6px 10px;
          border-radius: 7px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--c-border, #2a2a3d);
          background: var(--c-surface2, #1c1c27);
          color: var(--c-text, inherit);
          transition: all 0.15s;
        }
        .conn-btn:hover { border-color: var(--c-accent, #6366f1); color: var(--c-accent, #6366f1); }
        .conn-btn.primary {
          background: var(--c-accent, #6366f1);
          border-color: var(--c-accent, #6366f1);
          color: white;
        }
        .conn-btn.primary:hover { opacity: 0.9; }
        .conn-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .conn-coming-soon {
          font-size: 10px;
          color: var(--c-muted, #6b6b8a);
          text-align: center;
          padding: 4px;
        }
      </style>

      ${connected.length > 0 ? html`
        <div class="conn-section-title">✅ Подключено</div>
        <div class="conn-grid">
          ${connected.map(item => html`
            <div class="conn-card connected">
              <div class="conn-top">
                <span class="conn-icon">${item.icon}</span>
                <span class="conn-badge on">Подключён</span>
              </div>
              <div class="conn-name">${item.name}</div>
              <div class="conn-desc">${item.description ?? ""}</div>
              <div class="conn-actions">
                <button class="conn-btn" @click=${() => onConfigure(item.id)}>⚙️ Настройки</button>
              </div>
            </div>
          `)}
        </div>
      ` : ""}

      <div class="conn-section-title">Доступные интеграции</div>
      <div class="conn-grid">
        ${available.map(item => html`
          <div class="conn-card">
            <div class="conn-top">
              <span class="conn-icon">${item.icon}</span>
              <span class="conn-badge off">Не подключён</span>
            </div>
            <div class="conn-name">${item.name}</div>
            <div class="conn-desc">${item.description ?? ""}</div>
            <div class="conn-actions">
              ${item.configurable
                ? html`<button class="conn-btn primary" @click=${() => onConnect(item.id)}>+ Подключить</button>`
                : html`<div class="conn-coming-soon">Скоро</div>`}
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
}
