import mongoose, { Schema, Document, Types } from 'mongoose';

// A post stays browsable, and counts as one of its poster's active posts,
// until an hour after its start time.
export const DATE_POST_GRACE_MS = 60 * 60 * 1000;

export interface IDatePost extends Document {
  userId: Types.ObjectId;
  segment: string;
  activity: string;
  place: string;
  scheduledFor: Date;
  description?: string;
  status: 'active' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

const datePostSchema = new Schema<IDatePost>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Copied from the poster's profile so browsing never crosses segments.
    segment: { type: String, required: true },
    activity: { type: String, required: true, trim: true, maxlength: 80 },
    place: { type: String, required: true, trim: true, maxlength: 120 },
    scheduledFor: { type: Date, required: true },
    description: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  },
  { timestamps: true }
);

datePostSchema.index({ segment: 1, status: 1, scheduledFor: 1 });
// Counting a poster's active posts.
datePostSchema.index({ userId: 1, status: 1, scheduledFor: 1 });

export const DatePost = mongoose.model<IDatePost>('DatePost', datePostSchema);

export type DateRequestStatus = 'pending' | 'accepted' | 'declined';

export interface IDateRequest extends Document {
  dateId: Types.ObjectId;
  ownerId: Types.ObjectId;
  requesterId: Types.ObjectId;
  status: DateRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

const dateRequestSchema = new Schema<IDateRequest>(
  {
    dateId: { type: Schema.Types.ObjectId, ref: 'DatePost', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  },
  { timestamps: true }
);

dateRequestSchema.index({ dateId: 1, requesterId: 1 }, { unique: true });

export const DateRequest = mongoose.model<IDateRequest>('DateRequest', dateRequestSchema);
