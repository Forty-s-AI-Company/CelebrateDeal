import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { classifyLocalTestDatabase } from '../../scripts/local-database-safety';
import { getDb } from './db';
import { createInstructorChatMessage, createViewerChatMessage, listViewerChatMessages } from './live-chat';
import { createFormSubmissionChatSessionToken } from './form-submission-chat-session';
import { hashLiveViewerToken } from './live-quota-admission';
import { answerCard, commandCard, instructorCards, viewerCardSnapshot } from './interaction-card';
import { readDanmaku, setDanmaku } from './live-danmaku';
import { commandWarmup } from './scripted-roles';

const enabled = process.env.RT01_D2_DISPOSABLE_DB === 'true' && classifyLocalTestDatabase(process.env.DATABASE_URL).safe;
const config = { version: 1 as const, kind: 'interaction_card' as const, answerType: 'text' as const, visibility: 'instructor_only' as const, options: [] };
async function fixture() {
  const db = getDb(); const id = randomUUID(); const now = new Date();
  const vendor = await db.vendor.create({ data: { name: 'Cross feature', slug: id, email: `${id}@example.test`, passwordHash: 'synthetic' } });
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: 'Synthetic', slug: randomUUID(), headline: 'Synthetic', fields: [] } });
  const live = await db.live.create({ data: { vendorId: vendor.id, formId: form.id, title: 'Integration', slug: randomUUID(), scheduledAt: now, streamMode: 'live', status: 'live' } });
  const scope = { vendorId: vendor.id, liveId: live.id };
  const viewers = await Promise.all(['A', 'B'].map(async name => {
    const submission = await db.formSubmission.create({ data: { formId: form.id, liveId: live.id, name, email: `${name}-${id}@example.test`, verificationStatus: 'VERIFIED' } });
    const admissionToken = randomBytes(32).toString('base64url');
    const participant = hashLiveViewerToken(admissionToken);
    await db.liveViewerSession.create({ data: { ...scope, tokenHash: participant, lastSeenAt: now, expiresAt: new Date(now.getTime() + 120000) } });
    return { submission, participant, input: { ...scope, admissionToken, chatSessionToken: createFormSubmissionChatSessionToken({ submissionId: submission.id, now }), ipAddress: '203.0.113.7', now } };
  }));
  return { db, scope, viewers };
}

describe.skipIf(!enabled)('live cross-feature database integration', () => {
  afterAll(async () => { await getDb().$disconnect(); });
  it('keeps real private writes and private cards isolated while public answers and labelled roles share the feed', async () => {
    const { db, scope, viewers: [a, b] } = await fixture();
    for (const viewer of [a, b]) {
      await createViewerChatMessage(db, { ...viewer.input, body: `PRIVATE ${viewer.submission.name}`, clientMessageId: randomUUID() });
      await createInstructorChatMessage(db, { ...scope, submissionId: viewer.submission.id, body: `REPLY ${viewer.submission.name}`, clientMessageId: randomUUID() });
    }
    const privateCard = await commandCard(db, scope.vendorId, { action: 'create', liveId: scope.liveId, title: 'Private', configuration: config });
    await commandCard(db, scope.vendorId, { action: 'start', liveId: scope.liveId, runId: privateCard.id });
    await Promise.all([a, b].map(viewer => answerCard(db, scope, viewer.participant, privateCard.id, `PRIVATE CARD ${viewer.submission.name}`)));
    for (const viewer of [a, b]) {
      expect((await listViewerChatMessages(db, viewer.input)).messages.map(m => m.body).sort()).toEqual([`PRIVATE ${viewer.submission.name}`, `REPLY ${viewer.submission.name}`]);
      expect((await viewerCardSnapshot(db, scope, viewer.participant)).card?.ownValue).toBe(`PRIVATE CARD ${viewer.submission.name}`);
    }
    const publicCard = await commandCard(db, scope.vendorId, { action: 'create', liveId: scope.liveId, title: 'Public', configuration: { ...config, visibility: 'public_display' } });
    await commandCard(db, scope.vendorId, { action: 'start', liveId: scope.liveId, runId: publicCard.id });
    const role = await db.interactionRole.create({ data: { vendorId: scope.vendorId, name: '預設角色', isActive: true, isScheduled: true } });
    const script = await db.interactionScript.create({ data: { vendorId: scope.vendorId, name: 'Warmup', status: 'published' } });
    const event = await db.interactionEvent.create({ data: { scriptId: script.id, roleId: role.id, eventType: 'chat_message', title: 'Warmup', message: '暖場提示', triggerSec: 10 } });
    await setDanmaku(db, scope, true);
    await commandWarmup(db, scope.vendorId, { action: 'select', liveId: scope.liveId, scriptId: script.id, scheduled: false });
    const baseline = await readDanmaku(db, scope);
    await answerCard(db, scope, a.participant, publicCard.id, 'PUBLIC A');
    await commandWarmup(db, scope.vendorId, { action: 'send', liveId: scope.liveId, eventId: event.id, requestId: randomUUID() });
    const result = await readDanmaku(db, scope, baseline.cursor, baseline.state.epoch);
    expect(result.items.map(item => item.value).sort()).toEqual(['PUBLIC A', '暖場提示']);
    expect(result.items.find(item => item.value === '暖場提示')?.source).toBe('scripted_role');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|REPLY|participantHash|formSubmissionId/);
    const stats = await instructorCards(db, scope);
    expect(stats.find(card => card.id === privateCard.id)?.responseCount).toBe(2);
    expect(stats.find(card => card.id === publicCard.id)?.responseCount).toBe(1);
    expect(await db.liveChatMessage.count({ where: scope })).toBe(4);
    expect(await db.liveInteractionResponse.count({ where: scope })).toBe(3);
    expect(await db.liveViewerSession.count({ where: scope })).toBe(2);
    await commandWarmup(db, scope.vendorId, { action: 'stop', liveId: scope.liveId });
    expect((await readDanmaku(db, scope, result.cursor, result.state.epoch)).items).toEqual([]);
  });
  it('serializes close against concurrent same-answer retries and rejects all post-close new answers', async () => {
    const { db, scope, viewers: [a, b] } = await fixture();
    const card = await commandCard(db, scope.vendorId, { action: 'create', liveId: scope.liveId, title: 'Race', configuration: config });
    await commandCard(db, scope.vendorId, { action: 'start', liveId: scope.liveId, runId: card.id });
    const results = await Promise.allSettled([
      answerCard(db, scope, a.participant, card.id, 'same'),
      commandCard(db, scope.vendorId, { action: 'end', liveId: scope.liveId, runId: card.id }),
      answerCard(db, scope, a.participant, card.id, 'same'),
    ]);
    expect(results[1].status).toBe('fulfilled');
    for (const result of [results[0], results[2]]) if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
    const count = await db.liveInteractionResponse.count({ where: { ...scope, runId: card.id } });
    expect(count).toBe(results[0].status === 'fulfilled' || results[2].status === 'fulfilled' ? 1 : 0);
    await expect(answerCard(db, scope, b.participant, card.id, 'late')).rejects.toMatchObject({ status: 409 });
    if (count === 1) {
      expect((await answerCard(db, scope, a.participant, card.id, 'same')).ownValue).toBe('same');
      await expect(answerCard(db, scope, a.participant, card.id, 'changed')).rejects.toMatchObject({ status: 409 });
    }
    expect((await viewerCardSnapshot(db, scope, b.participant)).card).toBeNull();
  });
  it('lets concurrent danmaku readers share the activity lock without passing an uncommitted answer', async () => {
    const { db, scope, viewers: [a] } = await fixture();
    await setDanmaku(db, scope, true);
    const card = await commandCard(db, scope.vendorId, { action: 'create', liveId: scope.liveId, title: 'Concurrency', configuration: { ...config, visibility: 'public_display' } });
    await commandCard(db, scope.vendorId, { action: 'start', liveId: scope.liveId, runId: card.id });
    const before = await readDanmaku(db, scope);
    let release!: () => void; let acquired!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const reader = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Live" WHERE "id"=${scope.liveId} FOR SHARE`;
      acquired(); await held;
    }, { timeout: 10000 });
    await ready;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const concurrent = readDanmaku(db, scope, before.cursor, before.state.epoch);
    try {
      // A reader holding SHARE must not block another reader. The previous UPDATE lock fails here.
      expect(await Promise.race([concurrent.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 2000); })])).toBe(true);
    } finally { clearTimeout(timer); release(); await reader; await concurrent; }
    const answers = await Promise.all([answerCard(db, scope, a.participant, card.id, 'committed'), readDanmaku(db, scope, before.cursor, before.state.epoch)]);
    const snapshot = answers[1];
    const after = await readDanmaku(db, scope, snapshot.cursor, snapshot.state.epoch);
    // Whether the read wins or loses the lock race, its watermark must never lose the new answer.
    expect([...snapshot.items, ...after.items].some(item => item.value === 'committed')).toBe(true);
  });
});
