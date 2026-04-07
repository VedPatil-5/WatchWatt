/**
 * Smart Energy-Saving Human Detection System
 * Backend Server - Node.js + Express + MongoDB
 * Features: Gmail OTP Auth, Rate Limiting, Session Management, Admin Panel
 */

const dns = require('dns');

require('dotenv').config({ path: '../.env' });
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const helmet = require('helmet');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway sits behind a proxy, and express-rate-limit needs this to see client IPs safely.
app.set('trust proxy', 1);

if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('MongoDB connected');
}).catch((err) => {
  console.error('MongoDB error:', err);
  process.exit(1);
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  approved: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now },
  loginCount: { type: Number, default: 0 },
});

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  otp: { type: String, required: true },
  purpose: { type: String, enum: ['register', 'login'], required: true },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false },
});
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const logSchema = new mongoose.Schema({
  email: String,
  name: String,
  action: String,
  timestamp: { type: Date, default: Date.now },
  ip: String,
});

const User = mongoose.model('User', userSchema);
const OTP = mongoose.model('OTP', otpSchema);
const Log = mongoose.model('Log', logSchema);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(mongoSanitize());

app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
}));

app.use(express.static(path.join(__dirname, 'frontend', 'public')));

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { error: 'Too many OTP requests. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests.' },
});

app.use('/api/', apiLimiter);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function parseFromAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*?)<([^>]+)>$/);
  if (!match) return { email: raw, name: '' };
  return {
    name: match[1].replace(/^"|"$/g, '').trim(),
    email: match[2].trim(),
  };
}

let cachedTransporter;
function getMailer() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.GMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;

  if (!user || !pass) return null;

  cachedTransporter = host
    ? nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        requireTLS: port !== 465,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
        tls: { servername: host },
      })
    : nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      });

  return cachedTransporter;
}

async function sendEmailOTP(email, otp, purpose, name) {
  const transporter = getMailer();
  const from = process.env.MAIL_FROM || process.env.GMAIL_USER || process.env.SMTP_USER;
  const brevoApiKey = process.env.BREVO_API_KEY;
  const fromAddress = parseFromAddress(from);

  if (!from) {
    console.warn(`Email OTP not configured for ${email}. OTP: ${otp}`);
    return true;
  }

  const actionLabel = purpose === 'register' ? 'complete your WatchWatt signup' : 'sign in to WatchWatt';
  const text = [
    `Hello${name ? ` ${name}` : ''},`,
    '',
    `Use this code to ${actionLabel}: ${otp}`,
    'This code will expire in 5 minutes.',
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;background:#f4fbf8;padding:24px;color:#153229">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;border:1px solid #d9efe4">
        <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#2eb67d;margin-bottom:14px">WatchWatt</div>
        <h1 style="margin:0 0 10px;font-size:28px;color:#16372d">Verification code</h1>
        <p style="margin:0 0 20px;line-height:1.6;color:#4f6a61">
          Hello${name ? ` ${name}` : ''}, use the code below to ${actionLabel}.
        </p>
        <div style="font-size:34px;font-weight:700;letter-spacing:.3em;background:#eff9f3;border:1px solid #cae7d8;border-radius:16px;padding:18px 22px;text-align:center;color:#18a06a">
          ${otp}
        </div>
        <p style="margin:20px 0 0;line-height:1.6;color:#4f6a61">
          This code expires in 5 minutes. If you did not request it, you can ignore this email.
        </p>
      </div>
    </div>
  `;

  try {
    if (brevoApiKey) {
      await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: {
            name: fromAddress.name || 'WatchWatt',
            email: fromAddress.email,
          },
          to: [{ email }],
          subject: `Your WatchWatt verification code: ${otp}`,
          textContent: text,
          htmlContent: html,
        },
        {
          timeout: 15000,
          headers: {
            'api-key': brevoApiKey,
            'content-type': 'application/json',
          },
        }
      );
      return true;
    }

    if (!transporter) {
      console.warn(`Email transporter not configured for ${email}. OTP: ${otp}`);
      return true;
    }

    await transporter.sendMail({
      from,
      to: email,
      subject: `Your WatchWatt verification code: ${otp}`,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error('Email error:', err.response?.data || err.message);
    return false;
  }
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function getDetectionBaseUrl() {
  return (process.env.FLASK_STREAM_URL || 'http://localhost:5000/detection_feed').replace('/detection_feed', '');
}

function getDetectionHeaders() {
  return process.env.DETECTION_CONTROL_TOKEN
    ? { 'X-Control-Token': process.env.DETECTION_CONTROL_TOKEN }
    : {};
}

app.post('/api/auth/register', otpLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);

    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    await User.create({ name, email });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await OTP.create({ email, otp, purpose: 'register', expiresAt });

    const sent = await sendEmailOTP(email, otp, 'register', name);
    if (!sent) return res.status(500).json({ error: 'Failed to send OTP email' });

    await Log.create({ email, name, action: 'REGISTER_OTP_SENT', ip: req.ip });
    res.json({ message: 'Verification code sent to your email. Your account will wait for admin approval after verification.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/verify-register', loginLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();

    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const record = await OTP.findOne({
      email,
      otp,
      purpose: 'register',
      used: false,
      expiresAt: { $gt: new Date() },
    });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP' });

    record.used = true;
    await record.save();

    await Log.create({ email, action: 'REGISTER_VERIFIED', ip: req.ip });
    res.json({ message: 'Verified. Your account is now pending admin approval.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', otpLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Email not registered' });
    if (!user.approved) return res.status(403).json({ error: 'Account not yet approved by admin' });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await OTP.create({ email, otp, purpose: 'login', expiresAt });

    const sent = await sendEmailOTP(email, otp, 'login', user.name);
    if (!sent) return res.status(500).json({ error: 'Failed to send OTP email' });

    await Log.create({ email, name: user.name, action: 'LOGIN_OTP_SENT', ip: req.ip });
    res.json({ message: 'A login code has been sent to your Gmail address.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/verify-login', loginLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();

    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const record = await OTP.findOne({
      email,
      otp,
      purpose: 'login',
      used: false,
      expiresAt: { $gt: new Date() },
    });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP' });

    record.used = true;
    await record.save();

    const user = await User.findOne({ email });
    if (!user || !user.approved) return res.status(403).json({ error: 'Account not approved' });

    user.active = true;
    user.lastLogin = new Date();
    user.loginCount += 1;
    await user.save();

    req.session.userId = user._id.toString();
    req.session.email = user.email;
    req.session.name = user.name;
    req.session.role = user.role;

    await Log.create({ email, name: user.name, action: 'LOGIN', ip: req.ip });
    res.json({ message: 'Logged in', role: user.role, name: user.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await User.findByIdAndUpdate(req.session.userId, { active: false });
  await Log.create({ email: req.session.email, name: req.session.name, action: 'LOGOUT', ip: req.ip });
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).select('-__v');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    approved: user.approved,
  });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await User.find().select('-__v').sort({ createdAt: -1 });
  res.json(users);
});

app.patch('/api/admin/users/:id/approve', requireAdmin, async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { approved: true }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  await Log.create({ email: req.session.email, action: `APPROVED:${user.email}`, ip: req.ip });
  res.json({ message: 'User approved', user });
});

app.patch('/api/admin/users/:id/revoke', requireAdmin, async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { approved: false, active: false }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  await Log.create({ email: req.session.email, action: `REVOKED:${user.email}`, ip: req.ip });
  res.json({ message: 'User revoked', user });
});

app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  const role = String(req.body.role || '');
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  await Log.create({ email: req.session.email, action: `ROLE:${user.email}:${role}`, ip: req.ip });
  res.json({ message: 'Role updated', user });
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await Log.create({ email: req.session.email, action: `DELETED:${user.email}`, ip: req.ip });
  res.json({ message: 'User deleted' });
});

app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  const logs = await Log.find().sort({ timestamp: -1 }).limit(100);
  res.json(logs);
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const [total, approved, active, pending] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ approved: true }),
    User.countDocuments({ active: true }),
    User.countDocuments({ approved: false }),
  ]);
  res.json({ total, approved, active, pending });
});

app.get('/api/stream/detection', requireAuth, async (req, res) => {
  const streamUrl = process.env.FLASK_STREAM_URL || 'http://localhost:5000/detection_feed';

  try {
    const upstream = await axios.get(streamUrl, {
      responseType: 'stream',
      timeout: 15000,
      headers: {
        ...getDetectionHeaders(),
        'ngrok-skip-browser-warning': '1',
      },
    });

    res.setHeader('Content-Type', upstream.headers['content-type'] || 'multipart/x-mixed-replace; boundary=frame');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    upstream.data.on('error', () => {
      if (!res.headersSent) {
        res.status(502).end('Detection stream unavailable');
      } else {
        res.end();
      }
    });

    req.on('close', () => {
      upstream.data.destroy();
    });

    upstream.data.pipe(res);
  } catch (error) {
    console.error('Detection stream proxy error:', error.message);
    res.status(502).send('Detection stream unavailable');
  }
});

app.get('/api/system/status', requireAuth, async (req, res) => {
  try {
    const response = await axios.get(`${getDetectionBaseUrl()}/status`, {
      timeout: 2000,
      headers: getDetectionHeaders(),
    });
    res.json(response.data);
  } catch {
    res.json({ online: false, people: 0, lights_on: 0, light_states: Array(8).fill(false), mode: 'auto' });
  }
});

app.post('/api/system/lights/:index', requireAuth, async (req, res) => {
  try {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index > 7) {
      return res.status(400).json({ error: 'Invalid light index' });
    }

    const on = Boolean(req.body?.on);
    const response = await axios.post(
      `${getDetectionBaseUrl()}/control/lights/${index}`,
      { on },
      {
        timeout: 4000,
        headers: getDetectionHeaders(),
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error('Manual light control error:', err.response?.data || err.message);
    res.status(502).json({ error: 'Failed to control remote light' });
  }
});

app.post('/api/system/lights/auto', requireAuth, async (req, res) => {
  try {
    const response = await axios.post(
      `${getDetectionBaseUrl()}/control/auto`,
      {},
      {
        timeout: 4000,
        headers: getDetectionHeaders(),
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error('Auto mode restore error:', err.response?.data || err.message);
    res.status(502).json({ error: 'Failed to restore auto mode' });
  }
});

app.get('/health', (_, res) => {
  res.status(200).json({ ok: true });
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'frontend', 'views', 'index.html')));
app.get('/dashboard', (_, res) => res.sendFile(path.join(__dirname, 'frontend', 'views', 'dashboard.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'frontend', 'views', 'admin.html')));

process.on('SIGINT', async () => {
  await User.updateMany({}, { active: false });
  console.log('\nAll users set offline. Shutting down.');
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});
