const TaskModel = require("../Models/TaskModels");
const moment = require("moment-timezone");
const { sendBookingConfirmation, sendBookingReminder } = require("../utils/emailService");
const { buildIcs, buildGoogleCalendarUrl } = require("../utils/calendar");

// Normalizează data la formatul canonic yyyy-MM-dd, indiferent ce trimite clientul.
// Astfel aceeași zi reală produce mereu ACELAȘI string, deci indexul unic {data,time}
// și verificările de slot tratează 13-06-2026 și 2026-06-13 ca fiind același slot.
const normalizeData = (data) => {
  if (!data) return data;
  const s = String(data).trim();
  // dd-MM-yyyy -> yyyy-MM-dd
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // deja yyyy-MM-dd
  return s;
};

const normalizeTime = (time) => (time == null ? time : String(time).trim());

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

    // Normalizează data/ora dacă sunt incluse în update
    if (fieldsToUpdate.data != null) fieldsToUpdate.data = normalizeData(fieldsToUpdate.data);
    if (fieldsToUpdate.time != null) fieldsToUpdate.time = normalizeTime(fieldsToUpdate.time);

    // Dacă editarea mută rezervarea pe un slot (data+time), refuză dacă slotul e deja
    // ocupat de ALTĂ rezervare. Verificare explicită + indexul unic ca plasă de siguranță.
    if (fieldsToUpdate.data && fieldsToUpdate.time) {
      const conflict = await TaskModel.findOne({
        data: fieldsToUpdate.data,
        time: fieldsToUpdate.time,
        _id: { $ne: req.params.id },
      });
      if (conflict) {
        return res.status(409).json({ error: "Time slot already taken" });
      }
    }

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
  const { email, name, service, surname, tel } = req.body;
  // Normalizează data+ora la formatul canonic ÎNAINTE de orice verificare/inserare,
  // ca slotul să fie identic indiferent de formatul trimis de client.
  const data = normalizeData(req.body.data);
  const time = normalizeTime(req.body.time);

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

    // Rezervarea e confirmată în DB — DOAR ACUM generăm fișierul de calendar (.ics)
    // și linkul Google, și le returnăm pentru butonul „Ajouter à mon calendrier".
    const ics = buildIcs({ data, email, name, service, surname, tel, time });
    const googleCalendarUrl = buildGoogleCalendarUrl({
      data, email, name, service, surname, tel, time,
    });

    // Returnăm datele rezervării (+ calendar) fără un al doilea apel DB.
    res.status(201).json({
      data, email, name, service, surname, tel, time, ics, googleCalendarUrl,
    });
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
