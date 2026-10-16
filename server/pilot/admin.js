import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppError, token } from '../domain.js';

export const normalizeEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const requireValue = (condition, message, status = 400) => {
  if (!condition) throw new AppError(message, status);
};
export function passwordFields(password) {
  requireValue(
    typeof password === 'string' && password.length >= 16 && password.length <= 200,
    'Use a unique password between 16 and 200 characters.',
  );
  const salt = token();
  return { salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
}
export function checkPassword(user, password) {
  const actual = scryptSync(String(password || '').slice(0, 200), user?.salt || 'dummy-salt', 64);
  const expected = Buffer.from(user?.passwordHash || '', 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export const publicAdmin = ({ id, email, role, active, orgId }) => ({
  id,
  email,
  role,
  active,
  orgId,
});
export function recordAdminEvent(state, actor, action, userId) {
  state.adminAudit.push({
    id: randomUUID(),
    orgId: actor.orgId,
    actor: actor.userId,
    action,
    userId,
    at: new Date().toISOString(),
  });
}
export function addAdmin(state, actor, { email, password, role = 'admin' }) {
  requireValue(actor.role === 'owner', 'Organization owner access required.', 403);
  email = normalizeEmail(email);
  requireValue(
    email.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email),
    'Enter a valid administrator email.',
  );
  requireValue(['owner', 'admin'].includes(role), 'Choose owner or admin access.');
  requireValue(
    !state.users.some((u) => u.email === email),
    'An administrator already uses that email.',
    409,
  );
  const user = {
    id: randomUUID(),
    orgId: actor.orgId,
    email,
    role,
    active: true,
    credentialVersion: 1,
    ...passwordFields(password),
  };
  state.users.push(user);
  recordAdminEvent(state, actor, 'admin-created', user.id);
  return publicAdmin(user);
}
export function revokeUserSessions(sessions, userId) {
  for (const [key, session] of sessions) if (session.userId === userId) sessions.delete(key);
}
export function updateAdmin(state, sessions, actor, userId, input) {
  requireValue(actor.role === 'owner', 'Organization owner access required.', 403);
  const user = state.users.find((u) => u.id === userId && u.orgId === actor.orgId);
  requireValue(user, 'Administrator not found.', 404);
  requireValue(typeof input.active === 'boolean', 'Choose an active or disabled account.');
  requireValue(user.id !== actor.userId || input.active, 'You cannot disable your own account.');
  requireValue(
    input.active ||
      user.role !== 'owner' ||
      state.users.some(
        (u) => u.id !== user.id && u.orgId === user.orgId && u.role === 'owner' && u.active,
      ),
    'Keep at least one active organization owner.',
    409,
  );
  if (user.active !== input.active) {
    user.active = input.active;
    user.credentialVersion++;
    revokeUserSessions(sessions, user.id);
    recordAdminEvent(state, actor, input.active ? 'admin-enabled' : 'admin-disabled', user.id);
  }
  return publicAdmin(user);
}
export function replacePassword(state, sessions, actor, user, password) {
  Object.assign(user, passwordFields(password));
  user.credentialVersion++;
  revokeUserSessions(sessions, user.id);
  recordAdminEvent(state, actor, 'password-replaced', user.id);
}

export function createPilotState() {
  return {
    state: {
      version: 1,
      organizations: [
        {
          id: 'tvvc',
          name: 'Tualatin Valley Volleyball Club',
          color: '#39c6b0',
          receiptWording:
            'TVVC is a for-profit organization. Contributions are not tax-deductible. No charitable tax receipt is issued.',
        },
      ],
      users: [],
      campaigns: [],
      athletes: [],
      contacts: [],
      ledger: [],
      jobs: [],
      activity: [],
      audit: [],
      adminAudit: [],
      mediaAssets: [],
      suppressions: [],
      requests: {},
      events: {},
    },
    links: {},
    auth: { sessions: [], attempts: [] },
  };
}
