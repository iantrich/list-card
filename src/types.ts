import { ActionConfig } from 'custom-card-helpers';
import { TemplateResult } from 'lit-html';

export interface ListCardConfig {
  type: string;
  entity: string;
  columns: ColumnConfig;
  feed_attribute?: string;
  title?: string;
  row_limit?: string;
  theme?: string;
  tap_action?: ActionConfig;
}

export interface ColumnConfig {
  title: string;
  field: string;
  add_link?: string;
  type?: string;
  style?: string;
  regex?: string;
  prefix?: string;
  postfix?: string;
}

export interface DataTableColumnContainer {
  [key: string]: DataTableColumnData;
}

export interface DataTableSortColumnData {
  sortable?: boolean;
  filterable?: boolean;
  filterKey?: string;
  direction?: SortingDirection;
}

export interface DataTableColumnData extends DataTableSortColumnData {
  title: string;
  type?: 'numeric' | 'icon';
  template?: <T>(data: any, row: T) => TemplateResult;
}

export interface DataTableRowData {
  [key: string]: any;
}

export type SortingDirection = 'desc' | 'asc' | null;
