import { Server } from 'socket.io';

// The Socket.IO server, for HTTP handlers that need to push an event (a paid
// message request is sent over REST because it charges coins).
let io: Server | null = null;

export const setIO = (server: Server) => {
  io = server;
};

export const getIO = (): Server | null => io;
