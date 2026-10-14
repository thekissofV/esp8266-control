const express = require("express");
const crypto = require("crypto");
const path = require("path");
const https = require("https");
const querystring = require("querystring");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Relay States & Telemetry
let relay1 = false; // System Power
let relay2 = false; // Main Motor
let relay3 = false; // Drill Actuator
let relay4 = false; // Solenoid Water Valve
let node2Distance = 0; 
let paperWhite = false; // IR Sensor Color Detection (true = WHITE, false = BLACK)
let irColor = "BLACK";

// Timer reference for 15s Solenoid delay
let solenoidTimer = null;

// Pushover Credentials
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY || "u87wdpc6rv1yp4cdzx8tepvd3hptwk";
const PUSHOVER_APP_TOKEN = process.env.PUSHOVER_APP_TOKEN || "ayoqjrvo7q1mnheb2r41pzorc3uvbs";

// Fallback device key guarantees 200 OK without environment variable setup
const DEVICE_KEY = process.env.DEVICE_KEY || "K8xP92mQ7vL4nT6zR3";

// Helper function to send Pushover notifications directly from Render
function sendPushover(title, message) {
    const postData = querystring.stringify({
        token: PUSHOVER_APP_TOKEN,
        user: PUSHOVER_USER_KEY,
        title: title,
        message: message
    });

    const options = {
        hostname: "api.pushover.net",
        port: 443,
        path: "/1/messages.json",
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData)
        }
    };

    const req = https.request(options, (res) => {
        console.log(`Pushover Notification Sent. Status: ${res.statusCode}`);
    });

    req.on("error", (e) => {
        console.error(`Pushover Request Error: ${e.message}`);
    });

    req.write(postData);
    req.end();
}

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

app.get("/", (req, res) => {
    if (!loggedIn(req)) {
        return res.redirect("/login.html");
    }
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static("public"));

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

// GET Current System State for Web Front-End
app.get("/api/state", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.json({ relay1, relay2, relay3, relay4, node2Distance, paperWhite, irColor });
});

// CHANGE RELAY (Web Dashboard Manual Commands)
app.post("/api/relay", (req, res) => {
    if (!loggedIn(req)) {
        return res.status(401).json({ error: "Not logged in" });
    }
    const { relay, state } = req.body;

    if (relay === 1) {
        const oldState = relay1;
        relay1 = (state === true);
        if (oldState !== relay1) {
            sendPushover("Macerator Control", relay1 ? "System Power ONLINE." : "System Power OFFLINE.");
        }
        if (!relay1) {
            relay2 = false;
            relay3 = false;
            relay4 = false;
            if (solenoidTimer) { clearTimeout(solenoidTimer); solenoidTimer = null; }
        }
    } else {
        if (!relay1 && state === true) {
            return res.status(400).json({ 
                error: "Safety Interlock: System Power must be turned ON first!" 
            });
        }
        if (relay === 2) {
            const oldState = relay2;
            relay2 = (state === true);
            if (oldState !== relay2) {
                sendPushover("Macerator Alert", relay2 ? "MAIN MOTOR RUNNING!" : "Main Motor STOPPED.");
            }
        }
        if (relay === 3) relay3 = (state === true);
        if (relay === 4) relay4 = (state === true);
    }

    res.json({ relay1, relay2, relay3, relay4, node2Distance, paperWhite, irColor });
});

// ESP8266 DEVICE POLLING & AUTOMATED WORKFLOW
app.post("/api/device", (req, res) => {
    const clientKey = req.query.key;
    if (clientKey && clientKey !== DEVICE_KEY && clientKey !== "K8xP92mQ7vL4nT6zR3") {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (req.body && typeof req.body === 'object') {
        const wasMotorRunning = relay2;

        if (typeof req.body.relay1 === 'boolean') relay1 = req.body.relay1;
        if (typeof req.body.relay2 === 'boolean') relay2 = req.body.relay2;
        if (typeof req.body.relay3 === 'boolean') relay3 = req.body.relay3;
        if (typeof req.body.relay4 === 'boolean') relay4 = req.body.relay4;

        if (req.body.node2Distance !== undefined) node2Distance = req.body.node2Distance;
        if (req.body.rawDistanceCm !== undefined) node2Distance = req.body.rawDistanceCm;

        // Capture IR Color Telemetry from Node 2 / Node 1
        if (typeof req.body.paperWhite === 'boolean') paperWhite = req.body.paperWhite;
        if (typeof req.body.irColor === 'string') irColor = req.body.irColor;

        // AUTOMATION TRIGGER: If Motor was RUNNING and stopped locally by ESP8266 (<=22cm)
        if (wasMotorRunning && !relay2 && relay1) {
            sendPushover("Macerator Alert", "Paper Bin FULL (22cm)! Motor stopped. Solenoid opening in 15 seconds.");

            if (solenoidTimer) clearTimeout(solenoidTimer);
            
            solenoidTimer = setTimeout(() => {
                if (relay1) {
                    relay4 = true; // Open Solenoid Valve
                    sendPushover("Macerator Alert", "15s Delay passed. Solenoid Valve OPENED to fill water.");
                }
                solenoidTimer = null;
            }, 15000);
        }
    }

    res.json({ relay1, relay2, relay3, relay4, paperWhite });
});

app.get("/health", (req, res) => {
    res.send("ESP8266 Control Server is running!");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
