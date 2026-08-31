const mongoose = require("mongoose");

// Colecția "Preturi" (DB esthetiquebasilixdb) — un singur loc pentru:
//  - configul secțiunii Offres  → un singur document, kind: "offer"
//  - rândurile de preț editabile → multe documente, kind: "price"
//
// Notă: numele exact al colecției ("Preturi") e impus de a treia oară în
// mongoose.model(...) mai jos, ca să mapeze pe tabela creată de client în Atlas.
const priceSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["offer", "price", "serviceLabel"],
      required: true,
    },

    // ---- câmp pentru kind: "serviceLabel" (etichetă promo per serviciu) ----
    promoLabel: { type: String, default: "" }, // ex. "OFFRE SEPTEMBRE"

    // ---- câmpuri pentru kind: "price" ----
    serviceId: { type: String, default: "" }, // id-ul cardului de pe site, ex. "lifting-hifu"
    group: { type: String, default: "" }, // numele serviciului (pentru afișare în admin)
    label: { type: String, default: "" }, // eticheta liniei, ex. "Front" / "Pack Visage"
    basePrice: { type: Number, default: null }, // prețul normal numeric (tăiat când e reducere)
    priceText: { type: String, default: "" }, // preț text liber când nu e numeric, ex. "50 - 100"
    promoPrice: { type: Number, default: null }, // prețul redus numeric (roșu)
    promoText: { type: String, default: "" }, // preț redus text liber, ex. "40 - 80"
    promoActive: { type: Boolean, default: false }, // aplică reducerea?
    note: { type: String, default: "" }, // notă/durată, ex. "(45min)"
    order: { type: Number, default: 0 }, // ordinea de afișare

    // ---- câmpuri pentru kind: "offer" (secțiunea Offres de pe site) ----
    visible: { type: Boolean, default: false }, // afișează secțiunea sau nu
    chipLabel: { type: String, default: "" }, // ex. "OFFRE SEPTEMBRE"
    text: { type: String, default: "" }, // textul ofertei
    imageUrl: { type: String, default: "" }, // URL imagine (ex. Firebase)
    ctaLabel: { type: String, default: "Prendre rendez-vous" },
  },
  { collection: "Preturi", timestamps: true }
);

module.exports = mongoose.model("Preturi", priceSchema, "Preturi");
