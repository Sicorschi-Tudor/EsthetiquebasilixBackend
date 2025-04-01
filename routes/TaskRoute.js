const express = require("express");
const {
  getTasks,
  saveTask,
  updateTask,
  deleteTask,
} = require("../controllers/TaskControllers");

const router = express.Router();

router.get("/", getTasks);
router.get("/get", getTasks);
router.post("/save", saveTask);
router.put("/:id", updateTask);
router.delete("/:id", deleteTask);

module.exports = router;
