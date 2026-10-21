/**
 * Who is currently connected, held in this process's memory.
 *
 * A user is counted rather than flagged, so a second device (or a reconnect
 * that overlaps the old socket) does not mark them offline when the first one
 * drops. This is per-process: once the backend runs more than one instance
 * this needs to move to Redis, the same point at which Socket.IO needs the
 * Redis adapter.
 */
const connectionCounts = new Map<string, number>();

/** Returns true when this connection brought the user online. */
export const addConnection = (userId: string): boolean => {
  const count = (connectionCounts.get(userId) ?? 0) + 1;
  connectionCounts.set(userId, count);
  return count === 1;
};

/** Returns true when this disconnect took the user offline. */
export const removeConnection = (userId: string): boolean => {
  const count = (connectionCounts.get(userId) ?? 1) - 1;

  if (count <= 0) {
    connectionCounts.delete(userId);
    return true;
  }

  connectionCounts.set(userId, count);
  return false;
};

export const isUserOnline = (userId: string): boolean => connectionCounts.has(userId);

/** Number of users with at least one open socket. */
export const onlineCount = (): number => connectionCounts.size;
