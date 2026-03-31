# SmartVision — Complete Setup & Deployment Guide

## Folder Structure
```
smart-energy-system/
├── .env                    ← your secrets (create from .env.example)
├── .env.example            ← template
├── backend/
│   ├── server.js           ← Node.js backend
│   ├── seed-admin.js       ← run once to create admin
│   └── package.json
├── detection/
│   ├── stream_server.py    ← Flask YOLO stream server
│   └── requirements.txt
└── frontend/
    └── views/
        ├── index.html      ← new user page
        ├── dashboard.html  ← existing user page
        └── admin.html      ← admin panel
```

---

## STEP 1 — Prerequisites

Install these before anything else:

| Tool | Download |
|------|----------|
| Node.js 18+ | https://nodejs.org |
| Python 3.10+ | https://python.org |
| Git | https://git-scm.com |

---

## STEP 2 — Set Up MongoDB (Free Cloud DB)

1. Go to https://cloud.mongodb.com and sign up / log in
2. Create a **free M0 cluster** (any region)
3. In **Database Access** → Add a new database user (username + strong password)
4. In **Network Access** → Add `0.0.0.0/0` (allow all IPs for now)
5. Click **Connect** → **Connect your application**
6. Copy the connection string. It looks like:
   ```
   mongodb+srv://myuser:mypassword@cluster0.abc12.mongodb.net/smartvision?retryWrites=true&w=majority
   ```
   Replace `<password>` with your actual password.

---

## STEP 3 — Create the .env File

Inside `smart-energy-system/` create a file named exactly `.env` (no extension):

```env
MONGO_URI=mongodb+srv://youruser:yourpass@cluster.mongodb.net/smartvision?retryWrites=true&w=majority
SESSION_SECRET=paste_a_long_random_string_here
WHATSAPP_TOKEN=your_whatsapp_token
WHATSAPP_PHONE_ID=your_phone_number_id
FLASK_STREAM_URL=http://localhost:5000/detection_feed
FRONTEND_URL=http://localhost:3000
NODE_ENV=development
PORT=3000
```

> **Generating SESSION_SECRET**: Open any terminal and run:
> ```
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```
> Paste the output as your `SESSION_SECRET`.

> **WhatsApp API**: Go to https://developers.facebook.com → Create App → Add WhatsApp product.
> Copy the **Access Token** and **Phone Number ID** from the WhatsApp API Setup page.
> In **dev mode**, the OTP will print in the terminal (no WhatsApp needed for testing).

---

## STEP 4 — Install Node.js Backend

```bash
# Navigate to the backend folder
cd smart-energy-system/backend

# Install all packages
npm install

# Confirm it worked
node -e "console.log('Node OK')"
```

---

## STEP 5 — Set Up Python Virtual Environment

> ⚠️ Always use a virtual environment to avoid conflicts.

```bash
# Navigate to the detection folder
cd smart-energy-system/detection

# Create the virtual environment (named "venv")
python -m venv venv

# Activate it:
# On Windows:
venv\Scripts\activate

# On Mac/Linux:
source venv/bin/activate

# You should see (venv) at the start of your terminal prompt.

# Now install Python packages INSIDE the venv
pip install -r requirements.txt

# This downloads YOLOv8, OpenCV, Flask, etc.
# It may take 2–5 minutes on first run.
```

> **Every time you open a new terminal for the Python server, activate the venv first.**

---

## STEP 6 — Create the First Admin User

```bash
cd smart-energy-system/backend

# Open seed-admin.js and edit:
#   ADMIN_NAME  = 'Your Name'
#   ADMIN_PHONE = '919876543210'   ← your WhatsApp with country code, no +

node seed-admin.js
```

Expected output:
```
✅  Connected to MongoDB
✅  Admin user created: YourName (919876543210)
Done. You can now log in with your WhatsApp OTP.
```

---

## STEP 7 — Run the Servers

You need **two terminals** open simultaneously.

### Terminal 1 — Node.js Backend
```bash
cd smart-energy-system/backend
npm start
# You should see: 🚀  Server running on http://localhost:3000
#                 ✅  MongoDB connected
```

### Terminal 2 — Flask Detection Stream
```bash
cd smart-energy-system/detection
source venv/bin/activate      # or venv\Scripts\activate on Windows
python stream_server.py
# You should see: Flask stream server starting on port 5000
#                 YOLO model loaded ✅
#                 Detection loop started ✅
```

Now open http://localhost:3000 in your browser.

---

## STEP 8 — Test Login

1. Go to http://localhost:3000
2. Click **Existing User** tab
3. Enter your WhatsApp number (same as `ADMIN_PHONE` in seed-admin.js)
4. If WhatsApp is not configured, check Terminal 1 — the OTP prints there:
   ```
   ⚠️  WhatsApp not configured — OTP: 482931
   ```
5. Enter the OTP → you should be redirected to `/admin`

---

## STEP 9 — Deploy Online with Railway + ngrok

### Option A — Railway (Recommended, free tier available)

1. Go to https://railway.app and sign up
2. Click **New Project** → **Deploy from GitHub** (push your code to GitHub first)
3. Add all your `.env` variables in Railway's **Variables** tab
4. Railway gives you a public URL like `https://smartvision-production.up.railway.app`
5. Update `FRONTEND_URL` in Railway variables to your Railway URL

### Option B — ngrok (Quick local tunneling)

```bash
# Install ngrok: https://ngrok.com/download

# Expose the Node.js server
ngrok http 3000
# You get a URL like: https://abc123.ngrok-free.app

# In a SEPARATE terminal, expose Flask too (for the camera stream)
ngrok http 5000
# You get another URL like: https://def456.ngrok-free.app
```

Then update your `.env`:
```env
FRONTEND_URL=https://abc123.ngrok-free.app
FLASK_STREAM_URL=https://def456.ngrok-free.app/detection_feed
```

Restart both servers after changing `.env`.

---

## Troubleshooting

### "Invalid credentials" / can't log in
- Make sure you ran `node seed-admin.js` and it printed success
- Check the phone number has NO `+` and includes country code (e.g. `919876543210`)
- Check `MONGO_URI` in `.env` — make sure password has no special characters that need URL encoding

### Camera not showing
- Make sure Flask server (`stream_server.py`) is running
- Check terminal 2 for errors — camera might be at index 1 instead of 0, edit `CAMERA_INDEX = 1` in `stream_server.py`
- If no camera is found, a "Camera Offline" placeholder is shown

### OTP not arriving on WhatsApp
- In dev/test mode, OTP prints in Terminal 1 — use that
- For real WhatsApp: ensure `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` are correct
- WhatsApp Business API requires the recipient number to be added as a test number in your Meta app

### MongoDB connection failed
- Double-check `MONGO_URI` in `.env`
- In MongoDB Atlas → Network Access → make sure your IP is whitelisted (or use `0.0.0.0/0`)

### "Too many requests" error
- This is rate limiting working correctly
- Wait 10–15 minutes or restart the server for development

---

## Security Features Built In

| Feature | Details |
|---------|---------|
| Rate limiting | 3 OTP requests / 10 min per IP, 10 login attempts / 15 min |
| Session security | HttpOnly, SameSite cookies, stored in MongoDB |
| NoSQL injection | `express-mongo-sanitize` strips `$` and `.` from all inputs |
| Helmet | Sets 14 HTTP security headers automatically |
| OTP expiry | Each OTP expires in 5 minutes and can only be used once |
| Admin approval | New users cannot log in until an admin approves their account |
| Secure headers | CORS locked to your domain in production |
