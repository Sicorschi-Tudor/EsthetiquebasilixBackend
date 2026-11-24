const mongoose = require("mongoose");

// Coada de emailuri („outbox"). Fiecare email de confirmare / modificare / anulare
// e înregistrat aici ÎNAINTE de operația în DB și trimis abia după ce operația e
// confirmată. Dacă trimiterea eșuează (Gmail căzut, server repornit), emailul NU
// se pierde: un worker îl reîncearcă — dar numai după ce reverifică în DB că
// emailul corespunde încă stării reale a rezervării.
const emailOutboxSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["confirmation", "modification", "cancellation"],
      required: true,
    },
    bookingId: mongoose.Schema.Types.ObjectId,
    payload: {
      data: String,
      time: String,
      name: String,
      surname: String,
      email: String,
      tel: String,
      service: String,
    },
    previous: { data: String, time: String, email: String }, // la modificare: slotul vechi
    source: String, // "site" | "admin-panel" | "unknown"
    status: {
      type: String,
      enum: ["pending", "sending", "sent", "skipped", "failed"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lastError: String,
    sentAt: Date,
  },
  { collection: "email_outbox", timestamps: true }
);

emailOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model("EmailOutbox", emailOutboxSchema);
