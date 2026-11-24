const TaskModel = require("../Models/TaskModels");
const BookingAudit = require("../Models/BookingAuditModel");
const BookingSnapshot = require("../Models/BookingSnapshotModel");
const EmailOutbox = require("../Models/EmailOutboxModel");
const { sendClinicAlerts } = require("./emailService");
const { pickBooking, hasStarted, isKnownSlot } = require("./bookingRules");

// Detector de modificări făcute ÎN AFARA aplicației (direct în MongoDB, sau prin
// apeluri API străine care nu lasă urmă). La fiecare scanare compară rezervările cu
// ultima stare salvată și cu istoricul de audit al aplicației. Ce nu are o operație
// corespunzătoare în audit e înregistrat și, dacă programarea e încă în viitor,
// clinica primește un email de alertă cu toate datele clientei.
const INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS) || 5 * 60 * 1000;
// Pauză înainte de verdict, ca o operație a aplicației aflată în curs să-și scrie auditul.
const RECHECK_MS = Number(process.env.WATCH_RECHECK_MS) || 20 * 1000;
// Toleranță pentru ceasuri ușor diferite între două instanțe (deploy pe Render).
const CLOCK_SKEW_MS = 5000;
// Alerta către clinică e reîncercată la fiecare scanare dacă Gmail pică (max ~1 oră),
// iar o trimitere rămasă neterminată (proces oprit) e reluată după 10 minute.
const MAX_ALERT_ATTEMPTS = 12;
const CLAIM_STALE_MS = 10 * 60 * 1000;

const FIELDS = ["data", "time", "name", "surname", "email", "tel", "service"];
const sameFields = (a, b) => FIELDS.every((f) => String(a[f] ?? "") === String(b[f] ?? ""));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// seenAt = momentul CITIRII stării (nu al scrierii în snapshot): orice operație a
// aplicației făcută după citire are în audit un moment ulterior lui seenAt.
const snapshotOf = (b, seenAt) => ({ ...pickBooking(b), seenAt });

// A trecut operația prin aplicație? Dovada: rândul de audit corespunzător — sau,
// dacă operația a fost întreruptă înainte de audit (eroare DB, server oprit),
// jobul de email pe care aplicația îl creează ÎNAINTEA fiecărei operații: pentru
// creare/editare, cu EXACT starea găsită acum în DB; pentru ștergere, cu id-ul ei.
async function viaApp(action, b, since) {
  const after = since ? new Date(new Date(since).getTime() - CLOCK_SKEW_MS) : null;
  const q = { action, bookingId: b._id };
  if (after) q.at = { $gte: after };
  if (await BookingAudit.exists(q)) return true;

  const jq = {
    createdAt: { $gte: after || new Date(Date.now() - 2 * INTERVAL_MS - RECHECK_MS - 60 * 1000) },
  };
  if (action === "delete") {
    Object.assign(jq, { kind: "cancellation", bookingId: b._id });
  } else {
    if (FIELDS.some((f) => b[f] == null)) return false;
    for (const f of FIELDS) jq[`payload.${f}`] = b[f];
    if (action === "update") Object.assign(jq, { kind: { $in: ["modification", "confirmation"] }, bookingId: b._id });
    else jq.kind = "confirmation";
  }
  return !!(await EmailOutbox.exists(jq));
}

// Merită alertă? Programarea (înainte SAU după modificare) e încă în viitor — sau
// data/ora nu pot fi interpretate (scrise greșit în afara aplicației): mai bine o
// alertă în plus decât una lipsă.
const needsAlert = (b, before) =>
  [b, before].some((x) => x && (!isKnownSlot(x.data, x.time) || !hasStarted(x.data, x.time)));

// Înregistrează O SINGURĂ DATĂ o modificare externă (și când două instanțe scanează
// simultan, în timpul unui deploy). Emailul către clinică e trimis de flushAlerts().
async function record(kind, booking, before) {
  const dup = { action: kind, bookingId: booking._id };
  if (kind === "external-update") {
    // Aceeași modificare = aceeași stare nouă, față de aceeași stare veche.
    for (const f of FIELDS) if (booking[f] != null) dup[f] = booking[f];
    if (before && before.seenAt) dup.at = { $gte: before.seenAt };
  }
  if (await BookingAudit.exists(dup)) return;

  const upcoming = needsAlert(booking, before);
  await BookingAudit.create({
    action: kind,
    bookingId: booking._id,
    ...pickBooking(booking),
    source: "outside-app",
    emailSent: false,
    alertPending: upcoming, // doar programările viitoare declanșează email
    alertAttempts: 0,
    before: before ? pickBooking(before) : undefined,
    note: before ? `before: ${before.data} ${before.time} ${before.name} ${before.surname}` : "",
  });
  console.error(
    `[watcher] ⚠ ${kind}${upcoming ? "" : " (past appointment)"}: ${booking.data} ${booking.time} ` +
      `${booking.name} ${booking.surname} <${booking.email}>`
  );
}

let baselined = false;
async function detectChanges() {
  const loadedAt = new Date(); // ÎNAINTE de citire (vezi snapshotOf)
  const [current, snap] = await Promise.all([
    TaskModel.find().lean(),
    BookingSnapshot.find().lean(),
  ]);

  // Prima rulare (fără stare salvată): doar salvăm starea de referință, fără alerte.
  // După aceea comparăm mereu — chiar dacă nu există încă nicio rezervare.
  if (!baselined && snap.length === 0) {
    // Dacă salvarea eșuează, NU marcăm referința ca făcută: altfel scanarea următoare
    // ar raporta toate rezervările existente ca „adăugate în afara aplicației".
    if (current.length) {
      await BookingSnapshot.insertMany(
        current.map((b) => ({ _id: b._id, ...snapshotOf(b, loadedAt) })),
        { ordered: false }
      );
    }
    baselined = true;
    return;
  }
  baselined = true;

  const curById = new Map(current.map((b) => [String(b._id), b]));
  const snapById = new Map(snap.map((s) => [String(s._id), s]));
  const removed = snap.filter((s) => !curById.has(String(s._id)));
  const added = current.filter((b) => !snapById.has(String(b._id)));
  const changed = current.filter((b) => {
    const s = snapById.get(String(b._id));
    return s && !sameFields(s, b);
  });
  if (!removed.length && !added.length && !changed.length) return;

  await pause(RECHECK_MS);

  for (const s of removed) {
    if (await TaskModel.exists({ _id: s._id })) continue; // a reapărut: decide scanarea următoare
    if (!(await viaApp("delete", s))) await record("external-delete", s);
    await BookingSnapshot.deleteOne({ _id: s._id });
  }
  for (const b of added) {
    // Inserare anulată între timp (ex. dublură respinsă de aplicație) → nimic de semnalat.
    if (!(await TaskModel.exists({ _id: b._id }))) continue;
    if (!(await viaApp("create", b))) await record("external-create", b);
    await BookingSnapshot.updateOne({ _id: b._id }, { $set: snapshotOf(b, loadedAt) }, { upsert: true });
  }
  for (const b of changed) {
    const s = snapById.get(String(b._id));
    if (!(await viaApp("update", b, s.seenAt))) await record("external-update", b, s);
    await BookingSnapshot.updateOne({ _id: b._id }, { $set: snapshotOf(b, loadedAt) });
  }
}

// Trimite clinicii alertele în așteptare: UN SINGUR email per scanare (rezumat dacă
// sunt mai multe — fără avalanșă care ar putea epuiza limita zilnică Gmail și bloca
// confirmările clientelor). Dacă Gmail pică, alertele rămân în așteptare și sunt
// retrimise la scanarea următoare.
async function flushAlerts() {
  const pending = await BookingAudit.find({ alertPending: true }).sort({ at: 1 }).limit(100).lean();
  if (!pending.length) return;

  const claimed = [];
  for (const row of pending) {
    // Programarea (și cea de dinainte de modificare) a început între timp → alerta nu mai e utilă.
    if (!needsAlert(row, row.before && row.before.data ? row.before : null)) {
      await BookingAudit.updateOne(
        { _id: row._id, alertPending: true },
        { $set: { alertPending: false }, $unset: { alertClaimedAt: 1 } }
      );
      continue;
    }
    // Revendicare atomică: în timpul unui deploy pot rula două instanțe.
    const c = await BookingAudit.findOneAndUpdate(
      {
        _id: row._id,
        alertPending: true,
        $or: [
          { alertClaimedAt: null },
          { alertClaimedAt: { $lt: new Date(Date.now() - CLAIM_STALE_MS) } },
        ],
      },
      { $set: { alertClaimedAt: new Date() }, $inc: { alertAttempts: 1 } },
      { new: true }
    ).lean();
    if (c) claimed.push(c);
  }
  if (!claimed.length) return;

  const ids = claimed.map((r) => r._id);
  try {
    await sendClinicAlerts(claimed);
  } catch (e) {
    console.error(`[watcher] clinic alert failed (${claimed.length}), retry at next scan:`, e.message);
    await BookingAudit.updateMany({ _id: { $in: ids } }, { $unset: { alertClaimedAt: 1 } });
    const giveUp = claimed.filter((r) => (r.alertAttempts || 0) >= MAX_ALERT_ATTEMPTS).map((r) => r._id);
    if (giveUp.length) {
      await BookingAudit.updateMany({ _id: { $in: giveUp } }, { $set: { alertPending: false } });
      console.error(`[watcher] clinic alert given up after ${MAX_ALERT_ATTEMPTS} attempts (${giveUp.length})`);
    }
    return;
  }
  await BookingAudit.updateMany(
    { _id: { $in: ids } },
    { $set: { alertPending: false, emailSent: true }, $unset: { alertClaimedAt: 1 } }
  );
}

let running = false;
async function scanBookingsOnce() {
  if (running) return;
  running = true;
  try {
    try {
      await detectChanges();
    } catch (e) {
      console.error("[watcher] scan error:", e.message);
    }
    try {
      await flushAlerts();
    } catch (e) {
      console.error("[watcher] alert flush error:", e.message);
    }
  } finally {
    running = false;
  }
}

function startBookingWatcher() {
  setInterval(scanBookingsOnce, INTERVAL_MS);
  setTimeout(scanBookingsOnce, 30 * 1000); // la pornire: reia comparația
  console.log(`[watcher] external-change detector started (every ${INTERVAL_MS / 1000}s)`);
}

module.exports = { scanBookingsOnce, flushAlerts, startBookingWatcher };
