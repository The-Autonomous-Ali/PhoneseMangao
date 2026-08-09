import { describe, it, expect } from 'vitest';
import { slugify, slugCandidate } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates a plain name', () => {
    expect(slugify('Fresh Tomatoes')).toBe('fresh-tomatoes');
  });

  it('collapses runs of punctuation and whitespace into one hyphen', () => {
    expect(slugify('Rice  --  Basmati (1kg)')).toBe('rice-basmati-1kg');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  ...Onions!  ')).toBe('onions');
  });

  it('strips diacritics rather than dropping the letter', () => {
    expect(slugify('Purée')).toBe('puree');
  });

  it('falls back for a name that transliterates to nothing', () => {
    // Not hypothetical for a shop in India: an all-Devanagari name strips to
    // empty, and an empty slug would break the unique index on the second one.
    expect(slugify('टमाटर')).toBe('item');
    expect(slugify('!!!')).toBe('item');
  });

  it('caps the length', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it('never ends in a hyphen, even when the cap lands on a separator', () => {
    const slug = slugify(`${'a'.repeat(59)} tomatoes`);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('is stable for the same input', () => {
    expect(slugify('Green Chilli')).toBe(slugify('Green Chilli'));
  });
});

describe('slugCandidate', () => {
  it('returns the base slug unchanged on the first attempt', () => {
    expect(slugCandidate('tomatoes', 1)).toBe('tomatoes');
  });

  it('suffixes subsequent attempts', () => {
    expect(slugCandidate('tomatoes', 2)).toBe('tomatoes-2');
    expect(slugCandidate('tomatoes', 5)).toBe('tomatoes-5');
  });
});
