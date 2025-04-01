const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const routes = require("./routes/TaskRoute");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { checkNextDayRecord } = require("./controllers/TaskControllers");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

function sendEmailPartner({ email, textarea }) {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "rdvbasilix@gmail.com",
        pass: "kqli anfa tbho ctad",
      },
    });

    const mail_configs = {
      from: "rdvbasilix@gmail.com",
      to: "esthetiquebasilix@gmail.com",
      subject: "New Partener",
      html: `
            <p>${email}</p>
            <p>${textarea}</p>
      <p>Partener</p>
      `,
    };
    transporter.sendMail(mail_configs, function (error, info) {
      if (error) {
        console.log("Error sending email:", error);
        return reject({
          message: "An error has occurred while sending the email",
        });
      }
      return resolve({ message: "Email sent successfully" });
    });
  });
}

function sendEmail({ data, email, name, service, surname, tel, time }) {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "rdvbasilix@gmail.com",
        pass: "kqli anfa tbho ctad",
      },
    });

    const mail_configs = {
      from: "rdvbasilix@gmail.com",
      to: "esthetiquebasilix@gmail.com",
      subject: "Un nouvel horaire",
      html: `
    <p>Chère Madame,</p>
    <p>Nous vous informons que votre rendez-vous a été confirmé pour la date et l'heure indiquées ci-dessous :</p>
    
    <ul>
      <li><strong>Nom :</strong> ${name}</li>
      <li><strong>Prénom :</strong> ${surname}</li>
      <li><strong>Téléphone :</strong> ${tel}</li>
      <li><strong>E-mail :</strong> ${email}</li>
      <li><strong>Service :</strong> ${service}</li>
      <li><strong>Date :</strong> ${data}</li>
      <li><strong>Heure :</strong> ${time}</li>
    </ul>

    <p>Pour toute modification, veuillez appeler le <strong>02 354 57 98</strong> (10h00 - 19h00) ou répondre à cet e-mail <strong>au moins 24 heures à l'avance</strong>.</p>

    <p>Merci !</p>
  `,
    };

    transporter.sendMail(mail_configs, function (error, info) {
      if (error) {
        console.log("Error sending email:", error);
        return reject({
          message: "An error has occurred while sending the email",
        });
      }
      return resolve({ message: "Email sent successfully" });
    });
  });
}

function replayEmail({ data, email, name, service, surname, tel, time }) {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "rdvbasilix@gmail.com",
        pass: "kqli anfa tbho ctad",
      },
    });

    const mail_configs = {
      from: "rdvbasilix@gmail.com",
      to: email,
      subject: "Un nouvel horaire",
      html: `
<p>Inscription réussie! </p>
<p>Votre rendez-vous a été enregistré avec succès.</p>
      <p>${name}</p>
        <p>${surname}</p>
          <p>${tel}</p>
            <p>${email}</p>
              <p>${service}</p>
                <p>${data}</p>
                  <p>${time}</p> 
      `,
    };
    transporter.sendMail(mail_configs, function (error, info) {
      if (error) {
        console.log("Error sending email:", error);
        return reject({
          message: "An error has occurred while sending the email",
        });
      }
      return resolve({ message: "Email sent successfully" });
    });
  });
}

function replayEmailPartner({ email }) {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "rdvbasilix@gmail.com",
        pass: "kqli anfa tbho ctad",
      },
    });

    const mail_configs = {
      from: "rdvbasilix@gmail.com",
      to: email,
      subject: "Un nouvel horaire",
      html: `
<p>Bonjour, </p>
<p>Nous vous remercions de votre intérêt pour une collaboration avec nous. </p>
<p>Afin de pouvoir discuter plus en détail de cette possibilité, nous vous prions de bien vouloir nous fournir plus d'informations sur les services que vous proposez, les avantages que vous apportez à vos partenaires ainsi que toute autre information pertinente que vous jugez importante. </p>
<p>Nous vous invitons à nous envoyer ces informations à esthetiquebasilix@gmail.com .</p>
<p>Nous sommes ouverts à fixer une rencontre pour explorer toutes les façons dont nous pouvons collaborer au bénéfice des deux parties. </p>
<p>Nous attendons avec impatience votre réponse et sommes impatients de construire ensemble un partenariat réussi.</p>
<p>Cordialement,</p>
<p>Centre Esthétique Basilix</p>
      `,
    };
    transporter.sendMail(mail_configs, function (error, info) {
      if (error) {
        console.log("Error sending email:", error);
        return reject({
          message: "An error has occurred while sending the email",
        });
      }
      return resolve({ message: "Email sent successfully" });
    });
  });
}

// Function to start the server
const startServer = async () => {
  try {
    await mongoose.connect(
      "mongodb+srv://aaw1713tudor:7777777AAA@cluster0.wk7njla.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
      {
        dbName: "esthetiquebasilixdb",
      }
    );

    app.listen(PORT, () => {
      console.log(`Server started on port: ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
    process.exit(1); // Exit the process with failure code
  }
};

startServer();

setInterval(() => {
  fetch("https://trustoptimabackend.onrender.com");
  console.log("fetch");
}, [600000]);

// Programarea cronjob-ului pentru a se executa zilnic la ora 09:00 AM
cron.schedule("0 9 * * *", async () => {
  await checkNextDayRecord();
});

app.get("/sentemail", (req, res) => {
  Promise.all([sendEmail(req.query), replayEmail(req.query)])
    .then((responses) => {
      res.send(responses.map((response) => response.message));
    })
    .catch((error) => {
      console.error("Error in GET /:", error);
      res.status(500).send(error.message);
    });
});

app.get("/sentemailpartener", (req, res) => {
  Promise.all([sendEmailPartner(req.query), replayEmailPartner(req.query)])
    .then((response) => res.send(response.message))
    .catch((error) => {
      console.error("Error in GET /:", error);
      res.status(500).send(error.message);
    });
});

app.use("/tasks", routes); // Ensure the route is properly prefixed
