import type { ActionConfig } from 'custom-card-helpers';

export type { ActionConfig };

export interface HassEntity {
  attributes: Record<string, unknown>;
}

export interface HomeAssistant {
  states: Record<string, HassEntity | undefined>;
  locale?: { language?: string };
  language?: string;
}

export interface SortConfig {
  value: string;
  reverse?: boolean;
}

export interface FilterConfig {
  /** Keep only rows that contain at least one of these keywords. */
  include?: string[];
  /** Drop rows that contain any of these keywords. */
  exclude?: string[];
  /** Fields to search. Defaults to every configured column field. */
  fields?: string[];
  /** Match case exactly. Defaults to false. */
  case_sensitive?: boolean;
}

export type ValueFormat = 'date' | 'time' | 'datetime' | 'relative';

export type StyleList = Array<Record<string, string>>;

export interface ColumnConfig {
  title: string;
  /** Field to display. Supports nested paths such as `links.1.href` or `links[1].href`. */
  field: string;
  add_link?: string;
  link_target?: string;
  type?: 'image' | 'icon';
  /** Static icon for `type: icon` columns (e.g. `mdi:ticket`). */
  icon?: string;
  style?: StyleList;
  image_style?: StyleList;
  /** Image size for `type: image` columns. */
  width?: string | number;
  /** Width of this column in the grid, e.g. `120px`, `2fr`, `auto`. A bare number is treated as `fr`. */
  column_width?: string | number;
  height?: string | number;
  regex?: string;
  prefix?: string;
  postfix?: string;
  /** Text template; `[[field]]` placeholders are replaced with row values. */
  template?: string;
  format?: ValueFormat;
  format_options?: Intl.DateTimeFormatOptions;
  /** Render the cell on its own line spanning the full card width. */
  full_width?: boolean;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export interface ListCardConfig {
  type: string;
  entity: string;
  title?: string;
  feed_attribute?: string;
  row_limit?: number;
  page_size?: number;
  /** Seconds between automatic page changes. Requires `page_size`. */
  page_interval?: number;
  show_header?: boolean;
  card_height?: string | number;
  empty_message?: string;
  sort?: SortConfig;
  filter?: FilterConfig;
  columns?: ColumnConfig[];
}

export type FeedRow = Record<string, unknown>;
