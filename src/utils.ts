import type { ColumnConfig, FeedRow, FilterConfig, SortConfig, StyleList, ValueFormat } from './types';

export const FILE_LIST_ATTRIBUTE = 'file_list';

/**
 * Read a value from a row. An exact key match wins (so keys containing dots keep
 * working); otherwise the path is walked, e.g. `links.1.href` or `links[1].href`.
 */
export function getValue(row: unknown, path: string | undefined): unknown {
  if (!path || row === null || typeof row !== 'object') {
    return undefined;
  }

  const record = row as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, path)) {
    return record[path];
  }

  const segments = path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment !== '');

  if (segments.length < 2) {
    return undefined;
  }

  let current: unknown = row;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function hasValue(row: FeedRow, path: string | undefined): boolean {
  return getValue(row, path) !== undefined;
}

export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Replace `[[path]]` placeholders with row values. Unknown fields become empty strings. */
export function renderTemplate(template: string, row: FeedRow): string {
  return template.replace(/\[\[\s*(.*?)\s*\]\]/g, (_match, path: string) => stringifyValue(getValue(row, path)));
}

/**
 * Apply a column regex. When the expression has a capture group the first group
 * is shown, otherwise the whole match. No match yields an empty string.
 */
export function applyRegex(value: string, regex: string): string {
  let expression: RegExp;
  try {
    expression = new RegExp(regex, 'u');
  } catch (error) {
    console.warn(`list-card: invalid regex '${regex}'`, error);
    return value;
  }

  const match = expression.exec(value);
  if (!match) {
    return '';
  }
  return match.length > 1 && match[1] !== undefined ? match[1] : match[0];
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value);
    // Treat small numbers as Unix seconds, large ones as milliseconds.
    const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    // Without a four-digit year, Date silently guesses one (2001), so leave such strings as-is.
    if (!/\d{4}/.test(value)) {
      return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
}

const DEFAULT_FORMAT_OPTIONS: Record<Exclude<ValueFormat, 'relative'>, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'short' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
};

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/**
 * Format a date-like value. Values that cannot be parsed as dates are returned
 * unchanged so a bad format never blanks a column.
 */
export function formatValue(
  value: unknown,
  format: ValueFormat,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) {
    return stringifyValue(value);
  }

  try {
    if (format === 'relative') {
      const deltaSeconds = (date.getTime() - now.getTime()) / 1000;
      const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      for (const [unit, seconds] of RELATIVE_UNITS) {
        if (Math.abs(deltaSeconds) >= seconds || unit === 'second') {
          return formatter.format(Math.round(deltaSeconds / seconds), unit);
        }
      }
    }

    const resolvedOptions = options ?? DEFAULT_FORMAT_OPTIONS[format as Exclude<ValueFormat, 'relative'>];
    return new Intl.DateTimeFormat(locale, resolvedOptions).format(date);
  } catch (error) {
    console.warn('list-card: unable to format value', value, error);
    return stringifyValue(value);
  }
}

/** Compute the text shown in a text column. */
export function computeCellText(row: FeedRow, column: ColumnConfig, locale?: string): string {
  const raw = column.template !== undefined ? renderTemplate(column.template, row) : getValue(row, column.field);

  let value = column.format ? formatValue(raw, column.format, locale, column.format_options) : stringifyValue(raw);

  if (column.regex) {
    value = applyRegex(value, column.regex);
  }
  if (column.prefix) {
    value = `${column.prefix}${value}`;
  }
  if (column.postfix) {
    value = `${value}${column.postfix}`;
  }
  return value;
}

/**
 * Find an image URL in a value. Handles plain strings, `{ url }` / `{ href }`
 * objects (feedparser media fields), and arrays of them such as feedparser's
 * `links` list, where entries with an `image/*` type are preferred.
 */
export function resolveImageUrl(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  const urlOf = (entry: unknown): string | undefined => {
    if (!entry || typeof entry !== 'object') {
      return typeof entry === 'string' ? entry : undefined;
    }
    const record = entry as Record<string, unknown>;
    const url = record.url ?? record.href ?? record.src;
    return typeof url === 'string' && url !== '' ? url : undefined;
  };

  if (Array.isArray(value)) {
    const image = value.find(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).type === 'string' &&
        ((entry as Record<string, unknown>).type as string).startsWith('image/') &&
        urlOf(entry),
    );
    if (image) {
      return urlOf(image) ?? '';
    }

    const enclosure = value.find(
      (entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).rel === 'enclosure',
    );
    if (enclosure && urlOf(enclosure)) {
      return urlOf(enclosure) ?? '';
    }

    for (const entry of value) {
      const url = urlOf(entry);
      if (url) {
        return url;
      }
    }
    return '';
  }

  return urlOf(value) ?? stringifyValue(value);
}

export function styleListToObject(styles: StyleList | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  (styles ?? []).forEach((entry) => {
    Object.entries(entry ?? {}).forEach(([key, value]) => {
      if (key) {
        result[key] = String(value);
      }
    });
  });
  return result;
}

/** Turn a Folder integration `file_list` into rows with path/name/filename/fullpath/ext. */
export function transformFileList(files: string[]): FeedRow[] {
  return files.map((file) => {
    const path = file.substring(0, file.lastIndexOf('/') + 1);
    const filenameWithExt = file.substring(file.lastIndexOf('/') + 1);
    const dotIndex = filenameWithExt.lastIndexOf('.');
    const filename = dotIndex > 0 ? filenameWithExt.substring(0, dotIndex) : filenameWithExt;
    const extension = dotIndex > 0 ? filenameWithExt.substring(dotIndex + 1) : '';

    let name = filename;
    if (/^\d{14}$/.test(filename)) {
      const fileDate = new Date(
        `${filename.slice(0, 4)}-${filename.slice(4, 6)}-${filename.slice(6, 8)}T${filename.slice(8, 10)}:${filename.slice(10, 12)}:${filename.slice(12)}`,
      );
      if (!Number.isNaN(fileDate.getTime())) {
        name = fileDate.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          hour12: true,
        });
      }
    }

    return {
      path,
      name,
      filename: filenameWithExt,
      fullpath: `${path}${filenameWithExt}`,
      ext: extension,
    };
  });
}

export type FeedResult =
  | { ok: true; rows: FeedRow[] }
  | { ok: false; reason: 'missing_attribute'; available: string[] };

/** Extract the list of rows from an entity's attributes. */
export function extractRows(attributes: Record<string, unknown>, feedAttribute?: string): FeedResult {
  const attrs = attributes ?? {};
  let source: unknown = attrs;

  if (feedAttribute) {
    source = getValue(attrs, feedAttribute);
    if (source === undefined) {
      return { ok: false, reason: 'missing_attribute', available: Object.keys(attrs) };
    }
  }

  if (source === null || source === undefined || source === '') {
    return { ok: true, rows: [] };
  }

  if (typeof source === 'string') {
    // Some integrations (e.g. REST/MQTT templates) store the list as a JSON string.
    try {
      source = JSON.parse(source);
    } catch {
      return { ok: true, rows: [] };
    }
  }

  if (feedAttribute === FILE_LIST_ATTRIBUTE && Array.isArray(source)) {
    return {
      ok: true,
      rows: transformFileList(source.filter((value): value is string => typeof value === 'string')),
    };
  }

  const values = Array.isArray(source) ? source : typeof source === 'object' ? Object.values(source as object) : [];
  return {
    ok: true,
    rows: values.filter((row): row is FeedRow => typeof row === 'object' && row !== null && !Array.isArray(row)),
  };
}

export function sortRows(rows: FeedRow[], sort: SortConfig | undefined): FeedRow[] {
  if (!sort?.value) {
    return [...rows];
  }

  const isReverse = sort.reverse ?? false;
  return [...rows].sort((first, second) => {
    const valueA = getValue(first, sort.value);
    const valueB = getValue(second, sort.value);

    if (valueA === valueB) {
      return 0;
    }
    if (valueA === undefined || valueA === null) {
      return isReverse ? 1 : -1;
    }
    if (valueB === undefined || valueB === null) {
      return isReverse ? -1 : 1;
    }

    const result =
      typeof valueA === 'number' && typeof valueB === 'number'
        ? valueA - valueB
        : stringifyValue(valueA).localeCompare(stringifyValue(valueB), undefined, { numeric: true });
    return isReverse ? -result : result;
  });
}

export function filterRows(rows: FeedRow[], filter: FilterConfig | undefined, columns: ColumnConfig[]): FeedRow[] {
  const include = (filter?.include ?? []).filter((word) => word !== '');
  const exclude = (filter?.exclude ?? []).filter((word) => word !== '');
  if (include.length === 0 && exclude.length === 0) {
    return rows;
  }

  const caseSensitive = filter?.case_sensitive ?? false;
  const normalize = (text: string): string => (caseSensitive ? text : text.toLocaleLowerCase()).normalize('NFC');
  const fields = filter?.fields?.length ? filter.fields : columns.map((column) => column.field).filter(Boolean);
  const includeWords = include.map(normalize);
  const excludeWords = exclude.map(normalize);

  return rows.filter((row) => {
    const haystack = normalize(fields.map((field) => stringifyValue(getValue(row, field))).join('\n'));
    if (includeWords.length > 0 && !includeWords.some((word) => haystack.includes(word))) {
      return false;
    }
    return !excludeWords.some((word) => haystack.includes(word));
  });
}

/** Keep rows that have a value for at least one configured column. */
export function rowsWithColumns(rows: FeedRow[], columns: ColumnConfig[]): FeedRow[] {
  return rows.filter((row) =>
    columns.some(
      (column) =>
        hasValue(row, column.field) || column.template !== undefined || (column.type === 'icon' && column.icon),
    ),
  );
}

/** Deep-replace `[[field]]` placeholders in an action config. */
export function replacePlaceholders<T>(value: T, row: FeedRow): T {
  const traverse = (entry: unknown): unknown => {
    if (typeof entry === 'string') {
      return entry.includes('[[') ? renderTemplate(entry, row) : entry;
    }
    if (Array.isArray(entry)) {
      return entry.map(traverse);
    }
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry).map(([key, inner]) => [key, traverse(inner)]));
    }
    return entry;
  };
  return traverse(value) as T;
}

export function resolveCardHeight(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') {
    return '300px';
  }
  if (typeof value === 'number') {
    return `${value}px`;
  }
  return /^\d+$/.test(value.trim()) ? `${value.trim()}px` : value;
}

const DEFAULT_TRACK = 'minmax(0, 1fr)';
const LENGTH_TRACK = /^\d*\.?\d+(px|%|em|rem|ch|vw|vh)$/;
const FR_TRACK = /^(\d*\.?\d+)fr$/;

/** Convert one column's `column_width` into a CSS grid track size. */
export function resolveColumnTrack(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return DEFAULT_TRACK;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? `minmax(0, ${value}fr)` : DEFAULT_TRACK;
  }
  const text = value.trim();
  if (/^\d*\.?\d+$/.test(text)) {
    return Number(text) > 0 ? `minmax(0, ${text}fr)` : DEFAULT_TRACK;
  }
  const fr = FR_TRACK.exec(text);
  if (fr) return Number(fr[1]) > 0 ? `minmax(0, ${fr[1]}fr)` : DEFAULT_TRACK;
  if (LENGTH_TRACK.test(text) || ['auto', 'min-content', 'max-content'].includes(text)) return text;
  return DEFAULT_TRACK;
}

/** Build the `grid-template-columns` value for the inline columns. */
export function buildGridTemplate(columns: ColumnConfig[]): string {
  if (columns.length === 0) return DEFAULT_TRACK;
  return columns.map((column) => resolveColumnTrack(column.column_width)).join(' ');
}

/** Turn `config/www/...` paths from the Folder integration into `/local/...` URLs. */
export function resolveLink(value: unknown): string {
  return stringifyValue(value).replace(/^\/?config\/www/, '/local');
}
