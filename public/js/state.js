import { get, setCsrf } from './api.js';

export const session = { me: null, mfaPending: false };
const orgCache = new Map();

export async function loadSession() {
  try {
    const me = await get('/api/auth/me');
    setCsrf(me.csrfToken);
    session.mfaPending = Boolean(me.mfaPending);
    session.me = me.mfaPending ? null : me;
  } catch {
    session.me = null;
    session.mfaPending = false;
  }
  orgCache.clear();
  return session;
}

/** Org details incl. role, plan and usage; cached until invalidated. */
export async function orgInfo(orgId, { fresh = false } = {}) {
  if (!fresh && orgCache.has(orgId)) return orgCache.get(orgId);
  const info = await get(`/api/orgs/${orgId}`);
  orgCache.set(orgId, info);
  return info;
}

export function invalidateOrg(orgId) {
  if (orgId) orgCache.delete(orgId);
  else orgCache.clear();
}

export const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };
export const can = (role, min) => ROLE_RANK[role] >= ROLE_RANK[min];
