import type { User, VerificationRecord } from './types';
import type { SqlExecutor } from '../db/sql-executor';
import { normalizeJsonColumn } from '../db/sql-executor';

export interface UserStore {
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  createUser(user: User): Promise<User>;
  updateUser(user: User): Promise<User>;
  migrateGuestToUser(guestUserId: string, newUserId: string): Promise<void>;
  saveVerificationCode(email: string, code: string, expiresAt: number): Promise<void>;
  getVerificationCode(email: string): Promise<VerificationRecord | null>;
  incrementVerificationAttempt(email: string): Promise<void>;
  deleteVerificationCode(email: string): Promise<void>;
  recordAuthAttempt(ip: string, action: string): Promise<void>;
  checkRateLimit(ip: string, action: string, windowSeconds: number, maxAttempts: number): Promise<boolean>;
}

export class MemoryUserStore implements UserStore {
  private users = new Map<string, User>();
  private usersByEmail = new Map<string, User>();
  private verifications = new Map<string, VerificationRecord>();
  private attempts: Array<{ ip: string; action: string; time: number }> = [];

  async findUserById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.usersByEmail.get(email.trim().toLowerCase()) ?? null;
  }

  async createUser(user: User): Promise<User> {
    const copy = { ...user };
    this.users.set(user.id, copy);
    this.usersByEmail.set(user.emailLower, copy);
    return copy;
  }

  async updateUser(user: User): Promise<User> {
    const copy = { ...user, updatedAt: Date.now() };
    this.users.set(user.id, copy);
    this.usersByEmail.set(user.emailLower, copy);
    return copy;
  }

  async migrateGuestToUser(guestUserId: string, newUserId: string): Promise<void> {
    // Delete temp user record if existed
    const guest = this.users.get(guestUserId);
    if (guest) {
      this.users.delete(guestUserId);
      this.usersByEmail.delete(guest.emailLower);
    }
  }

  async saveVerificationCode(email: string, code: string, expiresAt: number): Promise<void> {
    const lower = email.trim().toLowerCase();
    this.verifications.set(lower, {
      id: `v_${Date.now()}`,
      emailLower: lower,
      code,
      attempts: 0,
      expiresAt,
      createdAt: Date.now(),
    });
  }

  async getVerificationCode(email: string): Promise<VerificationRecord | null> {
    const lower = email.trim().toLowerCase();
    const record = this.verifications.get(lower);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      this.verifications.delete(lower);
      return null;
    }
    return record;
  }

  async incrementVerificationAttempt(email: string): Promise<void> {
    const lower = email.trim().toLowerCase();
    const record = this.verifications.get(lower);
    if (record) {
      record.attempts += 1;
      if (record.attempts >= 5) {
        this.verifications.delete(lower);
      }
    }
  }

  async deleteVerificationCode(email: string): Promise<void> {
    this.verifications.delete(email.trim().toLowerCase());
  }

  async recordAuthAttempt(ip: string, action: string): Promise<void> {
    this.attempts.push({ ip, action, time: Date.now() });
    const cutoff = Date.now() - 3600_000;
    this.attempts = this.attempts.filter((a) => a.time > cutoff);
  }

  async checkRateLimit(ip: string, action: string, windowSeconds: number, maxAttempts: number): Promise<boolean> {
    const cutoff = Date.now() - windowSeconds * 1000;
    const count = this.attempts.filter((a) => a.ip === ip && a.action === action && a.time > cutoff).length;
    return count < maxAttempts;
  }
}

export class PostgresUserStore implements UserStore {
  private readonly fallback = new MemoryUserStore();

  constructor(private readonly executor: SqlExecutor) {}

  async findUserById(id: string): Promise<User | null> {
    try {
      const { rows } = await this.executor.query(
        `SELECT id, name, email, email_lower, password_hash, is_guest,
                EXTRACT(EPOCH FROM created_at) * 1000 AS created_at,
                EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at
         FROM zhiyan_users WHERE id = $1`,
        [id]
      );
      if (!rows[0]) {
        return this.fallback.findUserById(id);
      }
      const r = rows[0] as Record<string, unknown>;
      return {
        id: String(r.id),
        name: String(r.name),
        email: String(r.email),
        emailLower: String(r.email_lower),
        passwordHash: String(r.password_hash || ''),
        isGuest: Boolean(r.is_guest),
        createdAt: Number(r.created_at || Date.now()),
        updatedAt: Number(r.updated_at || Date.now()),
      };
    } catch (err) {
      console.warn('[auth/user-store] findUserById DB query failed, falling back to memory:', err);
      return this.fallback.findUserById(id);
    }
  }

  async findUserByEmail(email: string): Promise<User | null> {
    try {
      const lower = email.trim().toLowerCase();
      const { rows } = await this.executor.query(
        `SELECT id, name, email, email_lower, password_hash, is_guest,
                EXTRACT(EPOCH FROM created_at) * 1000 AS created_at,
                EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at
         FROM zhiyan_users WHERE email_lower = $1`,
        [lower]
      );
      if (!rows[0]) {
        return this.fallback.findUserByEmail(email);
      }
      const r = rows[0] as Record<string, unknown>;
      return {
        id: String(r.id),
        name: String(r.name),
        email: String(r.email),
        emailLower: String(r.email_lower),
        passwordHash: String(r.password_hash || ''),
        isGuest: Boolean(r.is_guest),
        createdAt: Number(r.created_at || Date.now()),
        updatedAt: Number(r.updated_at || Date.now()),
      };
    } catch (err) {
      console.warn('[auth/user-store] findUserByEmail DB query failed, falling back to memory:', err);
      return this.fallback.findUserByEmail(email);
    }
  }

  async createUser(user: User): Promise<User> {
    // Always keep memory fallback up to date
    await this.fallback.createUser(user);
    try {
      await this.executor.query(
        `INSERT INTO zhiyan_users (id, name, email, email_lower, password_hash, is_guest, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           email_lower = EXCLUDED.email_lower,
           password_hash = EXCLUDED.password_hash,
           is_guest = EXCLUDED.is_guest,
           updated_at = EXCLUDED.updated_at`,
        [
          user.id,
          user.name,
          user.email,
          user.emailLower,
          user.passwordHash,
          user.isGuest,
          new Date(user.createdAt).toISOString(),
          new Date(user.updatedAt).toISOString(),
        ]
      );
    } catch (err) {
      console.warn('[auth/user-store] createUser DB query failed, using memory store:', err);
    }
    return user;
  }

  async updateUser(user: User): Promise<User> {
    await this.fallback.updateUser(user);
    const now = Date.now();
    try {
      await this.executor.query(
        `UPDATE zhiyan_users
         SET name = $1, email = $2, email_lower = $3, password_hash = $4, is_guest = $5, updated_at = $6
         WHERE id = $7`,
        [user.name, user.email, user.emailLower, user.passwordHash, user.isGuest, new Date(now).toISOString(), user.id]
      );
    } catch (err) {
      console.warn('[auth/user-store] updateUser DB query failed, using memory store:', err);
    }
    return { ...user, updatedAt: now };
  }

  async migrateGuestToUser(guestUserId: string, newUserId: string): Promise<void> {
    await this.fallback.migrateGuestToUser(guestUserId, newUserId);
    try {
      await this.executor.query(
        `UPDATE zhiyan_sessions SET owner_id = $1 WHERE owner_id = $2`,
        [newUserId, guestUserId]
      );
      await this.executor.query(
        `UPDATE zhiyan_profiles SET owner_id = $1 WHERE owner_id = $2`,
        [newUserId, guestUserId]
      );
      await this.executor.query(
        `DELETE FROM zhiyan_users WHERE id = $1`,
        [guestUserId]
      );
    } catch (err) {
      console.warn('[auth/user-store] migrateGuestToUser DB query failed:', err);
    }
  }

  async saveVerificationCode(email: string, code: string, expiresAt: number): Promise<void> {
    await this.fallback.saveVerificationCode(email, code, expiresAt);
    try {
      const lower = email.trim().toLowerCase();
      const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await this.executor.query(
        `DELETE FROM zhiyan_email_verifications WHERE email_lower = $1`,
        [lower]
      );
      await this.executor.query(
        `INSERT INTO zhiyan_email_verifications (id, email_lower, code, attempts, expires_at, created_at)
         VALUES ($1, $2, $3, 0, $4, NOW())`,
        [id, lower, code, new Date(expiresAt).toISOString()]
      );
    } catch (err) {
      console.warn('[auth/user-store] saveVerificationCode DB query failed, using memory store:', err);
    }
  }

  async getVerificationCode(email: string): Promise<VerificationRecord | null> {
    try {
      const lower = email.trim().toLowerCase();
      const { rows } = await this.executor.query(
        `SELECT id, email_lower, code, attempts,
                EXTRACT(EPOCH FROM expires_at) * 1000 AS expires_at,
                EXTRACT(EPOCH FROM created_at) * 1000 AS created_at
         FROM zhiyan_email_verifications
         WHERE email_lower = $1 AND expires_at > NOW()`,
        [lower]
      );
      if (!rows[0]) {
        return this.fallback.getVerificationCode(email);
      }
      const r = rows[0] as Record<string, unknown>;
      return {
        id: String(r.id),
        emailLower: String(r.email_lower),
        code: String(r.code),
        attempts: Number(r.attempts || 0),
        expiresAt: Number(r.expires_at),
        createdAt: Number(r.created_at),
      };
    } catch (err) {
      console.warn('[auth/user-store] getVerificationCode DB query failed, falling back to memory:', err);
      return this.fallback.getVerificationCode(email);
    }
  }

  async incrementVerificationAttempt(email: string): Promise<void> {
    await this.fallback.incrementVerificationAttempt(email);
    try {
      const lower = email.trim().toLowerCase();
      await this.executor.query(
        `UPDATE zhiyan_email_verifications
         SET attempts = attempts + 1
         WHERE email_lower = $1`,
        [lower]
      );
      await this.executor.query(
        `DELETE FROM zhiyan_email_verifications
         WHERE email_lower = $1 AND attempts >= 5`,
        [lower]
      );
    } catch (err) {
      console.warn('[auth/user-store] incrementVerificationAttempt DB query failed:', err);
    }
  }

  async deleteVerificationCode(email: string): Promise<void> {
    await this.fallback.deleteVerificationCode(email);
    try {
      const lower = email.trim().toLowerCase();
      await this.executor.query(
        `DELETE FROM zhiyan_email_verifications WHERE email_lower = $1`,
        [lower]
      );
    } catch (err) {
      console.warn('[auth/user-store] deleteVerificationCode DB query failed:', err);
    }
  }

  async recordAuthAttempt(ip: string, action: string): Promise<void> {
    await this.fallback.recordAuthAttempt(ip, action);
    try {
      const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await this.executor.query(
        `INSERT INTO zhiyan_auth_attempts (id, ip_address, action_type, attempted_at)
         VALUES ($1, $2, $3, NOW())`,
        [id, ip, action]
      );
    } catch (err) {
      console.warn('[auth/user-store] recordAuthAttempt DB query failed:', err);
    }
  }

  async checkRateLimit(ip: string, action: string, windowSeconds: number, maxAttempts: number): Promise<boolean> {
    try {
      const { rows } = await this.executor.query(
        `SELECT COUNT(*) AS count
         FROM zhiyan_auth_attempts
         WHERE ip_address = $1 AND action_type = $2
           AND attempted_at > NOW() - INTERVAL '1 second' * $3`,
        [ip, action, windowSeconds]
      );
      const count = Number((rows[0] as { count?: unknown })?.count || 0);
      return count < maxAttempts;
    } catch (err) {
      console.warn('[auth/user-store] checkRateLimit DB query failed, falling back to memory:', err);
      return this.fallback.checkRateLimit(ip, action, windowSeconds, maxAttempts);
    }
  }
}
