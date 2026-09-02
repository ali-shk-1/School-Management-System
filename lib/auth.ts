import jwt from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';
import { isAli, defaultsForRole } from './permissions';

export interface JwtPayload {
  user_id: number;
  username: string;
  role: string;
  staff_id: number | null;
}

/**
 * Ported from middleware/authMiddleware.js `authenticate`.
 * Reads Authorization: Bearer <token>, or ?token= query param (needed for
 * EventSource, which can't set custom headers — see /api/events route).
 * Returns the decoded payload, or a NextResponse to return immediately
 * (401/403) if verification fails.
 */
export function authenticate(
  req: NextRequest
): { user: JwtPayload } | { error: NextResponse } {
  const authHeader = req.headers.get('authorization');
  let token: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else {
    const tokenParam = req.nextUrl.searchParams.get('token');
    if (tokenParam) token = tokenParam;
  }

  if (!token) {
    return {
      error: NextResponse.json({ error: 'No token provided. Access denied.' }, { status: 401 }),
    };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    return { user: decoded };
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return {
        error: NextResponse.json({ error: 'Token expired. Please log in again.' }, { status: 401 }),
      };
    }
    return { error: NextResponse.json({ error: 'Invalid token.' }, { status: 403 }) };
  }
}

/**
 * Ported from middleware/authMiddleware.js `authorize(...roles)`.
 * Plain role allow-list check (used for a handful of ali/admin-only routes).
 */
export function authorizeRoles(user: JwtPayload, ...roles: string[]): NextResponse | null {
  const normalizedRoles = roles.map((r) => r.toLowerCase());
  const userRole = user.role ? user.role.toLowerCase() : null;
  if (!userRole || !normalizedRoles.includes(userRole)) {
    return NextResponse.json(
      { error: `Access denied. Required role(s): ${roles.join(', ')}.` },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Perf: role_permissions is read on essentially every mutating request
 * (every add/edit/delete across students, staff, fees, expenses...) via
 * can() below, but the table itself changes rarely — only when someone
 * on the Permissions page explicitly edits a role's access. Caching each
 * (role, permission_key) lookup in memory for a short TTL turns that
 * per-mutation DB round-trip into a cache hit almost all the time,
 * without meaningfully delaying how fast a permission change takes
 * effect (worst case: the TTL window, same tradeoff already accepted
 * for the client-side GET cache in lib/api-client.ts).
 *
 * invalidatePermissionCache() is called from the permissions write
 * routes so an admin's change is picked up immediately rather than
 * waiting out the TTL.
 */
const PERMISSION_CACHE_TTL_MS = 30_000;
type PermCacheEntry = { allowed: boolean; expires: number };
const permissionCache = new Map<string, PermCacheEntry>();

function permCacheKey(role: string, permissionKey: string): string {
  return `${role}::${permissionKey}`;
}

export function invalidatePermissionCache(role?: string): void {
  if (!role) {
    permissionCache.clear();
    return;
  }
  const prefix = `${role.toLowerCase()}::`;
  for (const key of permissionCache.keys()) {
    if (key.startsWith(prefix)) permissionCache.delete(key);
  }
}

async function isPermissionAllowed(role: string, permissionKey: string): Promise<boolean> {
  const key = permCacheKey(role, permissionKey);
  const cached = permissionCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.allowed;

  const row = await prisma.rolePermission.findUnique({
    where: { role_name_permission_key: { role_name: role, permission_key: permissionKey } },
  });

  const allowed = row ? row.allowed : !!defaultsForRole(role)[permissionKey];
  permissionCache.set(key, { allowed, expires: Date.now() + PERMISSION_CACHE_TTL_MS });
  return allowed;
}

/**
 * Ported from middleware/authMiddleware.js `can(permissionKey)`.
 * - 'ali' always passes.
 * - Otherwise looks up role_permissions (cached, see isPermissionAllowed
 *   above); falls back to hardcoded defaults in lib/permissions.ts if no
 *   row exists yet.
 * Returns null if allowed, or a NextResponse(403) to return immediately.
 */
export async function can(user: JwtPayload, permissionKey: string): Promise<NextResponse | null> {
  const role = user.role ? user.role.toLowerCase() : null;
  if (!role) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  }
  if (isAli(role)) return null;

  const allowed = await isPermissionAllowed(role, permissionKey);

  if (!allowed) {
    return NextResponse.json(
      { error: `Access denied. You don't have permission to do this (${permissionKey}).` },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Mirrors fees.js `userHasPermission` — a plain boolean check (not
 * middleware), used where a request should still succeed even if a
 * secondary permission (e.g. fees.custom_date) is denied.
 */
export async function userHasPermission(role: string | null | undefined, permissionKey: string): Promise<boolean> {
  const normalizedRole = String(role || '').toLowerCase();
  if (isAli(normalizedRole)) return true;
  return isPermissionAllowed(normalizedRole, permissionKey);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as any,
  });
}
