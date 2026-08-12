const mongoose = require("mongoose");

/**
 * Connects to MongoDB. Takes the URI from the caller so tests can pass an
 * isolated database without touching environment state.
 *
 * @param {string} uri
 */
const connectDB = async (uri) => {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log("MongoDB Connected");
};

module.exports = connectDB;
