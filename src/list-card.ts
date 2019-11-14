import { html, LitElement, TemplateResult, customElement, property, CSSResult, css } from 'lit-element';
import { HomeAssistant, applyThemesOnElement } from 'custom-card-helpers';

import { ListCardConfig, DataTableColumnContainer } from './types';
import { CARD_VERSION } from './const';

/* eslint no-console: 0 */
console.info(
  `%c  LIST-CARD     \n%c  Version ${CARD_VERSION} `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

export function load_table() {
  if (customElements.get('ha-data-table')) return true;

  const res: any = document.createElement('partial-panel-resolver');
  res.hass = (document.querySelector('home-assistant') as any).hass;
  res.route = { path: '/lovelace/hass-unused-entities' };
  res._updateRoutes();
  try {
    document.querySelector('home-assistant')!.appendChild(res);
  } catch (error) {
  } finally {
    document.querySelector('home-assistant')!.removeChild(res);
  }
  if (customElements.get('ha-data-table')) return true;
  return false;
}

@customElement('list-card')
export class ListCard extends LitElement {
  @property() public hass?: HomeAssistant;
  @property() private _config?: ListCardConfig;

  constructor() {
    super();
    window.setTimeout(load_table, 500);
  }

  public getCardSize(): number {
    return 7;
  }

  public setConfig(config: ListCardConfig): void {
    if (!config.entity) {
      console.log('Invalid configuration. Entity is required.');
      return;
    }

    if (!config.columns) {
      console.log('Invalid configuration. Columns are required.');
      return;
    }

    this._config = {
      theme: 'default',
      ...config,
    };
  }

  protected render(): TemplateResult | void {
    if (!this._config || !this.hass) {
      return html``;
    }

    const stateObj = this.hass.states[this._config.entity];

    if (!stateObj) {
      return html`
        <ha-card>
          <div class="warning">Entity Unavailable</div>
        </ha-card>
      `;
    }

    const feed = this._config.feed_attribute ? stateObj.attributes[this._config.feed_attribute] : stateObj.attributes;

    if (!feed || Object.keys(feed).length === 0) {
      return html`
        <ha-card>
          <div class="warning">Feed Unavailable</div>
        </ha-card>
      `;
    }

    // TODO Filter to row_limit if set

    return html`
      <ha-card .header=${this._config.title}>
        <ha-data-table
          .columns=${this._columns()}
          .data=${feed}
          @selection-changed=${this._handleAction}
        ></ha-data-table>
      </ha-card>
    `;
  }

  protected updated(changedProps): void {
    super.updated(changedProps);
    if (!this._config || !this.hass) {
      return;
    }

    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;
    const oldConfig = changedProps.get('_config') as ListCardConfig | undefined;

    if (!oldHass || !oldConfig || oldHass.themes !== this.hass.themes || oldConfig.theme !== this._config.theme) {
      applyThemesOnElement(this, this.hass.themes, this._config.theme);
    }
  }

  private _columns(): DataTableColumnContainer {
    const columns: DataTableColumnContainer = this._config!.columns;

    for (let [key, value] of Object.entries(columns)) {
      if (value.type && value.type === 'image') {
        value.template = () => html`
          <div>TODO This doesn't work for some reason?</div>
        `;
      }
    }

    return columns;
  }

  private _handleAction(ev): void {
    if (this.hass && this._config && ev.detail.action) {
      // TODO
      // action: link
    }
  }

  static get styles(): CSSResult {
    return css`
      .warning {
        display: block;
        color: black;
        background-color: #fce588;
        padding: 8px;
      }
    `;
  }
}
