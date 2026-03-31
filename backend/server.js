/**
 * Smart Energy-Saving Human Detection System
 * Backend Server — Node.js + Express + MongoDB
 * Features: WhatsApp OTP Auth, Rate Limiting, Session Management, Admin Panel
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config({ path: '../.env' });
const express       = require('express');
const session       = require('express-session');
const MongoStore    = require('connect-mongo');
const mongoose      = require('mongoose');
const bcrypt        = require('bcryptjs');
const rateLimit     = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const helmet        = require('helmet');
const cors          = require('cors');
const axios         = require('axios');
const path          = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MongoDB Connection ────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser:    true,
  useUnifiedTopology: true,
}).then(() => console.log('✅  MongoDB connected'))
  .catch(err => { console.error('❌  MongoDB error:', err); process.exit(1); });

// ── Schemas ───────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true, maxlength: 80 },
  phone:       { type: String, required: true, unique: true, trim: true },
  role:        { type: String, enum: ['user', 'admin'], default: 'user' },
  approved:    { type: Boolean, default: false },
  active:      { type: Boolean, default: false },         // currently logged in
  lastLogin:   { type: Date },
  createdAt:   { type: Date, default: Date.now },
  loginCount:  { type: Number, default: 0 },
});

const otpSchema = new mongoose.Schema({
  phone:     { type: String, required: true },
  otp:       { type: String, required: true },
  expiresAt: { type: Date, required: true },
  used:      { type: Boolean, default: false },
});
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });  // TTL index

const logSchema = new mongoose.Schema({
  phone:     String,
  name:      String,
  action:    String,
  timestamp: { type: Date, default: Date.now },
  ip:        String,
});

const User = mongoose.model('User', userSchema);
const OTP  = mongoose.model('OTP',  otpSchema);
const Log  = mongoose.model('Log',  logSchema);

// ── Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));          // security headers
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(mongoSanitize());                                   // block NoSQL injection

app.use(session({
  secret:            process.env.SESSION_SECRET || 'change_this_secret',
  resave:            false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   8 * 60 * 60 * 1000,                          // 8 hours
    sameSite: 'lax',
  },
}));

app.use(express.static(path.join(__dirname, '../frontend/public')));

// ── Rate Limiters ─────────────────────────────────────────────────
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,  // 10 minutes
  max: 3,
  message: { error: 'Too many OTP requests. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 60,
  message: { error: 'Too many requests.' },
});

app.use('/api/', apiLimiter);

// ── Auth Middleware ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── WhatsApp OTP Helper ───────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendWhatsAppOTP(phone, otp) {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.warn('⚠️  WhatsApp not configured — OTP:', otp);
    return true; // dev mode: always succeed
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: `🔐 SmartVision OTP: *${otp}*\nValid for 5 minutes. Do not share this code.` },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return true;
  } catch (err) {
    console.error('WhatsApp error:', err.response?.data || err.message);
    return false;
  }
}

// ── Routes — Auth ─────────────────────────────────────────────────

// Register new user
app.post('/api/auth/register', otpLimiter, async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15)
      return res.status(400).json({ error: 'Invalid phone number' });

    const existing = await User.findOne({ phone: cleanPhone });
    if (existing) return res.status(409).json({ error: 'Phone already registered' });

    const newUser = await User.create({ name: name.trim(), phone: cleanPhone });

    const otp = generateOTP();
    const exp = new Date(Date.now() + 5 * 60 * 1000); // 5 min
    await OTP.create({ phone: cleanPhone, otp, expiresAt: exp });

    const sent = await sendWhatsAppOTP(cleanPhone, otp);
    if (!sent) return res.status(500).json({ error: 'Failed to send OTP' });

    await Log.create({ phone: cleanPhone, name: name.trim(), action: 'REGISTER_OTP_SENT', ip: req.ip });
    res.json({ message: 'OTP sent to WhatsApp. Pending admin approval after verification.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify registration OTP
app.post('/api/auth/verify-register', loginLimiter, async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const cleanPhone = phone?.replace(/\D/g, '');
    if (!cleanPhone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

    const record = await OTP.findOne({ phone: cleanPhone, otp, used: false, expiresAt: { $gt: new Date() } });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP' });

    record.used = true;
    await record.save();

    await Log.create({ phone: cleanPhone, action: 'REGISTER_VERIFIED', ip: req.ip });
    res.json({ message: 'Verified! Your account is pending admin approval.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login — send OTP
app.post('/api/auth/login', otpLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    const cleanPhone = phone?.replace(/\D/g, '');
    if (!cleanPhone) return res.status(400).json({ error: 'Phone required' });

    const user = await User.findOne({ phone: cleanPhone });
    if (!user) return res.status(404).json({ error: 'Phone not registered' });
    if (!user.approved) return res.status(403).json({ error: 'Account not yet approved by admin' });

    const otp = generateOTP();
    const exp = new Date(Date.now() + 5 * 60 * 1000);
    await OTP.create({ phone: cleanPhone, otp, expiresAt: exp });

    const sent = await sendWhatsAppOTP(cleanPhone, otp);
    if (!sent) return res.status(500).json({ error: 'Failed to send OTP' });

    res.json({ message: 'OTP sent to your WhatsApp' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login — verify OTP
app.post('/api/auth/verify-login', loginLimiter, async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const cleanPhone = phone?.replace(/\D/g, '');
    if (!cleanPhone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

    const record = await OTP.findOne({ phone: cleanPhone, otp, used: false, expiresAt: { $gt: new Date() } });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP' });

    record.used = true;
    await record.save();

    const user = await User.findOne({ phone: cleanPhone });
    if (!user || !user.approved) return res.status(403).json({ error: 'Account not approved' });

    user.active     = true;
    user.lastLogin  = new Date();
    user.loginCount += 1;
    await user.save();

    req.session.userId = user._id.toString();
    req.session.phone  = user.phone;
    req.session.name   = user.name;
    req.session.role   = user.role;

    await Log.create({ phone: cleanPhone, name: user.name, action: 'LOGIN', ip: req.ip });
    res.json({ message: 'Logged in', role: user.role, name: user.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await User.findByIdAndUpdate(req.session.userId, { active: false });
  await Log.create({ phone: req.session.phone, name: req.session.name, action: 'LOGOUT', ip: req.ip });
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

// Session info
app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).select('-__v');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ name: user.name, phone: user.phone, role: user.role, active: user.active });
});

// ── Routes — Admin ────────────────────────────────────────────────

// List all users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await User.find().select('-__v').sort({ createdAt: -1 });
  res.json(users);
});

// Approve a user
app.patch('/api/admin/users/:id/approve', requireAdmin, async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { approved: true }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  await Log.create({ phone: req.session.phone, action: `APPROVED:${user.phone}`, ip: req.ip });
  res.json({ message: 'User approved', user });
});

// Revoke a user
app.patch('/api/admin/users/:id/revoke', requireAdmin, async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { approved: false, active: false }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  await Log.create({ phone: req.session.phone, action: `REVOKED:${user.phone}`, ip: req.ip });
  res.json({ message: 'User revoked', user });
});

// Change role
app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Role updated', user });
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await Log.create({ phone: req.session.phone, action: `DELETED:${user.phone}`, ip: req.ip });
  res.json({ message: 'User deleted' });
});

// Recent logs
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  const logs = await Log.find().sort({ timestamp: -1 }).limit(100);
  res.json(logs);
});

// Stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const [total, approved, active, pending] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ approved: true }),
    User.countDocuments({ active: true }),
    User.countDocuments({ approved: false }),
  ]);
  res.json({ total, approved, active, pending });
});

// ── Routes — Camera / Detection ───────────────────────────────────

// Proxy the YOLO detection stream from Flask
app.get('/api/stream/detection', requireAuth, (req, res) => {
  const streamUrl = process.env.FLASK_STREAM_URL || 'http://localhost:5000/detection_feed';
  res.redirect(streamUrl);
});

// System status (from Flask)
app.get('/api/system/status', requireAuth, async (req, res) => {
  try {
    const r = await axios.get(`${process.env.FLASK_STREAM_URL?.replace('/detection_feed', '')}/status`, { timeout: 2000 });
    res.json(r.data);
  } catch {
    res.json({ online: false, people: 0, lights: 0 });
  }
});

// ── HTML Page Routes ──────────────────────────────────────────────
app.get('/',          (_, res) => res.sendFile(path.join(__dirname, '../frontend/views/index.html')));
app.get('/dashboard', (_, res) => res.sendFile(path.join(__dirname, '../frontend/views/dashboard.html')));
app.get('/admin',     (_, res) => res.sendFile(path.join(__dirname, '../frontend/views/admin.html')));

// ── Graceful Shutdown ────────────────────────────────────────────
process.on('SIGINT', async () => {
  await User.updateMany({}, { active: false });
  console.log('\n🔌  All users set offline. Shutting down.');
  process.exit(0);
});

app.listen(PORT, () => console.log(`🚀  Server running on http://localhost:${PORT}`));
