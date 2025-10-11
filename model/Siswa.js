const mongoose = require('mongoose');
const { model, Schema } = mongoose;

const siswaSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
        },
        kelas: {
            type: String,
            required: true,
        },
        tahun: {
            type: Number,
            required: true,
        },
        nilai: {
            type: Number,
            required: true
        },
        kehadiran: {
            type: Number,
            required: true
        },
        prestasi: {
            type: String,
        },
        walikelas_id: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        semester: {
            type: String,
            required: true
        },
    },
    { timestamps: true },
);

module.exports = model('Siswa', siswaSchema);
