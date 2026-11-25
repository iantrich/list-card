// @vitest-environment jsdom
// happy-dom's DOM isn't faithful enough for DOMPurify; jsdom is what it supports.
import { describe, expect, it } from 'vitest';

import { sanitizeHtml } from '../src/sanitize';

describe('sanitizeHtml (#92)', () => {
  it('passes plain text through untouched', () => {
    expect(sanitizeHtml('Just a headline')).toBe('Just a headline');
    expect(sanitizeHtml('')).toBe('');
  });

  it('keeps formatting tags', () => {
    expect(sanitizeHtml('<p>Hello <b>bold</b> <em>world</em><br></p>')).toBe(
      '<p>Hello <b>bold</b> <em>world</em><br></p>',
    );
  });

  it('decodes entities', () => {
    const el = document.createElement('div');
    el.innerHTML = sanitizeHtml('AT&amp;T &#39;quoted&#39;');
    expect(el.textContent).toBe("AT&T 'quoted'");
  });

  it('removes scripts and event handlers', () => {
    const out = sanitizeHtml('<img src="x.jpg" onerror="alert(1)"><script>alert(2)</script>ok');
    expect(out).not.toMatch(/onerror|script|alert/);
    expect(out).toContain('ok');
    expect(out).toContain('src="x.jpg"');
  });

  it('removes javascript: links', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript');
    expect(out).toContain('click');
  });

  it('drops style, class and dangerous elements but keeps their text', () => {
    const out = sanitizeHtml(
      '<div style="position:fixed" class="x">a</div><iframe src="https://evil"></iframe><style>*{}</style><svg><g>b</g></svg>',
    );
    expect(out).not.toMatch(/style|class|iframe|svg/);
    expect(out).toContain('a');
  });

  it('opens links in a new tab safely', () => {
    const out = sanitizeHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('strips anchors when links are not allowed, keeping text', () => {
    expect(sanitizeHtml('<a href="https://example.com">x</a> y', false)).toBe('x y');
  });
});
