import express from "express"
import cors from "cors"
import { v4 as uuidv4 } from "uuid"
import fs from "fs"

const app = express()
app.use(cors())
app.use(express.json())

let reservation = []

// Read reservation data from file
try {
  const data = fs.readFileSync("./reservation.json", "utf8")
  reservation = JSON.parse(data)
} catch (err) {
  console.error("Error reading reservation data:", err)
}

app.get("/", (req, res) => {
  const dataa = fs.readFileSync("./reservation.json", "utf8")
  res.json(JSON.parse(dataa))
})
// Endpoint to get all reservations
app.get("/api/reservation", (req, res) => {
  res.json(reservation)
})

// Endpoint to add a new reservation
app.post("/api/reservation", (req, res) => {
  const newReservation = { id: uuidv4(), ...req.body }
  reservation.push(newReservation)

  // Write reservation data to file
  try {
    fs.writeFileSync("./reservation.json", JSON.stringify(reservation))
    res.status(201).json(newReservation)
  } catch (err) {
    console.error("Error saving reservation data:", err)
    res.status(500).send("Error saving reservation data")
  }
})

const port = 5000
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
