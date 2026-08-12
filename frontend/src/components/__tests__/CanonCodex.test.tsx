// The Codex is the one component that injects HTML it did not author, so the
// contract worth pinning is not "it renders" but "what it injects came out of
// the sanitiser".
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanonCodex } from '../CanonCodex';

const markup = renderToStaticMarkup(<CanonCodex open onClose={() => {}} />);

describe('CanonCodex', () => {
  test('typesets the canon equations', () => {
    expect(markup).toContain('class="katex"');
  });

  test('keeps the MathML twin for screen readers', () => {
    expect(markup).toContain('<annotation encoding="application/x-tex">');
  });

  test('injects no scripts or event handlers', () => {
    expect(markup).not.toContain('<script');
    expect(markup).not.toMatch(/\son[a-z]+=/i);
  });
});
