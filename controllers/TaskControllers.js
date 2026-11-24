const mongoose = require("mongoose");
const moment = require("moment-timezone");
const TaskModel = require("../Models/TaskModels");
const BookingAudit = require("../Models/BookingAuditModel");
const { sendBookingReminder } = require("../utils/emailService");
const { buildGoogleCalendarUrl, buildIcsUrl } = require("../utils/calendar");
const {
  validateBooking,
  slotFilter,
  pickBooking,
  sameClient,
  sameBooking,
  isSamePersonAfterEdit,
  isPastSlot,
  withSlotLock,
  isSlotIndexActive,
} = require("../utils/bookingRules");
const {
  createJob,
  skipJob,
  attachBooking,
  updatePayload,
  attemptWithin,
} = require("../utils/emailOutbox");

// Emailul administratorului: NU primește remindere automate cu o zi înainte.
const ADMIN_EMAIL = "voicugeorgiana88@gmail.com";

// Cât așteaptă răspunsul HTTP după email: peste atât, clienta primește răspunsul
// (rezervarea e deja confirmată în DB), iar emailul continuă să plece în fundal.
const EMAIL_WAIT_MS = Number(process.env.EMAIL_WAIT_MS) || 10000;

// Scrie o linie în istoricul de audit pentru fiecare operație (creare/editare/
// ștergere) + dacă emailul aferent a plecat. Non-fatal: dacă logarea eșuează,
// operația principală NU e afectată.
const logAudit = async (action, doc, { source, emailSent, note, req, before } = {}) => {
  try {
    const row = await BookingAudit.create({
      // La editări: cum arăta rezervarea ÎNAINTE (cine o avea, la ce oră).
      ...(before ? { before: pickBooking(before) } : {}),
      action,
      bookingId: doc && doc._id,
      data: doc && doc.data,
      time: doc && doc.time,
      name: doc && doc.name,
      surname: doc && doc.surname,
      email: doc && doc.email,
      tel: doc && doc.tel,
      service: doc && doc.service,
      source: source || "unknown",
      emailSent: !!emailSent,
      note: note || "",
      ...(req ? requestMeta(req) : {}),
    });
    return row._id;
  } catch (e) {
    console.error("Audit log failed:", e.message);
    return null;
  }
};

// Completează rândul de audit cu rezultatul emailului (trimis după scrierea auditului).
// `keep` = o notă care trebuie păstrată indiferent de email (ex. „clientă înlocuită").
const finishAudit = async (auditId, r, keep = "") => {
  if (!auditId) return;
  try {
    const note = [keep, r.sent ? "" : r.reason || ""].filter(Boolean).join(" | ");
    await BookingAudit.updateOne({ _id: auditId }, { $set: { emailSent: !!r.sent, note } });
  } catch (e) {
    console.error("Audit update failed:", e.message);
  }
};

// De unde vine o cerere de editare/ștergere (adresa completă din proxy + browserul).
const requestMeta = (req) => ({
  ip: String(req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || ""),
  userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
});

const sourceOf = (req, fallback) => {
  const s = req.query && req.query.source;
  return s === "site" || s === "admin-panel" ? s : fallback;
};

const emailInfo = (r) => ({ sent: !!r.sent, status: r.status, reason: r.reason || "" });
const slotKey = (b) => `${b.data}|${b.time}`;
const TAKEN = { status: 409, body: { error: "Time slot already taken" } };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Plasă de siguranță anti-dublură (contează doar dacă indexul unic ar lipsi):
// dacă pe slot există mai multe rezervări, rămâne doar cea cu _id-ul cel mai mic.
// Fără index mai verificăm o dată după o pauză scurtă, ca scrierea unui
// concurent dintr-un alt proces să fie sigur vizibilă și decizia să fie aceeași.
async function losesSlotRace(data, time, myId) {
  const check = async () => {
    const occ = await TaskModel.find({ data, time }).sort({ _id: 1 }).select({ _id: 1 }).lean();
    return occ.length > 1 && String(occ[0]._id) !== String(myId);
  };
  if (await check()) return true;
  if (!isSlotIndexActive()) {
    await pause(150);
    return check();
  }
  return false;
}

async function slotOverbooked(data, time) {
  const over = async () => (await TaskModel.countDocuments({ data, time })) > 1;
  if (await over()) return true;
  if (!isSlotIndexActive()) {
    await pause(150);
    return over();
  }
  return false;
}

const getTasks = async (req, res) => {
  try {
    const tasks = await TaskModel.find().lean();
    // Datele de disponibilitate trebuie să fie mereu proaspete — fără cache.
    res.set("Cache-Control", "no-store");
    res.status(200).json(tasks);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
};

// CREARE (site + panou admin folosesc același endpoint):
// validare strictă → lacăt pe slot → email pus în coadă → inserare atomică →
// plasă anti-dublură → recitire din DB → ABIA APOI trimitem emailul.
const saveTask = async (req, res) => {
  try {
    const source = sourceOf(req, "site");
    const { value: booking, error } = validateBooking(req.body || {});
    if (error) return res.status(400).json({ error });
    if (source !== "admin-panel" && isPastSlot(booking.data, booking.time)) {
      return res.status(400).json({ error: "This time slot is in the past" });
    }
    const { data, time } = booking;

    // Sub lacătul slotului rulează DOAR operațiile din DB (rapide). Emailul pleacă
    // după eliberarea lacătului: un Gmail lent nu mai ține pe loc alte cereri.
    const out = await withSlotLock(slotKey(booking), async () => {
      // Același slot scris în alt format (date vechi / modificate în afara aplicației,
      // ex. „23-11-2026" sau „16:00") → tot ocupat. Forma canonică e verificată atomic
      // chiar de inserarea de mai jos.
      if (await TaskModel.exists({ ...slotFilter(data, time), $nor: [{ data, time }] })) {
        return TAKEN;
      }

      // Emailul e pus în coadă ÎNAINTE de scriere: dacă serverul cade între
      // scriere și trimitere, worker-ul îl reia — dar numai după ce verifică DB-ul.
      const job = await createJob("confirmation", booking, { source });

      let result;
      try {
        // Inserare atomică: se scrie DOAR dacă slotul (data+ora) e liber.
        result = await TaskModel.findOneAndUpdate(
          { data, time },
          { $setOnInsert: booking },
          { upsert: true, new: true, includeResultMetadata: true, lean: true }
        );
      } catch (e) {
        if (e.code === 11000) {
          await skipJob(job, "slot already taken (E11000)");
          return TAKEN;
        }
        // Altă eroare: scrierea POATE să fi avut loc totuși (ex. conexiune pierdută
        // după scriere). Jobul rămâne în coadă — worker-ul verifică DB-ul și trimite
        // confirmarea doar dacă rezervarea chiar există.
        throw e;
      }

      const insertedId = result && result.lastErrorObject && result.lastErrorObject.upserted;
      if (!insertedId) {
        await skipJob(job, "slot already taken");
        const existing = result && result.value;
        // Reîncercarea ACELEIAȘI rezervări (răspuns pierdut, dublu-click): nu e o
        // dublură — confirmăm fără să mai scriem nimic și fără al doilea email.
        if (existing && sameClient(existing, booking)) {
          return {
            status: 200,
            body: {
              ...pickBooking(existing),
              _id: existing._id,
              alreadyBooked: true,
              emailSent: false,
              email: { sent: false, status: "skipped", reason: "already booked" },
            },
          };
        }
        return TAKEN;
      }

      // Plasă de siguranță (dacă indexul unic ar lipsi vreodată): o singură
      // rezervare rămâne pe slot, a doua inserare e anulată imediat.
      if (await losesSlotRace(data, time, insertedId)) {
        await TaskModel.deleteOne({ _id: insertedId });
        await skipJob(job, "rolled back: slot already taken");
        // Ștergere făcută de aplicație (anularea dublurii) → apare ca atare în audit.
        await logAudit("delete", { ...booking, _id: insertedId }, {
          source,
          note: "rolled back: duplicate insert on an occupied slot",
        });
        return TAKEN;
      }

      // Recitire din DB: rezervarea e chiar acolo, exact cu datele ei?
      const saved = await TaskModel.findById(insertedId).lean();
      if (!sameBooking(saved, booking)) {
        await skipJob(job, "read-back failed");
        await logAudit("create", { ...booking, _id: insertedId }, { source, note: "read-back failed" });
        return { status: 500, body: { error: "Booking could not be confirmed. Please try again." } };
      }

      await attachBooking(job, insertedId);
      // Auditul se scrie IMEDIAT după confirmarea din DB (înaintea emailului), ca
      // detectorul de modificări externe să recunoască mereu operațiile aplicației.
      const auditId = await logAudit("create", saved, { source, note: "email pending" });
      return { job, auditId, saved };
    });

    if (!out.job) return res.status(out.status).json(out.body);

    // Rezervare CONFIRMATĂ în DB → abia acum emailul de confirmare (care mai
    // verifică o dată DB-ul chiar înainte de trimitere).
    const { saved } = out;
    const r = await attemptWithin(out.job, EMAIL_WAIT_MS, (done) => finishAudit(out.auditId, done));

    return res.status(201).json({
      ...pickBooking(saved),
      _id: saved._id,
      emailSent: r.sent,
      email: emailInfo(r),
      googleCalendarUrl: buildGoogleCalendarUrl(saved),
      icsUrl: buildIcsUrl(saved),
    });
  } catch (error) {
    console.error("Save task error:", error.name, error.message, error.code || "");
    if (error.code === 11000) return res.status(409).json({ error: "Time slot already taken" });
    return res.status(500).json({ error: "Booking could not be saved. Please try again." });
  }
};

// EDITARE (panou admin): rezultatul final (valori curente + modificări) e validat
// complet, slotul țintă trebuie să fie liber, iar emailul pleacă doar după recitire.
const updateTask = async (req, res) => {
  const source = sourceOf(req, "admin-panel");
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const current = await TaskModel.findById(id).lean();
    if (!current) return res.status(404).json({ error: "Booking not found" });

    const merged = pickBooking(current);
    for (const f of Object.keys(merged)) {
      if (req.body && req.body[f] !== undefined) merged[f] = req.body[f];
    }
    const { value: next, error } = validateBooking(merged);
    if (error) return res.status(400).json({ error });

    const previous = { data: current.data, time: current.time, email: current.email };
    const changed = !sameBooking(next, current);
    // Rezervarea e dată ALTEI persoane (ex. „Update" apăsat pe rândul greșit, sau o
    // programare refolosită pentru altă clientă): clienta anterioară își pierde
    // programarea → primește ANULARE, iar noua clientă o CONFIRMARE (nu „modificare").
    const replaced = !isSamePersonAfterEdit(current, next);
    const replacedNote = replaced
      ? `client replaced: ${current.name} ${current.surname} <${current.email}> ${current.data} ${current.time}` +
        ` → ${next.name} ${next.surname} <${next.email}>`
      : "";

    const out = await withSlotLock(slotKey(next), async () => {
      // Slotul țintă trebuie să fie liber (exceptând chiar această rezervare), în
      // orice format ar fi fost scrisă o altă rezervare pe el.
      const conflict = await TaskModel.findOne({
        ...slotFilter(next.data, next.time),
        _id: { $ne: id },
      }).lean();
      if (conflict) return TAKEN;

      // Emailurile sunt puse în coadă ÎNAINTE de scriere (ca la creare).
      const jobs = replaced
        ? {
            cancel: await createJob("cancellation", pickBooking(current), { source, bookingId: id }),
            main: await createJob("confirmation", next, { source, bookingId: id }),
          }
        : {
            // Nimic schimbat → retrimitem confirmarea (așa se folosea „salvează din nou");
            // ceva schimbat → email clar de MODIFICARE (cu vechiul slot, dacă s-a mutat).
            main: await createJob(changed ? "modification" : "confirmation", next, {
              source,
              bookingId: id,
              previous,
            }),
          };
      const skipAll = (why) => Promise.all(Object.values(jobs).map((j) => skipJob(j, why)));

      let updated;
      try {
        updated = await TaskModel.findByIdAndUpdate(
          id,
          { $set: next },
          { new: true, runValidators: true }
        ).lean();
      } catch (e) {
        if (e.code === 11000) {
          await skipAll("slot already taken (E11000)");
          return TAKEN;
        }
        // Altă eroare: modificarea POATE să fi avut loc. Joburile rămân în coadă —
        // worker-ul trimite fiecare email doar dacă DB-ul arată starea corespunzătoare.
        throw e;
      }
      if (!updated) {
        await skipAll("booking disappeared");
        return { status: 404, body: { error: "Booking not found" } };
      }

      // Plasă de siguranță (doar fără indexul unic): dacă slotul a ajuns dublu ocupat,
      // anulăm editarea — dar numai dacă vechiul slot e încă liber (altfel revenirea
      // ar crea o dublură acolo; atunci păstrăm editarea și semnalăm în log).
      if (await slotOverbooked(next.data, next.time)) {
        const oldTaken = await TaskModel.exists({
          data: current.data,
          time: current.time,
          _id: { $ne: id },
        });
        if (!oldTaken) {
          await TaskModel.updateOne({ _id: id }, { $set: pickBooking(current) });
          await skipAll("rolled back: slot already taken");
          await logAudit("update", { ...next, _id: id }, { source, req, before: current, note: "rolled back: duplicate slot" });
          return TAKEN;
        }
        console.error(`⚠️ Slot ${next.data} ${next.time} overbooked and old slot taken — manual check needed`);
      }

      // Recitire din DB: modificarea e chiar acolo?
      const verified = await TaskModel.findById(id).lean();
      if (!sameBooking(verified, next)) {
        await skipAll("read-back failed");
        await logAudit("update", { ...next, _id: id }, { source, req, before: current, note: "read-back failed" });
        return { status: 500, body: { error: "Update could not be confirmed." } };
      }

      const auditId = await logAudit("update", verified, {
        source,
        req,
        before: current,
        note: replacedNote || "email pending",
      });
      return { jobs, auditId, verified };
    });

    if (!out.jobs) return res.status(out.status).json(out.body);

    // Lacătul e eliberat: emailurile (fiecare re-verificat în DB chiar înainte de trimitere).
    const [r, rc] = await Promise.all([
      attemptWithin(out.jobs.main, EMAIL_WAIT_MS, (done) => finishAudit(out.auditId, done, replacedNote)),
      out.jobs.cancel ? attemptWithin(out.jobs.cancel, EMAIL_WAIT_MS) : null,
    ]);
    return res.json({
      ...out.verified,
      emailSent: r.sent,
      email: emailInfo(r),
      ...(rc ? { replacedClient: { ...pickBooking(current), cancellation: emailInfo(rc) } } : {}),
    });
  } catch (error) {
    console.error("Update error:", error.message);
    if (error.code === 11000) return res.status(409).json({ error: "Time slot already taken" });
    return res.status(500).json({ error: "Failed to update task" });
  }
};

// ȘTERGERE/ANULARE (panou admin): anularea e pusă în coadă înainte de ștergere,
// iar emailul pleacă doar după ce DB-ul confirmă că rezervarea chiar nu mai există.
const deleteTask = async (req, res) => {
  const source = sourceOf(req, "unknown");
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const current = await TaskModel.findById(id).lean();
    if (!current) return res.status(404).json({ error: "Booking not found" });

    const job = await createJob("cancellation", pickBooking(current), { source, bookingId: id });

    const deleted = await TaskModel.findByIdAndDelete(id).lean();
    if (!deleted) {
      await skipJob(job, "already deleted");
      return res.status(404).json({ error: "Booking not found" });
    }
    if (await TaskModel.exists({ _id: id })) {
      await skipJob(job, "delete not confirmed");
      await logAudit("delete", deleted, { source, req, note: "delete not confirmed" });
      return res.status(500).json({ error: "Delete could not be confirmed." });
    }
    // Dacă rezervarea s-a schimbat între citire și ștergere (ex. o editare chiar în
    // acel moment), anularea descrie starea REALĂ ștearsă (dată, oră, .ics corect).
    if (!sameBooking(deleted, current)) await updatePayload(job, pickBooking(deleted));

    const auditId = await logAudit("delete", deleted, { source, req, note: "email pending" });
    const r = await attemptWithin(job, EMAIL_WAIT_MS, (done) => finishAudit(auditId, done));
    return res.json({
      message: "Payment deleted successfully",
      deletedPayment: deleted,
      notified: r.sent,
      email: emailInfo(r),
    });
  } catch (error) {
    console.error("Delete error:", error.message);
    return res.status(500).json({ error: "Failed to delete task" });
  }
};

const checkNextDayRecord = async () => {
  try {
    const tasks = await TaskModel.find();
    const currentDate = moment().tz("Europe/Paris");
    const nextDay = currentDate.clone().add(1, "day");
    const nextDayStr = nextDay.format("DD-MM-YYYY");

    const records = tasks.filter((task) => {
      // Excepție: emailul administratorului NU primește reminder.
      if (String(task.email).trim().toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        return false;
      }
      const taskDate = task.data;
      // Suportă atât formatul dd-MM-yyyy cât și yyyy-MM-dd
      if (/^\d{2}-\d{2}-\d{4}$/.test(taskDate)) {
        return taskDate === nextDayStr;
      }
      return taskDate === nextDay.format("YYYY-MM-DD");
    });

    if (records.length > 0) {
      records.forEach((record) => {
        sendBookingReminder(record)
          .then(() => console.log("Reminder sent to:", record.email))
          .catch((err) => console.error("Reminder email failed for", record.email, err));
      });
    } else {
      console.log(`No appointments found for ${nextDayStr}`);
    }
  } catch (error) {
    console.error("Failed to fetch tasks for reminders:", error);
  }
};

module.exports = {
  getTasks,
  saveTask,
  deleteTask,
  updateTask,
  checkNextDayRecord,
};
