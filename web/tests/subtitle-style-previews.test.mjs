import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUBTITLE_SAMPLE_LINES,
  SUBTITLE_STYLE_SPECS,
  getSubtitlePreviewData,
} from '../src/lib/subtitle-style-previews.js';

test('subtitle preview exposes all 5 rendered styles and 3 Vietnamese sample lines', () => {
  assert.deepEqual(Object.keys(SUBTITLE_STYLE_SPECS), ['minimal', 'bold', 'cinema', 'neon', 'box']);
  assert.equal(SUBTITLE_SAMPLE_LINES.length, 3);
  for (const styleId of Object.keys(SUBTITLE_STYLE_SPECS)) {
    const data = getSubtitlePreviewData(styleId, '', 1);
    assert.equal(data.spec.id, styleId);
    assert.equal(data.sampleText, SUBTITLE_SAMPLE_LINES[1]);
    assert.ok(data.spec.description.length > 10);
  }
});

test('subtitle preview falls back safely and scales proportionally with font size', () => {
  const unknown = getSubtitlePreviewData('unknown_style', '', 4);
  assert.equal(unknown.spec.id, 'minimal');
  assert.equal(unknown.sampleIndex, 1);

  const small = getSubtitlePreviewData('box', '24', 0);
  const large = getSubtitlePreviewData('box', '36', 0);
  assert.ok(large.previewFontPx > small.previewFontPx);
  assert.ok(large.stageFontPx > small.stageFontPx);
});
