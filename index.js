const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const routes = require("./routes/TaskRoute");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

function sendEmailPartner({ email }) {
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
      subject: "New programare",
      html: `
      <p>${name}</p>
        <p>${surname}</p>
          <p>${tel}</p>
            <p>${email}</p>
              <p>${service}</p>
                <p>${data}</p>
                  <p>${time}</p> 
      <p>Best Regards</p>
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
      subject: "New programare",
      html: `
        <p>Ati fost inregistrat cu suucces</p>
      <p>${name}</p>
        <p>${surname}</p>
          <p>${tel}</p>
            <p>${email}</p>
              <p>${service}</p>
                <p>${data}</p>
                  <p>${time}</p> 
      <p>Best Regards</p>
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
  fetch("https://esthetiquebasilixbackend.onrender.com/tasks");
  console.log("fetch");
}, [600000]);

setInterval(async () => {
  const currentDate = new Date().toISOString().split("T")[0];
  await checkNextDayRecord(currentDate);
  res.send("Check the console for results.");
}, [600]);

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
  sendEmailPartner(req.query)
    .then((response) => res.send(response.message))
    .catch((error) => {
      console.error("Error in GET /:", error);
      res.status(500).send(error.message);
    });
});

app.use("/tasks", routes); // Ensure the route is properly prefixed
