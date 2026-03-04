import type { ActionConfig } from 'custom-card-helpers';

export type { ActionConfig };

export interface HassEntity {
  attributes: Record<string, unknown>;
}

export interface HomeAssistant {
  states: Record<string, HassEntity | undefined>;
}

export interface SortConfig {
  value: string;
  reverse?: boolean;
}

export interface ColumnConfig {
  title: string;
  field: string;
  add_link?: string;
  type?: 'image' | 'icon';
  style?: Array<Record<string, string>>;
  width?: string | number;
  height?: string | number;
  regex?: string;
  prefix?: string;
  postfix?: string;
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
  show_header?: boolean;
  card_height?: string | number;
  sort?: SortConfig;
  columns?: ColumnConfig[];
}

export type FeedRow = Record<string, unknown>;
