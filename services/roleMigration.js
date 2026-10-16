import User from "../models/user.js";

// Version each document in the same atomic update as its role change. Safe to rerun.
// Use the raw collection: Mongoose defaults must not hide missing historical versions.
export async function migrateLegacyRoles() {
  return User.collection.updateMany({ roleVersion: { $ne: 2 } }, [
    {
      $set: {
        role: {
          $switch: {
            branches: [
              { case: { $eq: ["$role", "admin"] }, then: "superadmin" },
              { case: { $eq: ["$role", "madam"] }, then: "admin" },
            ],
            default: "$role",
          },
        },
        roleVersion: 2,
      },
    },
  ]);
}
