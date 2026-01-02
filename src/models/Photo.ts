import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPhoto extends Document {
  userId: Types.ObjectId;
  url: string;
  publicId?: string;
  order: number;
}

const photoSchema = new Schema<IPhoto>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    url: { type: String, required: true },
    publicId: { type: String },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Photo = mongoose.model<IPhoto>('Photo', photoSchema);
