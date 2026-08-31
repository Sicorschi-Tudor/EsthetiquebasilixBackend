const express = require("express");
const {
  getConfig,
  createPrice,
  updatePrice,
  deletePrice,
  updateOffer,
  updateLabel,
  seedDefaults,
} = require("../controllers/PriceControllers");

const router = express.Router();

// Montat la /preturi în index.js
router.get("/", getConfig); //          GET    /preturi         -> { offer, prices, serviceLabels }
router.put("/offer", updateOffer); //   PUT    /preturi/offer   -> upsert secțiune Offres
router.put("/label", updateLabel); //   PUT    /preturi/label   -> upsert etichetă promo serviciu
router.post("/seed", seedDefaults); //  POST   /preturi/seed    -> populează valorile curente
router.post("/price", createPrice); //  POST   /preturi/price   -> creează rând de preț
router.put("/price/:id", updatePrice); // PUT  /preturi/price/:id -> actualizează rând
router.delete("/price/:id", deletePrice); // DELETE /preturi/price/:id -> șterge rând

module.exports = router;
