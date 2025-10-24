// models/associations.js
const User = require('./User');
const WaliKelas = require('./Walikelas');
const Siswa = require('./Siswa');

function setupAssociations() {
    // Associations untuk User dan WaliKelas
    WaliKelas.belongsTo(User, {
        foreignKey: 'user_id',
        as: 'user'
    });

    User.hasOne(WaliKelas, {
        foreignKey: 'user_id',
        as: 'walikelas'
    });

    // Associations untuk WaliKelas dan Siswa
    WaliKelas.hasMany(Siswa, {
        foreignKey: 'walikelas_id',
        as: 'siswas'
    });

    Siswa.belongsTo(WaliKelas, {
        foreignKey: 'walikelas_id',
        as: 'walikelas'
    });

    console.log('All associations setup successfully');
}

module.exports = setupAssociations;