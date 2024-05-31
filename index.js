const express = require("express")
const mongoose = require("mongoose")
require("dotenv").config()
const routes = require("./routes/TaskRoute")
const cors = require("cors")

const app = express()
const PORT = process.env.PORT || 5000

app.use(express.json())
app.use(cors())

// Function to start the server
const startServer = async () => {
  try {
    await mongoose.connect(
      "mongodb+srv://aaw1713tudor:7777777AAA@cluster0.wk7njla.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
      {
        dbName: "esthetiquebasilixdb", // Add dbName option to specify the database name
      }
    )

    app.listen(PORT, () => {
      console.log(`Server started on port: ${PORT}`)
    })
  } catch (error) {
    console.error("Failed to connect to MongoDB", error)
    process.exit(1) // Exit the process with failure code
  }
}

startServer()

app.use("/tasks", routes) // Ensure the route is properly prefixed
