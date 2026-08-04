import { describe, it, expect } from 'vitest';
import { stripHtmlToText, tokenSet, abilityTextScore } from '../abilityText';

describe('stripHtmlToText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(stripHtmlToText('<p>Negate  Evil\nCharacters.</p>')).toBe('Negate Evil Characters.');
  });
  it('decodes named entities the importer writes (escapeHtml output)', () => {
    // productFromCard.escapeHtml emits &amp; &lt; &gt; &quot; &#39;
    expect(stripHtmlToText('<p>Discard &amp; draw. Don&#39;t negate. &quot;Hold&quot;</p>'))
      .toBe('Discard & draw. Don\'t negate. "Hold"');
  });
  it('decodes smart-quote entities AND passes literal smart quotes through (both occur in real YTG data)', () => {
    // Live YTG bodies carry literal ’/“ (398/118 occurrences in tmp/products_export_1.csv);
    // entity-encoded forms appear in hand-edited descriptions.
    expect(stripHtmlToText('<p>opponents&rsquo; cards</p>')).toBe('opponents’ cards');
    expect(stripHtmlToText('<p>&#8220;He is Risen&#8221;</p>')).toBe('“He is Risen”');
    expect(stripHtmlToText('<p>opponents’ cards</p>')).toBe('opponents’ cards');
  });
  it('returns empty string for null/undefined/empty', () => {
    expect(stripHtmlToText(null)).toBe('');
    expect(stripHtmlToText(undefined)).toBe('');
    expect(stripHtmlToText('')).toBe('');
  });
});

describe('tokenSet', () => {
  it('lowercases, drops stopwords, normalizes smart apostrophes so “opponents’” == "opponents\'"', () => {
    const t = tokenSet('Protect your hand and deck from opponents’ cards.');
    expect(t.has('protect')).toBe(true);
    expect(t.has('opponents\'')).toBe(true);
    expect(t.has('your')).toBe(false); // stopword
    expect(t.has('and')).toBe(false);  // stopword
  });
});

describe('abilityTextScore', () => {
  it('identical ability text scores 1', () => {
    const s = 'Negate Evil Characters. If alone, you may choose a human to block.';
    expect(abilityTextScore(s, s)).toBe(1);
  });
  it('disjoint text scores 0; empty either side scores 0', () => {
    expect(abilityTextScore('Discard a Hero', 'Protect deck sites')).toBe(0);
    expect(abilityTextScore('Discard a Hero', '')).toBe(0);
    expect(abilityTextScore('', 'Protect deck')).toBe(0);
  });
  it('partial overlap lands strictly between 0 and 1', () => {
    const s = abilityTextScore('Discard a Hero in a territory', 'Discard a Hero to draw two cards');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});
