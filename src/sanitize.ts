import DOMPurify from 'dompurify';

/**
 * Formatting tags feeds commonly use. Anything not listed (script, style, iframe,
 * form controls, svg, …) is dropped, keeping its text content.
 */
const ALLOWED_TAGS = [
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'img',
  'ins',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'ul',
];

/** No `style` or `class`: feed content must not be able to restyle or overlay the dashboard. */
const ALLOWED_ATTR = ['href', 'title', 'src', 'alt', 'width', 'height'];

const CACHE_LIMIT = 500;
const cache = new Map<string, string>();
const cacheNoLinks = new Map<string, string>();

let hookInstalled = false;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function installHook(): void {
  if (hookInstalled) {
    return;
  }
  hookInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/**
 * Sanitize untrusted feed HTML down to a small set of formatting tags.
 *
 * `allowLinks: false` strips `<a>` elements (keeping their text) for cells that are
 * already wrapped in a link via `add_link`, since nested anchors are invalid.
 *
 * Results are cached because the card re-renders on every `hass` update.
 */
export function sanitizeHtml(value: string, allowLinks = true): string {
  if (value === '' || !/[<&]/.test(value)) {
    return value;
  }

  const store = allowLinks ? cache : cacheNoLinks;
  const cached = store.get(value);
  if (cached !== undefined) {
    return cached;
  }

  // DOMPurify returns its input untouched when it can't run; fail closed instead.
  if (!DOMPurify.isSupported) {
    return escapeHtml(value);
  }

  installHook();
  const result = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: allowLinks ? ALLOWED_TAGS : ALLOWED_TAGS.filter((tag) => tag !== 'a'),
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });

  if (store.size >= CACHE_LIMIT) {
    store.delete(store.keys().next().value as string);
  }
  store.set(value, result);
  return result;
}
