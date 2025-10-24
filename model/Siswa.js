// models/Siswa.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Siswa = sequelize.define('Siswa', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    kelas: {
        type: DataTypes.STRING,
        allowNull: false
    },
    tahun: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    semester: {
        type: DataTypes.ENUM('ganjil', 'genap'),
        allowNull: false
    },
    walikelas_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'walikelas',
            key: 'id'
        }
    }
}, {
    tableName: 'siswas',
    timestamps: true,
});

// HAPUS associations dari sini, pindahkan ke associations.js

module.exports = Siswa;