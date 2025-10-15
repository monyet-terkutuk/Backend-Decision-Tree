// scripts/sync.js
const sequelize = require('../config/database');
const User = require('../model/User');
const Siswa = require('../model/Siswa');

async function syncDatabase() {
    try {
        // Test connection
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');

        // Sync models
        await sequelize.sync({ force: false }); // force: true untuk development (hati-hati!)
        console.log('All models were synchronized successfully.');

        process.exit(0);
    } catch (error) {
        console.error('Unable to sync database:', error);
        process.exit(1);
    }
}

syncDatabase();