const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

let relay1 = false;
let relay2 = false;

// Device key - we will put the real value in Render Environment Variables
const DEVICE_KEY = process.env.DEVICE_KEY;

// Five users
const users = {
    user1: process.env.USER1_PASSWORD,
    user2: process.env.USER2_PASSWORD,
    user3: process.env.USER3_PASSWORD,
    user4: process.env.USER4_PASSWORD,
    user5: process.env.USER5_PASSWORD
};

// Temporary login sessions
const sessions = new Set();

// =========================
// LOGIN
// =========================

app.post("/login", (req, res) => {

    const { username, password } = req.body;

    if (
        users[username] &&
        password === users[username]
    ) {

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

// =========================
// CHECK LOGIN
// =========================

function loggedIn(req) {

    const cookie = req.headers.cookie || "";

    const match = cookie.match(/session=([^;]+)/);

    if (!match) {
        return false;
    }

    return sessions.has(match[1]);
}

// =========================
// LOGOUT
// =========================

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

// =========================
// GET RELAY STATUS
// =========================

app.get("/api/state", (req, res) => {

    // ESP8266 authentication
    if (req.query.key === DEVICE_KEY) {

        return res.json({
            relay1,
            relay2
        });
    }

    // Website authentication
    if (!loggedIn(req)) {
        return res.status(401).json({
            error: "Not logged in"
        });
    }

    res.json({
        relay1,
        relay2
    });
});

// =========================
// CHANGE RELAY
// =========================

app.post("/api/relay", (req, res) => {

    if (!loggedIn(req)) {
        return res.status(401).json({
            error: "Not logged in"
        });
    }

    const { relay, state } = req.body;

    if (relay === 1) {
        relay1 = state === true;
    }

    if (relay === 2) {
        relay2 = state === true;
    }

    res.json({
        relay1,
        relay2
    });
});

// =========================
// ESP8266 SENDS STATUS
// =========================

app.post("/api/device", (req, res) => {

    if (req.query.key !== DEVICE_KEY) {
        return res.status(401).json({
            error: "Unauthorized"
        });
    }

    res.json({
        relay1,
        relay2
    });
});

// =========================
// HEALTH CHECK
// =========================

app.get("/health", (req, res) => {
    res.send("ESP8266 Control Server is running!");
});

// =========================
// START SERVER
// =========================

app.listen(PORT, "0.0.0.0", () => {

    console.log(`Server running on port ${PORT}`);

});
