const TaskModel = require("../Models/TaskModels");
const nodemailer = require("nodemailer");

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

const checkNextDayRecord = async (currentDate) => {
  try {
    const tasks = await TaskModel.find();
    const nextDay = new Date(currentDate);
    nextDay.setDate(nextDay.getDate() + 2); // Change back to +1 if you want to check only the next day
    const nextDayStr = nextDay.toISOString().split("T")[0];

    const records = tasks.filter((task) => task.data === nextDayStr);

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
      console.log(`No record found for ${nextDayStr}`);
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
