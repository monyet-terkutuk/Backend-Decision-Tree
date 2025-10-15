// model/Siswa.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

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
    nilai: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    kehadiran: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    prestasi: {
        type: DataTypes.STRING,
        allowNull: true
    },
    walikelas_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    semester: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'siswas',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
});

// Associations
Siswa.belongsTo(User, { foreignKey: 'walikelas_id', as: 'walikelas' });
User.hasMany(Siswa, { foreignKey: 'walikelas_id' });

module.exports = Siswa;