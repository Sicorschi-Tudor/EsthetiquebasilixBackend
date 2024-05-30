const express = require("express");
const { getTasks, saveTasks } = require("../controllers/TaskControllers");

const router = express.Router();

router.get("/get", getTasks);
router.get("/save", saveTasks);

module.exports = router;
