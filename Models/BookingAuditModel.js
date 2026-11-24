const mongoose = require("mongoose");

// Istoric (audit) al TUTUROR operațiilor pe rezervări: creare / editare / ștergere.
// Scop: să putem investiga orice „a dispărut / s-a dublat / nu a venit emailul".
// Pentru fiecare operație reținem ce s-a întâmplat, de unde (site/admin) și dacă
// emailul aferent a plecat cu adevărat. Colecție separată, nu afectează datele reale.
const bookingAuditSchema = new mongoose.Schema(
  {
    action: String, // "create" | "update" | "delete"
    bookingId: mongoose.Schema.Types.ObjectId,
    data: String,
    time: String,
    name: String,
    surname: String,
    email: String,
    tel: String,
    service: String,
    source: String, // "site" | "admin-panel" | "unknown"
    emailSent: Boolean, // a plecat emailul (confirmare/anulare) cu adevărat?
    note: String, // ex. "read-back failed", "slot taken"
    // Doar la editări/ștergeri (operații de administrare): de unde a venit cererea,
    // ca la o ștergere suspectă să se vadă cine a făcut-o.
    ip: String,
    userAgent: String,
    // Doar pentru modificările EXTERNE (detector): alerta către clinică.
    alertPending: Boolean, // emailul de alertă mai trebuie trimis (reîncercat la fiecare scanare)
    alertAttempts: Number,
    alertClaimedAt: Date, // preluat de o instanță (fără dublură în timpul unui deploy)
    before: {
      data: String,
      time: String,
      name: String,
      surname: String,
      email: String,
      tel: String,
      service: String,
    },
    at: { type: Date, default: Date.now },
  },
  { collection: "booking_audit" }
);

// Detectorul caută des după rezervare + acțiune și după alertele în așteptare.
bookingAuditSchema.index({ bookingId: 1, action: 1, at: 1 });
bookingAuditSchema.index({ alertPending: 1 }, { partialFilterExpression: { alertPending: true } });

module.exports = mongoose.model("BookingAudit", bookingAuditSchema);
