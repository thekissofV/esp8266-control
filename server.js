const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Server Relay States & Telemetry
let relay1 = false; // System Power
let relay2 = false; // Main Motor
let relay3 = false; // Drill Actuator
let relay4 = false; // Solenoid Water Valve
let node2Distance = 0; 

// DEVICE_KEY with hardcoded fallback matching your ESP8266 firmware
const DEVICE_KEY = process.env.DEVICE_KEY || "K8xP92mQ7vL4nT6zR3";

// User credentials with default fallback ("1234") if Render env vars are absent
const users = {
    Dwight: process.env.USER1_PASSWORD || "1234",
    Philip: process.env.USER2_PASSWORD || "1234",
    Joaquin: process.env.USER3_PASSWORD || "1234",
    Guest: process.env.USER4_PASSWORD || "1234",
    Kris: process.env.USER5_PASSWORD || "1234"
};

const sessions = new Map();

function loggedIn(req) {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/session=([^;]+)/);
    if (!match) return false;
    
    const token = match[1];
    if (!sessions.has(token)) return false;

    if (Date.now() - sessions.get(token) > 86400000) {
        sessions.delete(token);
        return false;
    }
    return true;
}

// Protected Root Route
app.get("/", (req, res) => {
    if (!loggedIn(req)) {
        return res.redirect("/login.html");
    }
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Static Public Folder
app.use(express.static("public"));

// Login Route
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (users[username] && password && password === users[username]) {
        const token = crypto.randomBytes(32).toString("hex");
        sessions.set(token, Date.now());
        res.setHeader(
            "Set-Cookie",
            `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`
        );
        return res.redirect("/");
    }
    res.status(401).send("Invalid username or password");
});

// Logout Route
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
    res.redirect("/login.html");
});

// Get Current State (Web Dashboard)
app.get("/api/state", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.json({ relay1, relay2, relay3, relay4, node2Distance });
});

// Control Relays (Web Dashboard)
app.post("/api/relay", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }
    const { relay, state } = req.body;

    if (relay === 1) {
        relay1 = (state === true);
        if (!relay1) {
            relay2 = false;
            relay3 = false;
            relay4 = false;
        }
    } else {
        if (!relay1 && state === true) {
            return res.status(400).json({ error: "Safety Interlock: System Power must be turned ON first!" });
        }
        if (relay === 2) relay2 = (state === true);
        if (relay === 3) relay3 = (state === true);
        if (relay === 4) relay4 = (state === true);
    }

    res.json({ relay1, relay2, relay3, relay4, node2Distance });
});

// ESP8266 Hardware Sync & Polling Route
app.post("/api/device", (req, res) => {
    if (req.query.key && req.query.key !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Read distance telemetry if pushed by hardware
    if (req.body.node2Distance !== undefined) {
        node2Distance = req.body.node2Distance;
    } else if (req.body.rawDistanceCm !== undefined) {
        node2Distance = req.body.rawDistanceCm;
    }

    // Read relay state updates pushed by ESP8266 local automation
    if (req.body.relay1 !== undefined) relay1 = req.body.relay1;
    if (req.body.relay2 !== undefined) relay2 = req.body.relay2;
    if (req.body.relay3 !== undefined) relay3 = req.body.relay3;
    if (req.body.relay4 !== undefined) relay4 = req.body.relay4;

    res.json({ relay1, relay2, relay3, relay4 });
});

// Health Check
app.get("/health", (req, res) => {
    res.send("ESP8266 Control Server is running!");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
