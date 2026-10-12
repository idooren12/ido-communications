import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../../i18n/config';
import { escapeHtml, losLinePointPopup, searchResultPopup } from '../mapPopups';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('map popups', () => {
  it('escapes HTML in untrusted values', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    const html = searchResultPopup('<script>alert(1)</script>, Tel Aviv', 32, 34, 12);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('is localized and follows the text direction', async () => {
    const en = losLinePointPopup({ label: 'A', lat: 32, lon: 34, height: 10, mode: 'optical', clear: true, resultId: 'r1' });
    expect(en).toContain('direction:ltr');
    expect(en).toContain('Point A');
    expect(en).toContain('Line of sight clear');

    await i18n.changeLanguage('he');
    const he = losLinePointPopup({ label: 'A', lat: 32, lon: 34, height: 10, mode: 'optical', clear: false, resultId: 'r1' });
    expect(he).toContain('direction:rtl');
    expect(he).toContain('קו ראייה חסום');
    await i18n.changeLanguage('en');
  });
});
