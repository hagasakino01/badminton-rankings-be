import { Schema, model } from "mongoose";

const mutationReceiptSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 160 },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    resourceType: { type: String, required: true, trim: true, maxlength: 40 },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true, min: 1 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

mutationReceiptSchema.index({ key: 1, actorUserId: 1 }, { unique: true });
mutationReceiptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MutationReceiptModel = model("MutationReceipt", mutationReceiptSchema);
