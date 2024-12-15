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

    const mail_configs = {
      from: "rdvbasilix@gmail.com",
      to: record.email,
      subject: "Reminder Esthétique Basilix",
      html: `
<p>Cher/Chère ${record.surname} , nous vous rappelons que vous avez un rendez-vous prévu dans notre centre esthétique demain. Nous vous remercions pour votre ponctualité et nous espérons vous offrir notre meilleur service. À bientôt !</p>
      <p>${record.name}</p>
        <p>${record.surname}</p>
          <p>${record.tel}</p>
            <p>${record.email}</p>
              <p>${record.service}</p>
                <p>${record.data}</p>
                  <p>${record.time}</p> 
    <p>Centre Esthétique Basilix</p>
     <p>Basilix Shopping Center (2ème étage)</p>
      <p>Av. Charles-Quint 420, 1082 Berchem Sainte-Agathe</p>
       <p>T +32 (0) 2 35 45 798</p>
        <p>GSM +32 460 94 78 30</p>
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

    const records = tasks.filter((task) => task.data === nextDay);

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
      console.log(`No record found for ${nextDay}`);
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
