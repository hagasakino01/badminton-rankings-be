import { Schema, model } from "mongoose";

export type SeasonStatus = "draft" | "active" | "completed";

export interface SeasonDocument {
  _id: string;
  groupId: string;
  name: string;
  startDate?: Date;
  endDate?: Date;
  status: SeasonStatus;
  isLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const seasonSchema = new Schema<SeasonDocument>(
  {
    groupId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    startDate: { type: Date },
    endDate: { type: Date },
    status: { type: String, enum: ["draft", "active", "completed"], default: "draft" },
    isLocked: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

export const SeasonModel = model<SeasonDocument>("Season", seasonSchema);
