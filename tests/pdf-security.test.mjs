import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

// Run against a production build started locally with npm start.
const origin = process.env.PDF_TEST_ORIGIN;
if (!origin || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Set PDF_TEST_ORIGIN to a local test server URL');
}

async function exportMarkdown(markdown) {
  const body = new FormData();
  body.set('markdown', markdown);
  body.set('filename', 'security-test.pdf');
  return fetch(new URL('/api/download-pdf', origin), {
    method: 'POST', body, signal: AbortSignal.timeout(45_000),
  });
}

test('Markdown exports produce a PDF and reject empty input', async () => {
  const response = await exportMarkdown('# Export regression test\n\nOrdinary Markdown remains readable.');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await exportMarkdown('')).status, 400);
});

test('untrusted HTML cannot contact another server during PDF rendering', async () => {
  const requests = [];
  const canary = createServer((request, response) => {
    requests.push(request.url);
    response.end('Canary resource');
  });
  canary.listen(0, '127.0.0.1');
  await once(canary, 'listening');
  const target = `http://127.0.0.1:${canary.address().port}`;
  try {
    const response = await exportMarkdown(`# Offline export\n
<img src="${target}/image">
<iframe src="${target}/frame"></iframe>
<link rel="stylesheet" href="${target}/stylesheet">
<style>body { background-image: url('${target}/background'); }</style>
<script>document.body.innerHTML = 'JAVASCRIPT_EXECUTED'; fetch('${target}/script');</script>
<p>JAVASCRIPT_DISABLED_MARKER</p>`);
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(requests, [], 'PDF rendering must not fetch supplied URLs');
  } finally {
    canary.closeAllConnections();
    await new Promise(resolve => canary.close(resolve));
  }
});
