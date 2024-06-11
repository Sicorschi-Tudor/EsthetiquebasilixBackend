const TaskModel = require("../Models/TaskModels");

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
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split("T")[0];

    const record = tasks.find((task) => task.data === nextDayStr);

    if (record) {
      console.log(
        `Record found for ${record.data} at ${record.time}  ${record.email}`
      );
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
