const moment = require("moment-timezone");

const TZ = "Europe/Brussels";
const LOCATION = "Avenue Charles-Quint 420, 1082 Berchem-Sainte-Agathe, Bruxelles";
const CLINIC_PHONE = "02 354 57 98";

// Normalizează data la yyyy-MM-dd (acceptă și dd-MM-yyyy)
function normDate(d) {
  if (!d) return d;
  const s = String(d).trim();
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

// "12h00" -> { hour: 12, minute: 0 }
function parseTime(time) {
  const [h, m] = String(time || "").split("h");
  return { hour: parseInt(h, 10) || 0, minute: parseInt(m, 10) || 0 };
}

// Momentul de start al programării, în fusul orar Bruxelles
function startMoment(data, time) {
  const dateStr = normDate(data);
  const { hour, minute } = parseTime(time);
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return moment.tz(`${dateStr} ${hh}:${mm}`, "YYYY-MM-DD HH:mm", TZ);
}

// Format UTC pentru iCalendar / Google: 20260613T100000Z
function utcStamp(m) {
  return m.clone().utc().format("YYYYMMDDTHHmmss") + "Z";
}

// Escape conform RFC 5545 pentru valorile text din .ics
function escapeIcs(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Construiește conținutul fișierului .ics (iCalendar) pentru o programare.
// FĂRĂ durată fixă: punem doar ora de început (fără DTEND), fiindcă serviciile au
// durate diferite și nu vrem să inducem clientul în eroare.
// Include o notificare cu 2 zile înainte de programare.
function buildIcs(booking) {
  const { data, time, service, name, surname, email } = booking;
  const start = startMoment(data, time);
  if (!start.isValid()) return null;

  const uid =
    `${normDate(data)}-${String(time)}-${String(email || "").replace(/[^a-zA-Z0-9]/g, "")}` +
    "@esthetiquebasilix.be";
  const summary = `Rendez-vous Esthétique Basilix — ${service}`;
  const description =
    `Bonjour ${name || ""} ${surname || ""}. Votre rendez-vous : ${service}. ` +
    `Heure : ${time}. La durée varie selon le service. Tél : ${CLINIC_PHONE}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Esthetique Basilix//Booking//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(moment())}`,
    `DTSTART:${utcStamp(start)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `LOCATION:${escapeIcs(LOCATION)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-P2D",
    "ACTION:DISPLAY",
    "DESCRIPTION:Rappel — Rendez-vous Esthétique Basilix dans 2 jours",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}

// Construiește un link „Ajouter à Google Agenda" pre-completat.
function buildGoogleCalendarUrl(booking) {
  const { data, time, service } = booking;
  const start = startMoment(data, time);
  if (!start.isValid()) return null;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Rendez-vous Esthétique Basilix — ${service}`,
    // fără durată impusă: început = sfârșit (doar ora programării)
    dates: `${utcStamp(start)}/${utcStamp(start)}`,
    details: `Service : ${service}\nHeure : ${time}. La durée varie selon le service.\nTél : ${CLINIC_PHONE}`,
    location: LOCATION,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

module.exports = { buildIcs, buildGoogleCalendarUrl };
