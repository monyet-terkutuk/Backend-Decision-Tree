const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const Siswa = require('./Siswa');

const Penilaian = sequelize.define('Penilaian', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    siswa_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'siswas',
            key: 'id'
        }
    },
    semester: {
        type: DataTypes.ENUM('ganjil', 'genap'),
        allowNull: false
    },
    tahun: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    matematika: DataTypes.FLOAT,
    ipa: DataTypes.FLOAT,
    ips: DataTypes.FLOAT,
    b_indonesia: DataTypes.FLOAT,
    b_inggris: DataTypes.FLOAT,
    kehadiran: DataTypes.INTEGER,
    prestasi: DataTypes.STRING,
    prediksi: DataTypes.JSON, // hasil dari model Flask disimpan dalam bentuk JSON
}, {
    tableName: 'penilaians',
    timestamps: true,
});

Penilaian.belongsTo(Siswa, { foreignKey: 'siswa_id' });
Siswa.hasMany(Penilaian, { foreignKey: 'siswa_id' });

module.exports = Penilaian;
