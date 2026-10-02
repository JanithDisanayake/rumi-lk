/**
 * infrastructure/local/{up,down}.sh + supabase-shim.sql — static guards.
 *
 * The scripts start real processes, so CI does not run them. These checks
 * catch the cheap breakages: a syntax error, a shim that lost a role the
 * schema files need, or a schema edit that moves the pgvector line up.sh
 * comments out when pgvector is missing.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const LOCAL = path.join(ROOT, 'infrastructure', 'local');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('local stack scripts', () => {
  it.each(['up.sh', 'down.sh'])('%s parses with bash -n', (name) => {
    expect(() => execFileSync('bash', ['-n', path.join(LOCAL, name)], { stdio: 'pipe' })).not.toThrow();
  });

  it('the shim creates the Supabase roles, auth helpers, exec_sql and the vector fallback', () => {
    const shim = read('infrastructure/local/supabase-shim.sql');
    for (const role of ['anon', 'authenticated', 'service_role', 'authenticator']) {
      expect(shim).toMatch(new RegExp(`CREATE ROLE ${role}\\b`));
    }
    expect(shim).toMatch(/service_role NOLOGIN BYPASSRLS/);
    expect(shim).toMatch(/FUNCTION auth\.role\(\)/);
    expect(shim).toMatch(/FUNCTION auth\.uid\(\)/);
    expect(shim).toMatch(/request\.jwt\.claims/);
    expect(shim).toMatch(/FUNCTION public\.exec_sql\(query text\)/);
    expect(shim).toMatch(/CREATE DOMAIN public\.vector/);
  });

  it('up.sh comments out exactly the one pgvector line that 00_complete-schema.sql has', () => {
    const up = read('infrastructure/local/up.sh');
    const line = 'CREATE EXTENSION IF NOT EXISTS "vector"';
    expect(up).toContain(line);
    const schema = read('infrastructure/supabase/00_complete-schema.sql');
    expect(schema.split('\n').filter((l) => l.includes(line))).toHaveLength(1);
  });

  it('the default state dir is git-ignored', () => {
    expect(read('infrastructure/local/up.sh')).toMatch(/\.local-stack/);
    expect(read('.gitignore').split('\n')).toContain('.local-stack/');
  });
});
