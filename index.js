const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const routes = require("./routes/TaskRoute");
const cors = require("cors");
const cron = require("node-cron");
const { checkNextDayRecord } = require("./controllers/TaskControllers");
const {
  sendBookingConfirmation,
  sendBookingCancellation,
  sendPartnerInquiry,
} = require("./utils/emailService");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

const startServer = async () => {
  try {
    await mongoose.connect(
      "mongodb+srv://aaw1713tudor:7777777AAA@cluster0.wk7njla.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
      { dbName: "esthetiquebasilixdb" }
    );
    console.log("MongoDB connected");

    app.listen(PORT, () => {
      console.log(`Server started on port: ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
    process.exit(1);
  }
};

startServer();

// Menține serverul activ pe Render (free tier se oprește după 15 min inactivitate)
setInterval(() => {
  fetch("https://esthetiquebasilixbackend.onrender.com/tasks/get")
    .then(() => console.log("keep-alive ping OK"))
    .catch((err) => console.error("keep-alive ping failed:", err.message));
}, 600000);

// Remindere zilnice la 09:00
cron.schedule("0 9 * * *", async () => {
  await checkNextDayRecord();
});

// Rută păstrată pentru compatibilitate cu panoul admin (nu mai e apelată de frontend la rezervare nouă)
app.get("/sentemail", (req, res) => {
  sendBookingConfirmation(req.query)
    .then(() => res.send(["Email sent successfully", "Email sent successfully"]))
    .catch((error) => {
      console.error("Error in /sentemail:", error);
      res.status(500).send(error.message);
    });
});

app.get("/sentemailDelete", (req, res) => {
  sendBookingCancellation(req.query)
    .then(() => res.send(["Email sent successfully", "Email sent successfully"]))
    .catch((error) => {
      console.error("Error in /sentemailDelete:", error);
      res.status(500).send(error.message);
    });
});

app.get("/sentemailpartener", (req, res) => {
  sendPartnerInquiry(req.query)
    .then(() => res.send("Email sent successfully"))
    .catch((error) => {
      console.error("Error in /sentemailpartener:", error);
      res.status(500).send(error.message);
    });
});

app.use("/tasks", routes);
