var Express = require("express")
var Mongoclient = require("mongodb").MongoClient
var cors = require("cors")
const multer = require("multer")

var app = Express()
app.use(cors())
app.use(Express.json())

var CONNECTION_STRING =
  "mongodb+srv://aaw1713tudor:Xiaomitudor1.@cluster0.wk7njla.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"

var DATABASENAME = "esthetiquebasilixdb"
var database

app.listen(5000, () => {
  Mongoclient.connect(CONNECTION_STRING, (error, client) => {
    database = client.db(DATABASENAME)
    console.log("Mongo db conection")
  })
})

app.get("/api/registrations", (request, response) => {
  database
    .collection("db")
    .find({})
    .toArray((error, result) => {
      response.send(result)
    })
})

app.post("/api/registrations/add", multer().none(), (request, response) => {
  database.collection("db").countDocuments({}, (error, numOfDocs) => {
    if (error) {
      response.status(500).json({ error: "Database count error" })
      return
    }

    database.collection("db").insertOne(
      {
        id: (numOfDocs + 1).toString(),
        name: request.body.name,
      },
      (err, result) => {
        if (err) {
          response.status(500).json({ error: "Database insert error" })
          return
        }
        response.json({ message: "Added Successfully" })
      }
    )
  })
})
