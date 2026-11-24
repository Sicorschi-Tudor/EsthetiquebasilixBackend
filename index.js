const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const routes = require("./routes/TaskRoute");
const priceRoutes = require("./routes/PriceRoute");
const cors = require("cors");
const cron = require("node-cron");
const TaskModel = require("./Models/TaskModels");
const EmailOutbox = require("./Models/EmailOutboxModel");
const { buildIcs } = require("./utils/calendar");
const { checkNextDayRecord } = require("./controllers/TaskControllers");
const { sendPartnerInquiry } = require("./utils/emailService");
const { startOutboxWorker, activeSends } = require("./utils/emailOutbox");
const { startBookingWatcher } = require("./utils/bookingWatcher");
const { setSlotIndexActive } = require("./utils/bookingRules");

const app = express();
const PORT = process.env.PORT || 5000;

// Conexiunea poate veni din variabile de mediu (recomandat); valorile actuale
// rămân ca rezervă ca producția să funcționeze și fără ele setate.
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://aaw1713tudor:7777777AAA@cluster0.wk7njla.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const MONGODB_DB = process.env.MONGODB_DB || "esthetiquebasilixdb";

let slotIndexOk = false;

// Asigură indexul unic {data,time} în baza de date. Dacă build-ul eșuează
// (de obicei pentru că există deja duplicate), logăm CLAR — fără acest index
// upsert-ul atomic din saveTask NU previne singur dubla rezervare între procese.
// createIndexes DOAR creează indexul lipsă — nu șterge și nu modifică niciun document.
async function ensureSlotIndex() {
  try {
    await TaskModel.createIndexes();
  } catch (idxErr) {
    console.error(
      "⚠️ Nu s-a putut crea indexul unic {data,time} (probabil există duplicate). " +
        "Rulează scriptul de migrare pentru a curăța duplicatele și a crea indexul.",
      idxErr.message
    );
  }
  try {
    const idx = await TaskModel.collection.indexes();
    slotIndexOk = idx.some((i) => i.unique && i.key && i.key.data === 1 && i.key.time === 1);
  } catch (e) {
    slotIndexOk = false;
  }
  setSlotIndexActive(slotIndexOk);
  return slotIndexOk;
}

// O eroare neprevăzută într-o cerere nu trebuie să oprească tot serverul
// (rezervările în curs și emailurile s-ar pierde odată cu el).
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

const startServer = async () => {
  try {
    await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB });
    console.log(`MongoDB connected (db: ${MONGODB_DB})`);

    await ensureSlotIndex();
    console.log(
      slotIndexOk
        ? "✅ Unique index {data,time} ACTIV — dubla rezervare blocată la nivel DB."
        : "⚠️ Unique index {data,time} LIPSEȘTE. Rulează scriptul de migrare (dedup + createIndex)."
    );

    // Reverificare periodică: dacă indexul dispare vreodată, e recreat automat,
    // iar până atunci controller-ele aplică verificarea anti-dublură suplimentară.
    setInterval(async () => {
      const before = slotIndexOk;
      await ensureSlotIndex();
      if (before !== slotIndexOk) {
        console.log(`Unique index {data,time} state changed: ${before} → ${slotIndexOk}`);
      }
    }, Number(process.env.INDEX_CHECK_INTERVAL_MS) || 5 * 60 * 1000);

    try {
      await EmailOutbox.createIndexes();
    } catch (e) {
      console.error("Outbox index creation failed:", e.message);
    }

    // Coada de emailuri: reîncearcă emailurile care n-au putut pleca imediat.
    if (process.env.DISABLE_OUTBOX_WORKER !== "1") startOutboxWorker();
    // Detector: rezervări șterse/adăugate/modificate ÎN AFARA aplicației → alertă clinicii.
    if (process.env.DISABLE_BOOKING_WATCHER !== "1") startBookingWatcher();

    const server = app.listen(PORT, () => {
      console.log(`Server started on port: ${PORT}`);
    });

    // Oprire curată (deploy / restart pe Render): nu mai primim cereri noi, le
    // terminăm pe cele în curs (rezervare + audit + email), apoi ieșim.
    let stopping = false;
    const shutdown = (signal) => {
      if (stopping) return;
      stopping = true;
      console.log(`${signal}: finishing in-flight requests and emails before exit…`);
      let closed = false;
      server.close(() => {
        closed = true;
      });
      const deadline = Date.now() + 25000;
      const tick = setInterval(() => {
        // Conexiunile keep-alive rămase libere după răspuns sunt închise (altfel
        // serverul ar aștepta după ele până la limita de timp).
        if (server.closeIdleConnections) server.closeIdleConnections();
        if ((closed && activeSends() === 0) || Date.now() > deadline) {
          clearInterval(tick);
          process.exit(0);
        }
      }, 200);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
    process.exit(1);
  }
};

startServer();

// Menține serverul activ pe Render (free tier se oprește după 15 min inactivitate)
if (process.env.DISABLE_KEEPALIVE !== "1") {
  setInterval(() => {
    // /health e ușor și fără date personale (înainte se descărcau toate rezervările).
    fetch("https://esthetiquebasilixbackend.onrender.com/health")
      .then(() => console.log("keep-alive ping OK"))
      .catch((err) => console.error("keep-alive ping failed:", err.message));
  }, 600000);
}

// Remindere zilnice la 09:00
if (process.env.DISABLE_CRON !== "1") {
  cron.schedule("0 9 * * *", async () => {
    await checkNextDayRecord();
  });
}

// Stare de sănătate (fără date personale): baza de date, indexul anti-dublură și
// coada de emailuri. Util pentru monitorizare.
app.get("/health", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const [pending, failed] = await Promise.all([
      EmailOutbox.countDocuments({ status: { $in: ["pending", "sending"] } }),
      EmailOutbox.countDocuments({ status: "failed" }),
    ]);
    res.json({
      db: mongoose.connection.readyState === 1 ? "ok" : "down",
      uniqueSlotIndex: slotIndexOk,
      emailOutbox: { pending, failed },
    });
  } catch (e) {
    res.status(500).json({ db: "error", error: e.message });
  }
});

// Rute vechi, păstrate DOAR ca vechiul panou admin să nu afișeze erori până e
// actualizat. Nu mai trimit nimic: confirmarea/modificarea/anularea pleacă acum
// din operațiile propriu-zise, după verificarea în DB. (Înainte, prin ele se
// puteau declanșa emailuri fără nicio legătură cu starea reală din baza de date.)
app.get("/sentemail", (req, res) => {
  console.log("[legacy] /sentemail — no-op: emailul e trimis de operația din DB");
  res.send(["Email handled by booking operation", "Email handled by booking operation"]);
});

app.get("/sentemailDelete", (req, res) => {
  console.log("[legacy] /sentemailDelete — no-op: anularea e trimisă de DELETE /tasks/:id");
  res.send(["Email handled by booking operation", "Email handled by booking operation"]);
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
