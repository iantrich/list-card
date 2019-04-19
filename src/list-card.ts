import {
  LitElement,
  html,
  customElement,
  property,
  TemplateResult,
  css,
  CSSResult,
  PropertyValues
} from "lit-element";

import { ListCardConfig, HomeAssistant, ColumnConfig } from "./types";
import { fireEvent } from "./fire-event";

@customElement("list-card")
class ListCard extends LitElement {
  @property() public hass?: HomeAssistant;

  @property() private _config?: ListCardConfig;

  public setConfig(config: ListCardConfig): void {
    if (!config || !config.entity || config.columns) {
      throw new Error("Invalid configuration");
    }

    this._config = config;
  }

  public getCardSize(): number {
    return 6;
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    // TODO Change to HA core function
    return true;
  }

  protected render(): TemplateResult | void {
    if (!this._config || !this.hass) {
      return html``;
    }

    const stateObj = this.hass.states[this._config.entity] as any;

    if (!stateObj) {
      return html`
        <ha-card>
          <div class="warning">
            Entity not available: ${this._config.entity}
          </div>
        </ha-card>
      `;
    }

    const entries = stateObj.slice(
      0,
      this._config.row_limit || stateObj.length
    );

    return html`
      <ha-card .title="${this._config.title}">
        <table>
          <thread>
            <tr>
              ${this._config.columns.map(
                column =>
                  html`
                    <th class="${column.field}">${column.title}</th>
                  `
              )}
            </tr>
          </thread>
          <tbody>
            ${entries.map(
              entry => html`
                <tr>
                  ${this._config!.columns.map(
                    column =>
                      html`
                        <td class="${column.field}">${entry[column.field]}</td>
                      `
                  )}
                </tr>
              `
            )}
          </tbody>
        </table>
      </ha-card>
    `;
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

  private _moreInfo(): void {
    fireEvent(this, "hass-more-info", {
      entityId: this._config!.entity
    });
  }
}
