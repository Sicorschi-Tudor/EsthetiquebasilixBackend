const PriceModel = require("../Models/PriceModels");

// Convertește orice input („", null, "180", 180) într-un Number sau null.
const toNumberOrNull = (v) =>
  v === "" || v === null || v === undefined ? null : Number(v);

// GET /preturi  →  { offer, prices }
// offer = configul secțiunii Offres (sau null dacă nu e setat încă)
// prices = rândurile de preț, sortate după `order`
const getConfig = async (req, res) => {
  try {
    const docs = await PriceModel.find();
    const offer = docs.find((d) => d.kind === "offer") || null;
    const prices = docs
      .filter((d) => d.kind === "price")
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const serviceLabels = docs
      .filter((d) => d.kind === "serviceLabel")
      .map((d) => ({
        _id: d._id,
        serviceId: d.serviceId,
        promoLabel: d.promoLabel || "",
        group: d.group || "",
      }));
    res.status(200).json({ offer, prices, serviceLabels });
  } catch (error) {
    console.error("getConfig error:", error.message);
    res.status(500).json({ error: "Failed to fetch prices" });
  }
};

// POST /preturi/price  → creează un rând de preț
const createPrice = async (req, res) => {
  try {
    const b = req.body;
    const doc = await PriceModel.create({
      kind: "price",
      serviceId: b.serviceId || "",
      group: b.group || "",
      label: b.label || "",
      basePrice: toNumberOrNull(b.basePrice),
      priceText: b.priceText || "",
      promoPrice: toNumberOrNull(b.promoPrice),
      promoText: b.promoText || "",
      promoActive: !!b.promoActive,
      note: b.note || "",
      order: Number(b.order) || 0,
    });
    res.status(201).json(doc);
  } catch (error) {
    console.error("createPrice error:", error.message);
    res.status(500).json({ error: "Failed to create price" });
  }
};

// PUT /preturi/price/:id  → actualizează un rând de preț
const updatePrice = async (req, res) => {
  try {
    const b = req.body;
    const fields = {};
    if (b.serviceId != null) fields.serviceId = b.serviceId;
    if (b.group != null) fields.group = b.group;
    if (b.label != null) fields.label = b.label;
    if (b.basePrice !== undefined) fields.basePrice = toNumberOrNull(b.basePrice);
    if (b.priceText != null) fields.priceText = b.priceText;
    if (b.promoPrice !== undefined) fields.promoPrice = toNumberOrNull(b.promoPrice);
    if (b.promoText != null) fields.promoText = b.promoText;
    if (b.promoActive != null) fields.promoActive = !!b.promoActive;
    if (b.note != null) fields.note = b.note;
    if (b.order != null) fields.order = Number(b.order) || 0;

    const doc = await PriceModel.findByIdAndUpdate(req.params.id, fields, {
      new: true,
      runValidators: true,
    });
    if (!doc) return res.status(404).json({ error: "Price not found" });
    res.json(doc);
  } catch (error) {
    console.error("updatePrice error:", error.message);
    res.status(500).json({ error: "Failed to update price" });
  }
};

// DELETE /preturi/price/:id  → șterge un rând de preț
const deletePrice = async (req, res) => {
  try {
    const doc = await PriceModel.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: "Price not found" });
    res.json({ message: "Price deleted", doc });
  } catch (error) {
    console.error("deletePrice error:", error.message);
    res.status(500).json({ error: "Failed to delete price" });
  }
};

// PUT /preturi/offer  → creează/actualizează UNICUL document de tip "offer"
const updateOffer = async (req, res) => {
  try {
    const b = req.body;
    const fields = { kind: "offer" };
    if (b.visible != null) fields.visible = !!b.visible;
    if (b.chipLabel != null) fields.chipLabel = b.chipLabel;
    if (b.text != null) fields.text = b.text;
    if (b.imageUrl != null) fields.imageUrl = b.imageUrl;
    if (b.ctaLabel != null) fields.ctaLabel = b.ctaLabel;

    const doc = await PriceModel.findOneAndUpdate(
      { kind: "offer" },
      { $set: fields },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(doc);
  } catch (error) {
    console.error("updateOffer error:", error.message);
    res.status(500).json({ error: "Failed to update offer" });
  }
};

// POST /preturi/seed  → populează colecția cu valorile curente de pe site
// (promo RADIANCE septembrie + secțiunea Offres). Idempotent: nu dublează
// prețurile dacă există deja rânduri de tip "price".
// PUT /preturi/label  → creează/actualizează eticheta promo a unui serviciu
// (textul roșu afișat pe cardul serviciului, ex. „OFFRE SEPTEMBRE")
const updateLabel = async (req, res) => {
  try {
    const { serviceId, promoLabel, group } = req.body;
    if (!serviceId) return res.status(400).json({ error: "serviceId required" });
    const doc = await PriceModel.findOneAndUpdate(
      { kind: "serviceLabel", serviceId },
      {
        $set: {
          kind: "serviceLabel",
          serviceId,
          promoLabel: promoLabel || "",
          group: group || "",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(doc);
  } catch (error) {
    console.error("updateLabel error:", error.message);
    res.status(500).json({ error: "Failed to update label" });
  }
};

// Toate serviciile de pe site cu prețurile lor curente. `serviceId` = id-ul
// cardului de pe site (folosit ca să potrivim prețurile cu serviciul corect).
const DEFAULT_SERVICES = [
  {
    serviceId: "lifting-hifu",
    group: "Lifting HIFU",
    lines: [
      { label: "Front", basePrice: 170 },
      { label: "Contour des yeux", basePrice: 150 },
      { label: "Joues", basePrice: 150 },
      { label: "Menton", basePrice: 170 },
      { label: "Pack Visage (Front + Contour des yeux + Joues + Menton)", basePrice: 640, promoPrice: 550, promoActive: true },
      { label: "Double menton", basePrice: 200 },
      { label: "Cou", basePrice: 200 },
      { label: "Décolleté", basePrice: 280 },
      { label: "Pack Cou (Double menton + Cou + Décolleté)", basePrice: 680, promoPrice: 580, promoActive: true },
    ],
  },
  {
    serviceId: "soin-rADiaNce",
    group: "RADIANCE - Traitement à l'ADN de saumon",
    promoLabel: "OFFRE SEPTEMBRE",
    lines: [
      { label: "Visage", basePrice: 180, promoPrice: 135, promoActive: true },
      { label: "Pack 4 séances (Visage)", basePrice: 720, promoPrice: 480, promoActive: true },
      { label: "Cou", basePrice: 150, promoPrice: 112.5, promoActive: true },
      { label: "Pack 4 séances (Cou)", basePrice: 600, promoPrice: 405, promoActive: true },
      { label: "Décolleté", basePrice: 220, promoPrice: 165, promoActive: true },
      { label: "Pack 4 séances (Décolleté)", basePrice: 880, promoPrice: 600, promoActive: true },
    ],
  },
  { serviceId: "peeling-acide", group: "Peeling acide", lines: [{ label: "", basePrice: 130 }] },
  {
    serviceId: "peeling-laser",
    group: "Peeling au Laser",
    lines: [
      { label: "Visage", basePrice: 180 },
      { label: "Visage + Cou", basePrice: 220 },
    ],
  },
  { serviceId: "essentiel-visage", group: "ESSENTIEL - Soin du Visage", lines: [{ label: "", basePrice: 70, note: "(45min)" }] },
  { serviceId: "gold-hydrafacial", group: "GOLD - Soin du Visage avec Hydrafacial Diamant", lines: [{ label: "", basePrice: 90, note: "(50min)" }] },
  { serviceId: "diamond-hydrafacial", group: "DIAMOND - Soin du Visage avec Hydrafacial Diamant", lines: [{ label: "", basePrice: 110, note: "(50min)" }] },
  { serviceId: "platinum-hydrafacial", group: "PLATINUM - Soin du Visage avec Hydrafacial Diamant", lines: [{ label: "", basePrice: 130, note: "(50min)" }] },
  { serviceId: "mesotherapie", group: "Mésothérapie", lines: [{ label: "", basePrice: 120, note: "(50min)" }] },
  { serviceId: "depigmentation-sourcils", group: "Dépigmentation des sourcils et des tatouages au Pico-Laser", lines: [{ label: "", basePrice: 150 }] },
  { serviceId: "depigmentation-taches", group: "Dépigmentation des taches avec Pico-Laser", lines: [{ label: "", priceText: "50 - 100" }] },
  {
    serviceId: "epilation-definitive",
    group: "Épilation définitive",
    lines: [
      { label: "Visage complet", basePrice: 70 },
      { label: "Lévre supérieure", basePrice: 35 },
      { label: "Menton", basePrice: 45 },
      { label: "Aisselles", basePrice: 60 },
      { label: "Maillot", basePrice: 110 },
      { label: "Jambes entières", basePrice: 150 },
      { label: "Corps entier", basePrice: 300 },
    ],
  },
  {
    serviceId: "epilation-cire",
    group: "Épilation à la cire",
    lines: [
      { label: "Visage complet (sourcils non inclus)", basePrice: 25 },
      { label: "Sourcils (entretien + création)", basePrice: 18 },
      { label: "Teinture des sourcils", basePrice: 7 },
      { label: "Lèvre supérieure", basePrice: 9 },
      { label: "Menton", basePrice: 9 },
      { label: "Nez", basePrice: 7 },
      { label: "Aisselles", basePrice: 20 },
      { label: "Bras", basePrice: 25 },
      { label: "Bikini complet", basePrice: 30 },
      { label: "Jambes 1/2", basePrice: 25 },
      { label: "Jambes entières", basePrice: 40 },
    ],
  },
  { serviceId: "elimination-varices", group: "Élimination au laser des varices fines et de la couperose", lines: [{ label: "", priceText: "80 - 150" }] },
  {
    serviceId: "cryotherapie",
    group: "Cryothérapie",
    lines: [
      { label: "1ère séance", basePrice: 300 },
      { label: "2ème séance", basePrice: 280 },
      { label: "3ème séance", basePrice: 260 },
    ],
  },
  { serviceId: "raffermissement-corporel", group: "Remodelage Corporel", lines: [{ label: "", basePrice: 180, note: "(45min)" }] },
];

// Aplatizează structura de mai sus în documente "price" gata de inserat.
function buildDefaultPrices() {
  const docs = [];
  for (const svc of DEFAULT_SERVICES) {
    svc.lines.forEach((ln, i) => {
      docs.push({
        kind: "price",
        serviceId: svc.serviceId,
        group: svc.group,
        label: ln.label || "",
        basePrice: ln.basePrice != null ? ln.basePrice : null,
        priceText: ln.priceText || "",
        promoPrice: ln.promoPrice != null ? ln.promoPrice : null,
        promoText: ln.promoText || "",
        promoActive: !!ln.promoActive,
        note: ln.note || "",
        order: i + 1,
      });
    });
  }
  return docs;
}

// Etichetele promo implicite (doar serviciile care au promoLabel definit).
function buildDefaultLabels() {
  return DEFAULT_SERVICES.filter((s) => s.promoLabel).map((s) => ({
    kind: "serviceLabel",
    serviceId: s.serviceId,
    group: s.group,
    promoLabel: s.promoLabel,
  }));
}

const DEFAULT_OFFER = {
  kind: "offer",
  visible: true,
  chipLabel: "OFFRE SEPTEMBRE",
  text: "En septembre, profitez de notre offre spéciale sur le soin RADIANCE — Traitement à l'ADN de saumon.",
  imageUrl:
    "https://firebasestorage.googleapis.com/v0/b/esthetiquebasilix-7e531.appspot.com/o/2026-08-29-17-28-22-574.jpg?alt=media&token=1f6458a0-eec8-4d0f-b23f-a4e2c9ffdf3d",
  ctaLabel: "Prendre rendez-vous",
};

// POST /preturi/seed         → inserează valorile implicite doar dacă e gol
// POST /preturi/seed?reset=1  → ȘTERGE toate prețurile și le repopulează din valorile implicite
const seedDefaults = async (req, res) => {
  try {
    const reset =
      req.query.reset === "1" ||
      req.query.reset === "true" ||
      (req.body && req.body.reset === true);
    const priceCount = await PriceModel.countDocuments({ kind: "price" });
    const allPrices = buildDefaultPrices();
    const allLabels = buildDefaultLabels();
    let insertedPrices = 0;
    let deletedPrices = 0;

    if (reset) {
      const del = await PriceModel.deleteMany({
        kind: { $in: ["price", "serviceLabel"] },
      });
      deletedPrices = del.deletedCount || 0;
      await PriceModel.insertMany(allPrices);
      await PriceModel.insertMany(allLabels);
      insertedPrices = allPrices.length;
    } else if (priceCount === 0) {
      await PriceModel.insertMany(allPrices);
      const labelCount = await PriceModel.countDocuments({ kind: "serviceLabel" });
      if (labelCount === 0) await PriceModel.insertMany(allLabels);
      insertedPrices = allPrices.length;
    }

    const offer = await PriceModel.findOneAndUpdate(
      { kind: "offer" },
      { $set: DEFAULT_OFFER },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({
      message: "Seed done",
      reset: !!reset,
      deletedPrices,
      insertedPrices,
      skippedPrices: !reset && priceCount > 0,
      offer,
    });
  } catch (error) {
    console.error("seedDefaults error:", error.message);
    res.status(500).json({ error: "Failed to seed defaults" });
  }
};

module.exports = {
  getConfig,
  createPrice,
  updatePrice,
  deletePrice,
  updateOffer,
  updateLabel,
  seedDefaults,
};
