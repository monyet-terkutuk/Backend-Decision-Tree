const app = require("./app");
const cloudinary = require("cloudinary");

// Import sequelize
const sequelize = require('./config/database');

// Handling uncaught Exception
process.on("uncaughtException", (err) => {
  console.log(`Error: ${err.message}`);
  console.log(`shutting down the server for handling uncaught exception`);
});

// config
if (process.env.NODE_ENV !== "PRODUCTION") {
  require("dotenv").config({
    path: "config/.env",
  });
}

// Connect dan sync database
async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    console.log('MySQL Database connected...');

    // Sync tanpa force (tidak hapus data yang ada)
    await sequelize.sync({ force: false });
    console.log('Database synced...');
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

// Panggil fungsi initialize
initializeDatabase();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// create server
const server = app.listen(process.env.PORT, () => {
  console.log(
    `Server is running on http://localhost:${process.env.PORT}`
  );
});

// unhandled promise rejection
process.on("unhandledRejection", (err) => {
  console.log(`Shutting down the server for ${err.message}`);
  console.log(`shutting down the server for unhandle promise rejection`);

  server.close(() => {
    process.exit(1);
  });
});