import { Schema, model } from "mongoose";

export interface SessionDocument {
  _id: string;
  groupId: string;
  seasonId: string;
  scheduledFor: Date;
  participantIds: string[];
  absentPlayerIds: string[];
  isResultsSaved: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDocument>(
  {
    groupId: { type: String, required: true, index: true },
    seasonId: { type: String, required: true, index: true },
    scheduledFor: { type: Date, required: true },
    participantIds: [{ type: String, required: true }],
    absentPlayerIds: [{ type: String, required: true }],
    isResultsSaved: { type: Boolean, required: true, default: false },
    createdBy: { type: String, required: true },
  },
  {
    timestamps: true,
  },
);

export const SessionModel = model<SessionDocument>("Session", sessionSchema);
