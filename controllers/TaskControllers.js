const TaskModel = require("../Models/TaskModels");
const nodemailer = require("nodemailer");
const moment = require("moment-timezone");

function replayEmailResponder(record) {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "rdvbasilix@gmail.com",
        pass: "kqli anfa tbho ctad",
      },
    });

    const formattedDate = moment(record.data).format("DD-MM-YYYY");

    const mail_configs = {
      from: "rdvbasilix@gmail.com",
      to: record.email,
      subject: "Reminder Esthétique Basilix",
      html: `
    <p>
      Cher/Chère ${record.surname} , nous vous rappelons que vous avez un
      rendez-vous prévu au Centre Esthétique Basilix, le ${formattedDate} à
      ${record.time}. Nous vous remercions pour votre ponctualité et nous
      espérons vous offrir notre meilleur service.
    </p>
    <p>À bientôt !</p>
    <br />
    <br />
    <br />
    <br />
    <br />
    <p>${record.name}</p>
    <p>${record.surname}</p>
    <p>${record.tel}</p>
    <p>${record.email}</p>
    <p>${record.service}</p>
    <p>${formattedDate}</p>
    <p>${record.time}</p>
    <br />
    <br />
    <br />
    <p>Cordialement</p>
    <br />
    <p><b>Centre Esthétique Basilix</b></p>
    <p>Avenue Charles-Quint 420, Berchem-Sainte-Agathe</p>
    <p>(Bruxelles)</p>
    <p>T +32 (0) 2 35 45 798</p>
    <p>10h00 - 19h00</p>
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

const getTasks = async (req, res) => {
  try {
    const tasks = await TaskModel.find();
    res.status(200).json(tasks);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
};

const saveTask = async (req, res) => {
  const { data, email, name, service, surname, tel, time } = req.body;

  try {
    const newTask = await TaskModel.create({
      data,
      email,
      name,
      service,
      surname,
      tel,
      time,
    });
    res.status(201).json(newTask);
  } catch (error) {
    res.status(500).json({ error: "Failed to save task" });
  }
};

const checkNextDayRecord = async () => {
  try {
    const tasks = await TaskModel.find();
    const currentDate = moment().tz("Europe/Paris"); // Get the current date and time in Europe
    const nextDay = currentDate.clone().add(1, "day"); // Add 1 day to get the next day
    const records = tasks.filter(
      (task) => task.data === nextDay.format("YYYY-MM-DD")
    );

    if (records.length > 0) {
      records.forEach((record) => {
        replayEmailResponder(record)
          .then((response) =>
            console.error("Response:", response, "email:", record.email)
          )
          .catch((error) => {
            console.error("Error in GET /:", error);
          });
      });
    } else {
      console.log(`No record found for ${nextDay.format("YYYY-MM-DD")}`);
    }
  } catch (error) {
    console.error("Failed to fetch tasks", error);
  }
};

module.exports = {
  getTasks,
  saveTask,
  checkNextDayRecord,
};
