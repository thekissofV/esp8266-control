const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Relay States & Distance Telemetry
let relay1 = false; // System Power
let relay2 = false; // Main Motor
let relay3 = false; // Drill Actuator
let relay4 = false; // Solenoid Water Valve
let node2Distance = 0; // Distance reading in cm

// Security key with hardcoded fallback matching ESP8266
const DEVICE_KEY = process.env.DEVICE_KEY || "K8xP92mQ7vL4nT6zR3";

const users = {
    Dwight: process.env.USER1_PASSWORD || "1234",
    Philip: process.env.USER2_PASSWORD || "1234",
    Joaquin: process.env.USER3_PASSWORD || "1234",
    Guest: process.env.USER4_PASSWORD || "1234",
    Kris: process.env.USER5_PASSWORD || "1234"
};

// Active user sessions stored in memory
const sessions = new Map();

function loggedIn(req) {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/session=([^;]+)/);
    if (!match) return false;
    
    const token = match[1];
    if (!sessions.has(token)) return false;

    // Expire sessions older than 24 hours
    if (Date.now() - sessions.get(token) > 86400000) {
        sessions.delete(token);
        return false;
    }
    return true;
}

// 1. Root Route
app.get("/", (req, res) => {
    if (!loggedIn(req)) {
        return res.redirect("/login.html");
    }
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 2. Public Static Assets
app.use(express.static("public"));

// LOGIN ROUTE
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

// LOGOUT ROUTE
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

// GET RELAY STATE (Web UI)
app.get("/api/state", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.json({ relay1, relay2, relay3, relay4, node2Distance });
});

// CHANGE RELAY (Web Dashboard)
app.post("/api/relay", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }
    const { relay, state } = req.body;

    if (relay === 1) {
        relay1 = (state === true);
        if (!relay1) {
            relay2 = false; // Main Motor STOP
            relay3 = false; // Drill Actuator STOP
            relay4 = false; // Solenoid Valve CLOSE
        }
    } else {
        if (!relay1 && state === true) {
            return res.status(400).json({ error: "System Power must be turned ON first!" });
        }
        if (relay === 2 && state === true) {
            if (node2Distance > 0 && node2Distance <= 22) {
                return res.status(400).json({ error: "Hopper level is 22cm or closer. Clear hopper first!" });
            }
        }
        if (relay === 2) relay2 = (state === true);
        if (relay === 3) relay3 = (state === true);
        if (relay === 4) relay4 = (state === true);
    }

    res.json({ relay1, relay2, relay3, relay4, node2Distance });
});

// ESP8266 DEVICE POLLING & TELEMETRY
app.post("/api/device", (req, res) => {
    if (req.query.key && req.query.key !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Receive distance telemetry from ESP8266
    if (req.body.node2Distance !== undefined) {
        node2Distance = req.body.node2Distance;
    } else if (req.body.rawDistanceCm !== undefined) {
        node2Distance = req.body.rawDistanceCm;
    }

    // Receive state changes pushed from automated sequences on ESP8266
    if (req.body.relay1 !== undefined) relay1 = req.body.relay1;
    if (req.body.relay2 !== undefined) relay2 = req.body.relay2;
    if (req.body.relay3 !== undefined) relay3 = req.body.relay3;
    if (req.body.relay4 !== undefined) relay4 = req.body.relay4;

    // LATCHED SAFETY OVERRIDE: Motor cannot run if hopper <= 22cm
    if (node2Distance > 0 && node2Distance <= 22) {
        relay2 = false;
    }

    res.json({ relay1, relay2, relay3, relay4 });
});

// HEALTH CHECK
app.get("/health", (req, res) => {
    res.send("ESP8266 Control Server is running!");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
