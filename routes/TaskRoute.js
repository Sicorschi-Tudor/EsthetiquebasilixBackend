const express = require("express")
const { getTasks, saveTask } = require("../controllers/TaskControllers")

const router = express.Router()

router.get("/", getTasks)
router.get("/get", getTasks)
router.get("/save", saveTask)

module.exports = router
