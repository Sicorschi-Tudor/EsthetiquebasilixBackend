const mongoclient = require("mongodb").MongoClient

const registrationSchema = new mongoclient.Schema({
  name: String,
  surname: String,
  tel: String,
  email: String,
  service: String,
  data: String,
  time: String,
})

module.exports = mongoclient.model("registration", registrationSchema)
