// @vitest-environment jsdom
// happy-dom's DOM isn't faithful enough for DOMPurify; jsdom is what it supports.
import { afterEach, describe, expect, it } from 'vitest';

import '../src/list-card';
import type { ListCard } from '../src/list-card';
import type { HomeAssistant, ListCardConfig } from '../src/types';

const entries = [
  {
    title: 'AT&amp;T <b>news</b>',
    summary: '<p>Body <a href="https://example.com/x">more</a></p><img src="x" onerror="alert(1)">',
    link: 'https://example.com/1',
  },
];

const hass: HomeAssistant = { states: { 'sensor.feed': { attributes: { entries } } }, locale: { language: 'en-US' } };

async function mount(config: Partial<ListCardConfig>): Promise<ListCard> {
  const card = document.createElement('list-card') as ListCard;
  card.setConfig({
    type: 'custom:list-card',
    entity: 'sensor.feed',
    feed_attribute: 'entries',
    ...config,
  } as ListCardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const bodyCells = (card: ListCard) =>
  Array.from(card.shadowRoot!.querySelectorAll('.grid-row:not(.grid-header-row) .grid-cell'));

describe('html content (#92)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders sanitized markup instead of literal tags', async () => {
    const card = await mount({ columns: [{ title: 'S', field: 'summary' }] });
    const cell = bodyCells(card)[0];
    expect(cell.querySelector('p')).not.toBeNull();
    expect(cell.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(cell.innerHTML).not.toContain('onerror');
    expect(cell.textContent?.trim()).toBe('Body more');
  });

  it('decodes entities and strips nested links inside add_link cells', async () => {
    const card = await mount({
      columns: [
        { title: 'T', field: 'title', add_link: 'link' },
        { title: 'S', field: 'summary', add_link: 'link' },
      ],
    });
    const [title, summary] = bodyCells(card);
    expect(title.textContent?.trim()).toBe('AT&T news');
    expect(title.querySelector('b')).not.toBeNull();
    expect(summary.querySelectorAll('a')).toHaveLength(1);
  });

  it('lets prefix and postfix carry markup', async () => {
    const card = await mount({ columns: [{ title: 'T', field: 'link', prefix: '<i>', postfix: '</i>' }] });
    expect(bodyCells(card)[0].querySelector('i')?.textContent).toBe('https://example.com/1');
  });
});
