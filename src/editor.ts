import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { type HomeAssistant, type ActionConfig, fireEvent, type LovelaceCardEditor } from 'custom-card-helpers';

import type { ColumnConfig, ListCardConfig } from './types';
import { CARD_EDITOR_NAME } from './const';

/* ─── ha-form schema type (subset used by HA's <ha-form>) ─── */
interface HaFormSchema {
  name: string;
  type?: string;
  selector?: Record<string, unknown>;
  schema?: readonly HaFormSchema[];
  required?: boolean;
  default?: unknown;
  flatten?: boolean;
  iconPath?: string;
  column_min_width?: string;
  context?: Record<string, string>;
}

/* ─── General config schema (rendered by <ha-form>) ────────── */
const GENERAL_SCHEMA: readonly HaFormSchema[] = [
  { name: 'entity', required: true, selector: { entity: {} } },
  { name: 'title', selector: { text: {} } },
  { name: 'feed_attribute', selector: { text: {} } },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'row_limit', selector: { number: { min: 0, mode: 'box' } } },
      { name: 'card_height', selector: { text: {} } },
    ],
  },
  { name: 'show_header', selector: { boolean: {} } },
] as const;

/* ─── Sort sub-schema (rendered by <ha-form>) ──────────────── */
const SORT_SCHEMA: readonly HaFormSchema[] = [
  { name: 'value', required: true, selector: { text: {} } },
  { name: 'reverse', selector: { boolean: {} } },
] as const;

/* ────────────────────────────────────────────────────────────── */

@customElement(CARD_EDITOR_NAME)
export class ListCardEditor extends LitElement implements LovelaceCardEditor {
  /* ── HA bridge ────────────────────────────────────────────── */

  private _hass?: HomeAssistant;

  @property({ attribute: false })
  public set hass(value: HomeAssistant | undefined) {
    const oldValue = this._hass;
    this._hass = value;
    this.requestUpdate('hass', oldValue);
  }

  public get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  /* ── State ────────────────────────────────────────────────── */

  @state() private _config?: ListCardConfig;
  @state() private _openSection = 'general';
  @state() private _columnOpenByIndex: Record<number, boolean> = {};
  @state() private _advancedOpenByColumn: Record<number, boolean> = {};

  /* ── Lifecycle ────────────────────────────────────────────── */

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
    this._config = structuredClone(config);
    this.requestUpdate();
  }

  protected shouldUpdate(): boolean {
    return true;
  }

  /* ── Render ───────────────────────────────────────────────── */

  protected render(): TemplateResult | void {
    if (!this.hass || !this._config) {
      return html`<div>Loading…</div>`;
    }

    const generalData = {
      show_header: true,
      ...this._config,
    };

    return html`
      <div class="editor">
        ${this._renderSection(
          'general',
          'General',
          html`
            <ha-form
              .hass=${this.hass}
              .data=${generalData}
              .schema=${GENERAL_SCHEMA}
              .computeLabel=${this._computeGeneralLabel}
              @value-changed=${this._onGeneralChanged}
            ></ha-form>
          `,
        )}
        ${this._renderSection('columns', 'Columns', this._renderColumnsSection())}
        ${this._renderSection('sort', 'Sort', this._renderSortSection())}
      </div>
    `;
  }

  /* ── Section accordion (boilerplate-card pattern) ────────── */

  private _toggleSection(ev: Event, id: string): void {
    ev.stopPropagation();
    this._openSection = this._openSection === id ? '' : id;
    this.requestUpdate();
  }

  private _renderSection(id: string, title: string, content: TemplateResult): TemplateResult {
    const isOpen = this._openSection === id;
    return html`
      <div class="accordion ${isOpen ? 'accordion--open' : ''}">
        <button
          type="button"
          class="accordion__header"
          @click=${(ev: Event) => this._toggleSection(ev, id)}
          aria-expanded=${isOpen}
        >
          <span>${title}</span>
          <ha-icon icon=${isOpen ? 'mdi:chevron-up' : 'mdi:chevron-down'}></ha-icon>
        </button>
        <div class="accordion__body">
          <div class="accordion__content">${content}</div>
        </div>
      </div>
    `;
  }

  /* ── General section callback ─────────────────────────────── */

  private _onGeneralChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    if (!this._config) return;
    const updated = ev.detail.value as Record<string, unknown>;

    // Merge form values back but preserve columns & sort
    const config: ListCardConfig = {
      ...this._config,
      entity: (updated.entity as string) ?? this._config.entity,
    };

    // Handle optional string fields
    for (const key of ['title', 'feed_attribute', 'card_height'] as const) {
      const val = updated[key] as string | undefined;
      if (val && val.trim() !== '') {
        (config as unknown as Record<string, unknown>)[key] = val;
      } else {
        delete (config as unknown as Record<string, unknown>)[key];
      }
    }

    // Handle row_limit (number)
    const rl = updated.row_limit;
    if (rl !== undefined && rl !== null && rl !== '') {
      config.row_limit = Number(rl);
    } else {
      delete config.row_limit;
    }

    // Handle boolean
    config.show_header = updated.show_header !== false;

    this._updateConfig(config);
  };

  private _computeGeneralLabel = (schema: HaFormSchema): string => {
    const labels: Record<string, string> = {
      entity: 'Entity',
      title: 'Title',
      feed_attribute: 'Feed Attribute',
      row_limit: 'Row Limit',
      card_height: 'Card Height',
      show_header: 'Show Header',
    };
    return labels[schema.name] ?? schema.name;
  };

  /* ── Sort section ─────────────────────────────────────────── */

  private _renderSortSection(): TemplateResult {
    const sortEnabled = !!this._config?.sort;

    return html`
      <ha-formfield label="Enable Sort">
        <ha-switch .checked=${sortEnabled} @change=${this._onSortToggle}></ha-switch>
      </ha-formfield>

      ${sortEnabled
        ? html`
            <ha-form
              .hass=${this.hass}
              .data=${this._config?.sort ?? { value: '', reverse: false }}
              .schema=${SORT_SCHEMA}
              .computeLabel=${this._computeSortLabel}
              @value-changed=${this._onSortChanged}
            ></ha-form>
          `
        : nothing}
    `;
  }

  private _onSortToggle = (ev: Event): void => {
    if (!this._config) return;
    const checked = (ev.target as HTMLInputElement).checked;
    const config = { ...this._config };
    if (checked) {
      config.sort = { value: '', reverse: false };
    } else {
      delete config.sort;
    }
    this._updateConfig(config);
  };

  private _onSortChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    if (!this._config) return;
    this._updateConfig({
      ...this._config,
      sort: ev.detail.value,
    });
  };

  private _computeSortLabel = (schema: HaFormSchema): string => {
    const labels: Record<string, string> = {
      value: 'Sort Field',
      reverse: 'Reverse',
    };
    return labels[schema.name] ?? schema.name;
  };

  /* ── Columns section ──────────────────────────────────────── */

  private _renderColumnsSection(): TemplateResult {
    const columns = this._config?.columns ?? [];

    return html`
      <div class="columns-header">
        <span>Configured: ${columns.length}</span>
        <button type="button" class="btn btn--primary" @click=${this._onAddColumn}>+ Add Column</button>
      </div>
      ${columns.length === 0
        ? html`<div class="helper">No columns configured.</div>`
        : columns.map((col, i) => this._renderColumnAccordion(col, i))}
    `;
  }

  private _renderColumnAccordion(column: ColumnConfig, index: number): TemplateResult {
    const label = column.title || column.field || `Column ${index + 1}`;
    const isOpen = this._columnOpenByIndex[index] ?? index === 0;
    const advOpen = this._advancedOpenByColumn[index] ?? false;

    return html`
      <div class="accordion ${isOpen ? 'accordion--open' : ''} accordion--nested">
        <button
          type="button"
          class="accordion__header accordion__header--column"
          data-index=${String(index)}
          @click=${this._handleColumnToggle}
        >
          <span>${label}</span>
          <ha-icon icon=${isOpen ? 'mdi:chevron-up' : 'mdi:chevron-down'}></ha-icon>
        </button>
        <div class="accordion__body">
          <div class="accordion__content">
            <div class="column-grid">
              <ha-textfield
                label="Title"
                .value=${column.title ?? ''}
                data-index=${String(index)}
                data-field="title"
                @input=${this._onColumnInput}
              ></ha-textfield>

              <ha-textfield
                label="Field"
                .value=${column.field ?? ''}
                data-index=${String(index)}
                data-field="field"
                @input=${this._onColumnInput}
              ></ha-textfield>

              <ha-textfield
                label="Link Field"
                .value=${column.add_link ?? ''}
                data-index=${String(index)}
                data-field="add_link"
                @input=${this._onColumnInput}
              ></ha-textfield>

              <ha-selector
                .hass=${this.hass}
                .selector=${{
                  select: {
                    options: [
                      { value: '', label: 'Text (default)' },
                      { value: 'image', label: 'Image' },
                      { value: 'icon', label: 'Icon' },
                    ],
                    mode: 'dropdown',
                  },
                }}
                .value=${column.type ?? ''}
                label="Type"
                data-index=${String(index)}
                data-field="type"
                @value-changed=${this._onColumnSelectorChanged}
              ></ha-selector>

              <ha-textfield
                label="Width"
                .value=${column.width?.toString() ?? ''}
                data-index=${String(index)}
                data-field="width"
                @input=${this._onColumnInput}
              ></ha-textfield>

              <ha-textfield
                label="Height"
                .value=${column.height?.toString() ?? ''}
                data-index=${String(index)}
                data-field="height"
                @input=${this._onColumnInput}
              ></ha-textfield>

              <ha-textfield
                label="Regex"
                .value=${column.regex ?? ''}
                data-index=${String(index)}
                data-field="regex"
                @input=${this._onColumnInput}
              ></ha-textfield>

              <ha-textfield
                label="Prefix"
                .value=${column.prefix ?? ''}
                data-index=${String(index)}
                data-field="prefix"
                @input=${this._onColumnInput}
              ></ha-textfield>

              <ha-textfield
                label="Postfix"
                .value=${column.postfix ?? ''}
                data-index=${String(index)}
                data-field="postfix"
                @input=${this._onColumnInput}
              ></ha-textfield>
            </div>

            <!-- Advanced sub-accordion for style + actions -->
            <div class="accordion ${advOpen ? 'accordion--open' : ''} accordion--nested">
              <button
                type="button"
                class="accordion__header accordion__header--sub"
                data-index=${String(index)}
                @click=${this._handleAdvancedToggle}
              >
                <span>Style &amp; Actions</span>
                <ha-icon icon=${advOpen ? 'mdi:chevron-up' : 'mdi:chevron-down'}></ha-icon>
              </button>
              <div class="accordion__body">
                <div class="accordion__content">
                  ${this._renderColumnStyleEditor(column, index)}

                  <ha-selector
                    .hass=${this.hass}
                    .selector=${{ ui_action: {} }}
                    .value=${column.tap_action}
                    label="Tap Action"
                    data-index=${String(index)}
                    data-field="tap_action"
                    @value-changed=${this._onColumnActionChanged}
                  ></ha-selector>

                  <ha-selector
                    .hass=${this.hass}
                    .selector=${{ ui_action: {} }}
                    .value=${column.hold_action}
                    label="Hold Action"
                    data-index=${String(index)}
                    data-field="hold_action"
                    @value-changed=${this._onColumnActionChanged}
                  ></ha-selector>

                  <ha-selector
                    .hass=${this.hass}
                    .selector=${{ ui_action: {} }}
                    .value=${column.double_tap_action}
                    label="Double Tap Action"
                    data-index=${String(index)}
                    data-field="double_tap_action"
                    @value-changed=${this._onColumnActionChanged}
                  ></ha-selector>
                </div>
              </div>
            </div>

            <div class="column-footer">
              <button type="button" class="btn btn--danger" data-index=${String(index)} @click=${this._onRemoveColumn}>
                Remove Column
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ── Style key/value editor ───────────────────────────────── */

  private _renderColumnStyleEditor(column: ColumnConfig, index: number): TemplateResult {
    const styles = column.style ?? [];
    return html`
      <div class="style-editor">
        <div class="style-editor__header">
          <span class="style-editor__label">CSS Styles</span>
          <button type="button" class="btn btn--small" data-index=${String(index)} @click=${this._onAddStyle}>
            + Add
          </button>
        </div>
        ${styles.map((entry, si) => {
          const key = Object.keys(entry)[0] ?? '';
          const val = entry[key] ?? '';
          return html`
            <div class="style-row">
              <ha-textfield
                label="Property"
                .value=${key}
                data-col=${String(index)}
                data-si=${String(si)}
                data-role="prop"
                @input=${this._onStyleInput}
              ></ha-textfield>
              <ha-textfield
                label="Value"
                .value=${val}
                data-col=${String(index)}
                data-si=${String(si)}
                data-role="val"
                @input=${this._onStyleInput}
              ></ha-textfield>
              <button
                type="button"
                class="btn btn--icon btn--danger"
                data-col=${String(index)}
                data-si=${String(si)}
                @click=${this._onRemoveStyle}
              >
                ✕
              </button>
            </div>
          `;
        })}
      </div>
    `;
  }

  /* ── Column toggle helpers ────────────────────────────────── */

  private _handleColumnToggle = (ev: Event): void => {
    ev.stopPropagation();
    ev.preventDefault();
    const btn = ev.currentTarget as HTMLElement;
    const index = Number(btn.dataset.index);
    if (Number.isNaN(index)) return;
    this._columnOpenByIndex = {
      ...this._columnOpenByIndex,
      [index]: !(this._columnOpenByIndex[index] ?? index === 0),
    };
    this.requestUpdate();
  };

  private _handleAdvancedToggle = (ev: Event): void => {
    ev.stopPropagation();
    ev.preventDefault();
    const btn = ev.currentTarget as HTMLElement;
    const index = Number(btn.dataset.index);
    if (Number.isNaN(index)) return;
    this._advancedOpenByColumn = {
      ...this._advancedOpenByColumn,
      [index]: !(this._advancedOpenByColumn[index] ?? false),
    };
    this.requestUpdate();
  };

  /* ── Column field handlers ────────────────────────────────── */

  private _onColumnInput = (ev: Event): void => {
    if (!this._config) return;
    const el = ev.currentTarget as HTMLInputElement & { dataset: DOMStringMap };
    const index = Number.parseInt(el.dataset.index ?? '', 10);
    const field = el.dataset.field;
    if (Number.isNaN(index) || !field) return;

    const columns = [...(this._config.columns ?? [])];
    const col: ColumnConfig = { ...columns[index] };
    const value = el.value?.trim() ?? '';

    if (field === 'width' || field === 'height') {
      if (value === '') {
        delete col[field];
      } else if (/^\d+$/.test(value)) {
        col[field] = Number.parseInt(value, 10);
      } else {
        col[field] = value;
      }
    } else if (field === 'title' || field === 'field') {
      col[field] = value;
    } else {
      if (value === '') {
        delete (col as unknown as Record<string, unknown>)[field];
      } else {
        (col as unknown as Record<string, unknown>)[field] = value;
      }
    }

    columns[index] = col;
    this._updateConfig({ ...this._config, columns });
  };

  private _onColumnSelectorChanged = (ev: CustomEvent): void => {
    if (!this._config) return;
    const el = ev.target as HTMLElement & { dataset: DOMStringMap };
    const index = Number.parseInt(el.dataset.index ?? '', 10);
    const field = el.dataset.field;
    if (Number.isNaN(index) || !field) return;

    const columns = [...(this._config.columns ?? [])];
    const col: ColumnConfig = { ...columns[index] };
    const value = ev.detail.value;
    if (!value || value === '') {
      delete (col as unknown as Record<string, unknown>)[field];
    } else {
      (col as unknown as Record<string, unknown>)[field] = value;
    }
    columns[index] = col;
    this._updateConfig({ ...this._config, columns });
  };

  private _onColumnActionChanged = (ev: CustomEvent): void => {
    if (!this._config) return;
    const el = ev.target as HTMLElement & { dataset: DOMStringMap };
    const index = Number.parseInt(el.dataset.index ?? '', 10);
    const field = el.dataset.field as 'tap_action' | 'hold_action' | 'double_tap_action' | undefined;
    if (Number.isNaN(index) || !field) return;

    const columns = [...(this._config.columns ?? [])];
    const col: ColumnConfig = { ...columns[index] };
    const action = ev.detail.value as ActionConfig | undefined;

    if (action?.action) {
      col[field] = action;
    } else {
      delete col[field];
    }

    columns[index] = col;
    this._updateConfig({ ...this._config, columns });
  };

  /* ── Style editor handlers ────────────────────────────────── */

  private _onAddStyle = (ev: Event): void => {
    if (!this._config) return;
    const el = ev.currentTarget as HTMLElement & { dataset: DOMStringMap };
    const index = Number.parseInt(el.dataset.index ?? '', 10);
    if (Number.isNaN(index)) return;

    const columns = [...(this._config.columns ?? [])];
    const col: ColumnConfig = { ...columns[index] };
    col.style = [...(col.style ?? []), { '': '' }];
    columns[index] = col;
    this._updateConfig({ ...this._config, columns });
  };

  private _onRemoveStyle = (ev: Event): void => {
    if (!this._config) return;
    const el = ev.currentTarget as HTMLElement & { dataset: DOMStringMap };
    const colIndex = Number.parseInt(el.dataset.col ?? '', 10);
    const styleIndex = Number.parseInt(el.dataset.si ?? '', 10);
    if (Number.isNaN(colIndex) || Number.isNaN(styleIndex)) return;

    const columns = [...(this._config.columns ?? [])];
    const col: ColumnConfig = { ...columns[colIndex] };
    const styles = [...(col.style ?? [])];
    styles.splice(styleIndex, 1);
    col.style = styles.length > 0 ? styles : undefined;
    if (!col.style) delete col.style;
    columns[colIndex] = col;
    this._updateConfig({ ...this._config, columns });
  };

  private _onStyleInput = (ev: Event): void => {
    if (!this._config) return;
    const el = ev.currentTarget as HTMLInputElement & { dataset: DOMStringMap };
    const colIndex = Number.parseInt(el.dataset.col ?? '', 10);
    const styleIndex = Number.parseInt(el.dataset.si ?? '', 10);
    const role = el.dataset.role as 'prop' | 'val';
    if (Number.isNaN(colIndex) || Number.isNaN(styleIndex)) return;

    const columns = [...(this._config.columns ?? [])];
    const col: ColumnConfig = { ...columns[colIndex] };
    const styles = [...(col.style ?? [])];
    const entry = { ...styles[styleIndex] };

    if (role === 'prop') {
      const oldKey = Object.keys(entry)[0] ?? '';
      const oldVal = entry[oldKey] ?? '';
      const newKey = el.value?.trim() ?? '';
      styles[styleIndex] = { [newKey]: oldVal };
    } else {
      const key = Object.keys(entry)[0] ?? '';
      entry[key] = el.value ?? '';
      styles[styleIndex] = entry;
    }

    col.style = styles;
    columns[colIndex] = col;
    this._updateConfig({ ...this._config, columns });
  };

  /* ── Add / remove columns ─────────────────────────────────── */

  private _onAddColumn = (): void => {
    if (!this._config) return;
    const columns = [...(this._config.columns ?? [])];
    columns.push({ title: '', field: '' });
    const newIndex = columns.length - 1;
    this._columnOpenByIndex = { ...this._columnOpenByIndex, [newIndex]: true };
    this._updateConfig({ ...this._config, columns });
  };

  private _onRemoveColumn = (ev: Event): void => {
    if (!this._config) return;
    const el = ev.currentTarget as HTMLElement & { dataset: DOMStringMap };
    const index = Number.parseInt(el.dataset.index ?? '', 10);
    if (Number.isNaN(index)) return;

    const columns = [...(this._config.columns ?? [])];
    columns.splice(index, 1);

    // Re-index open states
    const nextCol: Record<number, boolean> = {};
    const nextAdv: Record<number, boolean> = {};
    for (const [k, v] of Object.entries(this._columnOpenByIndex)) {
      const i = Number(k);
      if (i === index) continue;
      nextCol[i > index ? i - 1 : i] = v;
    }
    for (const [k, v] of Object.entries(this._advancedOpenByColumn)) {
      const i = Number(k);
      if (i === index) continue;
      nextAdv[i > index ? i - 1 : i] = v;
    }
    this._columnOpenByIndex = nextCol;
    this._advancedOpenByColumn = nextAdv;
    this._updateConfig({ ...this._config, columns });
  };

  /* ── Config dispatch ──────────────────────────────────────── */

  private _updateConfig(config: ListCardConfig): void {
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  /* ── Styles ───────────────────────────────────────────────── */

  static styles = css`
    .editor {
      padding: 8px 0;
    }

    /* ── Controls inside sections ── */
    ha-textfield,
    ha-selector,
    ha-formfield,
    ha-form {
      margin-bottom: 16px;
      display: block;
    }
    ha-formfield {
      padding: 8px 0;
    }

    /* ── Accordion ── */
    .accordion {
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      margin-bottom: 8px;
      overflow: hidden;
    }
    .accordion--nested {
      margin-bottom: 4px;
    }
    .accordion__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 12px 16px;
      background: var(--secondary-background-color);
      border: none;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: var(--primary-text-color);
      text-align: left;
      transition: background 0.15s ease;
    }
    .accordion__header:hover {
      background: var(--divider-color);
    }
    .accordion--open > .accordion__header {
      border-bottom: 1px solid var(--divider-color);
    }
    .accordion__header--column {
      font-size: 13px;
      padding: 10px 14px;
    }
    .accordion__header--sub {
      font-size: 12px;
      padding: 8px 12px;
      background: var(--card-background-color, var(--secondary-background-color));
    }

    /* Collapse / expand with grid transition */
    .accordion__body {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.25s ease;
    }
    .accordion--open > .accordion__body {
      grid-template-rows: 1fr;
    }
    .accordion__content {
      overflow: hidden;
      padding: 0 16px;
    }
    .accordion--open > .accordion__body > .accordion__content {
      padding: 16px;
    }

    /* ── Column grid ── */
    .column-grid {
      display: grid;
      gap: 0;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .column-grid > ha-textfield,
    .column-grid > ha-selector {
      margin-bottom: 12px;
    }
    .column-grid > ha-textfield:nth-child(odd) {
      padding-right: 6px;
    }
    .column-grid > ha-textfield:nth-child(even),
    .column-grid > ha-selector {
      padding-left: 6px;
    }

    /* ── Columns header / footer ── */
    .columns-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .column-footer {
      display: flex;
      justify-content: flex-end;
      padding-top: 8px;
    }

    /* ── Style editor ── */
    .style-editor {
      margin-bottom: 16px;
    }
    .style-editor__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .style-editor__label {
      font-size: 13px;
      font-weight: 500;
      color: var(--primary-text-color);
    }
    .style-row {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 8px;
      align-items: end;
      margin-bottom: 8px;
    }
    .style-row ha-textfield {
      margin-bottom: 0;
    }

    /* ── Buttons ── */
    .btn {
      border: 1px solid var(--divider-color);
      border-radius: 6px;
      min-height: 34px;
      padding: 0 12px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      cursor: pointer;
      font-size: 13px;
    }
    .btn--primary {
      border-color: var(--primary-color);
      color: var(--primary-color);
    }
    .btn--danger {
      border-color: var(--error-color);
      color: var(--error-color);
    }
    .btn--small {
      min-height: 28px;
      padding: 0 8px;
      font-size: 12px;
    }
    .btn--icon {
      min-height: 28px;
      padding: 0 6px;
      line-height: 1;
    }

    /* ── Helpers ── */
    .helper {
      color: var(--secondary-text-color);
      font-size: 0.9rem;
      margin-bottom: 8px;
    }
  `;
}
