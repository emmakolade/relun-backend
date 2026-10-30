import mongoose, { Schema, Document } from 'mongoose';

/**
 * App-wide switches the team flips from the admin page. There is only ever
 * one document, keyed 'global'.
 */
export interface IAppSettings extends Document<string> {
  _id: string;
  /** Discovery ignores everyone's max distance and shows people anywhere, nearest first. */
  discoverEveryone: boolean;
  updatedAt: Date;
}

const appSettingsSchema = new Schema<IAppSettings>(
  {
    _id: { type: String, default: 'global' },
    discoverEveryone: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const AppSettings = mongoose.model<IAppSettings>('AppSettings', appSettingsSchema);

const CACHE_MS = 10_000;
let cached: { value: { discoverEveryone: boolean }; at: number } | null = null;

/** Current switches, cached briefly so every discovery request doesn't hit the database. */
export const getAppSettings = async (): Promise<{ discoverEveryone: boolean }> => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const doc = await AppSettings.findById('global').lean();
  const value = { discoverEveryone: doc?.discoverEveryone ?? false };
  cached = { value, at: Date.now() };
  return value;
};

export const updateAppSettings = async (patch: { discoverEveryone?: boolean }) => {
  const doc = await AppSettings.findByIdAndUpdate('global', { $set: patch }, { new: true, upsert: true }).lean();
  const value = { discoverEveryone: doc?.discoverEveryone ?? false };
  cached = { value, at: Date.now() };
  return value;
};
