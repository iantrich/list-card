import { describe, expect, it } from 'vitest';

import {
  applyRegex,
  computeCellText,
  extractRows,
  filterRows,
  formatValue,
  getValue,
  renderTemplate,
  replacePlaceholders,
  resolveCardHeight,
  resolveImageUrl,
  resolveLink,
  rowsWithColumns,
  sortRows,
  transformFileList,
} from '../src/utils';

const enclosureEntry = {
  title: 'Headline',
  link: 'https://example.com/a',
  links: [
    { rel: 'alternate', type: 'text/html', href: 'https://example.com/a' },
    { rel: 'enclosure', type: 'image/jpeg', length: '0', href: 'https://example.com/a.jpg' },
  ],
};

describe('getValue', () => {
  it('reads plain and nested paths', () => {
    expect(getValue(enclosureEntry, 'title')).toBe('Headline');
    expect(getValue(enclosureEntry, 'links.1.href')).toBe('https://example.com/a.jpg');
    expect(getValue(enclosureEntry, 'links[1].href')).toBe('https://example.com/a.jpg');
    expect(getValue(enclosureEntry, 'links.5.href')).toBeUndefined();
  });

  it('prefers exact keys containing dots', () => {
    expect(getValue({ 'a.b': 1, a: { b: 2 } }, 'a.b')).toBe(1);
  });

  it('handles bad input', () => {
    expect(getValue(null, 'a')).toBeUndefined();
    expect(getValue({ a: 1 }, '')).toBeUndefined();
  });
});

describe('extractRows', () => {
  it('reports a missing attribute with the available names (#57)', () => {
    const result = extractRows({ entries: [] }, 'Entries');
    expect(result).toEqual({ ok: false, reason: 'missing_attribute', available: ['entries'] });
  });

  it('returns no rows for a null attribute (#46)', () => {
    expect(extractRows({ hosts: null }, 'hosts')).toEqual({ ok: true, rows: [] });
  });

  it('accepts arrays, objects and JSON strings', () => {
    expect(extractRows({ entries: [{ a: 1 }, 'x', null] }, 'entries')).toEqual({ ok: true, rows: [{ a: 1 }] });
    expect(extractRows({ data: { one: { a: 1 }, two: { a: 2 } } }, 'data')).toEqual({
      ok: true,
      rows: [{ a: 1 }, { a: 2 }],
    });
    expect(extractRows({ data: '[{"a":1}]' }, 'data')).toEqual({ ok: true, rows: [{ a: 1 }] });
  });

  it('uses object-valued attributes when no feed_attribute is set', () => {
    expect(extractRows({ friendly_name: 'x', one: { a: 1 } })).toEqual({ ok: true, rows: [{ a: 1 }] });
  });

  it('transforms Folder integration file lists', () => {
    const result = extractRows({ file_list: ['/config/www/snaps/20240314151200.jpg'] }, 'file_list');
    expect(result.ok && result.rows[0]).toMatchObject({
      path: '/config/www/snaps/',
      filename: '20240314151200.jpg',
      fullpath: '/config/www/snaps/20240314151200.jpg',
      ext: 'jpg',
    });
  });
});

describe('transformFileList', () => {
  it('keeps dots inside file names', () => {
    expect(transformFileList(['/media/my.file.name.mp4'])[0]).toEqual({
      path: '/media/',
      name: 'my.file.name',
      filename: 'my.file.name.mp4',
      fullpath: '/media/my.file.name.mp4',
      ext: 'mp4',
    });
  });
});

describe('resolveImageUrl', () => {
  it('finds enclosure images in feedparser links (#37, #43)', () => {
    expect(resolveImageUrl(enclosureEntry.links)).toBe('https://example.com/a.jpg');
  });

  it('supports media_content style lists and objects', () => {
    expect(resolveImageUrl([{ url: 'https://x/y.png' }])).toBe('https://x/y.png');
    expect(resolveImageUrl({ href: 'https://x/z.png' })).toBe('https://x/z.png');
    expect(resolveImageUrl('https://x/plain.png')).toBe('https://x/plain.png');
    expect(resolveImageUrl([])).toBe('');
  });
});

describe('text helpers', () => {
  it('renders multi-field templates (#41)', () => {
    expect(renderTemplate('[[a]] – [[b.c]] [[missing]]', { a: 'A', b: { c: 'C' } })).toBe('A – C ');
  });

  it('uses the first capture group of a regex (#58)', () => {
    expect(applyRegex('Summary: real text', '^Summary: (.*)$')).toBe('real text');
    expect(applyRegex('abc123', '\\d+')).toBe('123');
    expect(applyRegex('abc', '\\d+')).toBe('');
    expect(applyRegex('abc', '([')).toBe('abc');
  });

  it('applies template, regex, prefix and postfix in order', () => {
    const text = computeCellText(
      { a: 'Hello', b: 'World' },
      { title: '', field: 'a', template: '[[a]] [[b]]', regex: '(\\w+)$', prefix: '<', postfix: '>' },
    );
    expect(text).toBe('<World>');
  });
});

describe('formatValue (#55)', () => {
  const iso = '2023-10-22T20:30:00+00:00';

  it('formats ISO dates with explicit options', () => {
    expect(formatValue(iso, 'datetime', 'en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })).toBe(
      '10/22/23, 8:30 PM',
    );
  });

  it('leaves year-less strings (feedparser default date_format) unchanged', () => {
    // V8 would otherwise parse these as the year 2001.
    expect(formatValue('Fri, Nov 13 07:00 PM', 'relative', 'en-US')).toBe('Fri, Nov 13 07:00 PM');
    expect(formatValue('Fri, Nov 13 07:00 PM', 'date', 'en-US')).toBe('Fri, Nov 13 07:00 PM');
  });

  it('formats relative times', () => {
    const now = new Date('2023-10-22T22:30:00Z');
    expect(formatValue(iso, 'relative', 'en-US', undefined, now)).toBe('2 hours ago');
  });

  it('formats unix timestamps', () => {
    expect(formatValue(0, 'date', 'en-US', { timeZone: 'UTC', year: 'numeric' })).toBe('1970');
  });

  it('leaves unparseable values alone', () => {
    expect(formatValue('not a date', 'date', 'en-US')).toBe('not a date');
  });
});

describe('sortRows', () => {
  const rows = [{ n: 10 }, { n: 2 }, { n: undefined }, { n: 33 }];

  it('sorts numerically and puts missing values first', () => {
    expect(sortRows(rows, { value: 'n' }).map((row) => row.n)).toEqual([undefined, 2, 10, 33]);
    expect(sortRows(rows, { value: 'n', reverse: true }).map((row) => row.n)).toEqual([33, 10, 2, undefined]);
  });

  it('sorts numeric strings naturally', () => {
    const items = [{ v: 'item 10' }, { v: 'item 2' }];
    expect(sortRows(items, { value: 'v' }).map((row) => row.v)).toEqual(['item 2', 'item 10']);
  });

  it('does not mutate the input', () => {
    const input = [{ n: 2 }, { n: 1 }];
    sortRows(input, { value: 'n' });
    expect(input[0].n).toBe(2);
  });
});

describe('filterRows (#14)', () => {
  const columns = [{ title: 'Title', field: 'title' }];
  const rows = [{ title: 'Weather alert' }, { title: 'Sports news' }, { title: 'מזג אוויר חם' }, { title: 'Other' }];

  it('includes and excludes keywords, case-insensitively', () => {
    expect(filterRows(rows, { include: ['WEATHER', 'sports'] }, columns)).toHaveLength(2);
    expect(filterRows(rows, { exclude: ['sports'] }, columns)).toHaveLength(3);
    expect(filterRows(rows, { include: ['weather'], case_sensitive: true }, columns)).toHaveLength(0);
  });

  it('handles non-latin keywords', () => {
    expect(filterRows(rows, { include: ['אוויר'] }, columns)).toEqual([{ title: 'מזג אוויר חם' }]);
  });

  it('can search fields that are not displayed', () => {
    const data = [
      { title: 'A', tag: 'keep' },
      { title: 'B', tag: 'drop' },
    ];
    expect(filterRows(data, { exclude: ['drop'], fields: ['tag'] }, columns)).toEqual([{ title: 'A', tag: 'keep' }]);
  });
});

describe('rowsWithColumns', () => {
  it('keeps rows with at least one configured field', () => {
    const columns = [
      { title: 'A', field: 'a' },
      { title: 'B', field: 'b.c' },
    ];
    expect(rowsWithColumns([{ a: 1 }, { b: { c: 2 } }, { z: 3 }], columns)).toHaveLength(2);
  });
});

describe('replacePlaceholders', () => {
  it('replaces nested placeholders without mutating input', () => {
    const action = { action: 'url', url_path: '[[link]]', data: { list: ['[[id]]'] } };
    const result = replacePlaceholders(action, { link: 'https://x', id: 7 });
    expect(result).toEqual({ action: 'url', url_path: 'https://x', data: { list: ['7'] } });
    expect(action.url_path).toBe('[[link]]');
  });
});

describe('misc', () => {
  it('resolves card height', () => {
    expect(resolveCardHeight(undefined)).toBe('300px');
    expect(resolveCardHeight(200)).toBe('200px');
    expect(resolveCardHeight(' 150 ')).toBe('150px');
    expect(resolveCardHeight('50vh')).toBe('50vh');
  });

  it('maps config/www paths to /local', () => {
    expect(resolveLink('/config/www/media/a.jpg')).toBe('/local/media/a.jpg');
    expect(resolveLink('config/www/a.jpg')).toBe('/local/a.jpg');
    expect(resolveLink('https://example.com/config/www/a')).toBe('https://example.com/config/www/a');
  });
});
