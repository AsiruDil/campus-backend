import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/user.js"; 
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/api/users/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // 1. Check if user already exists
        let user = await User.findOne({ email: profile.emails[0].value });

        if (!user) {
          // 2. If new user, create an account
          // Generate a secure random password to satisfy the DB schema
          const randomPassword = Math.random().toString(36).slice(-10) + "A1@"; 
          const hashedPassword = bcrypt.hashSync(randomPassword, 10);
          
          // Generate a unique userName based on their email
          const baseUserName = profile.emails[0].value.split("@")[0];
          const uniqueUserName = baseUserName + Math.floor(Math.random() * 10000);

          user = new User({
            email: profile.emails[0].value,
            userName: uniqueUserName,
            firstName: profile.name.givenName || "Google",
            lastName: profile.name.familyName || "User",
            password: hashedPassword,
            isVerified: true, // Google emails are already verified!
            img: profile.photos[0] ? profile.photos[0].value : undefined,
            role: "user",
          });

          await user.save();
        }

        // 3. Pass the user to the next middleware
        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

export default passport;