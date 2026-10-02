/**
 * One Node policy, stated the same way everywhere: Node 22 or newer (Node 20
 * reached end-of-life in April 2026, and matrix-bot-sdk itself requires 22),
 * tested in CI on 22 and 24. Matrix end-to-end encryption needs Node 24+; that
 * is documented in docs/channels/matrix.md and enforced at boot, not here.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Node version policy', () => {
  it.each(['package.json', 'bot/package.json'])('%s declares engines.node >=22', (rel) => {
    expect(JSON.parse(read(rel)).engines.node).toBe('>=22.0.0');
  });

  it('CI tests on Node 22 and 24', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/node-version: \[22, 24\]/);
  });

  it.each(['ci.yml', 'deploy.yml', 'fresh-clone-smoke.yml'])('%s pins no end-of-life Node', (file) => {
    const pins = [...read(`.github/workflows/${file}`).matchAll(/node-version:\s*'?(\d+)'?\s*$/gm)].map((m) => Number(m[1]));
    for (const major of pins) expect(major).toBeGreaterThanOrEqual(22);
  });

  it.each(['README.md', 'SETUP.md', 'AGENTS.md', 'docs/local-stack.md'])('%s states the same minimum', (rel) => {
    expect(read(rel)).not.toMatch(/Node(\.js)? 20\+/);
  });
});
