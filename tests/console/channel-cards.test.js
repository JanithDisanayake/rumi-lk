/**
 * Additive channels on the console: each one gets its own card with its own
 * name and setup pointer, and its own plain-language "what happens if I turn
 * this off" line. The card used to be a two-way slack/discord ternary, so a
 * third channel rendered as a second "Discord" card with Discord's link.
 */

const { buildCatalog } = require('../../bot/console/env-catalog');
const { WHEN_OFF } = require('../../bot/console/features');
const { FEATURES, ADDITIVE_CHANNEL_REQUIRED_VARS } = require('../../bot/shared/config/feature-availability');

function channelCards(env) {
  const group = buildCatalog(env).groups.find((g) => g.id === 'channels');
  return group ? group.abilities.filter((a) => a.guide) : [];
}

describe('console channel cards', () => {
  it('gives every additive channel a card titled with its own name', () => {
    const cards = channelCards({});
    const titles = cards.map((c) => c.title);
    expect(titles).toEqual(expect.arrayContaining(['Slack', 'Discord', 'Matrix']));
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('points the Matrix card at a homeserver, not at Discord', () => {
    const matrix = channelCards({}).find((c) => c.guide === 'matrix');
    expect(matrix.title).toBe('Matrix');
    expect(matrix.keys).toEqual(ADDITIVE_CHANNEL_REQUIRED_VARS.matrix);
    expect(matrix.why).toMatch(/Matrix/);
    expect(matrix.where).not.toMatch(/discord/i);
  });

  it('has a "when off" line for every channel feature', () => {
    const channelIds = FEATURES.map((f) => f.id).filter((id) => id && id.startsWith('channel_'));
    expect(channelIds).toEqual(expect.arrayContaining(['channel_slack', 'channel_discord', 'channel_matrix']));
    for (const id of channelIds) expect(WHEN_OFF[id]).toEqual(expect.any(String));
  });
});
