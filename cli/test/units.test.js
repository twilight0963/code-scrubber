const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { globToRegExp } = require('../config')
const { AddedLinesParser } = require('../git')

describe('globToRegExp', () => {
  const cases = [
    ['docs/**', 'docs/a/b.md', true],
    ['docs/**', 'src/docs/a.md', false],
    ['**/*.snap', 'a/b/c.snap', true],
    ['**/*.snap', 'c.snap', true],
    ['*.min.js', 'dist/app.min.js', true],
    ['test/fixtures', 'test/fixtures/keys.js', true],
    ['src/*.js', 'src/a/b.js', false],
    ['*.{yml,yaml}', 'ci/deploy.yaml', true],
    ['file?.txt', 'file1.txt', true]
  ]
  for (const [glob, file, expected] of cases) {
    test(`${glob} ${expected ? 'matches' : 'does not match'} ${file}`, () => {
      assert.equal(globToRegExp(glob).test(file), expected)
    })
  }
})

describe('AddedLinesParser', () => {
  test('tracks added line numbers per commit and file', () => {
    const files = []
    const parser = new AddedLinesParser(f => files.push(f))
    const lines = [
      '\0COMMIT abc123 2026-01-02T03:04:05+00:00 Jane Doe',
      'diff --git a/x.js b/x.js',
      '--- a/x.js',
      '+++ b/x.js',
      '@@ -1,0 +2,2 @@',
      '+first',
      '+second',
      '@@ -9 +10 @@',
      '-old',
      '+tenth',
      'diff --git a/gone.js b/gone.js',
      '--- a/gone.js',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-deleted',
      'diff --git "a/caf\\303\\251.js" "b/caf\\303\\251.js"',
      '+++ "b/caf\\303\\251.js"',
      '@@ -0,0 +1 @@',
      '+hi'
    ]
    lines.forEach(l => parser.line(l))
    parser.end()

    assert.equal(files.length, 2)
    assert.equal(files[0].file, 'x.js')
    assert.equal(files[0].commit.sha, 'abc123')
    assert.equal(files[0].commit.author, 'Jane Doe')
    assert.deepEqual([...files[0].lines], [[2, 'first'], [3, 'second'], [10, 'tenth']])
    assert.equal(files[1].file, 'café.js')
  })
})
