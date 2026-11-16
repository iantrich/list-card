import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import './editor';
import { CARD_DESCRIPTION, CARD_EDITOR_NAME, CARD_NAME, CARD_VERSION } from './const';
import type { ActionConfig, ColumnConfig, FeedRow, HomeAssistant, ListCardConfig } from './types';
import {
  computeCellText,
  extractRows,
  FILE_LIST_ATTRIBUTE,
  filterRows,
  getValue,
  replacePlaceholders,
  resolveCardHeight,
  resolveImageUrl,
  resolveLink,
  rowsWithColumns,
  sortRows,
  stringifyValue,
  styleListToObject,
} from './utils';

const FILE_LIST_COLUMNS: ColumnConfig[] = [
  { title: 'Path', field: 'path' },
  { title: 'Name', field: 'name' },
  { title: 'Filename', field: 'filename' },
  { title: 'Full Path', field: 'fullpath', add_link: 'fullpath' },
  { title: 'Ext', field: 'ext' },
];

const HOLD_DELAY_MS = 500;
const DOUBLE_TAP_WINDOW_MS = 250;

type ActionKind = 'tap' | 'hold' | 'double_tap';

@customElement(CARD_NAME)
export class ListCard extends LitElement {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @state()
  private _config?: ListCardConfig;

  @state()
  private _page = 0;

  private _holdTimer?: ReturnType<typeof setTimeout>;
  private _tapTimer?: ReturnType<typeof setTimeout>;
  private _pageTimer?: ReturnType<typeof setInterval>;
  private _holdFired = false;
  private _pageCount = 1;

  protected createRenderRoot(): ShadowRoot {
    // Inject styles as <style> tags rather than adoptedStyleSheets so the card
    // renders correctly inside HA's nested shadow roots and older browsers.
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const ctor = this.constructor as typeof LitElement;
    for (const s of ctor.elementStyles) {
      const style = document.createElement('style');
      style.textContent = (s as unknown as { cssText: string }).cssText ?? '';
      root.appendChild(style);
    }
    return root;
  }

  public setConfig(config: ListCardConfig): void {
    if (!config || !config.entity) {
      throw new Error('Please define an entity');
    }
    if (config.columns !== undefined && !Array.isArray(config.columns)) {
      throw new Error('columns must be a list');
    }
    if (config.sort && !config.sort.value) {
      throw new Error('You need to specify a value to sort on');
    }

    this._config = {
      ...config,
      columns:
        config.feed_attribute === FILE_LIST_ATTRIBUTE && (!config.columns || config.columns.length === 0)
          ? FILE_LIST_COLUMNS
          : config.columns,
    };
    this._page = 0;
    this._restartPageTimer();
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._restartPageTimer();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPageTimer();
    this._clearHold();
    if (this._tapTimer) {
      clearTimeout(this._tapTimer);
      this._tapTimer = undefined;
    }
  }

  /* ── Rendering ─────────────────────────────────────────────── */

  protected render() {
    if (!this.hass || !this._config) {
      return nothing;
    }

    const config = this._config;
    const entity = this.hass.states[config.entity];
    if (!entity) {
      return this._renderWarning(`Entity not available: ${config.entity}`);
    }

    const feed = extractRows(entity.attributes, config.feed_attribute);
    if (!feed.ok) {
      const available = feed.available.length ? ` Available attributes: ${feed.available.join(', ')}` : '';
      return this._renderWarning(
        `Attribute '${config.feed_attribute}' not found on ${config.entity}. Attribute names are case-sensitive.${available}`,
      );
    }

    const columns = config.columns ?? [];
    if (columns.length === 0) {
      const fields = feed.rows[0] ? Object.keys(feed.rows[0]).join(', ') : '';
      return this._renderWarning(
        `No columns configured.${fields ? ` Fields available in the first row: ${fields}` : ''}`,
      );
    }

    const rows = this._visibleRows(feed.rows, columns);
    if (rows.length === 0) {
      if (!config.empty_message) {
        this.style.display = 'none';
        return nothing;
      }
      this.style.display = '';
      return html`<ha-card .header=${config.title ?? ''}>
        <div class="empty">${config.empty_message}</div>
      </ha-card>`;
    }

    this.style.display = '';

    const inlineColumns = columns.filter((column) => !column.full_width);
    const gridStyle = {
      maxHeight: resolveCardHeight(config.card_height),
      '--list-card-columns': String(Math.max(inlineColumns.length, 1)),
    };

    return html`
      <ha-card .header=${config.title ?? ''}>
        <div class="grid-container" style=${styleMap(gridStyle)}>
          ${
            config.show_header !== false && inlineColumns.some((column) => column.title)
              ? html`
                  <div class="grid-row grid-header-row">
                    ${inlineColumns.map(
                      (column) =>
                        html`<div
                          class="grid-cell grid-header ${this._fieldClass(column)}"
                          style=${styleMap(styleListToObject(column.style))}
                        >
                          ${column.title}
                        </div>`,
                    )}
                  </div>
                `
              : nothing
          }
          ${rows.map((row) => this._renderRow(row, columns))}
        </div>
        ${this._renderPager()}
      </ha-card>
    `;
  }

  private _renderWarning(message: string): TemplateResult {
    this.style.display = '';
    return html`<ha-card .header=${this._config?.title ?? ''}>
      <div class="warning">${message}</div>
    </ha-card>`;
  }

  private _visibleRows(allRows: FeedRow[], columns: ColumnConfig[]): FeedRow[] {
    const config = this._config!;
    const prepared = rowsWithColumns(filterRows(sortRows(allRows, config.sort), config.filter, columns), columns);
    const limited = config.row_limit && config.row_limit > 0 ? prepared.slice(0, config.row_limit) : prepared;

    const pageSize = config.page_size && config.page_size > 0 ? config.page_size : 0;
    if (!pageSize) {
      this._pageCount = 1;
      return limited;
    }

    this._pageCount = Math.max(1, Math.ceil(limited.length / pageSize));
    const page = Math.min(this._page, this._pageCount - 1);
    return limited.slice(page * pageSize, page * pageSize + pageSize);
  }

  private _renderPager(): TemplateResult | typeof nothing {
    if (this._pageCount <= 1) {
      return nothing;
    }
    const page = Math.min(this._page, this._pageCount - 1);
    return html`
      <div class="pager">
        <button type="button" class="pager-button" aria-label="Previous page" @click=${() => this._changePage(-1)}>
          <ha-icon icon="mdi:chevron-left"></ha-icon>
        </button>
        <span class="pager-label">${page + 1} / ${this._pageCount}</span>
        <button type="button" class="pager-button" aria-label="Next page" @click=${() => this._changePage(1)}>
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>
      </div>
    `;
  }

  private _changePage(delta: number, fromTimer = false): void {
    const count = this._pageCount;
    if (count <= 1) {
      return;
    }
    this._page = (((Math.min(this._page, count - 1) + delta) % count) + count) % count;
    if (!fromTimer) {
      // Manual navigation resets the auto-advance countdown.
      this._restartPageTimer();
    }
  }

  private _restartPageTimer(): void {
    this._stopPageTimer();
    const interval = this._config?.page_interval;
    if (!this.isConnected || !this._config?.page_size || !interval || interval <= 0) {
      return;
    }
    this._pageTimer = setInterval(() => this._changePage(1, true), interval * 1000);
  }

  private _stopPageTimer(): void {
    if (this._pageTimer) {
      clearInterval(this._pageTimer);
      this._pageTimer = undefined;
    }
  }

  private _fieldClass(column: ColumnConfig): string {
    // Keep the legacy per-field class so existing card-mod styles still apply.
    return (column.field ?? '').replace(/[^\w-]/g, '_');
  }

  private _renderRow(row: FeedRow, columns: ColumnConfig[]): TemplateResult {
    return html`<div class="grid-row">${columns.map((column) => this._renderCell(row, column))}</div>`;
  }

  private _renderCell(row: FeedRow, column: ColumnConfig): TemplateResult {
    const hasAction = Boolean(column.tap_action || column.hold_action || column.double_tap_action);
    const classes = ['grid-cell', this._fieldClass(column)];
    if (hasAction) classes.push('actionable');
    if (column.full_width) classes.push('full-width');
    if (column.type) classes.push(`type-${column.type}`);

    return html`
      <div
        class=${classes.join(' ')}
        style=${styleMap(styleListToObject(column.style))}
        @click=${hasAction ? (ev: Event) => this._onClick(ev, column, row) : undefined}
        @dblclick=${hasAction ? (ev: Event) => this._onDoubleClick(ev, column, row) : undefined}
        @pointerdown=${column.hold_action ? () => this._startHold(column, row) : undefined}
        @pointerup=${column.hold_action ? this._clearHold : undefined}
        @pointerleave=${column.hold_action ? this._clearHold : undefined}
        @pointercancel=${column.hold_action ? this._clearHold : undefined}
      >
        ${this._renderCellContent(row, column)}
      </div>
    `;
  }

  private _renderCellContent(row: FeedRow, column: ColumnConfig): TemplateResult {
    if (column.type === 'image') {
      const url = resolveImageUrl(getValue(row, column.field));
      if (!url) {
        return html``;
      }
      const width = column.width ?? 70;
      const height = column.height ?? 90;
      const image = html`<img
        src=${url}
        width=${String(width)}
        height=${String(height)}
        loading="lazy"
        alt=""
        style=${styleMap(styleListToObject(column.image_style))}
      />`;
      return this._wrapLinkIfNeeded(column, row, image);
    }

    if (column.type === 'icon') {
      const icon = column.icon ?? stringifyValue(getValue(row, column.field));
      return this._wrapLinkIfNeeded(column, row, html`<ha-icon .icon=${icon}></ha-icon>`);
    }

    const locale = this.hass?.locale?.language ?? this.hass?.language;
    const text = html`<span>${computeCellText(row, column, locale)}</span>`;
    return this._wrapLinkIfNeeded(column, row, text);
  }

  private _wrapLinkIfNeeded(column: ColumnConfig, row: FeedRow, content: TemplateResult): TemplateResult {
    if (!column.add_link) {
      return content;
    }

    const href = resolveLink(getValue(row, column.add_link));
    if (!href) {
      return content;
    }
    const target = column.link_target ?? '_blank';
    return html`<a href=${href} target=${target} rel="noreferrer noopener">${content}</a>`;
  }

  /* ── Actions ───────────────────────────────────────────────── */

  private _onClick(ev: Event, column: ColumnConfig, row: FeedRow): void {
    if (this._holdFired) {
      // The pointer was held long enough to trigger hold_action; swallow the click.
      this._holdFired = false;
      ev.preventDefault();
      return;
    }
    if (!column.tap_action) {
      return;
    }
    ev.preventDefault();

    if (column.double_tap_action) {
      // Wait briefly so a double tap doesn't also fire the tap action.
      if (this._tapTimer) {
        clearTimeout(this._tapTimer);
        this._tapTimer = undefined;
        return;
      }
      this._tapTimer = setTimeout(() => {
        this._tapTimer = undefined;
        this._handleAction(column, row, 'tap');
      }, DOUBLE_TAP_WINDOW_MS);
      return;
    }

    this._handleAction(column, row, 'tap');
  }

  private _onDoubleClick(ev: Event, column: ColumnConfig, row: FeedRow): void {
    if (!column.double_tap_action) {
      return;
    }
    ev.preventDefault();
    if (this._tapTimer) {
      clearTimeout(this._tapTimer);
      this._tapTimer = undefined;
    }
    this._handleAction(column, row, 'double_tap');
  }

  private _startHold(column: ColumnConfig, row: FeedRow): void {
    this._clearHold();
    this._holdFired = false;
    this._holdTimer = setTimeout(() => {
      this._holdTimer = undefined;
      this._holdFired = true;
      this._handleAction(column, row, 'hold');
    }, HOLD_DELAY_MS);
  }

  private _clearHold = (): void => {
    if (this._holdTimer) {
      clearTimeout(this._holdTimer);
      this._holdTimer = undefined;
    }
  };

  private _handleAction(column: ColumnConfig, row: FeedRow, kind: ActionKind): void {
    const action = column[`${kind}_action`] as ActionConfig | undefined;
    if (!action?.action) {
      console.warn('list-card: invalid action config', action);
      return;
    }
    if (action.action === 'none') {
      return;
    }

    const resolved = replacePlaceholders(structuredClone(action), row);
    const event = new Event('hass-action', { bubbles: true, composed: true }) as Event & {
      detail: { config: Record<string, unknown>; action: string };
    };
    // HA's action handler reads `<kind>_action` from the config and uses `entity`
    // for more-info / toggle actions.
    event.detail = {
      config: { entity: this._config?.entity, [`${kind}_action`]: resolved },
      action: kind,
    };
    this.dispatchEvent(event);
  }

  /* ── Lovelace API ──────────────────────────────────────────── */

  public getCardSize(): number {
    const rows = this._config?.page_size ?? this._config?.row_limit ?? 5;
    return Math.min(Math.max(1, Math.ceil(rows / 2) + (this._config?.title ? 1 : 0)), 10);
  }

  public getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 'auto' as const };
  }

  public static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement(CARD_EDITOR_NAME);
  }

  public static getStubConfig(hass?: HomeAssistant): ListCardConfig {
    // Prefer an entity that actually carries a list attribute (e.g. a feedparser sensor).
    let entity = '';
    let feedAttribute: string | undefined;
    for (const [entityId, state] of Object.entries(hass?.states ?? {})) {
      const listAttribute = Object.entries(state?.attributes ?? {}).find(
        ([, value]) => Array.isArray(value) && value.length > 0 && typeof value[0] === 'object',
      );
      if (listAttribute) {
        entity = entityId;
        feedAttribute = listAttribute[0];
        break;
      }
    }

    return {
      type: `custom:${CARD_NAME}`,
      entity,
      title: 'List Card',
      ...(feedAttribute ? { feed_attribute: feedAttribute } : {}),
      columns: [{ title: 'Title', field: 'title' }],
    };
  }

  static styles = css`
    :host {
      display: block;
    }

    .grid-container {
      display: grid;
      gap: 8px;
      padding: 16px;
      overflow-y: auto;
    }

    .grid-row {
      display: grid;
      grid-template-columns: repeat(var(--list-card-columns, 1), minmax(0, 1fr));
      gap: 8px;
      align-items: center;
    }

    .grid-header {
      font-weight: bold;
      text-align: center;
    }

    .grid-cell {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      user-select: text;
      -webkit-user-select: text;
    }

    .grid-cell.full-width {
      grid-column: 1 / -1;
      white-space: normal;
    }

    .actionable {
      cursor: pointer;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    img {
      max-width: 100%;
      object-fit: contain;
    }

    .pager {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 0 16px 12px;
    }

    .pager-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--primary-text-color);
      cursor: pointer;
      padding: 4px;
      border-radius: 50%;
    }

    .pager-button:hover {
      background: var(--secondary-background-color);
    }

    .pager-label {
      color: var(--secondary-text-color);
      font-size: 0.9em;
    }

    .warning {
      padding: 16px;
      color: var(--primary-text-color);
      background: rgba(var(--rgb-warning-color, 255, 166, 0), 0.15);
      border-left: 4px solid var(--warning-color, #ffa600);
      word-break: break-word;
    }

    .empty {
      padding: 16px;
      color: var(--secondary-text-color);
    }
  `;
}

declare global {
  interface Window {
    customCards?: Array<{
      type: string;
      name: string;
      preview: boolean;
      description: string;
      documentationURL?: string;
    }>;
  }
}

console.info(
  `%clist-card\n%cVersion: ${CARD_VERSION}`,
  'color: #EED202; font-weight: bold; background-color: black;',
  '',
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_NAME,
  name: 'List Card',
  preview: true,
  description: CARD_DESCRIPTION,
  documentationURL: 'https://github.com/iantrich/list-card',
});
