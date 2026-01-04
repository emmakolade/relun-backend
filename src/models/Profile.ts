import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProfile extends Document {
  userId: Types.ObjectId;
  bio?: string;
  occupation?: string;
  education?: string;
  company?: string;
  school?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  location?: {
    type: string;
    coordinates: number[];
  };
  height?: number;
  bodyType?: string;
  ethnicity?: string;
  drinking?: string;
  smoking?: string;
  religion?: string;
  politicalViews?: string;
  lookingFor?: string;
  interests: string[];
  segment: string;
  isVisible: boolean;
  showAge: boolean;
  showDistance: boolean;
  isComplete: boolean;
  completenessScore: number;
}

const profileSchema = new Schema<IProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    bio: String,
    occupation: String,
    education: String,
    company: String,
    school: String,
    city: String,
    state: String,
    country: String,
    latitude: Number,
    longitude: Number,
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
      },
    },
    height: Number,
    bodyType: String,
    ethnicity: String,
    drinking: String,
    smoking: String,
    religion: String,
    politicalViews: String,
    lookingFor: String,
    interests: { type: [String], default: [] },
    segment: { type: String, default: 'relationship' },
    isVisible: { type: Boolean, default: true },
    showAge: { type: Boolean, default: true },
    showDistance: { type: Boolean, default: true },
    isComplete: { type: Boolean, default: false },
    completenessScore: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Create 2dsphere index on location field for geospatial queries
profileSchema.index({ location: '2dsphere' });

export const Profile = mongoose.model<IProfile>('Profile', profileSchema);
