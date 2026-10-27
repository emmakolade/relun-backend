import mongoose, { Schema, Document, Types } from 'mongoose';

interface INotificationDelivery extends Document {
  key: string;
  userId: Types.ObjectId;
  createdAt: Date;
}

const notificationDeliverySchema = new Schema<INotificationDelivery>(
  {
    key: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const NotificationDelivery = mongoose.model<INotificationDelivery>('NotificationDelivery', notificationDeliverySchema);
