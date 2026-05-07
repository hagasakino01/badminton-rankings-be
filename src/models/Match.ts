import { Schema, model } from "mongoose";

export type MatchStatus = "scheduled" | "completed";
export type WinnerTeam = "A" | "B";

export interface MatchDocument {
  _id: string;
  groupId: string;
  seasonId: string;
  sessionId: string;
  courtOrder: number;
  teamAIds: string[];
  teamBIds: string[];
  scoreA?: number;
  scoreB?: number;
  winnerTeam?: WinnerTeam;
  status: MatchStatus;
  createdAt: Date;
  updatedAt: Date;
}

const matchSchema = new Schema<MatchDocument>(
  {
    groupId: { type: String, required: true, index: true },
    seasonId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    courtOrder: { type: Number, required: true, min: 1 },
    teamAIds: [{ type: String, required: true }],
    teamBIds: [{ type: String, required: true }],
    scoreA: { type: Number, min: 0 },
    scoreB: { type: Number, min: 0 },
    winnerTeam: { type: String, enum: ["A", "B"] },
    status: { type: String, enum: ["scheduled", "completed"], default: "scheduled" },
  },
  {
    timestamps: true,
  },
);

export const MatchModel = model<MatchDocument>("Match", matchSchema);
