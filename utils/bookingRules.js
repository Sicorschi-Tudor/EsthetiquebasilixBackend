const moment = require("moment-timezone");

const TZ = "Europe/Brussels";

// Singurele sloturi orare valide: O SINGURĂ rezervare pe oră. Orice altă valoare
// e respinsă, ca indexul unic {data,time} să compare mereu exact același format
// (altfel „16:00" și „16h00" ar fi văzute ca sloturi diferite → dublă rezervare).
const ALLOWED_TIMES = [
  "10h00", "11h00", "12h00", "13h00", "14h00", "15h00", "16h00", "17h00", "18h00",
];

const FIELD_LIMITS = { name: 200, surname: 200, service: 200, tel: 50, email: 254 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOOKING_FIELDS = ["data", "time", "name", "surname", "email", "tel", "service"];

// Data canonică yyyy-MM-dd. Acceptă doar yyyy-MM-dd sau dd-MM-yyyy (formatele
// trimise de site și de panou) și verifică că e o zi reală din calendar.
function canonicalDate(input) {
  if (input == null) return null;
  const s = String(input).trim();
  let y, mo, d, m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else if ((m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s))) {
    [d, mo, y] = [+m[1], +m[2], +m[3]];
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null; // ex. 31-02-2026
  }
  if (y < 2020 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Ora canonică „HHh00". Variante ca „16h00", „16h", „16:00", „16" devin toate
// „16h00"; orice nu e un slot orar permis (ex. „16h30", „9h00") e respins.
function canonicalTime(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?:[h:.](\d{2})?)?$/.exec(s);
  if (!m) return null;
  if (m[2] && +m[2] !== 0) return null;
  const canon = `${String(+m[1]).padStart(2, "0")}h00`;
  return ALLOWED_TIMES.includes(canon) ? canon : null;
}

const clean = (v) => (v == null ? "" : String(v).trim());
// Doar text sau număr: obiecte/liste (ex. {"$gt": ""} sau ["a","b"]) sunt respinse,
// nu transformate în text.
const isScalar = (v) => v == null || typeof v === "string" || typeof v === "number";

// Validează și curăță o rezervare COMPLETĂ. Întoarce { value } sau { error }.
function validateBooking(body) {
  for (const f of BOOKING_FIELDS) {
    if (!isScalar(body[f])) return { error: `Invalid field: ${f}` };
  }
  const data = canonicalDate(body.data);
  if (!data) return { error: "Invalid date" };
  const time = canonicalTime(body.time);
  if (!time) return { error: "Invalid time slot" };
  const value = { data, time };
  for (const f of ["name", "surname", "service", "tel", "email"]) {
    const v = clean(body[f]);
    if (!v) return { error: `Missing field: ${f}` };
    if (v.length > FIELD_LIMITS[f]) return { error: `Field too long: ${f}` };
    value[f] = v;
  }
  if (!EMAIL_RE.test(value.email)) return { error: "Invalid email" };
  return { value };
}

// Toate formele sub care ACELAȘI slot ar putea exista în DB dacă a fost scris de o
// versiune veche sau în afara aplicației (ex. „23-11-2026", „16:00"). Aplicația scrie
// doar forma canonică, dar verificarea „slot ocupat" trebuie să le vadă pe toate.
// Primește data + ora deja canonice (yyyy-MM-dd, HHh00).
function slotFilter(data, time) {
  const [y, m, d] = String(data).split("-");
  const hh = String(time).slice(0, 2);
  const h = String(Number(hh));
  const times = new Set([hh, h].flatMap((x) => [`${x}h00`, `${x}H00`, `${x}:00`, `${x}h`, `${x}H`, x]));
  return { data: { $in: [data, `${d}-${m}-${y}`] }, time: { $in: [...times] } };
}

const pickBooking = (doc) =>
  BOOKING_FIELDS.reduce((o, f) => {
    o[f] = doc ? doc[f] : undefined;
    return o;
  }, {});

const sameText = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

// Aceeași clientă + același serviciu. Folosit (1) ca o reîncercare a ACELEIAȘI
// rezervări să nu fie tratată ca dublură și (2) ca înainte de orice email să
// verificăm că rezervarea din DB este chiar a persoanei căreia îi scriem.
function sameClient(a, b) {
  return ["email", "name", "surname", "service", "tel"].every((f) => sameText(a && a[f], b && b[f]));
}

const sameBooking = (a, b) =>
  !!a && !!b && a.data === b.data && a.time === b.time && sameClient(a, b);

// Emailul comun al salonului (rezervări telefonice): nu identifică o persoană.
const SHARED_EMAILS = ["voicugeorgiana88@gmail.com"];
const isShared = (e) => SHARED_EMAILS.includes(clean(e).toLowerCase());

// Cuvintele din nume + prenume, fără diacritice, majuscule și semne: „Varriale Celia"
// = „Celia Varriale"; „,," / „.." sunt ignorate.
function nameTokens(b) {
  const t = `${(b && b.name) || ""} ${(b && b.surname) || ""}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return new Set(t.split(/[^a-z]+/).filter((x) => x.length >= 2));
}

// După o editare, rezervarea aparține ACELEIAȘI persoane? Da, dacă: același email
// propriu (ex. nume corectat), același nume (ex. email corectat), sau o rezervare
// telefonică (emailul salonului) completată cu datele aceleiași cliente (numele vechi
// se regăsește în cel nou). Altfel rezervarea a fost dată ALTEI persoane — iar
// clienta anterioară și-a pierdut programarea.
function isSamePersonAfterEdit(before, after) {
  const eb = clean(before && before.email).toLowerCase();
  const ea = clean(after && after.email).toLowerCase();
  if (eb && eb === ea && !isShared(eb)) return true;
  const tb = nameTokens(before);
  const ta = nameTokens(after);
  if (!tb.size || !ta.size) return false;
  if (tb.size === ta.size && [...tb].every((t) => ta.has(t))) return true;
  return isShared(eb) && [...tb].every((t) => ta.has(t));
}

// Momentul de început al programării, în fusul orar Bruxelles. Acceptă și formatele
// vechi / scrise în afara aplicației (ex. „23-11-2026", „16:00"); ce nu se poate
// interpreta exact dă un moment invalid (parsare strictă, fără ghicit).
function slotMoment(data, time) {
  const d = canonicalDate(data) || clean(data);
  const t = canonicalTime(time) || clean(time);
  const h = parseInt(t, 10);
  return moment.tz(`${d} ${String(h).padStart(2, "0")}:00`, "YYYY-MM-DD HH:mm", true, TZ);
}

// Ca pe site: o zi trecută e „Passé"; în ziua curentă, ora curentă și cele
// anterioare sunt deja „Passé" (la 15:30, 15h00 e trecut, 16h00 e liber).
function isPastSlot(data, time, now = moment().tz(TZ)) {
  const start = slotMoment(data, time);
  if (!start.isValid()) return true;
  if (start.clone().startOf("day").isBefore(now.clone().startOf("day"))) return true;
  if (start.isSame(now, "day")) return start.hour() <= now.hour();
  return false;
}

// Data + ora pot fi interpretate exact? (o rezervare scrisă greșit în afara aplicației: nu)
const isKnownSlot = (data, time) => slotMoment(data, time).isValid();

// Programarea a început deja? (nu mai trimitem confirmări/anulări pentru ea)
function hasStarted(data, time, now = moment().tz(TZ)) {
  const start = slotMoment(data, time);
  return !start.isValid() || !start.isAfter(now);
}

// Starea indexului unic {data,time}, setată la pornire și reverificată periodic.
// Dacă lipsește, controller-ele fac o a doua verificare anti-dublură după o pauză.
let slotIndexActive = true;
const setSlotIndexActive = (v) => {
  slotIndexActive = !!v;
};
const isSlotIndexActive = () => slotIndexActive;

// Lacăt în memorie per slot: cererile pentru ACELAȘI slot rulează una după alta
// în acest proces. Strat suplimentar peste indexul unic din MongoDB.
const slotLocks = new Map();
async function withSlotLock(key, fn) {
  const previous = slotLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => (release = resolve));
  const tail = previous.then(() => current);
  slotLocks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (slotLocks.get(key) === tail) slotLocks.delete(key);
  }
}

module.exports = {
  TZ,
  ALLOWED_TIMES,
  BOOKING_FIELDS,
  canonicalDate,
  canonicalTime,
  validateBooking,
  slotFilter,
  pickBooking,
  sameClient,
  sameBooking,
  isShared,
  isSamePersonAfterEdit,
  isPastSlot,
  hasStarted,
  isKnownSlot,
  withSlotLock,
  setSlotIndexActive,
  isSlotIndexActive,
};
