const TaskModel = require("../Models/TaskModels");
const EmailOutbox = require("../Models/EmailOutboxModel");
const {
  sendBookingConfirmation,
  sendBookingModification,
  sendBookingCancellation,
} = require("./emailService");
const { sameBooking, sameClient, hasStarted, isSamePersonAfterEdit } = require("./bookingRules");

// Pauze între reîncercări (apoi o dată pe oră). Se reîncearcă până la începutul
// programării (după aceea emailul nu mai are rost), dar cel mult 7 zile: o pană
// Gmail mai lungă (ex. blocare de 24 h) nu mai face să se piardă emailuri.
const BACKOFF_MINUTES = [1, 2, 5, 10, 20, 30, 60];
const MAX_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
// Worker-ul preia doar joburi mai vechi de atât, ca să nu concureze cu trimiterea
// imediată din cererea HTTP aflată încă în desfășurare.
const MIN_AGE_MS = Number(process.env.OUTBOX_MIN_AGE_MS) || 2 * 60 * 1000;
const INTERVAL_MS = Number(process.env.OUTBOX_INTERVAL_MS) || 60 * 1000;
const STUCK_MS = Number(process.env.OUTBOX_STUCK_MS) || 10 * 60 * 1000;

function createJob(kind, payload, { bookingId, previous, source } = {}) {
  return EmailOutbox.create({
    kind,
    payload,
    bookingId,
    previous,
    source,
    status: "pending",
    nextAttemptAt: new Date(),
  });
}

const setJob = (jobId, fields) => EmailOutbox.updateOne({ _id: jobId }, { $set: fields });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Operația din DB NU a avut loc (slot ocupat, eroare, rollback) → emailul nu pleacă.
// Nefatal: dacă nici marcarea nu reușește, worker-ul reverifică oricum DB-ul
// înainte de orice trimitere (și nu găsește rezervarea → nu trimite).
async function skipJob(job, reason) {
  if (!job) return;
  try {
    await setJob(job._id, { status: "skipped", lastError: reason });
  } catch (e) {
    console.error("[outbox] could not mark job as skipped:", e.message);
  }
}

// Nefatal: fără bookingId, worker-ul găsește rezervarea după dată + oră + clientă.
async function attachBooking(job, bookingId) {
  if (!job) return;
  try {
    await setJob(job._id, { bookingId });
  } catch (e) {
    console.error("[outbox] could not attach booking to job:", e.message);
  }
}

// Emailul trebuie să descrie starea REALĂ din DB în momentul operației (ex. o
// anulare imediat după o editare concurentă).
async function updatePayload(job, payload) {
  if (!job) return;
  try {
    await setJob(job._id, { payload });
  } catch (e) {
    console.error("[outbox] could not update job payload:", e.message);
  }
}

// Emailul mai are rost? Da, cât timp programarea nu a început. Excepție: o programare
// viitoare mutată (ex. corectură spre o dată trecută) — clienta trebuie totuși anunțată
// că vechea programare din agenda ei nu mai e valabilă.
function stillRelevant(job) {
  const p = job.payload || {};
  if (!hasStarted(p.data, p.time)) return true;
  const prev = job.previous;
  return job.kind === "modification" && !!(prev && prev.data) && !hasStarted(prev.data, prev.time);
}

const ACTIVE = ["sent", "sending"];

// Verifică în DB, CHIAR înainte de trimitere, că emailul corespunde stării reale.
// Întoarce null dacă e valid, altfel motivul pentru care nu trebuie trimis.
async function invalidReason(job) {
  const p = job.payload || {};
  if (!stillRelevant(job)) return "appointment already started";

  if (job.kind === "confirmation" || job.kind === "modification") {
    const booking = job.bookingId
      ? await TaskModel.findById(job.bookingId).lean()
      : await TaskModel.findOne({ data: p.data, time: p.time }).lean();
    if (!booking) return "booking not found in DB";
    if (!sameBooking(booking, p)) return "booking in DB differs from email";
    // Job de creare rămas fără bookingId (server oprit / eroare între scriere și
    // atașare): dacă rezervarea și-a primit deja confirmarea printr-o reîncercare
    // a clientei, nu o mai trimitem încă o dată.
    if (
      !job.bookingId &&
      (await EmailOutbox.exists({
        _id: { $ne: job._id },
        kind: "confirmation",
        bookingId: booking._id,
        status: { $in: ACTIVE },
      }))
    ) {
      return "confirmation already sent by another job";
    }
    return null;
  }

  if (job.kind === "cancellation") {
    // Rezervarea există încă și e tot a ACESTEI cliente → nu e anulată (ex. ștergerea
    // n-a reușit). Dacă înregistrarea a fost dată altei persoane, clienta anterioară
    // chiar și-a pierdut programarea → anularea pleacă.
    const rec = job.bookingId ? await TaskModel.findById(job.bookingId).lean() : null;
    if (rec && isSamePersonAfterEdit(p, rec)) return "booking still exists in DB";
    // Aceeași clientă s-a reprogramat pe același slot → anularea ar induce în eroare.
    const again = await TaskModel.findOne({ data: p.data, time: p.time }).lean();
    if (again && sameClient(again, p)) return "client re-booked the same slot";
    // Aceeași programare a aceleiași cliente se anulează o singură dată (ex. ștergere
    // reîncercată după o eroare). Aceeași înregistrare poate fi anulată pentru alte
    // cliente (dacă a fost refolosită), deci comparăm și clienta, și slotul.
    if (
      job.bookingId &&
      (await EmailOutbox.exists({
        _id: { $ne: job._id },
        kind: "cancellation",
        bookingId: job.bookingId,
        "payload.data": p.data,
        "payload.time": p.time,
        "payload.email": p.email,
        status: { $in: ACTIVE },
      }))
    ) {
      return "cancellation already sent";
    }
    return null;
  }

  return "unknown email kind";
}

const SENDERS = {
  confirmation: (job) => sendBookingConfirmation(job.payload),
  modification: (job) => sendBookingModification(job.payload, job.previous),
  cancellation: (job) => sendBookingCancellation(job.payload),
};

async function scheduleRetry(job, errMsg) {
  const attempts = (job.attempts || 0) + 1;
  const age = Date.now() - new Date(job.createdAt || Date.now()).getTime();
  if (age > MAX_RETRY_MS || !stillRelevant(job)) {
    await setJob(job._id, { status: "failed", attempts, lastError: errMsg });
    console.error(
      `[outbox] FAILED permanently (${job.kind}) for ${job.payload && job.payload.email}: ${errMsg}`
    );
    return { sent: false, status: "failed", reason: errMsg };
  }
  const delayMin = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1];
  await setJob(job._id, {
    status: "pending",
    attempts,
    lastError: errMsg,
    nextAttemptAt: new Date(Date.now() + delayMin * 60 * 1000),
  });
  console.error(
    `[outbox] send failed (${job.kind}), attempt ${attempts}, retry in ${delayMin} min: ${errMsg}`
  );
  return { sent: false, status: "pending", reason: errMsg };
}

// Trimiteri în curs (la oprirea serverului le lăsăm să se termine).
let active = 0;
const activeSends = () => active;

// Procesează un job deja revendicat (status "sending"): verifică DB → trimite.
async function processClaimed(job) {
  active++;
  try {
    return await processClaimedInner(job);
  } finally {
    active--;
  }
}

async function processClaimedInner(job) {
  let reason;
  try {
    reason = await invalidReason(job);
  } catch (e) {
    // Nu putem verifica DB-ul → NU trimitem „orbește"; reîncercăm mai târziu.
    return scheduleRetry(job, "verification failed: " + e.message);
  }
  if (reason) {
    await setJob(job._id, { status: "skipped", lastError: reason });
    return { sent: false, status: "skipped", reason };
  }
  try {
    await SENDERS[job.kind](job);
  } catch (e) {
    return scheduleRetry(job, e.message);
  }
  // Emailul A PLECAT. O problemă la marcare nu e un eșec de trimitere (altfel s-ar
  // reprograma o retrimitere): mai încercăm o dată, apoi doar logăm.
  const sentFields = {
    status: "sent",
    sentAt: new Date(),
    attempts: (job.attempts || 0) + 1,
    lastError: "",
  };
  try {
    await setJob(job._id, sentFields);
  } catch (e) {
    await pause(1000);
    await setJob(job._id, sentFields).catch((e2) =>
      console.error(`[outbox] email sent but not marked as sent (${job.kind}):`, e2.message)
    );
  }
  return { sent: true, status: "sent" };
}

// Revendicare atomică (pending → sending): un job e trimis de UN SINGUR proces.
const claim = (jobId) =>
  EmailOutbox.findOneAndUpdate(
    { _id: jobId, status: "pending" },
    { $set: { status: "sending" } },
    { new: true }
  ).lean();

// Trimitere imediată, în cererea curentă, DUPĂ ce operația din DB a fost verificată.
// Nu aruncă niciodată (orice problemă → jobul rămâne în coadă pentru worker).
async function attemptNow(job) {
  try {
    const claimed = await claim(job._id);
    if (!claimed) return { sent: false, status: "pending", reason: "job not claimable" };
    return await processClaimed(claimed);
  } catch (e) {
    console.error("[outbox] attemptNow error:", e.message);
    return { sent: false, status: "pending", reason: e.message };
  }
}

// Răspunsul HTTP nu așteaptă un Gmail lent mai mult de `waitMs`: trimiterea continuă
// în fundal (iar dacă eșuează, e reluată din coadă). `onDone` primește rezultatul real.
function attemptWithin(job, waitMs, onDone) {
  const sending = attemptNow(job).then(async (r) => {
    if (onDone) {
      try {
        await onDone(r);
      } catch (e) {
        console.error("[outbox] onDone error:", e.message);
      }
    }
    return r;
  });
  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ sent: false, status: "pending", reason: "still sending" }),
      waitMs
    );
  });
  sending.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer)
  );
  return Promise.race([sending, slow]);
}

let running = false;
async function runOutboxOnce() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    // Joburi rămase în "sending" (ex. server repornit în timpul trimiterii) → reluate.
    await EmailOutbox.updateMany(
      { status: "sending", updatedAt: { $lt: new Date(now - STUCK_MS) } },
      { $set: { status: "pending" }, $inc: { attempts: 1 } }
    );
    const due = await EmailOutbox.find({
      status: "pending",
      createdAt: { $lt: new Date(now - MIN_AGE_MS) },
      nextAttemptAt: { $lte: new Date(now) },
    })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();
    for (const j of due) {
      const claimed = await claim(j._id);
      if (claimed) await processClaimed(claimed);
    }
  } catch (e) {
    console.error("[outbox] worker error:", e.message);
  } finally {
    running = false;
  }
}

function startOutboxWorker() {
  setInterval(runOutboxOnce, INTERVAL_MS);
  setTimeout(runOutboxOnce, 5000); // la pornire: preia ce a rămas în coadă
  console.log(`[outbox] worker started (every ${INTERVAL_MS / 1000}s)`);
}

module.exports = {
  createJob,
  skipJob,
  attachBooking,
  updatePayload,
  attemptNow,
  attemptWithin,
  activeSends,
  runOutboxOnce,
  startOutboxWorker,
};
