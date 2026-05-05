const TaskModel = require("../Models/TaskModels");
const moment = require("moment-timezone");
const { sendBookingConfirmation, sendBookingReminder } = require("../utils/emailService");

const getTasks = async (req, res) => {
  try {
    const tasks = await TaskModel.find();
    res.status(200).json(tasks);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
};

const updateTask = async (req, res) => {
  try {
    const { _id, ...fieldsToUpdate } = req.body;
    const updatedPayment = await TaskModel.findByIdAndUpdate(
      req.params.id,
      fieldsToUpdate,
      { new: true, runValidators: true }
    );
    if (!updatedPayment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    res.json(updatedPayment);
  } catch (error) {
    console.error("Update error:", error);
    if (error.code === 11000) {
      return res.status(409).json({ error: "Time slot already taken" });
    }
    res.status(500).json({ error: "Failed to update task" });
  }
};

const deleteTask = async (req, res) => {
  try {
    const deletedPayment = await TaskModel.findByIdAndDelete(req.params.id);
    if (!deletedPayment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    res.json({ message: "Payment deleted successfully", deletedPayment });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete task" });
  }
};

const saveTask = async (req, res) => {
  const { data, email, name, service, surname, tel, time } = req.body;

  if (!data || !email || !name || !service || !surname || !tel || !time) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Operație atomică: inserează DOAR dacă nu există deja aceeași dată+oră.
    // findOneAndUpdate cu upsert returnează:
    //   null         → documentul a fost inserat (slot liber, rezervare reușită)
    //   doc existent → slot-ul era deja ocupat, nu s-a inserat nimic
    const existing = await TaskModel.findOneAndUpdate(
      { data, time },
      { $setOnInsert: { data, email, name, service, surname, tel, time } },
      { upsert: true, new: false }
    );

    if (existing !== null) {
      // Slot ocupat — nu s-a inserat nimic, nu se trimite niciun email
      return res.status(409).json({ error: "Time slot already taken" });
    }

    // Inserare confirmată de MongoDB — abia acum trimitem emailul de confirmare.
    // Erorile de email sunt logate dar nu afectează răspunsul (rezervarea e salvată).
    sendBookingConfirmation({ data, email, name, service, surname, tel, time }).catch(
      (err) => console.error("Booking confirmation email failed:", err)
    );

    // Returnăm datele rezervării fără un al doilea apel DB.
    // Un al doilea findOne ar putea eșua independent și ar returna 500 fals
    // (rezervarea ar fi salvată, dar userul ar vedea eroare și nu ar primi email).
    res.status(201).json({ data, email, name, service, surname, tel, time });
  } catch (error) {
    // Orice eroare MongoDB (timeout, validare, rețea, write concern, etc.)
    // ajunge aici — rezervarea NU s-a salvat, emailul NU s-a trimis.
    if (error.code === 11000) {
      // Fallback: indexul unic a prins un duplicat (race condition extremă)
      return res.status(409).json({ error: "Time slot already taken" });
    }
    console.error("Save task error:", error.name, error.message, error.code || "");
    res.status(500).json({ error: "Booking could not be saved. Please try again." });
  }
};

const checkNextDayRecord = async () => {
  try {
    const tasks = await TaskModel.find();
    const currentDate = moment().tz("Europe/Paris");
    const nextDay = currentDate.clone().add(1, "day");
    const nextDayStr = nextDay.format("DD-MM-YYYY");

    const records = tasks.filter((task) => {
      const taskDate = task.data;
      // Suportă atât formatul dd-MM-yyyy cât și yyyy-MM-dd
      if (/^\d{2}-\d{2}-\d{4}$/.test(taskDate)) {
        return taskDate === nextDayStr;
      }
      return taskDate === nextDay.format("YYYY-MM-DD");
    });

    if (records.length > 0) {
      records.forEach((record) => {
        sendBookingReminder(record)
          .then(() => console.log("Reminder sent to:", record.email))
          .catch((err) => console.error("Reminder email failed for", record.email, err));
      });
    } else {
      console.log(`No appointments found for ${nextDayStr}`);
    }
  } catch (error) {
    console.error("Failed to fetch tasks for reminders:", error);
  }
};

module.exports = {
  getTasks,
  saveTask,
  deleteTask,
  updateTask,
  checkNextDayRecord,
};
