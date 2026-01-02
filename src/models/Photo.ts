import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPhoto extends Document {
  profileId: Types.ObjectId;
  url: string;
  order: number;
}

const photoSchema = new Schema<IPhoto>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    url: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Photo = mongoose.model<IPhoto>('Photo', photoSchema);
