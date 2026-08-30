// Session recovery priority and conflict rules (#21).
//
// When a session is restored (page reload, new browser session), up to two
// copies may exist: the client's localStorage mirror and the server's stored
// session. The rules, in force order:
//
//   1. Server reachable and holding the session → the server copy is the
//      recovery candidate (it is the durable store); the local mirror is the
//      candidate otherwise.
//   2. If both copies exist and disagree, the one with the newer `updatedAt`
//      wins ("newer wins").
//   3. A completed session is never overwritten: if exactly one copy is
//      completed, the completed copy wins regardless of timestamps.
//   4. Timestamp tie → the server copy wins (durable authority).
//
// Server UNAVAILABLE (fetch failure, 4xx/5xx) → the local mirror is used
// unchanged; a missing local copy simply means "nothing to restore".

import type { Session } from './providers';

export function pickRecoverySession(
  local: Session | null,
  remote: Session | null
): Session | null {
  if (local && remote) {
    if (local.completed !== remote.completed) {
      return local.completed ? local : remote;
    }
    if (remote.updatedAt > local.updatedAt) return remote;
    return local.updatedAt > remote.updatedAt ? local : remote; // tie → remote
  }
  return local ?? remote;
}

/**
 * The honest storage-status line shown in the session header (#21). Null =
 * nothing to disclose (persisted server-side in PostgreSQL). 'memory' and
 * 'unavailable' both explicitly tell the user where the data actually lives.
 */
export function storageNoticeFor(
  mode: 'memory' | 'postgres' | 'unavailable' | undefined
): string | null {
  if (mode === 'unavailable') {
    return '服务端存储不可用：当前进度仅保存在本机浏览器。';
  }
  if (mode === 'memory') {
    return '未配置数据库：数据暂存于服务器内存（重启即失），已镜像到本机浏览器。';
  }
  return null;
}
