// config/database.js
const { Sequelize } = require('sequelize');
const mysql2 = require('mysql2'); // 👈 tambahkan ini

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT, // 👈 PASTIKAN INI ADA
        dialect: 'mysql',
        dialectModule: mysql2, // 👈 GUNAKAN mysql2 untuk SSL support yang better
        pool: {
            max: 5,           // Maximum number of connection in pool
            min: 0,           // Minimum number of connection in pool
            acquire: 30000,   // The maximum time, in milliseconds, that pool will try to get connection before throwing error
            idle: 10000       // The maximum time, in milliseconds, that a connection can be idle before being released
        },
        retry: {
            max: 3            // Maximum number of retries
        },
        logging: false,     // Disable logging to reduce queries
        dialectOptions: {
            connectTimeout: 60000, // Increase timeout
            ssl: { // 👈 TAMBAHKAN KONFIGURASI SSL INI
                rejectUnauthorized: true,
                minVersion: "TLSv1.2"
            }
        }
    }
);

// Test connection dan sync
sequelize.authenticate()
    .then(() => {
        console.log('MySQL connection has been established successfully.');
        return sequelize.sync({ force: false }); // force: true akan drop tabel yang ada
    })
    .then(() => {
        console.log('All models were synchronized successfully.');
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
    });

module.exports = sequelize;