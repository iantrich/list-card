import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../src/list-card';
import type { ListCard } from '../src/list-card';
import type { HomeAssistant, ListCardConfig } from '../src/types';

const entries = [
  {
    title: 'First story',
    link: 'https://example.com/1',
    published: '2024-01-01T10:00:00Z',
    links: [{ rel: 'enclosure', type: 'image/jpeg', href: 'https://example.com/1.jpg' }],
  },
  { title: 'Second story', link: 'https://example.com/2', published: '2024-01-02T10:00:00Z', links: [] },
  { title: 'Third story', link: 'https://example.com/3', published: '2024-01-03T10:00:00Z', links: [] },
];

function makeHass(attributes: Record<string, unknown> = { entries }): HomeAssistant {
  return { states: { 'sensor.feed': { attributes } }, locale: { language: 'en-US' } };
}

async function mount(config: Partial<ListCardConfig>, hass: HomeAssistant = makeHass()): Promise<ListCard> {
  const card = document.createElement('list-card') as ListCard;
  card.setConfig({ type: 'custom:list-card', entity: 'sensor.feed', ...config } as ListCardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const $ = (card: ListCard, selector: string) => card.shadowRoot!.querySelector(selector);
const $$ = (card: ListCard, selector: string) => Array.from(card.shadowRoot!.querySelectorAll(selector));
const bodyRows = (card: ListCard) => $$(card, '.grid-row:not(.grid-header-row)');

describe('list-card', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('requires an entity', () => {
    const card = document.createElement('list-card') as ListCard;
    expect(() => card.setConfig({ type: 'custom:list-card' } as ListCardConfig)).toThrow('Please define an entity');
  });

  it('rejects sort without a value', () => {
    const card = document.createElement('list-card') as ListCard;
    expect(() =>
      card.setConfig({ type: 'custom:list-card', entity: 'sensor.feed', sort: { value: '' } } as ListCardConfig),
    ).toThrow('sort');
  });

  it('renders a header and one row per entry', async () => {
    const card = await mount({
      feed_attribute: 'entries',
      columns: [
        { title: 'Title', field: 'title' },
        { title: 'Link', field: 'link' },
      ],
    });
    expect($$(card, '.grid-header').map((el) => el.textContent?.trim())).toEqual(['Title', 'Link']);
    expect(bodyRows(card)).toHaveLength(3);
    expect(bodyRows(card)[0].textContent).toContain('First story');
  });

  it('re-renders when hass and config change', async () => {
    const card = await mount({ feed_attribute: 'entries', columns: [{ title: 'T', field: 'title' }] });
    expect(bodyRows(card)).toHaveLength(3);

    card.hass = makeHass({ entries: [{ title: 'Breaking' }] });
    await card.updateComplete;
    expect(bodyRows(card).map((row) => row.textContent?.trim())).toEqual(['Breaking']);

    card.setConfig({
      type: 'custom:list-card',
      entity: 'sensor.feed',
      feed_attribute: 'entries',
      columns: [{ title: 'Renamed', field: 'title' }],
    });
    await card.updateComplete;
    expect($(card, '.grid-header')?.textContent?.trim()).toBe('Renamed');
  });

  it('shows a helpful warning when feed_attribute is wrong (#57)', async () => {
    const card = await mount({ feed_attribute: 'Entries', columns: [{ title: 'T', field: 'title' }] });
    const warning = $(card, '.warning')?.textContent ?? '';
    expect(warning).toContain("Attribute 'Entries' not found");
    expect(warning).toContain('entries');
  });

  it('shows a warning when the entity is missing', async () => {
    const card = await mount({ entity: 'sensor.nope', columns: [{ title: 'T', field: 'title' }] });
    expect($(card, '.warning')?.textContent).toContain('sensor.nope');
  });

  it('does not throw before the sensor has data (#46)', async () => {
    const card = await mount(
      { feed_attribute: 'hosts', columns: [{ title: 'Host', field: 'field4' }] },
      makeHass({ hosts: null }),
    );
    expect(card.style.display).toBe('none');
  });

  it('shows empty_message when there are no rows', async () => {
    const card = await mount(
      { feed_attribute: 'entries', empty_message: 'Nothing new', columns: [{ title: 'T', field: 'title' }] },
      makeHass({ entries: [] }),
    );
    expect($(card, '.empty')?.textContent).toBe('Nothing new');
  });

  it('lists available fields when no columns are configured', async () => {
    const card = await mount({ feed_attribute: 'entries' });
    expect($(card, '.warning')?.textContent).toContain('title, link, published');
  });

  it('renders enclosure images from a links list (#43)', async () => {
    const card = await mount({
      feed_attribute: 'entries',
      row_limit: 1,
      columns: [{ title: '', field: 'links', type: 'image', image_style: [{ 'border-radius': '8px' }] }],
    });
    const img = $(card, 'img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://example.com/1.jpg');
    expect(img.style.getPropertyValue('border-radius')).toBe('8px');
  });

  it('hides the header row when every column title is empty (#17)', async () => {
    const card = await mount({ feed_attribute: 'entries', columns: [{ title: '', field: 'links', type: 'image' }] });
    expect($(card, '.grid-header-row')).toBeNull();
  });

  it('supports a static icon with a link (#35)', async () => {
    const card = await mount({
      feed_attribute: 'entries',
      row_limit: 1,
      columns: [{ title: 'Go', field: 'link', type: 'icon', icon: 'mdi:ticket-percent', add_link: 'link' }],
    });
    const icon = $(card, 'a ha-icon') as HTMLElement & { icon: string };
    expect(icon.icon).toBe('mdi:ticket-percent');
    expect(($(card, 'a') as HTMLAnchorElement).getAttribute('href')).toBe('https://example.com/1');
  });

  it('honours link_target (#59)', async () => {
    const card = await mount({
      feed_attribute: 'entries',
      row_limit: 1,
      columns: [{ title: 'T', field: 'title', add_link: 'link', link_target: '_self' }],
    });
    expect($(card, 'a')?.getAttribute('target')).toBe('_self');
  });

  it('formats dates and renders templates', async () => {
    const card = await mount({
      feed_attribute: 'entries',
      row_limit: 1,
      columns: [
        {
          title: 'When',
          field: 'published',
          format: 'date',
          format_options: { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' },
        },
        { title: 'Both', field: 'title', template: '[[title]] ([[link]])' },
      ],
    });
    const cells = bodyRows(card)[0].querySelectorAll('.grid-cell');
    expect(cells[0].textContent?.trim()).toBe('01/01/2024');
    expect(cells[1].textContent?.trim()).toBe('First story (https://example.com/1)');
  });

  it('puts full_width columns on their own line and out of the header (#33)', async () => {
    const card = await mount({
      feed_attribute: 'entries',
      row_limit: 1,
      columns: [
        { title: 'Title', field: 'title' },
        { title: 'Link', field: 'link' },
        { title: 'Summary', field: 'published', full_width: true },
      ],
    });
    expect($$(card, '.grid-header')).toHaveLength(2);
    expect($(card, '.grid-cell.full-width')).not.toBeNull();
    const container = $(card, '.grid-container') as HTMLElement;
    expect(container.style.getPropertyValue('--list-card-template')).toBe('minmax(0, 1fr) minmax(0, 1fr)');
  });

  it('filters rows by keyword (#14)', async () => {
    const card = await mount({
      feed_attribute: 'entries',
      filter: { exclude: ['second'] },
      columns: [{ title: 'T', field: 'title' }],
    });
    expect(bodyRows(card).map((row) => row.textContent?.trim())).toEqual(['First story', 'Third story']);
  });

  it('sorts rows', async () => {
    const card = await mount({
      feed_attribute: 'entries',
      sort: { value: 'published', reverse: true },
      columns: [{ title: 'T', field: 'title' }],
    });
    expect(bodyRows(card)[0].textContent?.trim()).toBe('Third story');
  });

  describe('paging (#4, #54)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('pages rows with prev/next buttons', async () => {
      const card = await mount({
        feed_attribute: 'entries',
        page_size: 2,
        columns: [{ title: 'T', field: 'title' }],
      });
      expect(bodyRows(card)).toHaveLength(2);
      expect($(card, '.pager-label')?.textContent?.trim()).toBe('1 / 2');

      ($$(card, '.pager-button')[1] as HTMLButtonElement).click();
      await card.updateComplete;
      expect(bodyRows(card).map((row) => row.textContent?.trim())).toEqual(['Third story']);

      ($$(card, '.pager-button')[1] as HTMLButtonElement).click();
      await card.updateComplete;
      expect($(card, '.pager-label')?.textContent?.trim()).toBe('1 / 2');
    });

    it('auto-advances with page_interval', async () => {
      const card = await mount({
        feed_attribute: 'entries',
        page_size: 1,
        page_interval: 5,
        columns: [{ title: 'T', field: 'title' }],
      });
      expect(bodyRows(card)[0].textContent?.trim()).toBe('First story');
      vi.advanceTimersByTime(5000);
      await card.updateComplete;
      expect(bodyRows(card)[0].textContent?.trim()).toBe('Second story');

      card.remove();
      vi.advanceTimersByTime(20000);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('actions', () => {
    it('fires hass-action with placeholders replaced (#18, #59)', async () => {
      const card = await mount({
        feed_attribute: 'entries',
        row_limit: 1,
        columns: [{ title: 'T', field: 'title', tap_action: { action: 'url', url_path: '[[link]]' } as never }],
      });
      const handler = vi.fn();
      card.addEventListener('hass-action', handler);
      ($(card, '.grid-cell.actionable') as HTMLElement).click();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({
        config: { entity: 'sensor.feed', tap_action: { action: 'url', url_path: 'https://example.com/1' } },
        action: 'tap',
      });
    });

    it('does not fire tap when double tapping', async () => {
      vi.useFakeTimers();
      const card = await mount({
        feed_attribute: 'entries',
        row_limit: 1,
        columns: [
          {
            title: 'T',
            field: 'title',
            tap_action: { action: 'more-info' },
            double_tap_action: { action: 'toggle' },
          },
        ],
      });
      const handler = vi.fn();
      card.addEventListener('hass-action', handler);
      const cell = $(card, '.grid-cell.actionable') as HTMLElement;
      cell.click();
      cell.click();
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      vi.advanceTimersByTime(500);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail.action).toBe('double_tap');
    });

    it('fires hold and swallows the following click', async () => {
      vi.useFakeTimers();
      const card = await mount({
        feed_attribute: 'entries',
        row_limit: 1,
        columns: [
          { title: 'T', field: 'title', tap_action: { action: 'more-info' }, hold_action: { action: 'more-info' } },
        ],
      });
      const handler = vi.fn();
      card.addEventListener('hass-action', handler);
      const cell = $(card, '.grid-cell.actionable') as HTMLElement;
      cell.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(600);
      cell.dispatchEvent(new Event('pointerup'));
      cell.click();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail.action).toBe('hold');
    });
  });

  it('builds a stub config from an entity with a list attribute', async () => {
    const { ListCard: Card } = await import('../src/list-card');
    const stub = Card.getStubConfig(makeHass());
    expect(stub).toMatchObject({ entity: 'sensor.feed', feed_attribute: 'entries' });
  });
});
