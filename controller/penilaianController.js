// controllers/penilaianController.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { Op, Sequelize } = require("sequelize");
const Penilaian = require("../model/Penilaian");
const Siswa = require("../model/Siswa");
const User = require("../model/User");
const WaliKelas = require("../model/Walikelas");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated } = require("../middleware/auth");
// 🔹 TAMBAHKAN MULTER CONFIG DI SINI
const multer = require('multer');
const xlsx = require('xlsx');

// Konfigurasi multer untuk upload file
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: function (req, file, cb) {
        const allowedMimeTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file Excel (.xlsx, .xls) yang diizinkan'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});


// Helper function untuk validasi UUID
const isValidUUID = (id) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
};

// Helper function untuk mendapatkan prediksi dari API
const getPrediction = async (matematika, ipa, ips, b_indonesia, b_inggris, semester) => {
    try {
        const response = await axios.post("https://saving-lemming-loyal.ngrok-free.app", {
            Matematika: matematika,
            IPA: ipa,
            IPS: ips,
            "B.Indonesia": b_indonesia,
            "B.Inggris": b_inggris,
            Semester: semester,
        });
        return response.data.prediksi_semester_berikutnya;
    } catch (error) {
        console.error("Error calling prediction API:", error.message);
        return null;
    }
};

// Helper function untuk menghitung nilai rata-rata dan kategori prestasi
const calculateNilaiRataRata = (matematika, ipa, ips, b_indonesia, b_inggris) => {
    const rataRata = (matematika + ipa + ips + b_indonesia + b_inggris) / 5;

    let kategori;
    if (rataRata >= 90) kategori = "Sangat Baik";
    else if (rataRata >= 80) kategori = "Baik";
    else if (rataRata >= 70) kategori = "Cukup";
    else if (rataRata >= 60) kategori = "Kurang";
    else kategori = "Kurang Sekali";

    return {
        rata_rata: Math.round(rataRata * 100) / 100,
        kategori: kategori
    };
};

// Helper function untuk kategori kehadiran
const getKategoriKehadiran = (kehadiran) => {
    if (kehadiran >= 95) return "Sangat Baik";
    else if (kehadiran >= 85) return "Baik";
    else if (kehadiran >= 75) return "Cukup";
    else if (kehadiran >= 60) return "Kurang";
    else return "Kurang Sekali";
};


// Helper function untuk parse tahun
const parseTahun = (tahunValue) => {
    if (!tahunValue && tahunValue !== 0) return null;

    // Jika sudah number, langsung return
    if (typeof tahunValue === 'number') {
        return tahunValue;
    }

    // Jika string, coba parse
    if (typeof tahunValue === 'string') {
        // Hapus spasi dan karakter non-digit
        const cleaned = tahunValue.toString().trim().replace(/[^\d]/g, '');
        if (cleaned) {
            const tahunNum = parseInt(cleaned);
            // Validasi range tahun (misal: 2000-2100)
            if (!isNaN(tahunNum) && tahunNum >= 2000 && tahunNum <= 2100) {
                return tahunNum;
            }
        }
    }

    return null;
};

// 🔹 TAMBAHKAN HELPER FUNCTION UNTUK GET WALIKELAS ID
const getWaliKelasId = async (userId) => {
    const waliKelas = await WaliKelas.findOne({
        where: { user_id: userId }
    });
    return waliKelas ? waliKelas.id : null;
};

// Helper function untuk parse data prediksi
const parsePrediksiData = (prediksiRaw, semester, tahun) => {
    if (!prediksiRaw) return null;

    try {
        const prediksiParsed = typeof prediksiRaw === 'string'
            ? JSON.parse(prediksiRaw)
            : prediksiRaw;

        console.log("Raw prediksi data:", prediksiParsed);

        // Cek berbagai format prediksi
        let matematika = 0, ipa = 0, ips = 0, b_indonesia = 0, b_inggris = 0;

        // Format 1: Nested object dengan prediksi_semester_berikutnya
        if (prediksiParsed.prediksi_semester_berikutnya) {
            const pred = prediksiParsed.prediksi_semester_berikutnya;
            matematika = pred.Matematika || pred.matematika || 0;
            ipa = pred.IPA || pred.ipa || 0;
            ips = pred.IPS || pred.ips || 0;
            b_indonesia = pred["B.Indonesia"] || pred.b_indonesia || 0;
            b_inggris = pred["B.Inggris"] || pred.b_inggris || 0;
        }
        // Format 2: Langsung berisi nilai
        else if (prediksiParsed.Matematika !== undefined) {
            matematika = prediksiParsed.Matematika;
            ipa = prediksiParsed.IPA;
            ips = prediksiParsed.IPS;
            b_indonesia = prediksiParsed["B.Indonesia"];
            b_inggris = prediksiParsed["B.Inggris"];
        }
        // Format 3: Lowercase
        else if (prediksiParsed.matematika !== undefined) {
            matematika = prediksiParsed.matematika;
            ipa = prediksiParsed.ipa;
            ips = prediksiParsed.ips;
            b_indonesia = prediksiParsed.b_indonesia;
            b_inggris = prediksiParsed.b_inggris;
        }

        const prediksiRataRata = calculateNilaiRataRata(matematika, ipa, ips, b_indonesia, b_inggris);

        return {
            nilai: {
                matematika: matematika,
                ipa: ipa,
                ips: ips,
                b_indonesia: b_indonesia,
                b_inggris: b_inggris,
                rata_rata: prediksiRataRata.rata_rata
            },
            kategori_prestasi: prediksiRataRata.kategori,
            semester_prediksi: `Semester ${semester === 'ganjil' ? 'genap' : 'ganjil'} ${semester === 'ganjil' ? tahun : tahun + 1}`
        };
    } catch (error) {
        console.error("Error parsing prediksi:", error);
        return {
            nilai: null,
            kategori_prestasi: "Error parsing",
            semester_prediksi: "Tidak tersedia",
            error: error.message
        };
    }
};

// 🔹 Create Penilaian dengan prediksi otomatis
router.post(
    "/",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const {
                siswa_id,
                semester,
                tahun,
                matematika,
                ipa,
                ips,
                b_indonesia,
                b_inggris,
                kehadiran,
                prestasi,
            } = req.body;

            // Validasi field required
            if (
                !siswa_id ||
                !semester ||
                !tahun ||
                matematika == null ||
                ipa == null ||
                ips == null ||
                b_indonesia == null ||
                b_inggris == null
            ) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Semua nilai wajib diisi.",
                });
            }

            // Validasi UUID
            if (!isValidUUID(siswa_id)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Invalid siswa ID format",
                });
            }

            // Validasi range nilai (0-100)
            const nilaiFields = { matematika, ipa, ips, b_indonesia, b_inggris };
            for (const [field, value] of Object.entries(nilaiFields)) {
                if (value < 0 || value > 100) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: `Nilai ${field} harus antara 0-100`,
                    });
                }
            }

            // Validasi kehadiran jika ada
            if (kehadiran && (kehadiran < 0 || kehadiran > 100)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Kehadiran harus antara 0-100%",
                });
            }

            // Pastikan siswa ada
            const siswa = await Siswa.findByPk(siswa_id);
            if (!siswa) {
                return res.status(404).json({
                    code: 404,
                    status: "error",
                    message: "Siswa tidak ditemukan.",
                });
            }

            // Cek duplikat penilaian (siswa, semester, tahun)
            const existingPenilaian = await Penilaian.findOne({
                where: {
                    siswa_id,
                    semester,
                    tahun
                }
            });

            if (existingPenilaian) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Penilaian untuk siswa ini pada semester dan tahun tersebut sudah ada.",
                });
            }

            // Hitung nilai rata-rata dan kategori prestasi
            const { rata_rata, kategori } = calculateNilaiRataRata(
                matematika, ipa, ips, b_indonesia, b_inggris
            );

            // Kategori kehadiran
            const kategoriKehadiran = kehadiran ? getKategoriKehadiran(kehadiran) : null;

            // 🔹 Dapatkan prediksi dari API
            let prediksi = null;
            try {
                prediksi = await getPrediction(matematika, ipa, ips, b_indonesia, b_inggris, semester);
            } catch (error) {
                console.error("Prediction API error:", error.message);
                // Tetap lanjut tanpa prediksi
            }

            // 🔹 Simpan ke database (TANPA field calculated)
            const penilaian = await Penilaian.create({
                id: uuidv4(),
                siswa_id,
                semester,
                tahun,
                matematika,
                ipa,
                ips,
                b_indonesia,
                b_inggris,
                kehadiran,
                prestasi: prestasi || kategori,
                prediksi,
                created_by: req.user.id
            });

            // Get data dengan include
            const penilaianWithSiswa = await Penilaian.findByPk(penilaian.id, {
                include: [{
                    model: Siswa,
                    attributes: ['id', 'name', 'kelas'],
                    include: [{
                        model: WaliKelas,
                        as: 'walikelas',
                        attributes: ['id', 'sekolah', 'jurusan'],
                        include: [{
                            model: User,
                            as: 'user',
                            attributes: ['id', 'name', 'email']
                        }]
                    }]
                }]
            });

            // Parse data prediksi untuk response
            const prediksiData = parsePrediksiData(prediksi, semester, tahun);

            // Format response dengan perhitungan manual
            const responseData = {
                id: penilaianWithSiswa.id,
                siswa_id: penilaianWithSiswa.siswa_id,
                periode: {
                    semester: penilaianWithSiswa.semester,
                    tahun: penilaianWithSiswa.tahun,
                    label: `Semester ${penilaianWithSiswa.semester} ${penilaianWithSiswa.tahun}`
                },
                data_aktual: {
                    nilai: {
                        matematika: penilaianWithSiswa.matematika,
                        ipa: penilaianWithSiswa.ipa,
                        ips: penilaianWithSiswa.ips,
                        b_indonesia: penilaianWithSiswa.b_indonesia,
                        b_inggris: penilaianWithSiswa.b_inggris,
                        rata_rata: rata_rata
                    },
                    kehadiran: penilaianWithSiswa.kehadiran,
                    kategori: {
                        prestasi: kategori,
                        kehadiran: kategoriKehadiran
                    },
                    prestasi: prestasi || kategori
                },
                data_prediksi: prediksiData,
                perbandingan: prediksiData && prediksiData.nilai ? {
                    selisih_rata_rata: Math.round((prediksiData.nilai.rata_rata - rata_rata) * 100) / 100,
                    tren: prediksiData.nilai.rata_rata > rata_rata ? "Meningkat" :
                        prediksiData.nilai.rata_rata < rata_rata ? "Menurun" : "Stabil",
                    confidence: "Tinggi"
                } : null,
                metadata: {
                    created_at: penilaianWithSiswa.createdAt,
                    updated_at: penilaianWithSiswa.updatedAt
                }
            };

            // Tambahkan data siswa dan walikelas jika ada
            if (penilaianWithSiswa.Siswa) {
                responseData.siswa = {
                    id: penilaianWithSiswa.Siswa.id,
                    name: penilaianWithSiswa.Siswa.name,
                    kelas: penilaianWithSiswa.Siswa.kelas
                };

                if (penilaianWithSiswa.Siswa.walikelas) {
                    responseData.walikelas = {
                        id: penilaianWithSiswa.Siswa.walikelas.id,
                        sekolah: penilaianWithSiswa.Siswa.walikelas.sekolah,
                        jurusan: penilaianWithSiswa.Siswa.walikelas.jurusan,
                        user: penilaianWithSiswa.Siswa.walikelas.user ? {
                            id: penilaianWithSiswa.Siswa.walikelas.user.id,
                            name: penilaianWithSiswa.Siswa.walikelas.user.name,
                            email: penilaianWithSiswa.Siswa.walikelas.user.email
                        } : null
                    };
                }
            }

            res.status(201).json({
                code: 201,
                status: "success",
                message: "Penilaian berhasil disimpan.",
                data: responseData
            });
        } catch (error) {
            console.error("Error:", error.message);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat menyimpan penilaian.",
                error: error.message,
            });
        }
    })
);

// 🔹 Get All Penilaian dengan filter dan pagination
router.get(
    "/list",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const {
                page = 1,
                limit = 10,
                siswa_id,
                kelas,
                semester,
                tahun,
                search
            } = req.query;

            let whereCondition = {};
            let siswaWhereCondition = {};

            // Filter berdasarkan siswa_id
            if (siswa_id) {
                if (!isValidUUID(siswa_id)) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: "Invalid siswa ID format",
                    });
                }
                whereCondition.siswa_id = siswa_id;
            }

            // Filter berdasarkan kelas
            if (kelas) {
                siswaWhereCondition.kelas = kelas;
            }

            // Filter berdasarkan semester
            if (semester) {
                whereCondition.semester = semester;
            }

            // Filter berdasarkan tahun
            if (tahun) {
                whereCondition.tahun = parseInt(tahun);
            }

            // Filter berdasarkan pencarian nama siswa
            if (search) {
                if (search.length < 2) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: "Search query must be at least 2 characters long",
                    });
                }
                siswaWhereCondition.name = { [Op.like]: `%${search}%` };
            }

            // Pagination
            const pageNumber = parseInt(page);
            const pageSize = parseInt(limit);
            const offset = (pageNumber - 1) * pageSize;

            // Hitung total data
            const totalPenilaian = await Penilaian.count({
                include: [{
                    model: Siswa,
                    where: siswaWhereCondition,
                    attributes: []
                }]
            });

            const totalPages = Math.ceil(totalPenilaian / pageSize);

            // Get data dengan pagination
            const penilaianList = await Penilaian.findAll({
                where: whereCondition,
                include: [{
                    model: Siswa,
                    where: siswaWhereCondition,
                    attributes: ['id', 'name', 'kelas'],
                    include: [{
                        model: WaliKelas,
                        as: 'walikelas',
                        attributes: ['id', 'sekolah', 'jurusan'],
                        include: [{
                            model: User,
                            as: 'user',
                            attributes: ['id', 'name', 'email']
                        }]
                    }]
                }],
                order: [
                    ['tahun', 'DESC'],
                    ['semester', 'DESC'],
                    ['createdAt', 'DESC']
                ],
                offset: offset,
                limit: pageSize
            });

            // Format response data dengan perhitungan manual
            const formattedPenilaian = penilaianList.map((item) => {
                // Hitung nilai rata-rata dan kategori secara manual untuk data AKTUAL
                const { rata_rata, kategori } = calculateNilaiRataRata(
                    item.matematika, item.ipa, item.ips, item.b_indonesia, item.b_inggris
                );

                const kategoriKehadiran = item.kehadiran ? getKategoriKehadiran(item.kehadiran) : null;

                // Parse data prediksi
                const prediksiData = parsePrediksiData(item.prediksi, item.semester, item.tahun);

                const data = {
                    id: item.id,
                    siswa_id: item.siswa_id,
                    periode: {
                        semester: item.semester,
                        tahun: item.tahun,
                        label: `Semester ${item.semester} ${item.tahun}`
                    },
                    data_aktual: {
                        nilai: {
                            matematika: item.matematika,
                            ipa: item.ipa,
                            ips: item.ips,
                            b_indonesia: item.b_indonesia,
                            b_inggris: item.b_inggris,
                            rata_rata: rata_rata
                        },
                        kehadiran: item.kehadiran,
                        kategori: {
                            prestasi: kategori,
                            kehadiran: kategoriKehadiran
                        },
                        prestasi: item.prestasi || kategori
                    },
                    data_prediksi: prediksiData,
                    perbandingan: prediksiData && prediksiData.nilai ? {
                        selisih_rata_rata: Math.round((prediksiData.nilai.rata_rata - rata_rata) * 100) / 100,
                        tren: prediksiData.nilai.rata_rata > rata_rata ? "Meningkat" :
                            prediksiData.nilai.rata_rata < rata_rata ? "Menurun" : "Stabil",
                        confidence: "Tinggi"
                    } : null,
                    metadata: {
                        created_at: item.createdAt,
                        updated_at: item.updatedAt
                    }
                };

                // Tambahkan data siswa jika ada
                if (item.Siswa) {
                    data.siswa = {
                        id: item.Siswa.id,
                        name: item.Siswa.name,
                        kelas: item.Siswa.kelas
                    };

                    if (item.Siswa.walikelas) {
                        data.walikelas = {
                            id: item.Siswa.walikelas.id,
                            sekolah: item.Siswa.walikelas.sekolah,
                            jurusan: item.Siswa.walikelas.jurusan,
                            user: item.Siswa.walikelas.user ? {
                                id: item.Siswa.walikelas.user.id,
                                name: item.Siswa.walikelas.user.name,
                                email: item.Siswa.walikelas.user.email
                            } : null
                        };
                    }
                }

                return data;
            });

            // Hitung statistik secara manual
            let totalRataRataAktual = 0;
            let totalRataRataPrediksi = 0;
            let totalKehadiran = 0;
            let countWithKehadiran = 0;
            let countWithPrediksi = 0;
            const prestasiDistributionAktual = {};
            const prestasiDistributionPrediksi = {};

            penilaianList.forEach(item => {
                const { rata_rata: rataRataAktual, kategori: kategoriAktual } = calculateNilaiRataRata(
                    item.matematika, item.ipa, item.ips, item.b_indonesia, item.b_inggris
                );

                totalRataRataAktual += rataRataAktual;

                if (item.kehadiran) {
                    totalKehadiran += item.kehadiran;
                    countWithKehadiran++;
                }

                prestasiDistributionAktual[kategoriAktual] = (prestasiDistributionAktual[kategoriAktual] || 0) + 1;

                // Hitung untuk data prediksi jika ada
                if (item.prediksi) {
                    const prediksiData = parsePrediksiData(item.prediksi, item.semester, item.tahun);
                    if (prediksiData && prediksiData.nilai) {
                        totalRataRataPrediksi += prediksiData.nilai.rata_rata;
                        countWithPrediksi++;
                        prestasiDistributionPrediksi[prediksiData.kategori_prestasi] = (prestasiDistributionPrediksi[prediksiData.kategori_prestasi] || 0) + 1;
                    }
                }
            });

            const avgRataRataAktual = penilaianList.length > 0 ? totalRataRataAktual / penilaianList.length : 0;
            const avgRataRataPrediksi = countWithPrediksi > 0 ? totalRataRataPrediksi / countWithPrediksi : 0;
            const avgKehadiran = countWithKehadiran > 0 ? totalKehadiran / countWithKehadiran : 0;

            // Format distribusi prestasi
            const formattedPrestasiDistributionAktual = Object.entries(prestasiDistributionAktual).map(([kategori, count]) => ({
                kategori,
                count,
                persentase: Math.round((count / penilaianList.length) * 100)
            }));

            const formattedPrestasiDistributionPrediksi = Object.entries(prestasiDistributionPrediksi).map(([kategori, count]) => ({
                kategori,
                count,
                persentase: countWithPrediksi > 0 ? Math.round((count / countWithPrediksi) * 100) : 0
            }));

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Data penilaian berhasil diambil",
                data: {
                    pagination: {
                        currentPage: pageNumber,
                        totalPages: totalPages,
                        totalItems: totalPenilaian,
                        pageSize: pageSize,
                        hasNext: pageNumber < totalPages,
                        hasPrev: pageNumber > 1
                    },
                    statistics: {
                        total_penilaian: totalPenilaian,
                        total_dengan_prediksi: countWithPrediksi,
                        rata_rata: {
                            aktual: Math.round(avgRataRataAktual * 100) / 100,
                            prediksi: Math.round(avgRataRataPrediksi * 100) / 100,
                            selisih: Math.round((avgRataRataPrediksi - avgRataRataAktual) * 100) / 100
                        },
                        kehadiran: {
                            rata_rata: Math.round(avgKehadiran * 100) / 100
                        },
                        distribusi_prestasi: {
                            aktual: formattedPrestasiDistributionAktual,
                            prediksi: formattedPrestasiDistributionPrediksi
                        }
                    },
                    filters: {
                        siswa_id: siswa_id || 'Semua',
                        kelas: kelas || 'Semua',
                        semester: semester || 'Semua',
                        tahun: tahun || 'Semua',
                        search: search || ''
                    },
                    penilaian: formattedPenilaian
                }
            });
        } catch (error) {
            console.error("Error in get penilaian:", error);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Gagal mengambil data penilaian.",
                error: error.message,
            });
        }
    })
);

// controllers/penilaianController.js - Tambahkan endpoint import nilai

// ✅ Import Nilai Siswa dari Excel
router.post(
    "/import",
    isAuthenticated,
    upload.single('file'),
    catchAsyncErrors(async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "File Excel harus diupload",
                });
            }

            // Dapatkan walikelas_id berdasarkan user yang login
            const walikelas_id = await getWaliKelasId(req.user.id);

            if (!walikelas_id) {
                return res.status(404).json({
                    code: 404,
                    status: "error",
                    message: "Data wali kelas tidak ditemukan untuk user ini",
                });
            }

            const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(worksheet);

            if (data.length === 0) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "File Excel kosong atau format tidak sesuai",
                });
            }

            // Validasi kolom required
            const requiredColumns = [
                'Nama Siswa',
                'Kehadiran',
                'Nilai Matematika',
                'Nilai IPA',
                'Nilai B.Inggris',
                'Nilai IPS',
                'Nilai B.Indonesia',
                'Kelas',
                'Semester',
                'Tahun'
            ];

            const firstRow = data[0];
            const missingColumns = requiredColumns.filter(col => !firstRow.hasOwnProperty(col));

            if (missingColumns.length > 0) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: `Kolom yang diperlukan tidak ditemukan: ${missingColumns.join(', ')}`,
                });
            }

            const results = {
                total: data.length,
                success: 0,
                failed: 0,
                errors: [],
                details: {
                    siswa_dibuat: 0,
                    siswa_digunakan: 0,
                    penilaian_dibuat: 0,
                    penilaian_duplikat: 0
                }
            };

            // Process each row
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const rowNumber = i + 2;

                try {
                    // Validasi data required
                    if (!row['Nama Siswa'] || !row['Kelas'] || !row['Semester'] || !row['Tahun']) {
                        results.errors.push(`Baris ${rowNumber}: Data siswa tidak lengkap (Nama, Kelas, Semester, Tahun wajib diisi)`);
                        results.failed++;
                        continue;
                    }

                    // Validasi nilai numerik
                    const tahun = parseTahun(row['Tahun']);
                    if (tahun === null) {
                        results.errors.push(`Baris ${rowNumber}: Tahun harus berupa angka`);
                        results.failed++;
                        continue;
                    }

                    const semester = row['Semester'].toLowerCase();
                    if (!['ganjil', 'genap'].includes(semester)) {
                        results.errors.push(`Baris ${rowNumber}: Semester harus 'ganjil' atau 'genap'`);
                        results.failed++;
                        continue;
                    }

                    // Validasi nilai mata pelajaran
                    const nilaiFields = {
                        matematika: row['Nilai Matematika'],
                        ipa: row['Nilai IPA'],
                        b_inggris: row['Nilai B.Inggris'],
                        ips: row['Nilai IPS'],
                        b_indonesia: row['Nilai B.Indonesia']
                    };

                    // Cek jika nilai valid
                    for (const [field, value] of Object.entries(nilaiFields)) {
                        if (value === undefined || value === null || value === '') {
                            results.errors.push(`Baris ${rowNumber}: Nilai ${field} tidak boleh kosong`);
                            results.failed++;
                            continue;
                        }

                        const nilaiNum = parseFloat(value);
                        if (isNaN(nilaiNum) || nilaiNum < 0 || nilaiNum > 100) {
                            results.errors.push(`Baris ${rowNumber}: Nilai ${field} harus antara 0-100`);
                            results.failed++;
                            continue;
                        }
                        nilaiFields[field] = nilaiNum;
                    }

                    // Validasi kehadiran
                    const kehadiran = parseInt(row['Kehadiran']);
                    if (isNaN(kehadiran) || kehadiran < 0 || kehadiran > 365) {
                        results.errors.push(`Baris ${rowNumber}: Kehadiran harus antara 0-365 hari`);
                        results.failed++;
                        continue;
                    }

                    // Cari atau buat siswa
                    let siswa = await Siswa.findOne({
                        where: {
                            name: row['Nama Siswa'],
                            kelas: row['Kelas'],
                            walikelas_id: walikelas_id
                        }
                    });

                    if (!siswa) {
                        // Buat siswa baru jika belum ada
                        siswa = await Siswa.create({
                            id: uuidv4(),
                            name: row['Nama Siswa'],
                            kelas: row['Kelas'],
                            tahun: tahun,
                            semester: semester,
                            walikelas_id: walikelas_id
                        });
                        results.details.siswa_dibuat++;
                    } else {
                        results.details.siswa_digunakan++;
                    }

                    // Cek duplikat penilaian
                    const existingPenilaian = await Penilaian.findOne({
                        where: {
                            siswa_id: siswa.id,
                            semester: semester,
                            tahun: tahun
                        }
                    });

                    if (existingPenilaian) {
                        results.errors.push(`Baris ${rowNumber}: Penilaian untuk ${row['Nama Siswa']} (${semester} ${tahun}) sudah ada`);
                        results.details.penilaian_duplikat++;
                        results.failed++;
                        continue;
                    }

                    // Hitung nilai rata-rata dan kategori
                    const { rata_rata, kategori } = calculateNilaiRataRata(
                        nilaiFields.matematika,
                        nilaiFields.ipa,
                        nilaiFields.ips,
                        nilaiFields.b_indonesia,
                        nilaiFields.b_inggris
                    );

                    const kategoriKehadiran = getKategoriKehadiran((kehadiran / 365) * 100); // Convert to percentage

                    // Dapatkan prediksi dari API
                    let prediksi = null;
                    try {
                        prediksi = await getPrediction(
                            nilaiFields.matematika,
                            nilaiFields.ipa,
                            nilaiFields.ips,
                            nilaiFields.b_indonesia,
                            nilaiFields.b_inggris,
                            semester
                        );
                    } catch (error) {
                        console.error(`Prediction API error for row ${rowNumber}:`, error.message);
                        // Tetap lanjut tanpa prediksi
                    }

                    // Simpan penilaian
                    await Penilaian.create({
                        id: uuidv4(),
                        siswa_id: siswa.id,
                        semester: semester,
                        tahun: tahun,
                        matematika: nilaiFields.matematika,
                        ipa: nilaiFields.ipa,
                        ips: nilaiFields.ips,
                        b_indonesia: nilaiFields.b_indonesia,
                        b_inggris: nilaiFields.b_inggris,
                        kehadiran: kehadiran,
                        prestasi: kategori,
                        prediksi: prediksi,
                        created_by: req.user.id
                    });

                    results.success++;
                    results.details.penilaian_dibuat++;

                } catch (error) {
                    console.error(`Error processing row ${rowNumber}:`, error);
                    results.errors.push(`Baris ${rowNumber}: ${error.message}`);
                    results.failed++;
                }
            }

            // Response hasil import
            res.status(200).json({
                code: 200,
                status: "success",
                message: `Import nilai selesai. Berhasil: ${results.success}, Gagal: ${results.failed}`,
                data: {
                    summary: {
                        total: results.total,
                        success: results.success,
                        failed: results.failed
                    },
                    details: results.details,
                    errors: results.errors.slice(0, 20) // Batasi error yang ditampilkan
                }
            });

        } catch (error) {
            console.error("Error in import nilai:", error);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat import data nilai",
                error: error.message
            });
        }
    })
);

// ✅ Download Template Import Nilai
router.get(
    "/import/template",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            // Buat workbook baru
            const workbook = xlsx.utils.book_new();

            // Data contoh untuk template
            const templateData = [
                {
                    'Nama Siswa': 'Contoh: Vania Melati',
                    'Kehadiran': 'Contoh: 108 (jumlah hari hadir, 0-365)',
                    'Nilai Matematika': 'Contoh: 85 (angka, 0-100)',
                    'Nilai IPA': 'Contoh: 91 (angka, 0-100)',
                    'Nilai B.Inggris': 'Contoh: 83 (angka, 0-100)',
                    'Nilai IPS': 'Contoh: 90 (angka, 0-100)',
                    'Nilai B.Indonesia': 'Contoh: 95 (angka, 0-100)',
                    'Kelas': 'Contoh: 2',
                    'Semester': 'Contoh: Ganjil',
                    'Tahun': 'Contoh: 2025'
                },
                {
                    'Nama Siswa': 'Vania Melati',
                    'Kehadiran': 108,
                    'Nilai Matematika': 85,
                    'Nilai IPA': 91,
                    'Nilai B.Inggris': 83,
                    'Nilai IPS': 90,
                    'Nilai B.Indonesia': 95,
                    'Kelas': '2',
                    'Semester': 'Ganjil',
                    'Tahun': 2025
                },
                {
                    'Nama Siswa': 'Bima Saputra',
                    'Kehadiran': 103,
                    'Nilai Matematika': 90,
                    'Nilai IPA': 85,
                    'Nilai B.Inggris': 88,
                    'Nilai IPS': 90,
                    'Nilai B.Indonesia': 92,
                    'Kelas': '2',
                    'Semester': 'Ganjil',
                    'Tahun': 2025
                }
            ];

            // Buat worksheet
            const worksheet = xlsx.utils.json_to_sheet(templateData);

            // Tambahkan worksheet ke workbook
            xlsx.utils.book_append_sheet(workbook, worksheet, 'Template Nilai Siswa');

            // Set header untuk download
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=template-import-nilai-siswa.xlsx');

            // Generate file dan kirim sebagai response
            const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            res.send(buffer);

        } catch (error) {
            console.error("Error generating template:", error);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat generate template",
                error: error.message
            });
        }
    })
);

// controllers/penilaianController.js - Tambahkan endpoint export

// ✅ Export Data Penilaian ke Excel
router.get(
    "/export",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const {
                page = 1,
                limit = 1000, // Default limit besar untuk export
                siswa_id,
                kelas,
                semester,
                tahun,
                search
            } = req.query;

            let whereCondition = {};
            let siswaWhereCondition = {};

            // Filter berdasarkan siswa_id
            if (siswa_id) {
                if (!isValidUUID(siswa_id)) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: "Invalid siswa ID format",
                    });
                }
                whereCondition.siswa_id = siswa_id;
            }

            // Filter berdasarkan kelas
            if (kelas) {
                siswaWhereCondition.kelas = kelas;
            }

            // Filter berdasarkan semester
            if (semester) {
                whereCondition.semester = semester;
            }

            // Filter berdasarkan tahun
            const tahunParsed = parseTahun(tahun);
            if (tahunParsed !== null) {
                whereCondition.tahun = tahunParsed;
            }

            // Filter berdasarkan pencarian nama siswa
            if (search && search.length >= 2) {
                siswaWhereCondition.name = { [Op.like]: `%${search}%` };
            }

            // Untuk wali kelas, hanya tampilkan siswa mereka sendiri
            if (req.user.role === 'walikelas') {
                const walikelas_id = await getWaliKelasId(req.user.id);
                if (walikelas_id) {
                    // Tambahkan kondisi untuk siswa yang memiliki walikelas_id yang sama
                    const siswaWaliKelas = await Siswa.findAll({
                        where: { walikelas_id: walikelas_id },
                        attributes: ['id']
                    });
                    const siswaIds = siswaWaliKelas.map(siswa => siswa.id);
                    whereCondition.siswa_id = { [Op.in]: siswaIds };
                }
            }

            // Pagination untuk export (bisa besar)
            const pageNumber = parseInt(page) || 1;
            const pageSize = Math.min(parseInt(limit) || 1000, 5000); // Max 5000 records
            const offset = (pageNumber - 1) * pageSize;

            // Get data dengan pagination
            const penilaianList = await Penilaian.findAll({
                where: whereCondition,
                include: [{
                    model: Siswa,
                    where: siswaWhereCondition,
                    attributes: ['id', 'name', 'kelas'],
                    include: [{
                        model: WaliKelas,
                        as: 'walikelas',
                        attributes: ['id', 'sekolah', 'jurusan'],
                        include: [{
                            model: User,
                            as: 'user',
                            attributes: ['id', 'name', 'email']
                        }]
                    }]
                }],
                order: [
                    ['tahun', 'DESC'],
                    ['semester', 'DESC'],
                    [Siswa, 'kelas', 'ASC'],
                    [Siswa, 'name', 'ASC']
                ],
                offset: offset,
                limit: pageSize
            });

            // Format data untuk Excel
            const exportData = penilaianList.map((item) => {
                // Hitung nilai rata-rata dan kategori secara manual
                const { rata_rata, kategori } = calculateNilaiRataRata(
                    item.matematika, item.ipa, item.ips, item.b_indonesia, item.b_inggris
                );

                const kategoriKehadiran = item.kehadiran ? getKategoriKehadiran(item.kehadiran) : null;

                // Parse data prediksi jika ada
                let prediksiData = null;
                if (item.prediksi) {
                    try {
                        const prediksiParsed = typeof item.prediksi === 'string'
                            ? JSON.parse(item.prediksi)
                            : item.prediksi;

                        if (prediksiParsed.prediksi_semester_berikutnya) {
                            prediksiData = prediksiParsed.prediksi_semester_berikutnya;
                        } else {
                            prediksiData = prediksiParsed;
                        }
                    } catch (error) {
                        console.error("Error parsing prediksi for export:", error);
                    }
                }

                return {
                    // Data Siswa
                    'Nama Siswa': item.Siswa?.name || '-',
                    'Kelas': item.Siswa?.kelas || '-',
                    'Wali Kelas': item.Siswa?.walikelas?.user?.name || '-',

                    // Periode
                    'Tahun Ajaran': item.tahun,
                    'Semester': item.semester,

                    // Nilai Aktual
                    'Kehadiran (Hari)': item.kehadiran || 0,
                    'Persentase Kehadiran (%)': item.kehadiran ? Math.round((item.kehadiran / 365) * 100) : 0,
                    'Kategori Kehadiran': kategoriKehadiran || '-',

                    'Nilai Matematika': item.matematika,
                    'Nilai IPA': item.ipa,
                    'Nilai IPS': item.ips,
                    'Nilai Bahasa Indonesia': item.b_indonesia,
                    'Nilai Bahasa Inggris': item.b_inggris,

                    'Rata-rata Nilai': rata_rata,
                    'Kategori Prestasi': kategori,
                    'Prestasi': item.prestasi || kategori,

                    // Data Prediksi
                    'Prediksi Matematika': prediksiData?.Matematika || prediksiData?.matematika || '-',
                    'Prediksi IPA': prediksiData?.IPA || prediksiData?.ipa || '-',
                    'Prediksi IPS': prediksiData?.IPS || prediksiData?.ips || '-',
                    'Prediksi Bahasa Indonesia': prediksiData?.["B.Indonesia"] || prediksiData?.b_indonesia || '-',
                    'Prediksi Bahasa Inggris': prediksiData?.["B.Inggris"] || prediksiData?.b_inggris || '-',

                    'Rata-rata Prediksi': prediksiData ? calculateNilaiRataRata(
                        prediksiData.Matematika || prediksiData.matematika || 0,
                        prediksiData.IPA || prediksiData.ipa || 0,
                        prediksiData.IPS || prediksiData.ips || 0,
                        prediksiData["B.Indonesia"] || prediksiData.b_indonesia || 0,
                        prediksiData["B.Inggris"] || prediksiData.b_inggris || 0
                    ).rata_rata : '-',

                    // Metadata
                    'Tanggal Input': item.createdAt ? new Date(item.createdAt).toLocaleDateString('id-ID') : '-',
                    'Diupdate Pada': item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('id-ID') : '-'
                };
            });

            // Buat workbook baru
            const workbook = xlsx.utils.book_new();

            // Data utama
            const worksheet = xlsx.utils.json_to_sheet(exportData);
            xlsx.utils.book_append_sheet(workbook, worksheet, 'Data Penilaian');

            // Buat worksheet untuk summary
            const summaryData = [
                { 'Keterangan': 'Total Data', 'Nilai': exportData.length },
                { 'Keterangan': 'Tanggal Export', 'Nilai': new Date().toLocaleDateString('id-ID') },
                { 'Keterangan': 'Filter Kelas', 'Nilai': kelas || 'Semua' },
                { 'Keterangan': 'Filter Semester', 'Nilai': semester || 'Semua' },
                { 'Keterangan': 'Filter Tahun', 'Nilai': tahun || 'Semua' },
                { 'Keterangan': 'Pencarian', 'Nilai': search || 'Semua' }
            ];

            const summaryWorksheet = xlsx.utils.json_to_sheet(summaryData);
            xlsx.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');

            // Generate filename dengan timestamp dan filter
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            let filename = `data-penilaian-${timestamp}`;

            if (kelas) filename += `-kelas-${kelas}`;
            if (semester) filename += `-semester-${semester}`;
            if (tahun) filename += `-tahun-${tahun}`;

            filename += '.xlsx';

            // Set header untuk download
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

            // Generate file dan kirim sebagai response
            const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            res.send(buffer);

        } catch (error) {
            console.error("Error in export penilaian:", error);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat export data penilaian",
                error: error.message
            });
        }
    })
);

// ✅ Export Data Penilaian Sederhana (Format Ringkas)
router.get(
    "/export/simple",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const {
                kelas,
                semester,
                tahun,
                search
            } = req.query;

            let whereCondition = {};
            let siswaWhereCondition = {};

            // Filter berdasarkan kelas
            if (kelas) {
                siswaWhereCondition.kelas = kelas;
            }

            // Filter berdasarkan semester
            if (semester) {
                whereCondition.semester = semester;
            }

            // Filter berdasarkan tahun
            const tahunParsed = parseTahun(tahun);
            if (tahunParsed !== null) {
                whereCondition.tahun = tahunParsed;
            }

            // Filter berdasarkan pencarian nama siswa
            if (search && search.length >= 2) {
                siswaWhereCondition.name = { [Op.like]: `%${search}%` };
            }

            // Untuk wali kelas, hanya tampilkan siswa mereka sendiri
            if (req.user.role === 'walikelas') {
                const walikelas_id = await getWaliKelasId(req.user.id);
                if (walikelas_id) {
                    const siswaWaliKelas = await Siswa.findAll({
                        where: { walikelas_id: walikelas_id },
                        attributes: ['id']
                    });
                    const siswaIds = siswaWaliKelas.map(siswa => siswa.id);
                    whereCondition.siswa_id = { [Op.in]: siswaIds };
                }
            }

            // Get semua data tanpa pagination untuk export sederhana
            const penilaianList = await Penilaian.findAll({
                where: whereCondition,
                include: [{
                    model: Siswa,
                    where: siswaWhereCondition,
                    attributes: ['id', 'name', 'kelas']
                }],
                order: [
                    ['tahun', 'DESC'],
                    ['semester', 'DESC'],
                    [Siswa, 'kelas', 'ASC'],
                    [Siswa, 'name', 'ASC']
                ]
            });

            // Format data sederhana untuk Excel
            const exportData = penilaianList.map((item) => {
                const { rata_rata, kategori } = calculateNilaiRataRata(
                    item.matematika, item.ipa, item.ips, item.b_indonesia, item.b_inggris
                );

                return {
                    'Nama Siswa': item.Siswa?.name || '-',
                    'Kelas': item.Siswa?.kelas || '-',
                    'Tahun': item.tahun,
                    'Semester': item.semester,
                    'Kehadiran': item.kehadiran || 0,
                    'Matematika': item.matematika,
                    'IPA': item.ipa,
                    'IPS': item.ips,
                    'Bahasa Indonesia': item.b_indonesia,
                    'Bahasa Inggris': item.b_inggris,
                    'Rata-rata': rata_rata,
                    'Kategori': kategori,
                    'Prestasi': item.prestasi || kategori
                };
            });

            // Buat workbook
            const workbook = xlsx.utils.book_new();
            const worksheet = xlsx.utils.json_to_sheet(exportData);
            xlsx.utils.book_append_sheet(workbook, worksheet, 'Data Nilai');

            // Generate filename
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            let filename = `data-nilai-sederhana-${timestamp}`;

            if (kelas) filename += `-kelas-${kelas}`;
            if (semester) filename += `-semester-${semester}`;
            if (tahun) filename += `-tahun-${tahun}`;

            filename += '.xlsx';

            // Set header untuk download
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

            // Generate file dan kirim
            const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            res.send(buffer);

        } catch (error) {
            console.error("Error in export simple penilaian:", error);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat export data penilaian sederhana",
                error: error.message
            });
        }
    })
);

// 🔹 Get Penilaian by ID
router.get(
    "/:id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidUUID(id)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Invalid penilaian ID format",
                });
            }

            const penilaian = await Penilaian.findByPk(id, {
                include: [{
                    model: Siswa,
                    attributes: ['id', 'name', 'kelas'],
                    include: [{
                        model: WaliKelas,
                        as: 'walikelas',
                        attributes: ['id', 'sekolah', 'jurusan'],
                        include: [{
                            model: User,
                            as: 'user',
                            attributes: ['id', 'name', 'email']
                        }]
                    }]
                }]
            });

            if (!penilaian) {
                return res.status(404).json({
                    code: 404,
                    status: "error",
                    message: "Penilaian tidak ditemukan.",
                });
            }

            // Hitung nilai rata-rata dan kategori secara manual
            const { rata_rata, kategori } = calculateNilaiRataRata(
                penilaian.matematika, penilaian.ipa, penilaian.ips, penilaian.b_indonesia, penilaian.b_inggris
            );

            const kategoriKehadiran = penilaian.kehadiran ? getKategoriKehadiran(penilaian.kehadiran) : null;

            // Parse data prediksi
            const prediksiData = parsePrediksiData(penilaian.prediksi, penilaian.semester, penilaian.tahun);

            // Format response
            const responseData = {
                id: penilaian.id,
                siswa_id: penilaian.siswa_id,
                periode: {
                    semester: penilaian.semester,
                    tahun: penilaian.tahun,
                    label: `Semester ${penilaian.semester} ${penilaian.tahun}`
                },
                data_aktual: {
                    nilai: {
                        matematika: penilaian.matematika,
                        ipa: penilaian.ipa,
                        ips: penilaian.ips,
                        b_indonesia: penilaian.b_indonesia,
                        b_inggris: penilaian.b_inggris,
                        rata_rata: rata_rata
                    },
                    kehadiran: penilaian.kehadiran,
                    kategori: {
                        prestasi: kategori,
                        kehadiran: kategoriKehadiran
                    },
                    prestasi: penilaian.prestasi || kategori
                },
                data_prediksi: prediksiData,
                perbandingan: prediksiData && prediksiData.nilai ? {
                    selisih_rata_rata: Math.round((prediksiData.nilai.rata_rata - rata_rata) * 100) / 100,
                    tren: prediksiData.nilai.rata_rata > rata_rata ? "Meningkat" :
                        prediksiData.nilai.rata_rata < rata_rata ? "Menurun" : "Stabil",
                    confidence: "Tinggi"
                } : null,
                metadata: {
                    created_at: penilaian.createdAt,
                    updated_at: penilaian.updatedAt
                }
            };

            // Tambahkan data siswa dan walikelas jika ada
            if (penilaian.Siswa) {
                responseData.siswa = {
                    id: penilaian.Siswa.id,
                    name: penilaian.Siswa.name,
                    kelas: penilaian.Siswa.kelas
                };

                if (penilaian.Siswa.walikelas) {
                    responseData.walikelas = {
                        id: penilaian.Siswa.walikelas.id,
                        sekolah: penilaian.Siswa.walikelas.sekolah,
                        jurusan: penilaian.Siswa.walikelas.jurusan,
                        user: penilaian.Siswa.walikelas.user ? {
                            id: penilaian.Siswa.walikelas.user.id,
                            name: penilaian.Siswa.walikelas.user.name,
                            email: penilaian.Siswa.walikelas.user.email
                        } : null
                    };
                }
            }

            res.status(200).json({
                code: 200,
                status: "success",
                data: responseData
            });
        } catch (error) {
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Gagal mengambil data penilaian.",
                error: error.message,
            });
        }
    })
);

// 🔹 Get Penilaian by Siswa ID
router.get(
    "/siswa/:siswa_id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { siswa_id } = req.params;

            if (!isValidUUID(siswa_id)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Invalid siswa ID format",
                });
            }

            // Pastikan siswa ada
            const siswa = await Siswa.findByPk(siswa_id, {
                include: [{
                    model: WaliKelas,
                    as: 'walikelas',
                    attributes: ['id', 'sekolah', 'jurusan'],
                    include: [{
                        model: User,
                        as: 'user',
                        attributes: ['id', 'name', 'email']
                    }]
                }]
            });

            if (!siswa) {
                return res.status(404).json({
                    code: 404,
                    status: "error",
                    message: "Siswa tidak ditemukan.",
                });
            }

            const penilaianList = await Penilaian.findAll({
                where: { siswa_id },
                order: [
                    ['tahun', 'ASC'],
                    ['semester', 'ASC']
                ]
            });

            if (!penilaianList || penilaianList.length === 0) {
                return res.status(404).json({
                    code: 404,
                    status: "error",
                    message: "Belum ada data penilaian untuk siswa ini.",
                });
            }

            // Format response data
            const formattedPenilaian = penilaianList.map((item) => {
                const { rata_rata, kategori } = calculateNilaiRataRata(
                    item.matematika, item.ipa, item.ips, item.b_indonesia, item.b_inggris
                );

                const kategoriKehadiran = item.kehadiran ? getKategoriKehadiran(item.kehadiran) : null;
                const prediksiData = parsePrediksiData(item.prediksi, item.semester, item.tahun);

                return {
                    id: item.id,
                    periode: {
                        semester: item.semester,
                        tahun: item.tahun,
                        label: `Semester ${item.semester} ${item.tahun}`
                    },
                    data_aktual: {
                        nilai: {
                            matematika: item.matematika,
                            ipa: item.ipa,
                            ips: item.ips,
                            b_indonesia: item.b_indonesia,
                            b_inggris: item.b_inggris,
                            rata_rata: rata_rata
                        },
                        kehadiran: item.kehadiran,
                        kategori: {
                            prestasi: kategori,
                            kehadiran: kategoriKehadiran
                        },
                        prestasi: item.prestasi || kategori
                    },
                    data_prediksi: prediksiData,
                    perbandingan: prediksiData && prediksiData.nilai ? {
                        selisih_rata_rata: Math.round((prediksiData.nilai.rata_rata - rata_rata) * 100) / 100,
                        tren: prediksiData.nilai.rata_rata > rata_rata ? "Meningkat" :
                            prediksiData.nilai.rata_rata < rata_rata ? "Menurun" : "Stabil"
                    } : null,
                    metadata: {
                        created_at: item.createdAt,
                        updated_at: item.updatedAt
                    }
                };
            });

            // Hitung statistik perkembangan
            const perkembangan = formattedPenilaian.map(item => ({
                periode: item.periode.label,
                rata_rata_aktual: item.data_aktual.nilai.rata_rata,
                rata_rata_prediksi: item.data_prediksi?.nilai?.rata_rata || null,
                kategori_aktual: item.data_aktual.kategori.prestasi,
                kategori_prediksi: item.data_prediksi?.kategori_prestasi || null,
                tren: item.perbandingan?.tren || "Tidak tersedia"
            }));

            // Rata-rata keseluruhan
            const totalRataRata = formattedPenilaian.reduce((sum, item) => sum + item.data_aktual.nilai.rata_rata, 0) / formattedPenilaian.length;
            const rataRataKeseluruhan = Math.round(totalRataRata * 100) / 100;

            res.status(200).json({
                code: 200,
                status: "success",
                data: {
                    siswa: {
                        id: siswa.id,
                        name: siswa.name,
                        kelas: siswa.kelas,
                        walikelas: siswa.walikelas ? {
                            id: siswa.walikelas.id,
                            sekolah: siswa.walikelas.sekolah,
                            jurusan: siswa.walikelas.jurusan,
                            user: siswa.walikelas.user ? {
                                id: siswa.walikelas.user.id,
                                name: siswa.walikelas.user.name,
                                email: siswa.walikelas.user.email
                            } : null
                        } : null
                    },
                    summary: {
                        total_semester: formattedPenilaian.length,
                        rata_rata_keseluruhan: rataRataKeseluruhan,
                        perkembangan: perkembangan
                    },
                    penilaian: formattedPenilaian
                }
            });
        } catch (error) {
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Gagal mengambil data penilaian siswa.",
                error: error.message,
            });
        }
    })
);

// 🔹 Update Penilaian
router.put(
    "/:id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { id } = req.params;
            const {
                matematika,
                ipa,
                ips,
                b_indonesia,
                b_inggris,
                kehadiran,
                prestasi,
            } = req.body;

            if (!isValidUUID(id)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Invalid penilaian ID format",
                });
            }

            // Cek apakah penilaian exists
            const existingPenilaian = await Penilaian.findByPk(id);
            if (!existingPenilaian) {
                return res.status(404).json({
                    code: 404,
                    status: "error",
                    message: "Penilaian tidak ditemukan.",
                });
            }

            // Validasi range nilai (0-100)
            const nilaiFields = { matematika, ipa, ips, b_indonesia, b_inggris };
            for (const [field, value] of Object.entries(nilaiFields)) {
                if (value !== undefined && (value < 0 || value > 100)) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: `Nilai ${field} harus antara 0-100`,
                    });
                }
            }

            // Validasi kehadiran jika ada
            if (kehadiran !== undefined && (kehadiran < 0 || kehadiran > 100)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Kehadiran harus antara 0-100%",
                });
            }

            // Update data
            const updateData = {};
            if (matematika !== undefined) updateData.matematika = matematika;
            if (ipa !== undefined) updateData.ipa = ipa;
            if (ips !== undefined) updateData.ips = ips;
            if (b_indonesia !== undefined) updateData.b_indonesia = b_indonesia;
            if (b_inggris !== undefined) updateData.b_inggris = b_inggris;
            if (kehadiran !== undefined) updateData.kehadiran = kehadiran;
            if (prestasi !== undefined) updateData.prestasi = prestasi;

            // Jika ada perubahan nilai, update prediksi
            if (matematika !== undefined || ipa !== undefined || ips !== undefined ||
                b_indonesia !== undefined || b_inggris !== undefined) {

                const finalMatematika = matematika !== undefined ? matematika : existingPenilaian.matematika;
                const finalIpa = ipa !== undefined ? ipa : existingPenilaian.ipa;
                const finalIps = ips !== undefined ? ips : existingPenilaian.ips;
                const finalBIndonesia = b_indonesia !== undefined ? b_indonesia : existingPenilaian.b_indonesia;
                const finalBInggris = b_inggris !== undefined ? b_inggris : existingPenilaian.b_inggris;

                try {
                    const prediksi = await getPrediction(
                        finalMatematika, finalIpa, finalIps, finalBIndonesia, finalBInggris, existingPenilaian.semester
                    );
                    updateData.prediksi = prediksi;
                } catch (error) {
                    console.error("Prediction API error:", error.message);
                }
            }

            await Penilaian.update(updateData, {
                where: { id }
            });

            // Get updated data
            const updatedPenilaian = await Penilaian.findByPk(id, {
                include: [{
                    model: Siswa,
                    attributes: ['id', 'name', 'kelas'],
                    include: [{
                        model: WaliKelas,
                        as: 'walikelas',
                        attributes: ['id', 'sekolah', 'jurusan'],
                        include: [{
                            model: User,
                            as: 'user',
                            attributes: ['id', 'name', 'email']
                        }]
                    }]
                }]
            });

            // Hitung nilai untuk response
            const { rata_rata, kategori } = calculateNilaiRataRata(
                updatedPenilaian.matematika, updatedPenilaian.ipa, updatedPenilaian.ips,
                updatedPenilaian.b_indonesia, updatedPenilaian.b_inggris
            );

            const kategoriKehadiran = updatedPenilaian.kehadiran ? getKategoriKehadiran(updatedPenilaian.kehadiran) : null;
            const prediksiData = parsePrediksiData(updatedPenilaian.prediksi, updatedPenilaian.semester, updatedPenilaian.tahun);

            const responseData = {
                id: updatedPenilaian.id,
                siswa_id: updatedPenilaian.siswa_id,
                periode: {
                    semester: updatedPenilaian.semester,
                    tahun: updatedPenilaian.tahun,
                    label: `Semester ${updatedPenilaian.semester} ${updatedPenilaian.tahun}`
                },
                data_aktual: {
                    nilai: {
                        matematika: updatedPenilaian.matematika,
                        ipa: updatedPenilaian.ipa,
                        ips: updatedPenilaian.ips,
                        b_indonesia: updatedPenilaian.b_indonesia,
                        b_inggris: updatedPenilaian.b_inggris,
                        rata_rata: rata_rata
                    },
                    kehadiran: updatedPenilaian.kehadiran,
                    kategori: {
                        prestasi: kategori,
                        kehadiran: kategoriKehadiran
                    },
                    prestasi: updatedPenilaian.prestasi || kategori
                },
                data_prediksi: prediksiData,
                perbandingan: prediksiData && prediksiData.nilai ? {
                    selisih_rata_rata: Math.round((prediksiData.nilai.rata_rata - rata_rata) * 100) / 100,
                    tren: prediksiData.nilai.rata_rata > rata_rata ? "Meningkat" :
                        prediksiData.nilai.rata_rata < rata_rata ? "Menurun" : "Stabil",
                    confidence: "Tinggi"
                } : null,
                metadata: {
                    created_at: updatedPenilaian.createdAt,
                    updated_at: updatedPenilaian.updatedAt
                }
            };

            // Tambahkan data siswa jika ada
            if (updatedPenilaian.Siswa) {
                responseData.siswa = {
                    id: updatedPenilaian.Siswa.id,
                    name: updatedPenilaian.Siswa.name,
                    kelas: updatedPenilaian.Siswa.kelas
                };
            }

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Penilaian berhasil diupdate.",
                data: responseData
            });
        } catch (error) {
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Gagal mengupdate penilaian.",
                error: error.message,
            });
        }
    })
);

// 🔹 Delete Penilaian
router.delete(
    "/:id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { id } = req.params;

            if (!isValidUUID(id)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Invalid penilaian ID format",
                });
            }

            const deleted = await Penilaian.destroy({
                where: { id }
            });

            if (!deleted) {
                return res.status(404).json({
                    code: 404,
                    status: "error",
                    message: "Penilaian tidak ditemukan.",
                });
            }

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Penilaian berhasil dihapus.",
            });
        } catch (error) {
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Gagal menghapus penilaian.",
                error: error.message,
            });
        }
    })
);

module.exports = router;