import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import he from '../he.json';
import en from '../en.json';

type Dict = { [key: string]: string | Dict };

function flatten(dict: Dict, prefix = ''): string[] {
  return Object.entries(dict).flatMap(([key, value]) =>
    typeof value === 'string' ? [prefix + key] : flatten(value, `${prefix}${key}.`)
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'i18n' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const heKeys = new Set(flatten(he as Dict));
const enKeys = new Set(flatten(en as Dict));

describe('translations', () => {
  it('Hebrew and English have the same keys', () => {
    expect([...heKeys].filter(k => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter(k => !heKeys.has(k))).toEqual([]);
  });

  it('every literal t("...") key used in the code exists', () => {
    const srcDir = join(__dirname, '..', '..');
    const missing: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]/g)) {
        const key = match[1];
        const pluralised = [...enKeys].some(k => k.startsWith(`${key}_`));
        if (!enKeys.has(key) && !pluralised) missing.push(`${file.replace(srcDir, 'src')}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
