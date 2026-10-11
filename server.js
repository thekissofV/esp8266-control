const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Relay States & Sensor Data
let relay1 = false; // System Power
let relay2 = false; // Main Motor
let relay3 = false; // Drill Actuator
let relay4 = false; // Solenoid Water Valve
let node2Distance = 0; // Secondary Ultrasonic Sensor

const DEVICE_KEY = process.env.DEVICE_KEY;

const users = {
    Dwight: process.env.USER1_PASSWORD,
    Philip: process.env.USER2_PASSWORD,
    Joaquin: process.env.USER3_PASSWORD,
    Guest: process.env.USER4_PASSWORD,
    Kris: process.env.USER5_PASSWORD
};

// Store sessions with timestamp for expiration cleanup
const sessions = new Map(); // token -> loginTimestamp

function loggedIn(req) {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/session=([^;]+)/);
    if (!match) return false;
    
    const token = match[1];
    if (!sessions.has(token)) return false;

    // Expire sessions older than 24 hours (86,400,000 ms)
    if (Date.now() - sessions.get(token) > 86400000) {
        sessions.delete(token);
        return false;
    }
    return true;
}

// 1. Explicit Routing to Protect index.html
app.get("/", (req, res) => {
    if (!loggedIn(req)) {
        return res.redirect("/login.html");
    }
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 2. Public Static Assets (Serves login.html, CSS, JS without auth)
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
    res.json({ relay1, relay2, relay3, relay4, node2Distance });
});

// CHANGE RELAY (Web UI) WITH SAFETY INTERLOCK
app.post("/api/relay", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }
    const { relay, state } = req.body;

    // Relay 1: System Power Logic
    if (relay === 1) {
        relay1 = state === true;
        // AUTO-CUTOFF: Turning System Power OFF shuts down all motors/valves immediately
        if (!relay1) {
            relay2 = false; // Main Motor STOP
            relay3 = false; // Drill Actuator STOP
            relay4 = false; // Solenoid Valve CLOSE
        }
    } else {
        // SAFETY INTERLOCK: Reject turning ON motor/actuator/valve if System Power is OFF
        if (!relay1 && state === true) {
            return res.status(400).json({ 
                error: "Safety Interlock: System Power must be turned ON first!" 
            });
        }
        if (relay === 2) relay2 = state === true;
        if (relay === 3) relay3 = state === true;
        if (relay === 4) relay4 = state === true;
    }

    res.json({ relay1, relay2, relay3, relay4, node2Distance });
});

// ESP8266 DEVICE POLLING / SYNC
app.post("/api/device", (req, res) => {
    if (req.query.key !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Accept optional sensor updates from ESP8266
    if (req.body.node2Distance !== undefined) {
        node2Distance = req.body.node2Distance;
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
