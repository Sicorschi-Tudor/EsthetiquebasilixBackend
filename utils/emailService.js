const fs = require("fs");
const nodemailer = require("nodemailer");
const { buildIcs, buildCancelIcs } = require("./calendar");

// Credențialele pot veni din variabile de mediu (recomandat); valorile actuale
// rămân ca rezervă ca producția să funcționeze și fără ele setate.
const EMAIL_USER = process.env.EMAIL_USER || "rdvbasilix@gmail.com";
const EMAIL_PASS = process.env.EMAIL_PASS || "isht brfx mffv zeju";
const CLINIC_EMAIL = process.env.CLINIC_EMAIL || "esthetiquebasilix@gmail.com";

// Timeout-urile nodemailer (conectare / salut / inactivitate) închid conexiunea și dau
// un eșec definitiv. Limita de mai jos e doar o plasă pentru o trimitere complet
// blocată — mare intenționat: dacă ar expira o trimitere pe care Gmail o acceptă
// totuși mai târziu, reîncercarea ar produce un email dublu.
const SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS) || 120000;

// DOAR pentru teste locale: EMAIL_DRY_RUN=1 → nu se trimite nimic, doar se loghează
// (opțional în fișierul EMAIL_DRY_RUN_LOG). Dacă fișierul EMAIL_FAIL_FLAG_FILE există,
// trimiterea eșuează simulat (pentru a testa reîncercările). Neactiv în producție.
const DRY_RUN = process.env.EMAIL_DRY_RUN === "1";

function createTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    dnsTimeout: 15000,
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sendMail(to, subject, html, extra = {}) {
  if (DRY_RUN) {
    const failFlag = process.env.EMAIL_FAIL_FLAG_FILE;
    if (failFlag && fs.existsSync(failFlag)) {
      return Promise.reject(new Error("dry-run: simulated SMTP failure"));
    }
    const attachments = (extra.attachments || []).map((a) => {
      const c = String(a.content || "");
      const field = (k) => ((new RegExp(`^${k}:(.*)$`, "m").exec(c) || [])[1] || "").trim();
      return { filename: a.filename, method: field("METHOD"), uid: field("UID"), status: field("STATUS") };
    });
    const write = () => {
      const entry = { at: new Date().toISOString(), to, subject, attachments, html };
      console.log(`[email dry-run] to=${to} subject="${subject}"`);
      if (process.env.EMAIL_DRY_RUN_LOG) {
        fs.appendFileSync(process.env.EMAIL_DRY_RUN_LOG, JSON.stringify(entry) + "\n");
      }
      return { dryRun: true };
    };
    // Gmail lent simulat (milisecunde scrise în fișierul EMAIL_DELAY_FLAG_FILE).
    const delayFlag = process.env.EMAIL_DELAY_FLAG_FILE;
    const delayMs =
      delayFlag && fs.existsSync(delayFlag) ? Number(fs.readFileSync(delayFlag, "utf8")) || 0 : 0;
    return delayMs
      ? new Promise((resolve) => setTimeout(() => resolve(write()), delayMs))
      : Promise.resolve(write());
  }
  const send = new Promise((resolve, reject) => {
    createTransporter().sendMail(
      { from: EMAIL_USER, to, subject, html, ...extra },
      (error, info) => (error ? reject(error) : resolve(info))
    );
  });
  return withTimeout(send, SEND_TIMEOUT_MS, "SMTP");
}

// Emailul către CLIENTĂ trebuie să reușească (altfel se reîncearcă din coadă).
// Copia către clinică e „best effort": dacă pică, doar se loghează — astfel un
// eșec la clinică nu mai poate provoca trimiterea dublă a emailului către clientă.
async function sendClientThenClinic(client, clinic) {
  await sendMail(client.to, client.subject, client.html, client.extra || {});
  try {
    await sendMail(CLINIC_EMAIL, clinic.subject, clinic.html);
  } catch (e) {
    console.error(`Clinic copy failed (${clinic.subject}):`, e.message);
  }
}

// Valorile introduse de utilizatori sunt escape-uite înainte de a intra în HTML.
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Afișează data ca dd-MM-yyyy indiferent de formatul primit (yyyy-MM-dd sau dd-MM-yyyy)
function displayDate(dateStr) {
  if (!dateStr) return dateStr;
  const str = String(dateStr).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) return str;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return str;
}

function detailsList({ data, email, name, service, surname, tel, time }) {
  return `
<ul>
  <li><strong>Nom :</strong> ${esc(name)}</li>
  <li><strong>Prénom :</strong> ${esc(surname)}</li>
  <li><strong>Téléphone :</strong> ${esc(tel)}</li>
  <li><strong>E-mail :</strong> ${esc(email)}</li>
  <li><strong>Service :</strong> ${esc(service)}</li>
  <li><strong>Date :</strong> ${esc(displayDate(data))}</li>
  <li><strong>Heure :</strong> ${esc(time)}</li>
</ul>`;
}

const icsFile = (filename, content) =>
  content ? [{ filename, content, contentType: "text/calendar; charset=utf-8" }] : [];

// Atașează evenimentul .ics la emailul clientei (universal: Apple/Google/Outlook).
function icsAttachment(booking) {
  const files = icsFile("rendez-vous.ics", buildIcs(booking));
  return files.length ? { attachments: files } : {};
}

// Trimite email de confirmare rezervare către client și clinică
async function sendBookingConfirmation(booking) {
  const userHtml = `
<p>Inscription réussie!</p>
<p>Votre rendez-vous a été enregistré avec succès.</p>${detailsList(booking)}
<p>Pour toute modification, veuillez appeler le <strong>02 354 57 98</strong> (10h00 - 19h00) ou répondre à cet e-mail <strong>au moins 24 heures à l'avance</strong>.</p>
<p>À bientôt !</p>`;

  const clinicHtml = `
<p>Chère Madame,</p>
<p>Un nouveau rendez-vous a été enregistré :</p>${detailsList(booking)}
<p>Merci !</p>`;

  await sendClientThenClinic(
    {
      to: booking.email,
      subject: "Confirmation de rendez-vous – Esthétique Basilix",
      html: userHtml,
      extra: icsAttachment(booking),
    },
    { subject: "Un nouvel horaire", html: clinicHtml }
  );
}

// Trimite email de MODIFICARE (dată/oră/serviciu schimbate de administrator).
// Dacă s-a schimbat slotul, emailul spune clar că vechiul rendez-vous e înlocuit.
async function sendBookingModification(booking, previous) {
  const moved =
    previous && previous.data && (previous.data !== booking.data || previous.time !== booking.time);
  const oldLine = moved
    ? `<p>Ancien rendez-vous : <strong>${esc(displayDate(previous.data))} à ${esc(previous.time)}</strong> — remplacé par le nouveau ci-dessous.</p>`
    : "";
  // Vechiul eveniment din calendarul clientei (cu alarma lui) trebuie scos, altfel ea
  // poate veni la ora veche — exact situația a două cliente pe același slot.
  const calendarLine = moved
    ? `<p><strong>Si vous aviez ajouté l'ancien rendez-vous à votre agenda, pensez à le supprimer</strong> : seul le nouveau rendez-vous ci-dessous est valable. (Le fichier « ancien-rendez-vous-annule.ics » joint peut le retirer automatiquement de certains agendas.)</p>`
    : "";

  const userHtml = `
<p>Bonjour Madame ${esc(booking.name)},</p>
<p>Votre rendez-vous au Centre Esthétique Basilix a été <strong>modifié</strong>.</p>${oldLine}${calendarLine}
<p>Voici les informations à jour :</p>${detailsList(booking)}
<p>Pour toute question, veuillez appeler le <strong>02 354 57 98</strong> (10h00 - 19h00) ou répondre à cet e-mail.</p>
<p>À bientôt !</p>`;

  const attachments = [
    ...icsFile("rendez-vous.ics", buildIcs(booking)),
    ...(moved
      ? icsFile(
          "ancien-rendez-vous-annule.ics",
          buildCancelIcs({
            ...booking,
            data: previous.data,
            time: previous.time,
            email: previous.email || booking.email,
          })
        )
      : []),
  ];

  const clinicHtml = `
<p>Chère Madame,</p>
<p>Un rendez-vous a été modifié :</p>${oldLine}${detailsList(booking)}
<p>Merci !</p>`;

  await sendClientThenClinic(
    {
      to: booking.email,
      subject: "Modification de votre rendez-vous – Esthétique Basilix",
      html: userHtml,
      extra: { attachments },
    },
    { subject: "Rendez-vous modifié", html: clinicHtml }
  );
}

// Trimite email de anulare rezervare către client și clinică
async function sendBookingCancellation(booking) {
  const intro = `
<p>Bonjour Madame ${esc(booking.name)},</p>
<p>Nous vous informons qu'à votre demande ou pour d'autres raisons, votre rendez-vous au Centre Esthétique Basilix a été annulé. Si vous estimez qu'il s'agit d'une erreur de notre part, n'hésitez pas à nous le faire savoir en répondant à ce message.</p>`;
  const rest = `
<p>Nous vous rappelons que vous pouvez prendre un nouveau rendez-vous en accédant à www.esthetiquebasilix.be .</p>
<p>Merci de votre compréhension, et nous serons ravis de vous accueillir à nouveau !</p>${detailsList(booking)}
<p>Cordialement,</p>
<p>Centre Esthétique Basilix</p>`;
  // Doar pentru clientă: evenimentul din calendar (cu alarma lui) trebuie scos.
  const calendarLine = `
<p><strong>Si vous aviez ajouté ce rendez-vous à votre agenda, pensez à le supprimer</strong> : il n'est plus valable. (Le fichier « annulation-rendez-vous.ics » joint peut le retirer automatiquement de certains agendas.)</p>`;

  await sendClientThenClinic(
    {
      to: booking.email,
      subject: "Votre rendez-vous a été annulé",
      html: intro + calendarLine + rest,
      extra: { attachments: icsFile("annulation-rendez-vous.ics", buildCancelIcs(booking)) },
    },
    { subject: "Votre rendez-vous a été annulé", html: intro + rest }
  );
}

const ALERTS = {
  "external-delete": {
    title: "Rendez-vous SUPPRIMÉ en dehors de l'application",
    advice:
      "Cette cliente n'a reçu AUCUN e-mail d'annulation. Si ce rendez-vous est réellement annulé, prévenez-la ; sinon, recréez-le dans le panneau d'administration.",
  },
  "external-create": {
    title: "Rendez-vous AJOUTÉ en dehors de l'application",
    advice:
      "Il n'a été créé ni par le site ni par le panneau : la cliente n'a reçu aucune confirmation. Vérifiez qu'il est légitime.",
  },
  "external-update": {
    title: "Rendez-vous MODIFIÉ en dehors de l'application",
    advice:
      "La cliente n'a pas été informée de cette modification. Vérifiez-la et prévenez-la si nécessaire.",
  },
};

const ALERT_PLURAL = {
  "external-delete": "SUPPRIMÉS",
  "external-create": "AJOUTÉS",
  "external-update": "MODIFIÉS",
};
const MAX_ALERTS_LISTED = 50;

function alertBlock(row) {
  const a = ALERTS[row.action];
  const before =
    row.before && row.before.data ? `<p>Avant la modification :</p>${detailsList(row.before)}` : "";
  return `<p><strong>⚠ ${a.title}.</strong></p>
<p>${a.advice}</p>${detailsList(row)}${before}`;
}

// Alertă către clinică: rezervări șterse / adăugate / modificate fără să treacă prin
// aplicație (direct în baza de date sau printr-un acces neautorizat). Mai multe deodată
// → UN SINGUR email-rezumat (fără avalanșă de emailuri, care ar putea epuiza limita
// zilnică Gmail și bloca astfel confirmările clientelor).
async function sendClinicAlerts(rows) {
  const list = (rows || []).filter((r) => ALERTS[r.action]);
  if (!list.length) return;
  const kinds = new Set(list.map((r) => r.action));
  const subject =
    list.length === 1
      ? `⚠ ${ALERTS[list[0].action].title}`
      : kinds.size === 1
      ? `⚠ ${list.length} rendez-vous ${ALERT_PLURAL[list[0].action]} en dehors de l'application`
      : `⚠ ${list.length} rendez-vous changés en dehors de l'application`;
  const shown = list.slice(0, MAX_ALERTS_LISTED);
  const intro =
    list.length > 1 ? `<p><strong>${list.length} changements</strong> ont été détectés :</p>` : "";
  const more =
    list.length > shown.length
      ? `<p>… et ${list.length - shown.length} autres (voir le panneau d'administration).</p>`
      : "";
  const html = `
<p>Chère Madame,</p>${intro}
${shown.map(alertBlock).join("\n<hr />\n")}${more}
<p>Cette alerte est automatique : toute suppression ou modification faite directement dans la base de données (ou via un accès non autorisé) est détectée.</p>`;
  await sendMail(CLINIC_EMAIL, subject, html);
}

// Trimite reminder cu o zi înainte către client
async function sendBookingReminder(record) {
  const dateDisplay = displayDate(record.data);

  const html = `
<p>Bonjour Madame ${esc(record.name)},</p>
<p>Nous vous rappelons que vous avez un rendez-vous prévu au Centre Esthétique Basilix, le <strong>${esc(dateDisplay)}</strong> à <strong>${esc(record.time)}</strong>.</p>
<p>Nous vous remercions pour votre ponctualité et nous espérons vous offrir notre meilleur service.</p>
<p>À bientôt !</p>
<br />
<p><b>Centre Esthétique Basilix</b></p>
<p>Avenue Charles-Quint 420, Berchem-Sainte-Agathe (Bruxelles)</p>
<p>T +32 (0) 2 35 45 798</p>
<p>10h00 - 19h00</p>`;

  await sendMail(record.email, "Reminder Esthétique Basilix", html);
}

// Trimite email partener
async function sendPartnerInquiry({ email, textarea }) {
  const userHtml = `
<p>Bonjour,</p>
<p>Nous vous remercions de votre intérêt pour une collaboration avec nous.</p>
<p>Afin de pouvoir discuter plus en détail de cette possibilité, nous vous prions de bien vouloir nous fournir plus d'informations sur les services que vous proposez, les avantages que vous apportez à vos partenaires ainsi que toute autre information pertinente.</p>
<p>Nous vous invitons à nous envoyer ces informations à esthetiquebasilix@gmail.com .</p>
<p>Nous attendons avec impatience votre réponse.</p>
<p>Cordialement,</p>
<p>Centre Esthétique Basilix</p>`;

  const clinicHtml = `<p>${esc(email)}</p><p>${esc(textarea)}</p><p>Partener</p>`;

  await Promise.all([
    sendMail(email, "Partenariat – Esthétique Basilix", userHtml),
    sendMail(CLINIC_EMAIL, "New Partener", clinicHtml),
  ]);
}

module.exports = {
  sendBookingConfirmation,
  sendBookingModification,
  sendBookingCancellation,
  sendBookingReminder,
  sendPartnerInquiry,
  sendClinicAlerts,
};
