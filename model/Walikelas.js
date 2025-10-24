// models/Walikelas.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const WaliKelas = sequelize.define('WaliKelas', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    sekolah: {
        type: DataTypes.STRING,
        allowNull: true
    },
    jurusan: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'walikelas',
    timestamps: true
});

// HAPUS associations dari sini, pindahkan ke associations.js

module.exports = WaliKelas;