const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Hardware Relay States
let relay1 = false; // System Power
let relay2 = false; // Main Motor
let relay3 = false; // Drill Actuator
let relay4 = false; // Solenoid Water Valve

const DEVICE_KEY = process.env.DEVICE_KEY;

const users = {
    Dwight: process.env.USER1_PASSWORD,
    Philip: process.env.USER2_PASSWORD,
    Joaquin: process.env.USER3_PASSWORD,
    Guest: process.env.USER4_PASSWORD,
    Kris: process.env.USER5_PASSWORD
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

// CHECK LOGIN SESSION
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

    res.redirect("/login.html");
});

// GET RELAY STATE (WEB UI)
app.get("/api/state", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }

    res.json({
        relay1,
        relay2,
        relay3,
        relay4
    });
});

// CHANGE RELAY (WEB UI)
app.post("/api/relay", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }

    const { relay, state } = req.body;

    if (relay === 1) relay1 = state === true;
    if (relay === 2) relay2 = state === true;
    if (relay === 3) relay3 = state === true;
    if (relay === 4) relay4 = state === true;

    res.json({
        relay1,
        relay2,
        relay3,
        relay4
    });
});

// ESP8266 DEVICE POLLING ENDPOINT
app.post("/api/device", (req, res) => {
    if (req.query.key !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    res.json({
        relay1,
        relay2,
        relay3,
        relay4
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
