const nodemailer = require("nodemailer");

const EMAIL_USER = "rdvbasilix@gmail.com";
const EMAIL_PASS = "isht brfx mffv zeju";
const CLINIC_EMAIL = "esthetiquebasilix@gmail.com";

function createTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
}

function sendMail(to, subject, html) {
  return new Promise((resolve, reject) => {
    createTransporter().sendMail(
      { from: EMAIL_USER, to, subject, html },
      (error, info) => {
        if (error) return reject(error);
        resolve(info);
      }
    );
  });
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

// Trimite email de confirmare rezervare către client și clinică
async function sendBookingConfirmation({ data, email, name, service, surname, tel, time }) {
  const dateDisplay = displayDate(data);

  const userHtml = `
<p>Inscription réussie!</p>
<p>Votre rendez-vous a été enregistré avec succès.</p>
<ul>
  <li><strong>Nom :</strong> ${name}</li>
  <li><strong>Prénom :</strong> ${surname}</li>
  <li><strong>Téléphone :</strong> ${tel}</li>
  <li><strong>E-mail :</strong> ${email}</li>
  <li><strong>Service :</strong> ${service}</li>
  <li><strong>Date :</strong> ${dateDisplay}</li>
  <li><strong>Heure :</strong> ${time}</li>
</ul>
<p>Pour toute modification, veuillez appeler le <strong>02 354 57 98</strong> (10h00 - 19h00) ou répondre à cet e-mail <strong>au moins 24 heures à l'avance</strong>.</p>
<p>À bientôt !</p>`;

  const clinicHtml = `
<p>Chère Madame,</p>
<p>Un nouveau rendez-vous a été enregistré :</p>
<ul>
  <li><strong>Nom :</strong> ${name}</li>
  <li><strong>Prénom :</strong> ${surname}</li>
  <li><strong>Téléphone :</strong> ${tel}</li>
  <li><strong>E-mail :</strong> ${email}</li>
  <li><strong>Service :</strong> ${service}</li>
  <li><strong>Date :</strong> ${dateDisplay}</li>
  <li><strong>Heure :</strong> ${time}</li>
</ul>
<p>Merci !</p>`;

  await Promise.all([
    sendMail(email, "Confirmation de rendez-vous – Esthétique Basilix", userHtml),
    sendMail(CLINIC_EMAIL, "Un nouvel horaire", clinicHtml),
  ]);
}

// Trimite email de anulare rezervare către client și clinică
async function sendBookingCancellation({ data, email, name, service, surname, tel, time }) {
  const dateDisplay = displayDate(data);

  const html = `
<p>Bonjour Madame ${name},</p>
<p>Nous vous informons qu'à votre demande ou pour d'autres raisons, votre rendez-vous au Centre Esthétique Basilix a été annulé. Si vous estimez qu'il s'agit d'une erreur de notre part, n'hésitez pas à nous le faire savoir en répondant à ce message.</p>
<p>Nous vous rappelons que vous pouvez prendre un nouveau rendez-vous en accédant à www.esthetiquebasilix.be .</p>
<p>Merci de votre compréhension, et nous serons ravis de vous accueillir à nouveau !</p>
<ul>
  <li><strong>Nom :</strong> ${name}</li>
  <li><strong>Prénom :</strong> ${surname}</li>
  <li><strong>Téléphone :</strong> ${tel}</li>
  <li><strong>E-mail :</strong> ${email}</li>
  <li><strong>Service :</strong> ${service}</li>
  <li><strong>Date :</strong> ${dateDisplay}</li>
  <li><strong>Heure :</strong> ${time}</li>
</ul>
<p>Cordialement,</p>
<p>Centre Esthétique Basilix</p>`;

  await Promise.all([
    sendMail(email, "Votre rendez-vous a été annulé", html),
    sendMail(CLINIC_EMAIL, "Votre rendez-vous a été annulé", html),
  ]);
}

// Trimite reminder cu o zi înainte către client
async function sendBookingReminder(record) {
  const dateDisplay = displayDate(record.data);

  const html = `
<p>Bonjour Madame ${record.name},</p>
<p>Nous vous rappelons que vous avez un rendez-vous prévu au Centre Esthétique Basilix, le <strong>${dateDisplay}</strong> à <strong>${record.time}</strong>.</p>
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

  const clinicHtml = `<p>${email}</p><p>${textarea}</p><p>Partener</p>`;

  await Promise.all([
    sendMail(email, "Partenariat – Esthétique Basilix", userHtml),
    sendMail(CLINIC_EMAIL, "New Partener", clinicHtml),
  ]);
}

module.exports = {
  sendBookingConfirmation,
  sendBookingCancellation,
  sendBookingReminder,
  sendPartnerInquiry,
};
