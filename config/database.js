// config/database.js
const { Sequelize } = require('sequelize');
const mysql2 = require('mysql2'); // 👈 tambahkan ini

const sequelize = new Sequelize(
    'freedb_desicion-tree',
    'freedb_blackidut',
    '$fJx99BM6p?R!$V',
    {
        host: 'sql.freedb.tech',
        port: 3306,
        dialect: 'mysql',
        dialectModule: mysql2, // 👈 tambahkan ini supaya Sequelize pakai mysql2 secara eksplisit
        logging: false,
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        },
        define: {
            timestamps: true,
            underscored: false
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
