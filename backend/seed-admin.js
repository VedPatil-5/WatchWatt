/**
 * seed-admin.js
 * Run ONCE to create your first admin account in MongoDB.
 * Usage: node seed-admin.js
 */
require("node:dns/promises").setServers(["8.8.8.8", "1.1.1.1"]);
require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  phone:     { type: String, required: true, unique: true },
  role:      { type: String, enum: ['user', 'admin'], default: 'user' },
  approved:  { type: Boolean, default: false },
  active:    { type: Boolean, default: false },
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now },
  loginCount:{ type: Number, default: 0 },
});
const User = mongoose.model('User', userSchema);

// ── EDIT THESE ──────────────────────────────────────────────────
const ADMIN_NAME  = 'Ved';           // your name
const ADMIN_PHONE = '917276210876';    // your WhatsApp number WITH country code (no +)
// ───────────────────────────────────────────────────────────────

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅  Connected to MongoDB');

  const existing = await User.findOne({ phone: ADMIN_PHONE });
  if (existing) {
    existing.role     = 'admin';
    existing.approved = true;
    await existing.save();
    console.log(`✅  Updated existing user ${ADMIN_PHONE} → role: admin, approved: true`);
  } else {
    await User.create({ name: ADMIN_NAME, phone: ADMIN_PHONE, role: 'admin', approved: true });
    console.log(`✅  Admin user created: ${ADMIN_NAME} (${ADMIN_PHONE})`);
  }
  await mongoose.disconnect();
  console.log('Done. You can now log in with your WhatsApp OTP.');
}

seed().catch(err => { console.error(err); process.exit(1); });
