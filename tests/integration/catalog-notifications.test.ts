import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, createHarness, createPlatformAdmin, publishedVersionId, resetData, signUp, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h.ownerDb));

type Client = Awaited<ReturnType<typeof createPlatformAdmin>>;
type Owner = Awaited<ReturnType<typeof signUp>>;
interface Material { id: string; title: string }
interface Subject { id: string; grade: number; track: string; block: string; code: string; materials: Material[] }

const notes = (userId: string, kind?: string) => {
  let q = h.ownerDb.selectFrom('notifications').select(['kind', 'title', 'body', 'link', 'org_id']).where('user_id', '=', userId).orderBy('created_at');
  if (kind) q = q.where('kind', '=', kind);
  return q.execute();
};
const mails = (to: string, template: string) => h.ownerDb.selectFrom('email_outbox').select(['subject', 'text_body']).where('to_email', '=', to).where('template', '=', template).execute();
const subjects = async (c: Client, versionId: string) => ((await c.get(`/api/admin/catalog/versions/${versionId}`)).json() as { subjects: Subject[] }).subjects;

async function scopeWith(owner: Owner, versionId: string, name: string, materialIds: string[]) {
  const scope = (await owner.client.post(`/api/orgs/${owner.orgId}/scopes`, { name, catalogVersionId: versionId })).json().scope as { id: string };
  if (materialIds.length) expect((await owner.client.post(`/api/orgs/${owner.orgId}/scopes/${scope.id}/items`, { add: materialIds })).statusCode).toBe(200);
  return scope.id;
}

async function newVersion(admin: Client, fromVersionId: string, academicYear: string, label: string) {
  const res = await admin.post('/api/admin/catalog/versions', { fromVersionId, academicYear, label });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

describe('catalogue change notifications', () => {
  it('a newer catalogue notifies owners, admins and editors of organizations behind it, in their language, once per year', async () => {
    const admin = await createPlatformAdmin(h);
    const currentId = await publishedVersionId(h);
    const subs = await subjects(admin, currentId);
    const m = subs[0]!.materials.map((x) => x.id);

    const a = await signUp(h, { org: 'Org A' });
    const scopeA = await scopeWith(a, currentId, 'Plan A', m.slice(0, 2));
    const editor = await addMember(h, a.client, a.orgId, 'editor');
    expect((await editor.client.patch('/api/auth/profile', { locale: 'ar' })).statusCode).toBe(200);
    const viewer = await addMember(h, a.client, a.orgId, 'viewer');

    const quiet = await signUp(h, { org: 'No scopes' });
    const suspended = await signUp(h, { org: 'Suspended org' });
    await scopeWith(suspended, currentId, 'Suspended plan', m.slice(0, 1));
    expect((await admin.post(`/api/admin/orgs/${suspended.orgId}/suspend`, { reason: 'Notification test' })).statusCode).toBe(200);
    const optOut = await signUp(h, { org: 'Opted out' });
    await scopeWith(optOut, currentId, 'One', m.slice(0, 1));
    await scopeWith(optOut, currentId, 'Two', m.slice(1, 2));
    expect((await optOut.client.patch('/api/auth/profile', { catalogEmails: false })).json().user.catalogEmails).toBe(false);

    const nextId = await newVersion(admin, currentId, '2027/2028', 'Next year');
    const published = await admin.post(`/api/admin/catalog/versions/${nextId}/publish`);
    expect(published.json()).toEqual({ status: 'published', notifiedOrgs: 2 });

    expect(await notes(a.userId, 'catalog_behind')).toEqual([{
      kind: 'catalog_behind', org_id: a.orgId, title: 'The 2027/2028 catalogue is published',
      body: '“Plan A” still uses an older catalogue. Review what changed and carry it forward.',
      link: `/org/${a.orgId}/scopes/${scopeA}/carry?to=${nextId}`,
    }]);
    expect((await notes(editor.userId, 'catalog_behind'))[0]).toMatchObject({ title: 'نُشر دليل عام 2027/2028', body: expect.stringContaining('«Plan A»') });
    expect(await notes(viewer.userId, 'catalog_behind')).toEqual([]);
    expect(await notes(quiet.userId, 'catalog_behind')).toEqual([]);
    expect(await notes(suspended.userId, 'catalog_behind')).toEqual([]);
    // Several scopes: the link goes to the scopes list. Opted out: in-app only.
    expect((await notes(optOut.userId, 'catalog_behind'))[0]).toMatchObject({ link: `/org/${optOut.orgId}/scopes`, body: '“One”, “Two” still use an older catalogue. Review what changed and carry them forward.' });
    expect(await mails(optOut.email, 'catalog_published')).toEqual([]);

    const [mail] = await mails(a.email, 'catalog_published');
    expect(mail!.subject).toBe('The 2027/2028 curriculum catalogue is published');
    expect(mail!.text_body).toContain(`• Plan A`);
    expect(mail!.text_body).toContain(`${h.config.APP_URL}/org/${a.orgId}/scopes/${scopeA}/carry?to=${nextId}`);
    expect(mail!.text_body).toContain(`${h.config.APP_URL}/account`);
    expect((await mails(editor.email, 'catalog_published'))[0]!.subject).toBe('نُشر دليل المناهج لعام 2027/2028');

    // Archiving last year's version does not notify about 2027/2028 again.
    expect((await admin.post(`/api/admin/catalog/versions/${currentId}/archive`)).json()).toEqual({ status: 'archived', notifiedOrgs: 0 });
    expect(await notes(a.userId, 'catalog_behind')).toHaveLength(1);
  });

  it('organizations already on a year hear about its correction only when the version they use is archived', async () => {
    const admin = await createPlatformAdmin(h);
    const currentId = await publishedVersionId(h);
    const a = await signUp(h);
    const m = (await subjects(admin, currentId))[0]!.materials.map((x) => x.id);
    const scope = await scopeWith(a, currentId, 'Plan', m.slice(0, 1));

    const correctionId = await newVersion(admin, currentId, '2026/2027', 'Correction');
    expect((await admin.post(`/api/admin/catalog/versions/${correctionId}/publish`)).json().notifiedOrgs).toBe(0);
    expect(await notes(a.userId, 'catalog_behind')).toEqual([]);

    expect((await admin.post(`/api/admin/catalog/versions/${currentId}/archive`)).json().notifiedOrgs).toBe(1);
    expect((await notes(a.userId, 'catalog_behind'))[0]!.link).toBe(`/org/${a.orgId}/scopes/${scope}/carry?to=${correctionId}`);
  });

  it('entries newly flagged for review notify organizations that selected them; repeats and other marks do not', async () => {
    const admin = await createPlatformAdmin(h);
    const versionId = await publishedVersionId(h);
    const subs = await subjects(admin, versionId);
    const [s1, s2] = [subs.find((s) => s.materials.length >= 2)!, subs.find((s) => s.materials.length >= 1 && s.grade !== subs[0]!.grade)!];
    const a = await signUp(h, { org: 'Flag org' });
    const scope = await scopeWith(a, versionId, 'Flagged plan', [s1.materials[0]!.id, s1.materials[1]!.id, s2.materials[0]!.id]);
    const editor = await addMember(h, a.client, a.orgId, 'editor');
    const viewer = await addMember(h, a.client, a.orgId, 'viewer');
    const other = await signUp(h, { org: 'Unrelated' });
    await scopeWith(other, versionId, 'Elsewhere', [s2.materials[0]!.id]);

    const flag = (body: object) => admin.post(`/api/admin/catalog/versions/${versionId}/verification`, body);
    expect((await flag({ materialIds: [s1.materials[0]!.id], status: 'needs_review', note: '2026/27 edition not yet announced' })).statusCode).toBe(200);

    expect(await notes(a.userId, 'catalog_review')).toEqual([{
      kind: 'catalog_review', org_id: a.orgId, title: '1 selected item is under review',
      body: '2026/27 edition not yet announced — “Flagged plan”', link: `/org/${a.orgId}?scope=${scope}`,
    }]);
    expect(await notes(editor.userId, 'catalog_review')).toHaveLength(1);
    expect(await notes(viewer.userId, 'catalog_review')).toEqual([]);
    expect(await notes(other.userId, 'catalog_review')).toEqual([]);
    const [mail] = await mails(a.email, 'catalog_review');
    expect(mail!.subject).toBe('1 item in your scopes is under review');
    expect(mail!.text_body).toContain(`• ${s1.materials[0]!.title}`);

    // Saving the same flag again is not news; a new note is.
    await flag({ materialIds: [s1.materials[0]!.id], status: 'needs_review', note: '2026/27 edition not yet announced' });
    expect(await notes(a.userId, 'catalog_review')).toHaveLength(1);
    await flag({ materialIds: [s1.materials[0]!.id], status: 'needs_review', note: 'Publisher confirmed a 2nd edition' });
    expect(await notes(a.userId, 'catalog_review')).toHaveLength(2);

    // Flagging a subject covers the selected materials under it; the other org also selected s2.
    await flag({ subjectIds: [s2.id], status: 'needs_review', note: 'Subject status under review' });
    expect((await notes(a.userId, 'catalog_review'))[2]!.title).toBe('1 selected item is under review');
    expect(await notes(other.userId, 'catalog_review')).toHaveLength(1);

    // Verified marks and entries nobody selected notify no one.
    const before = (await notes(a.userId)).length;
    await flag({ subjectIds: [s1.id], materialIds: s1.materials.map((x) => x.id), status: 'verified', source: 'Decree 1/2026' });
    const unselected = subs.find((s) => s.id !== s1.id && s.id !== s2.id)!;
    await flag({ materialIds: [unselected.materials[0]!.id], status: 'needs_review', note: 'Nobody selected this' });
    expect((await notes(a.userId)).length).toBe(before);
  });

  it('users can turn catalogue emails off and on in their profile', async () => {
    const a = await signUp(h);
    expect((await a.client.get('/api/auth/me')).json().user.catalogEmails).toBe(true);
    expect((await a.client.patch('/api/auth/profile', { catalogEmails: false })).statusCode).toBe(200);
    expect((await a.client.get('/api/auth/me')).json().user.catalogEmails).toBe(false);
    expect((await a.client.patch('/api/auth/profile', { catalogEmails: 'no' })).statusCode).toBe(400);
  });
});
