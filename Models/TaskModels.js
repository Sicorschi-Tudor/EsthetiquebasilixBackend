const mongoose = require("mongoose")

const taskSchema = new mongoose.Schema(
  {
    data: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    service: {
      type: String,
      required: true,
    },
    surname: {
      type: String,
      required: true,
    },
    tel: {
      type: String,
      required: true,
    },
    time: {
      type: String,
      required: true,
    },
  },
  { collection: "db" }
)

module.exports = mongoose.model("Task", taskSchema)
