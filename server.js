const express = require("express");
const crypto = require("crypto");
const https = require("https");
const querystring = require("querystring");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ==============================
// DIRECT SMS FUNCTION (TEXTBELT)
// No NPM packages required
// ==============================
function sendMotorSMS() {
    const alertPhone = process.env.ALERT_PHONE_NUMBER; // e.g., +639171234567
    const apiKey     = process.env.TEXTBELT_KEY || "textbelt"; // Defaults to free 1 SMS/day key

    if (!alertPhone) {
        console.log("[SMS] ALERT_PHONE_NUMBER missing in Environment Variables. Skipping SMS.");
        return;
    }

    const postData = querystring.stringify({
        phone: alertPhone,
        message: "⚠️ ALERT: Automated Paper Macerator Motor has been STARTED!",
        key: apiKey
    });

    const options = {
        hostname: "textbelt.com",
        port: 443,
        path: "/text",
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData)
        }
    };

    const req = https.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
            try {
                const response = JSON.parse(body);
                if (response.success) {
                    console.log(`[SMS] Alert sent successfully! Quota remaining: ${response.quotaRemaining}`);
                } else {
                    console.error("[SMS] Failed to send:", response.error);
                }
            } catch (e) {
                console.log("[SMS Response]:", body);
            }
        });
    });

    req.on("error", (e) => {
        console.error("[SMS] Request Error:", e.message);
    });

    req.write(postData);
    req.end();
}

// ==============================
// STATE TRACKING & USERS
// ==============================
let relay1 = false;
let relay2 = false;
let lastESPCheckIn = 0;

const DEVICE_KEY = process.env.DEVICE_KEY || "K8xP92mQ7vL4nT6zR3";

const users = {
    "admin": process.env.USER1_PASSWORD || "macerator123",
    "operator": process.env.USER2_PASSWORD || "paper2026"
};

const sessions = new Set();

// LOGIN
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (users[username] && password === users[username]) {
        const token = crypto.randomBytes(32).toString("hex");
        sessions.add(token);

        res.setHeader(
            "Set-Cookie",
            `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`
        );

        return res.redirect("/");
    }

    res.status(401).send("Invalid username or password");
});

// CHECK LOGIN
function loggedIn(req) {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/session=([^;]+)/);
    if (!match) return false;
    return sessions.has(match[1]);
}

// LOGOUT
app.get("/logout", (req, res) => {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/session=([^;]+)/);

    if (match) {
        sessions.delete(match[1]);
    }

    res.setHeader(
        "Set-Cookie",
        "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
    );

    res.redirect("/");
});

// GET RELAY STATE + ESP ONLINE STATUS
app.get("/api/state", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }

    const espOnline = (Date.now() - lastESPCheckIn) < 7000;

    res.json({
        relay1,
        relay2,
        espOnline
    });
});

// CHANGE RELAY
app.post("/api/relay", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }

    const { relay, state } = req.body;

    if (relay === 1) {
        relay1 = state === true;
    }

    if (relay === 2) {
        const turningOn = state === true;

        // Send Direct SMS ONLY when motor transitions from OFF -> ON
        if (turningOn && !relay2) {
            sendMotorSMS();
        }

        relay2 = turningOn;
    }

    res.json({
        relay1,
        relay2
    });
});

// ESP8266 DEVICE POLLING ENDPOINT
app.post("/api/device", (req, res) => {
    if (req.query.key !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    lastESPCheckIn = Date.now();

    res.json({
        relay1,
        relay2
    });
});

// HEALTH CHECK
app.get("/health", (req, res) => {
    res.send("ESP8266 Control Server is running!");
});

// START SERVER
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
