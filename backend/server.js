require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const twilio = require("twilio");
const { StreamClient } = require("@stream-io/node-sdk");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_INR_RATE = 1.1;

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL in backend/.env");
}
if (!JWT_SECRET) {
  throw new Error("Missing JWT_SECRET in backend/.env");
}
if (!process.env.STREAM_API_KEY || !process.env.STREAM_API_SECRET) {
  throw new Error("Missing Stream credentials in backend/.env");
}
if (
  !process.env.TWILIO_ACCOUNT_SID ||
  !process.env.TWILIO_AUTH_TOKEN ||
  !process.env.TWILIO_VERIFY_SERVICE_SID
) {
  throw new Error("Missing Twilio Verify credentials in backend/.env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const streamClient = new StreamClient(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\s+/g, "");
}

function monthKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function signJwt(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email || null,
      phone: user.phone || null,
      tier: user.tier || "none",
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function generateStreamToken(userId) {
  return streamClient.generateUserToken({ user_id: userId });
}

function tokensToInr(tokens) {
  return Number(tokens) * TOKEN_INR_RATE;
}

function inrToTokens(inrAmount) {
  return Math.floor(Number(inrAmount) / TOKEN_INR_RATE);
}

async function upsertMonthlyAllotment(userId) {
  const key = monthKey();

  const result = await pool.query(
    `
    INSERT INTO monthly_allotments (user_id, month_key)
    VALUES ($1, $2)
    ON CONFLICT (user_id, month_key)
    DO UPDATE SET month_key = EXCLUDED.month_key
    RETURNING *
    `,
    [userId, key]
  );

  return result.rows[0];
}

async function ensureStreamUser(user) {
  await streamClient.upsertUsers([
    {
      id: user.id,
      name: user.display_name || user.email || user.phone || "Fan User",
      role: "user",
    },
  ]);
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.auth = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired auth token" });
  }
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ ok: true, service: "backend", db: "connected" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Database not reachable" });
  }
});

app.get("/api/pricing/token-quote", (req, res) => {
  const tokens = Number(req.query.tokens || 0);
  const inr = Number(req.query.inr || 0);

  if (tokens > 0) {
    return res.json({
      tokens,
      inr: Number(tokensToInr(tokens).toFixed(2)),
      rate: TOKEN_INR_RATE,
    });
  }

  if (inr > 0) {
    return res.json({
      inr: Number(inr.toFixed(2)),
      tokens: inrToTokens(inr),
      rate: TOKEN_INR_RATE,
    });
  }

  return res.status(400).json({
    error: "Provide either ?tokens=NUMBER or ?inr=NUMBER",
  });
});

app.post("/api/auth/register", async (req, res) => {
  const { email, password, isAdultConfirmed } = req.body;

  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return res.status(400).json({ error: "Email is required" });
  }

  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  if (isAdultConfirmed !== true) {
    return res.status(400).json({ error: "Adult confirmation is required" });
  }

  try {
    const existing = await pool.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (email, password_hash, is_adult_confirmed)
      VALUES ($1, $2, $3)
      RETURNING id, email, phone, display_name, tier, is_phone_verified, is_adult_confirmed, created_at
      `,
      [normalizedEmail, passwordHash, true]
    );

    const user = result.rows[0];

    await upsertMonthlyAllotment(user.id);
    await ensureStreamUser(user);

    const token = signJwt(user);
    const streamToken = generateStreamToken(user.id);

    return res.status(201).json({
      message: "Registration successful",
      token,
      streamToken,
      user,
    });
  } catch (error) {
    console.error("register error:", error);
    return res.status(500).json({ error: "Failed to register user" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, email, phone, password_hash, display_name, tier,
             is_phone_verified, is_adult_confirmed, coin_balance, membership_expires_at
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash || "");
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    await pool.query(
      `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    await upsertMonthlyAllotment(user.id);
    await ensureStreamUser(user);

    const token = signJwt(user);
    const streamToken = generateStreamToken(user.id);

    return res.json({
      message: "Login successful",
      token,
      streamToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        display_name: user.display_name,
        tier: user.tier,
        coin_balance: user.coin_balance,
        membership_expires_at: user.membership_expires_at,
        is_phone_verified: user.is_phone_verified,
        is_adult_confirmed: user.is_adult_confirmed,
      },
    });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({ error: "Failed to log in" });
  }
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, email, phone, dob, display_name, tier, coin_balance,
             membership_expires_at, is_phone_verified, is_adult_confirmed,
             created_at, last_login_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.auth.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ user: result.rows[0] });
  } catch (error) {
    console.error("me error:", error);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

app.post("/api/auth/post-payment-profile", authRequired, async (req, res) => {
  const { displayName, phone, dob } = req.body;

  const normalizedPhone = normalizePhone(phone);

  if (!displayName || !String(displayName).trim()) {
    return res.status(400).json({ error: "Name is required" });
  }

  if (!normalizedPhone) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  if (!dob) {
    return res.status(400).json({ error: "Date of birth is required" });
  }

  try {
    const phoneCheck = await pool.query(
      `
      SELECT id FROM users
      WHERE phone = $1 AND id <> $2
      LIMIT 1
      `,
      [normalizedPhone, req.auth.userId]
    );

    if (phoneCheck.rows.length > 0) {
      return res.status(409).json({ error: "Phone number already in use" });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET display_name = $1,
          phone = $2,
          dob = $3,
          is_phone_verified = FALSE
      WHERE id = $4
      RETURNING id, email, phone, dob, display_name, tier, is_phone_verified
      `,
      [String(displayName).trim(), normalizedPhone, dob, req.auth.userId]
    );

    const user = result.rows[0];
    await ensureStreamUser(user);

    return res.json({
      message: "Post-payment profile saved. Verify phone with OTP next.",
      user,
    });
  } catch (error) {
    console.error("post-payment-profile error:", error);
    return res.status(500).json({ error: "Failed to save profile" });
  }
});

app.post("/api/auth/send-otp", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT phone FROM users WHERE id = $1 LIMIT 1`,
      [req.auth.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const phone = result.rows[0].phone;

    if (!phone) {
      return res.status(400).json({ error: "Phone number not set for user" });
    }

    const verification = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({
        to: phone,
        channel: "sms",
      });

    return res.json({
      message: "OTP sent successfully",
      status: verification.status,
      sid: verification.sid,
    });
  } catch (error) {
    console.error("send-otp error:", {
      message: error.message,
      status: error.status,
      code: error.code,
      moreInfo: error.moreInfo,
      details: error.details,
    });

    return res.status(500).json({
      error: "Failed to send OTP",
      twilio: {
        message: error.message || null,
        status: error.status || null,
        code: error.code || null,
        moreInfo: error.moreInfo || null,
        details: error.details || null,
      },
    });
  }
});
app.post("/api/auth/verify-otp", authRequired, async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: "OTP code is required" });
  }

  try {
    const result = await pool.query(
      `SELECT phone FROM users WHERE id = $1 LIMIT 1`,
      [req.auth.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const phone = result.rows[0].phone;
    if (!phone) {
      return res.status(400).json({ error: "Phone number not set for user" });
    }

    const check = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({
        to: phone,
        code: String(code).trim(),
      });

    if (check.status !== "approved") {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    await pool.query(
      `
      UPDATE users
      SET is_phone_verified = TRUE,
          phone_verified_at = NOW()
      WHERE id = $1
      `,
      [req.auth.userId]
    );

    return res.json({
      message: "Phone verified successfully",
      approved: true,
    });
  } catch (error) {
    console.error("verify-otp error:", error);
    return res.status(500).json({ error: "Failed to verify OTP" });
  }
});

app.post("/api/auth/recover/send-otp", async (req, res) => {
  const { phone } = req.body;
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  try {
    const userResult = await pool.query(
      `
      SELECT id, phone, is_phone_verified
      FROM users
      WHERE phone = $1
      LIMIT 1
      `,
      [normalizedPhone]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "No account found for this phone number" });
    }

    const user = userResult.rows[0];

    if (!user.is_phone_verified) {
      return res.status(400).json({ error: "Phone number is not verified yet" });
    }

    const allotment = await upsertMonthlyAllotment(user.id);

    if ((allotment.recovery_otp_used || 0) >= 2) {
      return res.status(429).json({
        error: "Monthly OTP recovery limit reached",
      });
    }

    const verification = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({
        to: normalizedPhone,
        channel: "sms",
      });

    await pool.query(
      `
      UPDATE monthly_allotments
      SET recovery_otp_used = COALESCE(recovery_otp_used, 0) + 1
      WHERE user_id = $1 AND month_key = $2
      `,
      [user.id, monthKey()]
    );

    return res.json({
      message: "Recovery OTP sent successfully",
      status: verification.status,
      remainingThisMonth: Math.max(0, 2 - ((allotment.recovery_otp_used || 0) + 1)),
    });
  } catch (error) {
    console.error("recover/send-otp error:", error);
    return res.status(500).json({ error: "Failed to send recovery OTP" });
  }
});

app.post("/api/auth/recover/verify-otp", async (req, res) => {
  const { phone, code } = req.body;
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone || !code) {
    return res.status(400).json({ error: "Phone number and OTP code are required" });
  }

  try {
    const userResult = await pool.query(
      `
      SELECT id, email, display_name, phone, is_phone_verified
      FROM users
      WHERE phone = $1
      LIMIT 1
      `,
      [normalizedPhone]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "No account found for this phone number" });
    }

    const user = userResult.rows[0];

    if (!user.is_phone_verified) {
      return res.status(400).json({ error: "Phone number is not verified yet" });
    }

    const check = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({
        to: normalizedPhone,
        code: String(code).trim(),
      });

    if (check.status !== "approved") {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    return res.json({
      message: "Recovery OTP verified",
      account: {
        email: user.email,
        display_name: user.display_name,
      },
      resetPasswordAllowed: true,
    });
  } catch (error) {
    console.error("recover/verify-otp error:", error);
    return res.status(500).json({ error: "Failed to verify recovery OTP" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { phone, code, newPassword } = req.body;
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone || !code || !newPassword) {
    return res.status(400).json({
      error: "Phone number, OTP code, and new password are required",
    });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }

  try {
    const userResult = await pool.query(
      `
      SELECT id, phone, is_phone_verified
      FROM users
      WHERE phone = $1
      LIMIT 1
      `,
      [normalizedPhone]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "No account found for this phone number" });
    }

    const user = userResult.rows[0];

    if (!user.is_phone_verified) {
      return res.status(400).json({ error: "Phone number is not verified yet" });
    }

    const check = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({
        to: normalizedPhone,
        code: String(code).trim(),
      });

    if (check.status !== "approved") {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
      `,
      [passwordHash, user.id]
    );

    return res.json({
      message: "Password reset successful",
    });
  } catch (error) {
    console.error("reset-password error:", error);
    return res.status(500).json({ error: "Failed to reset password" });
  }
});

app.get("/api/stream/token", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, email, phone, display_name, tier
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.auth.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];
    await ensureStreamUser(user);

    const streamToken = generateStreamToken(user.id);

    return res.json({
      streamToken,
      user: {
        id: user.id,
        name: user.display_name || user.email || user.phone || "Fan User",
      },
    });
  } catch (error) {
    console.error("stream token error:", error);
    return res.status(500).json({ error: "Failed to generate Stream token" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});