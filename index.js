const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const routes = require("./routes/TaskRoute");
const priceRoutes = require("./routes/PriceRoute");
const cors = require("cors");
const cron = require("node-cron");
const TaskModel = require("./Models/TaskModels");
const { buildIcs } = require("./utils/calendar");
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

    // Asigură indexul unic {data,time} în baza de date. Dacă build-ul eșuează
    // (de obicei pentru că există deja duplicate), logăm CLAR — fără acest index
    // upsert-ul atomic din saveTask NU previne dubla rezervare.
    try {
      // createIndexes DOAR creează indexul lipsă — nu șterge și nu modifică niciun document.
      await TaskModel.createIndexes();
      const idx = await TaskModel.collection.indexes();
      const hasUnique = idx.some(
        (i) => i.unique && i.key && i.key.data === 1 && i.key.time === 1
      );
      console.log(
        hasUnique
          ? "✅ Unique index {data,time} ACTIV — dubla rezervare blocată la nivel DB."
          : "⚠️ Unique index {data,time} LIPSEȘTE. Rulează scriptul de migrare (dedup + createIndex)."
      );
    } catch (idxErr) {
      console.error(
        "⚠️ Nu s-a putut crea indexul unic {data,time} (probabil există duplicate). " +
          "Rulează scriptul de migrare pentru a curăța duplicatele și a crea indexul.",
        idxErr.message
      );
    }

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

// Servește fișierul .ics pentru o programare. Folosit de butonul „Ajouter au calendrier"
// pe iOS/Mac: deschiderea acestui URL (Content-Type text/calendar) adaugă evenimentul
// direct în Apple Calendar (calendarul lor nativ, nu Google).
app.get("/ics", (req, res) => {
  const ics = buildIcs(req.query);
  if (!ics) {
    return res.status(400).send("Données de réservation invalides");
  }
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  // "inline" (nu "attachment") → iOS/Mac Safari deschid DIRECT Apple Calendar cu
  // fereastra de adăugare, fără pasul intermediar de descărcare + deschidere a fișierului.
  res.setHeader("Content-Disposition", 'inline; filename="rendez-vous.ics"');
  res.send(ics);
});

app.use("/tasks", routes);
app.use("/preturi", priceRoutes);
