// Unmatches everyone and wipes all chats: deletes both likes of every mutual
// pair, all messages and all message requests. One-sided likes are kept.
// Writes a JSON backup of everything deleted first. Pass --apply to delete;
// without it the script only reports counts.
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Like } from '../models/Like';
import { Message } from '../models/Message';
import { MessageRequest } from '../models/MessageRequest';

dotenv.config();
// Node's SRV lookup fails on some Windows resolvers.
dns.setServers(['8.8.8.8', '1.1.1.1']);

const apply = process.argv.includes('--apply');
const backupDir = process.argv.find((a) => a.startsWith('--backup='))?.slice(9) ?? '.';

const run = async () => {
  await mongoose.connect(process.env.DATABASE_URL as string);

  const likes = await Like.find().lean();
  const keys = new Set(likes.map((l) => `${l.userId}_${l.targetUserId}`));
  const mutual = likes.filter((l) => keys.has(`${l.targetUserId}_${l.userId}`));
  const messages = await Message.find().lean();
  const requests = await MessageRequest.find().lean();

  console.log(`likes total: ${likes.length}, in mutual pairs: ${mutual.length} (${mutual.length / 2} matches)`);
  console.log(`messages: ${messages.length}, message requests: ${requests.length}`);

  if (apply) {
    const file = path.join(backupDir, `reset-backup-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ likes: mutual, messages, requests }, null, 2));
    console.log(`backup written: ${file}`);

    const l = await Like.deleteMany({ _id: { $in: mutual.map((m) => m._id) } });
    const m = await Message.deleteMany({});
    const r = await MessageRequest.deleteMany({});
    console.log(`deleted likes: ${l.deletedCount}, messages: ${m.deletedCount}, requests: ${r.deletedCount}`);
  } else {
    console.log('dry run; pass --apply to delete');
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
