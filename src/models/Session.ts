import { Schema, model } from "mongoose";

export interface SessionDocument {
  _id: string;
  groupId: string;
  seasonId: string;
  title?: string;
  note?: string;
  scheduledFor: Date;
  participantIds: string[];
  absentPlayerIds: string[];
  scheduleType: "auto" | "manual";
  isResultsSaved: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDocument>(
  {
    groupId: { type: String, required: true, index: true },
    seasonId: { type: String, required: true, index: true },
    title: { type: String, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 500 },
    scheduledFor: { type: Date, required: true },
    participantIds: [{ type: String, required: true }],
    absentPlayerIds: [{ type: String, required: true }],
    scheduleType: {
      type: String,
      enum: ["auto", "manual"],
      required: true,
      default: "auto",
    },
    isResultsSaved: { type: Boolean, required: true, default: false },
    createdBy: { type: String, required: true },
  },
  {
    timestamps: true,
  },
);

export const SessionModel = model<SessionDocument>("Session", sessionSchema);
