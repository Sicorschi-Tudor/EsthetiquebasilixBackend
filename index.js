import express from "express"
import cors from "cors"
import { v4 as uuidv4 } from "uuid"
import fs from "fs"

const app = express()
app.use(cors())
app.use(express.json())

let reservation = []

fs.readFile("./reservation.json", "utf8", (err, data) => {
  if (err) {
    console.error("Error reading reservation data:", err)
  } else {
    try {
      reservation = JSON.parse(data)
    } catch (parseErr) {
      console.error("Error parsing reservation data:", parseErr)
    }
  }
})

app.get("/", (req, res) => {
  res.send("Server is ready")
})

app.get("/api/reservation", (req, res) => {
  res.json(reservation)
})

app.post("/api/reservation", (req, res) => {
  const newReservation = { id: uuidv4(), ...req.body }
  reservation.push(newReservation)

  fs.writeFile("./reservation.json", JSON.stringify(reservation), err => {
    if (err) {
      console.error("Error saving reservation data:", err)
      res.status(500).send("Error saving reservation data")
    } else {
      res.status(201).json(newReservation)
    }
  })
})

const port = 5000
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
