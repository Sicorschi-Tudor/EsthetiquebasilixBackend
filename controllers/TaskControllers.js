const TaskModel = require("../Models/TaskModels.js");

module.exports.getTasks = async (req, res) => {
  const task = await TaskModel.find();
  res.send(task);
};

module.exports.saveTasks = (req, res) => {
  const { task } = req.body;

  TaskModel.create({ task })
    .then((data) => {
      console.log("Saved Succesfully");
      res.status(201).send(data);
    })
    .catch((err) => {
      console.log(err);
      res.send({ err, msg: "something went wrong" });
    });
};
