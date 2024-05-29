import express from "express"
import cors from "cors"
import nodemailer from "nodemailer" // Import nodemailer without destructuring
import bodyParser from "body-parser"
import { v4 as uuidv4 } from "uuid"
import fs from "fs"

const app = express()
app.use(cors())
app.use(express.json())
app.use(bodyParser.json())

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

app.post("/api/send-email", async (req, res) => {
  const { name, surname, tel, service, email, data, time } = req.body

  try {
    // Create a transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "companybrizy@gmail.com",
        pass: "Xiaomitudor1.",
      },
    })

    // Send mail with defined transport object
    await transporter.sendMail({
      from: "companybrizy@gmail.com", // sender address
      to: "aaw1713tudor@gmail.com", // list of receivers
      subject: "New Contact Form Submission", // Subject line
      html: `
        <p>Name: ${name}</p>
        <p>Surname: ${surname}</p>
        <p>Telephone: ${tel}</p>
        <p>Email: ${email}</p>
        <p>Service: ${service}</p>
        <p>Date: ${data}</p>
        <p>Time: ${time}</p>
      `, // HTML body
    })

    res.status(200).send("Email sent successfully")
  } catch (error) {
    console.error("Error sending email:", error)
    res.status(500).send("Failed to send email")
  }
})

const port = 5000
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
