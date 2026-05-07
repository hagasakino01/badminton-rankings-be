import { Schema, model } from "mongoose";

export interface GroupDocument {
  _id: string;
  name: string;
  description?: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

const groupSchema = new Schema<GroupDocument>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    ownerId: { type: String, required: true, index: true },
  },
  {
    timestamps: true,
  },
);

export const GroupModel = model<GroupDocument>("Group", groupSchema);
