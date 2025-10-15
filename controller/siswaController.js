const express = require("express");
const router = express.Router();
const Siswa = require("../model/Siswa");
const Validator = require("fastest-validator");
const v = new Validator();
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const axios = require("axios");
const mongoose = require('mongoose'); // JANGAN LUPA IMPORT MONGOOSE

const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');

// Validation schema
const schema = {
    name: { type: "string", empty: false },
    kelas: { type: "string", empty: false },
    tahun: { type: "number", integer: true, positive: true },
    nilai: { type: "number", integer: true, min: 0, max: 100 },
    kehadiran: { type: "number", integer: true, min: 0, max: 365 },
    prestasi: { type: "string", optional: true },
    walikelas_id: { type: "string", empty: false },
    semester: { type: "string", empty: false }
};

// Helper function untuk memanggil API prediksi
const getPrediction = async (nilai_akademik, total_kehadiran) => {
    try {
        const response = await axios.post("https://rika111.pythonanywhere.com/predict", {
            nilai_akademik: nilai_akademik,
            total_kehadiran: total_kehadiran
        });

        return response.data.prediksi_prestasi;
    } catch (error) {
        console.error("Error calling prediction API:", error.message);
        return null;
    }
};

// Helper function untuk validasi ObjectId
const isValidObjectId = (id) => {
    return mongoose.Types.ObjectId.isValid(id);
};

// Konfigurasi multer untuk upload file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'siswa-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Hanya file Excel (.xlsx, .xls) yang diizinkan'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});

// ✅ Import Siswa dari Excel
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

            // Baca file Excel
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(worksheet);

            // Validasi struktur file
            if (data.length === 0) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "File Excel kosong atau format tidak sesuai",
                });
            }

            // Validasi kolom required
            const requiredColumns = ['Nama Siswa', 'Total Kehadiran', 'Nilai Akademik', 'Kelas', 'Semester', 'Tahun'];
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
                errors: []
            };

            // Proses setiap baris data
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const rowNumber = i + 2;

                try {
                    // Validasi data
                    if (!row['Nama Siswa'] || !row['Kelas'] || !row['Semester'] || !row['Tahun']) {
                        results.errors.push(`Baris ${rowNumber}: Data required tidak lengkap`);
                        results.failed++;
                        continue;
                    }

                    // Validasi tipe data
                    const kehadiran = parseInt(row['Total Kehadiran']);
                    const nilai = parseInt(row['Nilai Akademik']);
                    const tahun = parseInt(row['Tahun']);

                    if (isNaN(kehadiran) || isNaN(nilai) || isNaN(tahun)) {
                        results.errors.push(`Baris ${rowNumber}: Data numerik tidak valid`);
                        results.failed++;
                        continue;
                    }

                    if (nilai < 0 || nilai > 100) {
                        results.errors.push(`Baris ${rowNumber}: Nilai akademik harus antara 0-100`);
                        results.failed++;
                        continue;
                    }

                    if (kehadiran < 0 || kehadiran > 365) {
                        results.errors.push(`Baris ${rowNumber}: Total kehadiran harus antara 0-365`);
                        results.failed++;
                        continue;
                    }

                    // Cek duplikat berdasarkan nama, kelas, tahun, semester
                    const existingSiswa = await Siswa.findOne({
                        name: row['Nama Siswa'],
                        kelas: row['Kelas'],
                        tahun: tahun,
                        semester: row['Semester']
                    });

                    if (existingSiswa) {
                        results.errors.push(`Baris ${rowNumber}: Data siswa sudah ada (${row['Nama Siswa']} - ${row['Kelas']} - ${row['Semester']} ${tahun})`);
                        results.failed++;
                        continue;
                    }

                    // Dapatkan prediksi prestasi dari API
                    let prestasi;
                    try {
                        const prediction = await getPrediction(nilai, kehadiran);
                        prestasi = prediction || "Cukup";
                    } catch (error) {
                        prestasi = "Cukup";
                    }

                    // Buat data siswa
                    const siswa = await Siswa.create({
                        name: row['Nama Siswa'],
                        kelas: row['Kelas'],
                        tahun: tahun,
                        nilai: nilai,
                        kehadiran: kehadiran,
                        prestasi: prestasi,
                        walikelas_id: req.user.id,
                        semester: row['Semester']
                    });

                    results.success++;

                } catch (error) {
                    results.errors.push(`Baris ${rowNumber}: ${error.message}`);
                    results.failed++;
                }
            }

            // Hapus file temporary
            const fs = require('fs');
            fs.unlinkSync(req.file.path);

            // Response hasil import
            res.status(200).json({
                code: 200,
                status: "success",
                message: `Import selesai. Berhasil: ${results.success}, Gagal: ${results.failed}`,
                data: {
                    total: results.total,
                    success: results.success,
                    failed: results.failed,
                    errors: results.errors.slice(0, 10)
                }
            });

        } catch (error) {
            // Hapus file temporary jika ada error
            if (req.file && req.file.path) {
                const fs = require('fs');
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
            }

            return res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat import data",
                error: error.message
            });
        }
    })
);

// ✅ Download Template Excel
router.get(
    "/template",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            // Buat workbook baru
            const workbook = xlsx.utils.book_new();

            // Data contoh
            const templateData = [
                {
                    'Nama Siswa': 'Contoh: Budi Santoso',
                    'Total Kehadiran': 'Contoh: 105 (angka, 0-365)',
                    'Nilai Akademik': 'Contoh: 85 (angka, 0-100)',
                    'Kelas': 'Contoh: 10A',
                    'Semester': 'Contoh: Ganjil',
                    'Tahun': 'Contoh: 2024'
                },
                {
                    'Nama Siswa': 'Bella Anggraini',
                    'Total Kehadiran': 109,
                    'Nilai Akademik': 92,
                    'Kelas': '3',
                    'Semester': 'Ganjil',
                    'Tahun': 2024
                },
                {
                    'Nama Siswa': 'Lukman Nulhakim',
                    'Total Kehadiran': 106,
                    'Nilai Akademik': 71,
                    'Kelas': '3',
                    'Semester': 'Ganjil',
                    'Tahun': 2024
                }
            ];

            // Buat worksheet
            const worksheet = xlsx.utils.json_to_sheet(templateData);

            // Tambahkan worksheet ke workbook
            xlsx.utils.book_append_sheet(workbook, worksheet, 'Template Siswa');

            // Set header untuk download
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=template-import-siswa.xlsx');

            // Generate file dan kirim sebagai response
            const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            res.send(buffer);

        } catch (error) {
            return res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat generate template",
                error: error.message
            });
        }
    })
);

// ✅ Create Siswa dengan prediksi otomatis
router.post(
    "",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        // Validasi walikelas_id
        if (!isValidObjectId(req.body.walikelas_id)) {
            return res.status(400).json({
                code: 400,
                status: "error",
                message: "Invalid walikelas_id format",
            });
        }

        const validation = v.validate(req.body, schema);
        if (validation !== true) {
            return res.status(400).json({
                code: 400,
                status: "error",
                message: "Validation failed",
                data: validation,
            });
        }

        const { name, kelas, tahun, nilai, kehadiran, walikelas_id, semester } = req.body;

        // Jika prestasi tidak disediakan, dapatkan prediksi dari API
        let prestasi = req.body.prestasi;
        if (!prestasi) {
            prestasi = await getPrediction(nilai, kehadiran);
            if (!prestasi) {
                prestasi = "Cukup";
            }
        }

        const siswa = await Siswa.create({
            name,
            kelas,
            tahun,
            nilai,
            kehadiran,
            prestasi,
            walikelas_id,
            semester
        });

        // Populate walikelas data
        await siswa.populate("walikelas_id");

        res.status(201).json({
            code: 201,
            status: "success",
            message: "Siswa created successfully",
            data: {
                id: siswa._id,
                name: siswa.name,
                kelas: siswa.kelas,
                tahun: siswa.tahun,
                nilai: siswa.nilai,
                kehadiran: siswa.kehadiran,
                prestasi: siswa.prestasi,
                walikelas: siswa.walikelas_id ? {
                    id: siswa.walikelas_id._id,
                    name: siswa.walikelas_id.name,
                    email: siswa.walikelas_id.email
                } : null,
                semester: siswa.semester,
                createdAt: siswa.createdAt,
                updatedAt: siswa.updatedAt
            },
        });
    })
);

// ✅ Get All Siswa
// ✅ Get All Siswa (Admin dengan filter lengkap)
router.get(
    "/list",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { kelas, tahun, semester, walikelas_id, prestasi, page, limit, search } = req.query;

            // Hanya admin yang bisa akses semua data
            if (req.user.role !== 'operator') {
                return res.status(403).json({
                    code: 403,
                    status: "error",
                    message: "Hanya operator yang dapat mengakses semua data siswa",
                });
            }

            let filter = {};

            // Filter berdasarkan kelas
            if (kelas) filter.kelas = kelas;

            // Filter berdasarkan tahun
            if (tahun) {
                const tahunNum = parseInt(tahun);
                if (isNaN(tahunNum)) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: "Invalid tahun format, must be a number",
                    });
                }
                filter.tahun = tahunNum;
            }

            // Filter berdasarkan semester
            if (semester) {
                if (!['1', '2'].includes(semester)) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: "Invalid semester format, must be '1' or '2'",
                    });
                }
                filter.semester = semester;
            }

            // Filter berdasarkan wali kelas
            if (walikelas_id) {
                if (!isValidObjectId(walikelas_id)) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: "Invalid walikelas_id format",
                    });
                }
                filter.walikelas_id = walikelas_id;
            }

            // Filter berdasarkan prestasi
            if (prestasi) {
                const validPrestasi = ['Sangat Baik', 'Baik', 'Cukup', 'Kurang', 'Kurang Sekali'];
                if (!validPrestasi.includes(prestasi)) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: "Invalid prestasi value",
                    });
                }
                filter.prestasi = prestasi;
            }

            // Filter berdasarkan pencarian nama
            if (search) {
                if (search.length < 2) {
                    return res.status(400).json({
                        code: 400,
                        status: "error",
                        message: "Search query must be at least 2 characters long",
                    });
                }
                filter.name = { $regex: search, $options: 'i' }; // Case insensitive search
            }

            // Pagination validation
            const pageNumber = parseInt(page) || 1;
            const pageSize = parseInt(limit) || 10;

            if (pageNumber < 1) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Page number must be greater than 0",
                });
            }

            if (pageSize < 1 || pageSize > 100) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Limit must be between 1 and 100",
                });
            }

            const skip = (pageNumber - 1) * pageSize;

            // Hitung total data
            const totalSiswa = await Siswa.countDocuments(filter);

            // Hitung total pages
            const totalPages = Math.ceil(totalSiswa / pageSize);

            // Validate if page number exceeds total pages
            if (pageNumber > totalPages && totalPages > 0) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: `Page ${pageNumber} exceeds total pages (${totalPages})`,
                });
            }

            // Get data dengan pagination
            const siswaList = await Siswa.find(filter)
                .sort({
                    tahun: -1,
                    semester: 1,
                    kelas: 1,
                    name: 1
                })
                .skip(skip)
                .limit(pageSize)
                .populate("walikelas_id");

            // Hitung statistik untuk filter yang dipilih
            const stats = await Siswa.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        avgNilai: { $avg: "$nilai" },
                        avgKehadiran: { $avg: "$kehadiran" },
                        totalSiswa: { $sum: 1 },
                        prestasiDistribution: {
                            $push: "$prestasi"
                        }
                    }
                },
                {
                    $project: {
                        avgNilai: { $round: ["$avgNilai", 2] },
                        avgKehadiran: { $round: ["$avgKehadiran", 2] },
                        totalSiswa: 1,
                        prestasiDistribution: {
                            $arrayToObject: {
                                $map: {
                                    input: { $setUnion: ["$prestasiDistribution", []] },
                                    as: "prestasi",
                                    in: {
                                        k: "$$prestasi",
                                        v: {
                                            $size: {
                                                $filter: {
                                                    input: "$prestasiDistribution",
                                                    as: "p",
                                                    cond: { $eq: ["$$p", "$$prestasi"] }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            ]);

            const statistics = stats.length > 0 ? stats[0] : {
                avgNilai: 0,
                avgKehadiran: 0,
                totalSiswa: 0,
                prestasiDistribution: {}
            };

            // Format prestasi distribution dengan semua kategori
            const allPrestasiCategories = ['Sangat Baik', 'Baik', 'Cukup', 'Kurang', 'Kurang Sekali'];
            const formattedPrestasi = allPrestasiCategories.map(category => ({
                prestasi: category,
                count: statistics.prestasiDistribution[category] || 0
            }));

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Data siswa retrieved successfully",
                data: {
                    pagination: {
                        currentPage: pageNumber,
                        totalPages: totalPages,
                        totalSiswa: totalSiswa,
                        pageSize: pageSize,
                        hasNext: pageNumber < totalPages,
                        hasPrev: pageNumber > 1
                    },
                    statistics: {
                        avgNilai: statistics.avgNilai,
                        avgKehadiran: statistics.avgKehadiran,
                        totalSiswa: statistics.totalSiswa,
                        prestasiDistribution: formattedPrestasi
                    },
                    filters: {
                        kelas: kelas || 'Semua',
                        tahun: tahun || 'Semua',
                        semester: semester || 'Semua',
                        walikelas: walikelas_id || 'Semua',
                        prestasi: prestasi || 'Semua',
                        search: search || ''
                    },
                    siswa: siswaList.map((siswa) => ({
                        id: siswa._id,
                        name: siswa.name,
                        kelas: siswa.kelas,
                        tahun: siswa.tahun,
                        nilai: siswa.nilai,
                        kehadiran: siswa.kehadiran,
                        prestasi: siswa.prestasi,
                        walikelas: siswa.walikelas_id ? {
                            id: siswa.walikelas_id._id,
                            name: siswa.walikelas_id.name,
                            email: siswa.walikelas_id.email,
                            role: siswa.walikelas_id.role
                        } : null,
                        semester: siswa.semester,
                        createdAt: siswa.createdAt,
                        updatedAt: siswa.updatedAt
                    }))
                },
            });
        } catch (error) {
            return res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat mengambil data siswa",
                error: error.message
            });
        }
    })
);

// ✅ Get Available Filters for Admin
router.get(
    "/admin/filters",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            // Hanya admin yang bisa akses
            if (req.user.role !== 'operator') {
                return res.status(403).json({
                    code: 403,
                    status: "error",
                    message: "Hanya operator yang dapat mengakses filter admin",
                });
            }

            const years = await Siswa.distinct("tahun");
            const semesters = await Siswa.distinct("semester");
            const classes = await Siswa.distinct("kelas");
            const prestasiCategories = await Siswa.distinct("prestasi");

            // Get semua wali kelas
            const walikelasList = await User.find({ role: 'walikelas' })
                .select('_id name email')
                .sort({ name: 1 });

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Available filters retrieved successfully",
                data: {
                    years: years.sort((a, b) => b - a),
                    semesters: semesters.sort(),
                    classes: classes.sort(),
                    prestasi: prestasiCategories.sort(),
                    walikelas: walikelasList.map(wali => ({
                        id: wali._id,
                        name: wali.name,
                        email: wali.email
                    }))
                }
            });

        } catch (error) {
            return res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat mengambil data filter",
                error: error.message
            });
        }
    })
);

router.get(
    "/walikelas/list",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { tahun, semester, kelas } = req.query;
            const walikelas_id = req.user.id; // Ambil dari user yang login

            // Validasi bahwa user adalah wali kelas
            if (req.user.role !== 'walikelas') {
                return res.status(403).json({
                    code: 403,
                    status: "error",
                    message: "Hanya wali kelas yang dapat mengakses data ini",
                });
            }

            let filter = { walikelas_id: walikelas_id };

            // Tambahkan filter jika ada
            if (tahun) filter.tahun = parseInt(tahun);
            if (semester) filter.semester = semester;
            if (kelas) filter.kelas = kelas;

            const siswaList = await Siswa.find(filter)
                .sort({
                    kelas: 1,
                    name: 1
                })
                .populate("walikelas_id");

            // Hitung statistik sederhana
            const totalSiswa = siswaList.length;
            const avgNilai = totalSiswa > 0
                ? Math.round(siswaList.reduce((sum, siswa) => sum + siswa.nilai, 0) / totalSiswa * 100) / 100
                : 0;
            const avgKehadiran = totalSiswa > 0
                ? Math.round(siswaList.reduce((sum, siswa) => sum + siswa.kehadiran, 0) / totalSiswa * 100) / 100
                : 0;

            // Distribusi prestasi
            const prestasiDistribution = siswaList.reduce((acc, siswa) => {
                acc[siswa.prestasi] = (acc[siswa.prestasi] || 0) + 1;
                return acc;
            }, {});

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Data siswa retrieved successfully",
                data: {
                    summary: {
                        totalSiswa,
                        avgNilai,
                        avgKehadiran,
                        kelas: [...new Set(siswaList.map(siswa => siswa.kelas))] // Daftar kelas unik
                    },
                    prestasiDistribution,
                    siswa: siswaList.map((siswa) => ({
                        id: siswa._id,
                        name: siswa.name,
                        kelas: siswa.kelas,
                        tahun: siswa.tahun,
                        nilai: siswa.nilai,
                        kehadiran: siswa.kehadiran,
                        prestasi: siswa.prestasi,
                        walikelas: siswa.walikelas_id ? {
                            id: siswa.walikelas_id._id,
                            name: siswa.walikelas_id.name,
                            email: siswa.walikelas_id.email
                        } : null,
                        semester: siswa.semester,
                        createdAt: siswa.createdAt,
                        updatedAt: siswa.updatedAt
                    }))
                },
            });
        } catch (error) {
            return res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat mengambil data siswa",
                error: error.message
            });
        }
    })
);

// ✅ Get Siswa by ID
router.get(
    "/:id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        // Validasi ObjectId
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({
                code: 400,
                status: "error",
                message: "Invalid siswa ID format",
            });
        }

        const siswa = await Siswa.findById(req.params.id).populate("walikelas_id");

        if (!siswa) {
            return res.status(404).json({
                code: 404,
                status: "error",
                message: "Siswa not found",
            });
        }

        res.status(200).json({
            code: 200,
            status: "success",
            data: {
                id: siswa._id,
                name: siswa.name,
                kelas: siswa.kelas,
                tahun: siswa.tahun,
                nilai: siswa.nilai,
                kehadiran: siswa.kehadiran,
                prestasi: siswa.prestasi,
                walikelas: siswa.walikelas_id ? {
                    id: siswa.walikelas_id._id,
                    name: siswa.walikelas_id.name,
                    email: siswa.walikelas_id.email
                } : null,
                semester: siswa.semester,
                createdAt: siswa.createdAt,
                updatedAt: siswa.updatedAt
            },
        });
    })
);

// ✅ Update Siswa
router.put(
    "/:id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        // Validasi ObjectId
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({
                code: 400,
                status: "error",
                message: "Invalid siswa ID format",
            });
        }

        // Validasi walikelas_id jika ada di body
        if (req.body.walikelas_id && !isValidObjectId(req.body.walikelas_id)) {
            return res.status(400).json({
                code: 400,
                status: "error",
                message: "Invalid walikelas_id format",
            });
        }

        const validation = v.validate(req.body, schema);
        if (validation !== true) {
            return res.status(400).json({
                code: 400,
                status: "error",
                message: "Validation failed",
                data: validation,
            });
        }

        const { name, kelas, tahun, nilai, kehadiran, walikelas_id, semester } = req.body;

        // Cek apakah siswa exists
        const existingSiswa = await Siswa.findById(req.params.id);
        if (!existingSiswa) {
            return res.status(404).json({
                code: 404,
                status: "error",
                message: "Siswa not found",
            });
        }

        // Jika nilai atau kehadiran berubah, update prediksi prestasi
        let prestasi = req.body.prestasi;
        if (!prestasi && (nilai !== existingSiswa.nilai || kehadiran !== existingSiswa.kehadiran)) {
            prestasi = await getPrediction(nilai, kehadiran);
            if (!prestasi) {
                prestasi = existingSiswa.prestasi;
            }
        }

        const updatedData = {
            name,
            kelas,
            tahun,
            nilai,
            kehadiran,
            walikelas_id,
            semester
        };

        if (prestasi) {
            updatedData.prestasi = prestasi;
        }

        const siswa = await Siswa.findByIdAndUpdate(
            req.params.id,
            updatedData,
            { new: true }
        ).populate("walikelas_id");

        res.status(200).json({
            code: 200,
            status: "success",
            message: "Siswa updated successfully",
            data: {
                id: siswa._id,
                name: siswa.name,
                kelas: siswa.kelas,
                tahun: siswa.tahun,
                nilai: siswa.nilai,
                kehadiran: siswa.kehadiran,
                prestasi: siswa.prestasi,
                walikelas: siswa.walikelas_id ? {
                    id: siswa.walikelas_id._id,
                    name: siswa.walikelas_id.name,
                    email: siswa.walikelas_id.email
                } : null,
                semester: siswa.semester,
                createdAt: siswa.createdAt,
                updatedAt: siswa.updatedAt
            },
        });
    })
);

// ✅ Delete Siswa
router.delete(
    "/:id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        // Validasi ObjectId
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({
                code: 400,
                status: "error",
                message: "Invalid siswa ID format",
            });
        }

        const siswa = await Siswa.findByIdAndDelete(req.params.id);

        if (!siswa) {
            return res.status(404).json({
                code: 404,
                status: "error",
                message: "Siswa not found",
            });
        }

        res.status(200).json({
            code: 200,
            status: "success",
            message: "Siswa deleted successfully",
        });
    })
);

// ✅ Get Prediksi Prestasi (standalone endpoint)
router.post(
    "/predict",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        const { nilai_akademik, total_kehadiran } = req.body;

        if (nilai_akademik === undefined || total_kehadiran === undefined) {
            return res.status(400).json({
                code: 400,
                status: "error",
                message: "nilai_akademik and total_kehadiran are required",
            });
        }

        try {
            const prediksi = await getPrediction(nilai_akademik, total_kehadiran);

            if (!prediksi) {
                return res.status(500).json({
                    code: 500,
                    status: "error",
                    message: "Prediction service unavailable",
                });
            }

            res.status(200).json({
                code: 200,
                status: "success",
                data: {
                    nilai_akademik,
                    total_kehadiran,
                    prediksi_prestasi: prediksi
                }
            });

        } catch (error) {
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Error getting prediction",
                error: error.message
            });
        }
    })
);

// ✅ Get Statistics
router.get(
    "/stats/overview",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        const { tahun, semester } = req.query;

        let matchStage = {};
        if (tahun) matchStage.tahun = parseInt(tahun);
        if (semester) matchStage.semester = semester;

        const stats = await Siswa.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalSiswa: { $sum: 1 },
                    avgNilai: { $avg: "$nilai" },
                    avgKehadiran: { $avg: "$kehadiran" },
                    prestasiCount: {
                        $push: "$prestasi"
                    }
                }
            },
            {
                $project: {
                    totalSiswa: 1,
                    avgNilai: { $round: ["$avgNilai", 2] },
                    avgKehadiran: { $round: ["$avgKehadiran", 2] },
                    prestasiDistribution: {
                        $arrayToObject: {
                            $map: {
                                input: { $setUnion: ["$prestasiCount", []] },
                                as: "prestasi",
                                in: {
                                    k: "$$prestasi",
                                    v: {
                                        $size: {
                                            $filter: {
                                                input: "$prestasiCount",
                                                as: "p",
                                                cond: { $eq: ["$$p", "$$prestasi"] }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        ]);

        const result = stats.length > 0 ? stats[0] : {
            totalSiswa: 0,
            avgNilai: 0,
            avgKehadiran: 0,
            prestasiDistribution: {}
        };

        res.status(200).json({
            code: 200,
            status: "success",
            data: result
        });
    })
);

module.exports = router;