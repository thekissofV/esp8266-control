const express = require("express");

const app = express();

const PORT = process.env.PORT || 10000;

app.use(express.static("public"));

app.get("/health", (req, res) => {
    res.send("ESP8266 Control Server is running!");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
