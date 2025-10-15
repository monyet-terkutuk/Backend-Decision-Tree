// config/database.js
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('freedb_desicion-tree', 'freedb_blackidut', '$fJx99BM6p?R!$V', {
    host: 'sql.freedb.tech',
    port: 3306,
    dialect: 'mysql',
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
});

// Test connection dan sync
sequelize.authenticate()
    .then(() => {
        console.log('MySQL connection has been established successfully.');

        // Sync semua model dengan database
        return sequelize.sync({ force: false }); // force: true akan drop tabel yang ada
    })
    .then(() => {
        console.log('All models were synchronized successfully.');
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
    });

module.exports = sequelize;