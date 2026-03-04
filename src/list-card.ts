import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import './editor';
import { CARD_DESCRIPTION, CARD_EDITOR_NAME, CARD_NAME, CARD_VERSION } from './const';
import type { ActionConfig, ColumnConfig, FeedRow, HomeAssistant, ListCardConfig } from './types';

const FILE_LIST_COLUMNS: ColumnConfig[] = [
  { title: 'Path', field: 'path' },
  { title: 'Name', field: 'name' },
  { title: 'Filename', field: 'filename' },
  { title: 'Full Path', field: 'fullpath', add_link: 'fullpath' },
  { title: 'Ext', field: 'ext' },
];

@customElement(CARD_NAME)
export class ListCard extends LitElement {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @state()
  private _config?: ListCardConfig;

  private _holdTimer?: ReturnType<typeof setTimeout>;

  protected createRenderRoot(): ShadowRoot {
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
    if (!config.entity) {
      throw new Error('Please define an entity');
    }

    const normalizedConfig: ListCardConfig = {
      ...config,
      columns:
        config.feed_attribute === 'file_list' && (!config.columns || config.columns.length === 0)
          ? FILE_LIST_COLUMNS
          : config.columns,
    };

    this._config = normalizedConfig;
  }

  protected render() {
    if (!this.hass || !this._config) {
      this.style.display = 'none';
      return nothing;
    }

    const state = this.hass.states[this._config.entity];
    if (!state) {
      this.style.display = 'none';
      return nothing;
    }

    const feed = this._getFeedRows(state.attributes);
    const rows = this._getLimitedRows(feed);
    const columns = this._config.columns ?? [];

    if (rows.length === 0 || columns.length === 0) {
      this.style.display = 'none';
      return nothing;
    }

    this.style.display = 'block';

    return html`
      <ha-card .header=${this._config.title ?? ''}>
        <div class="grid-container" style=${styleMap({ maxHeight: this._resolveCardHeight() })}>
          ${this._config.show_header !== false
            ? html`
                <div class="grid-row">
                  ${columns.map(
                    (column) => html`<div class="grid-cell grid-header ${column.field}">${column.title}</div>`,
                  )}
                </div>
              `
            : nothing}
          ${rows.map((row) => this._renderRow(row, columns))}
        </div>
      </ha-card>
    `;
  }

  private _renderRow(row: FeedRow, columns: ColumnConfig[]): TemplateResult {
    return html` <div class="grid-row">${columns.map((column) => this._renderCell(row, column))}</div> `;
  }

  private _renderCell(row: FeedRow, column: ColumnConfig): TemplateResult {
    const tapAction = column.tap_action;
    const holdAction = column.hold_action;
    const doubleTapAction = column.double_tap_action;
    const hasAction = Boolean(tapAction || holdAction || doubleTapAction);

    const cellContent = this._renderCellContent(row, column);
    const className = `grid-cell ${column.field}${hasAction ? ' actionable' : ''}`;

    return html`
      <div
        class=${className}
        style=${styleMap(this._columnStyleObject(column))}
        @click=${() => tapAction && this._handleAction(tapAction, row)}
        @dblclick=${() => doubleTapAction && this._handleAction(doubleTapAction, row)}
        @touchstart=${() => this._startHold(holdAction, row)}
        @touchend=${this._clearHold}
        @touchcancel=${this._clearHold}
      >
        ${cellContent}
      </div>
    `;
  }

  private _renderCellContent(row: FeedRow, column: ColumnConfig): TemplateResult {
    const rawValue = row[column.field];

    if (column.type === 'image') {
      const url = this._resolveImageUrl(rawValue);
      const width = column.width ?? 70;
      const height = column.height ?? 90;
      const image = html`<img src=${String(url ?? '')} width=${String(width)} height=${String(height)} />`;
      return this._wrapLinkIfNeeded(column, row, image);
    }

    if (column.type === 'icon') {
      const icon = html`<ha-icon .icon=${String(rawValue ?? '')}></ha-icon>`;
      return this._wrapLinkIfNeeded(column, row, icon);
    }

    let value = this._stringifyValue(rawValue);

    if (column.regex) {
      const match = new RegExp(column.regex, 'u').exec(value);
      value = match ? String(match[0]) : '';
    }

    if (column.prefix) {
      value = `${column.prefix}${value}`;
    }

    if (column.postfix) {
      value = `${value}${column.postfix}`;
    }

    const text = html`<span>${value}</span>`;
    return this._wrapLinkIfNeeded(column, row, text);
  }

  private _wrapLinkIfNeeded(column: ColumnConfig, row: FeedRow, content: TemplateResult): TemplateResult {
    if (!column.add_link) {
      return content;
    }

    const href = this._stringifyValue(row[column.add_link]).replace('config/www', 'local');
    return html`<a href=${href} target="_blank" rel="noreferrer noopener">${content}</a>`;
  }

  private _getFeedRows(attributes: Record<string, unknown>): FeedRow[] {
    if (!this._config) {
      return [];
    }

    const source = this._config.feed_attribute ? attributes[this._config.feed_attribute] : (attributes as unknown);

    if (!source) {
      return [];
    }

    if (this._config.feed_attribute === 'file_list') {
      if (!Array.isArray(source)) {
        return [];
      }

      const files = source.filter((value): value is string => typeof value === 'string');
      return this._transformFeed(files);
    }

    const rows = Array.isArray(source)
      ? source
      : typeof source === 'object' && source !== null
        ? Object.values(source)
        : [];

    const normalizedRows = rows.filter((row): row is FeedRow => typeof row === 'object' && row !== null);

    return normalizedRows;
  }

  private _transformFeed(oldFeed: string[]): FeedRow[] {
    return oldFeed.map((file) => {
      const path = file.substring(0, file.lastIndexOf('/') + 1);
      const filenameParts = file.split('/').pop()?.split('.') ?? [''];
      const filename = filenameParts[0];
      const extension = filenameParts[filenameParts.length - 1];
      const filenameWithExt = `${filename}.${extension}`;

      const filenameFormat = /^\d{14}$/;
      if (filenameFormat.test(filename)) {
        const fileDate = new Date(
          `${filename.slice(0, 4)}-${filename.slice(4, 6)}-${filename.slice(6, 8)}T${filename.slice(8, 10)}:${filename.slice(10, 12)}:${filename.slice(12)}`,
        );

        return {
          path,
          name: fileDate.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true,
          }),
          filename: filenameWithExt,
          fullpath: `${path}${filenameWithExt}`,
          ext: extension,
        };
      }

      return {
        path,
        name: filename,
        filename: filenameWithExt,
        fullpath: `${path}${filenameWithExt}`,
        ext: extension,
      };
    });
  }

  private _getLimitedRows(feed: FeedRow[]): FeedRow[] {
    if (!this._config) {
      return [];
    }

    const sortedFeed = this._sortFeed(feed);
    const columns = this._config.columns ?? [];

    const rowsWithColumns = sortedFeed.filter((row) =>
      columns.some((column) => Object.prototype.hasOwnProperty.call(row, column.field)),
    );

    const rowLimit = this._config.row_limit ?? rowsWithColumns.length;
    return rowsWithColumns.slice(0, rowLimit);
  }

  private _sortFeed(feed: FeedRow[]): FeedRow[] {
    if (!this._config?.sort) {
      return [...feed];
    }

    const sortField = this._config.sort.value;
    if (!sortField) {
      throw new Error('You need to specify a value to sort on');
    }

    const isReverse = this._config.sort.reverse ?? false;
    return [...feed].sort((first, second) => {
      const valueA = first[sortField];
      const valueB = second[sortField];

      if (valueA === valueB) {
        return 0;
      }

      if (valueA === undefined || valueA === null) {
        return isReverse ? 1 : -1;
      }

      if (valueB === undefined || valueB === null) {
        return isReverse ? -1 : 1;
      }

      const result = String(valueA).localeCompare(String(valueB), undefined, { numeric: true });
      return isReverse ? -result : result;
    });
  }

  private _startHold(action: ActionConfig | undefined, row: FeedRow): void {
    if (!action) {
      return;
    }

    this._clearHold();
    this._holdTimer = setTimeout(() => {
      this._handleAction(action, row);
    }, 500);
  }

  private _clearHold = (): void => {
    if (this._holdTimer) {
      clearTimeout(this._holdTimer);
      this._holdTimer = undefined;
    }
  };

  private _handleAction(action: ActionConfig, row: FeedRow): void {
    if (!action?.action) {
      console.warn('Invalid action object:', action);
      return;
    }

    const replacedAction = this._replacePlaceholdersInAction(structuredClone(action) as ActionConfig, row);

    switch (replacedAction.action) {
      case 'call-service':
      case 'navigate':
      case 'fire-dom-event': {
        const event = new Event('hass-action', {
          bubbles: true,
          composed: true,
        }) as Event & {
          detail: {
            config: { tap_action: ActionConfig };
            action: 'tap';
          };
        };

        event.detail = {
          config: { tap_action: replacedAction },
          action: 'tap',
        };
        this.dispatchEvent(event);
        break;
      }
      default:
        console.warn('Unsupported action type:', replacedAction.action);
    }
  }

  private _replacePlaceholdersInAction(action: ActionConfig, row: FeedRow): ActionConfig {
    const traverse = (value: unknown): unknown => {
      if (typeof value === 'string') {
        let replaced = value;
        const placeholders = replaced.match(/\[\[(.*?)\]\]/g);

        if (!placeholders) {
          return replaced;
        }

        placeholders.forEach((placeholder) => {
          const field = placeholder.substring(2, placeholder.length - 2);
          if (!Object.prototype.hasOwnProperty.call(row, field)) {
            throw new Error(`Invalid field '${field}' specified in action: ${JSON.stringify(action)}`);
          }

          replaced = replaced.replace(placeholder, this._stringifyValue(row[field]));
        });

        return replaced;
      }

      if (Array.isArray(value)) {
        return value.map((entry) => traverse(entry));
      }

      if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        Object.entries(value).forEach(([key, entry]) => {
          result[key] = traverse(entry);
        });
        return result;
      }

      return value;
    };

    return traverse(action) as ActionConfig;
  }

  private _resolveImageUrl(value: unknown): string {
    if (Array.isArray(value)) {
      const first = value[0];
      if (first && typeof first === 'object' && 'url' in first) {
        return String((first as { url: unknown }).url ?? '');
      }
      return '';
    }

    return this._stringifyValue(value);
  }

  private _columnStyleObject(column: ColumnConfig): Record<string, string> {
    const styleMapObject: Record<string, string> = {};
    (column.style ?? []).forEach((styleEntry) => {
      Object.entries(styleEntry).forEach(([key, value]) => {
        styleMapObject[key] = value;
      });
    });

    return styleMapObject;
  }

  private _resolveCardHeight(): string {
    const value = this._config?.card_height;
    if (value === undefined || value === null || value === '') {
      return '300px';
    }

    if (typeof value === 'number') {
      return `${value}px`;
    }

    if (/^\d+$/.test(value.trim())) {
      return `${value.trim()}px`;
    }

    return value;
  }

  private _stringifyValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    return typeof value === 'string' ? value : String(value);
  }

  public getCardSize(): number {
    return 1;
  }

  public static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement(CARD_EDITOR_NAME);
  }

  public static getStubConfig(): ListCardConfig {
    return {
      type: `custom:${CARD_NAME}`,
      entity: '',
      title: 'List Card',
      show_header: true,
      columns: [],
      card_height: '300px',
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
      grid-template-columns: repeat(var(--list-card-columns, 1), minmax(100px, 1fr));
      gap: 8px;
    }

    .grid-header {
      font-weight: bold;
      text-align: center;
    }

    .grid-cell {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      user-select: text;
      -webkit-user-select: text;
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
  `;

  protected updated(): void {
    const columns = this._config?.columns?.length ?? 1;
    this.style.setProperty('--list-card-columns', String(columns));
  }
}

declare global {
  interface Window {
    customCards?: Array<{
      type: string;
      name: string;
      preview: boolean;
      description: string;
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
  preview: false,
  description: CARD_DESCRIPTION,
});
