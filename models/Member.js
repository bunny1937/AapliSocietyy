import mongoose from "mongoose";

const MemberSchema = new mongoose.Schema(
  {
    roomNo: {
      type: String,
      required: true,
      trim: true,
    },
    wing: {
      type: String,
      trim: true,
      default: "",
    },
    ownerName: {
      type: String,
      required: true,
      trim: true,
    },
    areaSqFt: {
      type: Number,
      required: true,
      min: 0,
    },
    contact: {
      type: String,
      trim: true,
    },
    openingBalance: {
      type: Number,
      default: 0,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

MemberSchema.index({ societyId: 1, roomNo: 1, wing: 1 }, { unique: true });

export default mongoose.models.Member || mongoose.model("Member", MemberSchema);
