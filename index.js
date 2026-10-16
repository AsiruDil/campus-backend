import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';
import { migrateLegacyRoles } from './services/roleMigration.js';

if (!process.env.MONGODB_URL || !process.env.JWT_KEY) {
  console.error('Set MONGODB_URL and JWT_KEY before starting the backend.');
  process.exitCode = 1;
} else {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    await migrateLegacyRoles();
    console.log('Connected to the database; role migration checked');
    app.listen(Number(process.env.PORT || 3000), () => console.log(`Server is running on port ${process.env.PORT || 3000}`));
  } catch {
    console.error('Database connection failed. Check MONGODB_URL and database access.');
    process.exitCode = 1;
  }
}
