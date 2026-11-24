const mongoose = require("mongoose");

// Ultima stare cunoscută a fiecărei rezervări. Detectorul de modificări externe o
// compară periodic cu baza de date: orice rezervare ștearsă, adăugată sau modificată
// FĂRĂ să treacă prin aplicație (direct în MongoDB sau printr-un apel API străin)
// e semnalată imediat clinicii. _id = _id-ul rezervării.
const bookingSnapshotSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    data: String,
    time: String,
    name: String,
    surname: String,
    email: String,
    tel: String,
    service: String,
    seenAt: { type: Date, default: Date.now },
  },
  { collection: "booking_snapshot", versionKey: false }
);

module.exports = mongoose.model("BookingSnapshot", bookingSnapshotSchema);
