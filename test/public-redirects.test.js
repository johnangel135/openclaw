'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function readPublic(relativePath) {
  return fs.readFile(path.join(__dirname, '..', 'public', relativePath), 'utf8');
}

test('public auth/login/console redirects preserve query string', async () => {
  const [authHtml, loginHtml, consoleHtml] = await Promise.all([
    readPublic(path.join('auth', 'index.html')),
    readPublic(path.join('login', 'index.html')),
    readPublic(path.join('console', 'index.html')),
  ]);

  for (const html of [authHtml, loginHtml, consoleHtml]) {
    assert.match(html, /if \(location\.search\) target\.search = location\.search\.slice\(1\);/);
    assert.match(html, /location\.replace\(target\.toString\(\)\);/);
  }
});
