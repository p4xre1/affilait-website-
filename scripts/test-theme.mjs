import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/theme-toggle.js', import.meta.url), 'utf8');

function simulateTheme({ initialTheme, savedTheme = null, prefersDark = false }) {
  class FakeElement {
    constructor(parent = null) {
      this.parent = parent;
      this.attributes = new Map();
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    closest(selector) {
      if (selector !== '[data-theme-toggle]') return null;
      return this.parent ?? (this.isToggle ? this : null);
    }
  }
  const buttons = [new FakeElement(), new FakeElement()];
  buttons.forEach((button) => { button.isToggle = true; });
  const attributes = buttons.map((button) => button.attributes);
  const child = new FakeElement(buttons[0]);
  const root = { dataset: initialTheme ? { theme: initialTheme } : {} };
  const themeColor = { content: '' };
  const listeners = new Map();
  const storage = { value: savedTheme };
  const document = {
    documentElement: root,
    addEventListener(name, listener) { listeners.set(name, listener); },
    querySelectorAll(selector) { return selector === '[data-theme-toggle]' ? buttons : []; },
    querySelector(selector) { return selector === 'meta[name="theme-color"]' ? themeColor : null; },
  };
  const localStorage = {
    getItem(key) { return key === 'fatorati-theme' ? storage.value : null; },
    setItem(key, value) { if (key === 'fatorati-theme') storage.value = value; },
  };
  runInNewContext(source, {
    document,
    localStorage,
    window: { matchMedia: () => ({ matches: prefersDark }) },
    Element: FakeElement,
  });
  return { attributes, buttons, child, document, listeners, root, storage, themeColor };
}

const dark = simulateTheme({ initialTheme: 'dark' });
assert.equal(dark.root.dataset.theme, 'dark');
assert.equal(dark.attributes[0].get('aria-label'), 'Switch to light mode');
assert.equal(dark.attributes[0].get('aria-pressed'), 'true');
assert.equal(dark.themeColor.content, '#0d1713');
dark.listeners.get('click')({ target: dark.child });
assert.equal(dark.root.dataset.theme, 'light');
assert.equal(dark.storage.value, 'light');
assert.equal(dark.attributes[1].get('aria-label'), 'Switch to dark mode');
assert.equal(dark.attributes[1].get('aria-pressed'), 'false');
assert.equal(dark.themeColor.content, '#f8faf8');
dark.listeners.get('click')({ target: dark.buttons[1] });
assert.equal(dark.root.dataset.theme, 'dark');
assert.equal(dark.storage.value, 'dark');

const savedLight = simulateTheme({ initialTheme: '', savedTheme: 'light', prefersDark: true });
assert.equal(savedLight.root.dataset.theme, 'light');
assert.equal(savedLight.storage.value, 'light');

const systemDark = simulateTheme({ initialTheme: '', prefersDark: true });
assert.equal(systemDark.root.dataset.theme, 'dark');

console.log('Theme tests passed: explicit light/dark toggles, both buttons, saved preference, system preference, labels, and browser theme color.');
