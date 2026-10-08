import {describe, expect, it} from 'vitest';
import {generateReferralShareCard} from './referral-share-card';

describe('referral share card', () => {
  it('escapes user-controlled titles and embeds a locally generated QR image', async () => {
    const svg = await generateReferralShareCard('<script>"&活動', 'https://example.test/live/event?ref=partner');
    expect(svg).toContain('&lt;script&gt;&quot;&amp;活動');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).not.toContain('partner');
  });
  it.each(['javascript:alert(1)', 'data:text/html,bad', 'https://user:password@example.test/'])('rejects unsafe links: %s', async url => {
    await expect(generateReferralShareCard('活動', url)).rejects.toThrow('Invalid referral URL');
  });
  it('bounds the visible title and rejects oversized links', async () => {
    const svg = await generateReferralShareCard('界'.repeat(200), 'https://example.test/');
    expect(svg.match(/界/g)).toHaveLength(40);
    expect(svg).not.toContain('界'.repeat(41));
    await expect(generateReferralShareCard('活動', `https://example.test/${'a'.repeat(2048)}`)).rejects.toThrow();
  });
});
