// controllers/siswaController.js
const express = require("express");
const router = express.Router();
const Siswa = require("../model/Siswa");
const User = require("../model/User");
const WaliKelas = require("../model/Walikelas");
const Validator = require("fastest-validator");
const v = new Validator();
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated } = require("../middleware/auth");
const { Op, Sequelize } = require("sequelize");
const { v4: uuidv4 } = require('uuid');

const multer = require('multer');
const xlsx = require('xlsx');

// Validation schema
const schema = {
    name: { type: "string", empty: false },
    kelas: { type: "string", empty: false },
    tahun: { type: "number", integer: true, positive: true },
    semester: { type: "string", enum: ["ganjil", "genap"] }
};

// Helper function untuk validasi UUID
const isValidUUID = (id) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
};

// Helper function untuk mendapatkan WaliKelas ID
const getWaliKelasId = async (userId) => {
    const waliKelas = await WaliKelas.findOne({
        where: { user_id: userId }
    });
    return waliKelas ? waliKelas.id : null;
};

// Helper function untuk validasi dan parse tahun
const parseTahun = (tahun) => {
    if (!tahun) return null;
    const tahunNum = parseInt(tahun);
    return isNaN(tahunNum) ? null : tahunNum;
};

// Helper function untuk validasi dan parse pagination
const parsePagination = (page, limit) => {
    const pageNumber = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    return {
        pageNumber: Math.max(1, pageNumber),
        pageSize: Math.max(1, Math.min(100, pageSize)) // Limit max 100 per page
    };
};

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
        fileSize: 5 * 1024 * 1024
    }
});

// ✅ Create Siswa
router.post(
    "",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const validation = v.validate(req.body, schema);
            if (validation !== true) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Validation failed",
                    data: validation,
                });
            }

            const { name, kelas, tahun, semester } = req.body;

            // Dapatkan walikelas_id berdasarkan user yang login
            const walikelas_id = await getWaliKelasId(req.user.id);

            if (!walikelas_id) {
                return res.status(404).json({
                    code: 404,
                    status: "error",
                    message: "Data wali kelas tidak ditemukan untuk user ini",
                });
            }

            // Cek duplikat siswa
            const existingSiswa = await Siswa.findOne({
                where: {
                    name,
                    kelas,
                    tahun,
                    semester,
                    walikelas_id
                }
            });

            if (existingSiswa) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Siswa dengan data yang sama sudah ada",
                });
            }

            // Buat siswa
            const siswa = await Siswa.create({
                id: uuidv4(),
                name,
                kelas,
                tahun,
                semester,
                walikelas_id
            });

            // Get data dengan include yang benar
            const siswaWithDetails = await Siswa.findByPk(siswa.id, {
                include: [{
                    model: WaliKelas,
                    as: 'walikelas',
                    include: [{
                        model: User,
                        as: 'user',
                        attributes: ['id', 'name', 'email']
                    }]
                }]
            });

            res.status(201).json({
                code: 201,
                status: "success",
                message: "Siswa created successfully",
                data: {
                    id: siswaWithDetails.id,
                    name: siswaWithDetails.name,
                    kelas: siswaWithDetails.kelas,
                    tahun: siswaWithDetails.tahun,
                    semester: siswaWithDetails.semester,
                    walikelas: siswaWithDetails.walikelas ? {
                        id: siswaWithDetails.walikelas.id,
                        user: {
                            id: siswaWithDetails.walikelas.user.id,
                            name: siswaWithDetails.walikelas.user.name,
                            email: siswaWithDetails.walikelas.user.email
                        },
                        sekolah: siswaWithDetails.walikelas.sekolah,
                        jurusan: siswaWithDetails.walikelas.jurusan
                    } : null,
                    createdAt: siswaWithDetails.createdAt,
                    updatedAt: siswaWithDetails.updatedAt
                },
            });
        } catch (error) {
            console.error("Error in create siswa:", error);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat membuat siswa",
                error: error.message
            });
        }
    })
);

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

            const requiredColumns = ['Nama Siswa', 'Kelas', 'Semester', 'Tahun'];
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

            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const rowNumber = i + 2;

                try {
                    if (!row['Nama Siswa'] || !row['Kelas'] || !row['Semester'] || !row['Tahun']) {
                        results.errors.push(`Baris ${rowNumber}: Data required tidak lengkap`);
                        results.failed++;
                        continue;
                    }

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

                    // Cek duplikat
                    const existingSiswa = await Siswa.findOne({
                        where: {
                            name: row['Nama Siswa'],
                            kelas: row['Kelas'],
                            tahun: tahun,
                            semester: semester,
                            walikelas_id
                        }
                    });

                    if (existingSiswa) {
                        results.errors.push(`Baris ${rowNumber}: Data siswa sudah ada`);
                        results.failed++;
                        continue;
                    }

                    // Buat data siswa
                    await Siswa.create({
                        id: uuidv4(),
                        name: row['Nama Siswa'],
                        kelas: row['Kelas'],
                        tahun: tahun,
                        semester: semester,
                        walikelas_id
                    });

                    results.success++;

                } catch (error) {
                    results.errors.push(`Baris ${rowNumber}: ${error.message}`);
                    results.failed++;
                }
            }

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
            console.error("Error in import siswa:", error);
            return res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat import data",
                error: error.message
            });
        }
    })
);

// ✅ Get All Siswa
router.get(
    "/list",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { kelas, tahun, semester, page = 1, limit = 10, search } = req.query;

            let whereCondition = {};

            // Untuk wali kelas, hanya tampilkan siswa mereka sendiri
            if (req.user.role === 'walikelas') {
                const walikelas_id = await getWaliKelasId(req.user.id);
                if (walikelas_id) {
                    whereCondition.walikelas_id = walikelas_id;
                }
            }

            // Filter lainnya dengan validasi
            if (kelas) whereCondition.kelas = kelas;

            const tahunParsed = parseTahun(tahun);
            if (tahunParsed !== null) {
                whereCondition.tahun = tahunParsed;
            }

            if (semester) whereCondition.semester = semester;

            if (search && search.length >= 2) {
                whereCondition.name = { [Op.like]: `%${search}%` };
            }

            // Validasi dan parse pagination
            const { pageNumber, pageSize } = parsePagination(page, limit);
            const offset = (pageNumber - 1) * pageSize;

            // Hitung total data
            const totalSiswa = await Siswa.count({ where: whereCondition });
            const totalPages = Math.ceil(totalSiswa / pageSize);

            // Validasi jika page number melebihi total pages
            if (pageNumber > totalPages && totalPages > 0) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: `Page ${pageNumber} exceeds total pages (${totalPages})`,
                });
            }

            const siswaList = await Siswa.findAll({
                where: whereCondition,
                include: [{
                    model: WaliKelas,
                    as: 'walikelas',
                    include: [{
                        model: User,
                        as: 'user',
                        attributes: ['id', 'name', 'email']
                    }]
                }],
                order: [
                    ['tahun', 'DESC'],
                    ['semester', 'ASC'],
                    ['kelas', 'ASC'],
                    ['name', 'ASC']
                ],
                offset: offset,
                limit: pageSize
            });

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
                    filters: {
                        kelas: kelas || 'Semua',
                        tahun: tahun || 'Semua',
                        semester: semester || 'Semua',
                        search: search || ''
                    },
                    siswa: siswaList.map((siswa) => ({
                        id: siswa.id,
                        name: siswa.name,
                        kelas: siswa.kelas,
                        tahun: siswa.tahun,
                        semester: siswa.semester,
                        walikelas: siswa.walikelas ? {
                            id: siswa.walikelas.id,
                            user: {
                                id: siswa.walikelas.user.id,
                                name: siswa.walikelas.user.name,
                                email: siswa.walikelas.user.email
                            },
                            sekolah: siswa.walikelas.sekolah,
                            jurusan: siswa.walikelas.jurusan
                        } : null,
                        createdAt: siswa.createdAt,
                        updatedAt: siswa.updatedAt
                    }))
                },
            });
        } catch (error) {
            console.error("Error in get siswa list:", error);
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
        try {
            if (!isValidUUID(req.params.id)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Invalid siswa ID format",
                });
            }

            const siswa = await Siswa.findByPk(req.params.id, {
                include: [{
                    model: WaliKelas,
                    as: 'walikelas',
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
                    message: "Siswa not found",
                });
            }

            res.status(200).json({
                code: 200,
                status: "success",
                data: {
                    id: siswa.id,
                    name: siswa.name,
                    kelas: siswa.kelas,
                    tahun: siswa.tahun,
                    semester: siswa.semester,
                    walikelas: siswa.walikelas ? {
                        id: siswa.walikelas.id,
                        user: {
                            id: siswa.walikelas.user.id,
                            name: siswa.walikelas.user.name,
                            email: siswa.walikelas.user.email
                        },
                        sekolah: siswa.walikelas.sekolah,
                        jurusan: siswa.walikelas.jurusan
                    } : null,
                    createdAt: siswa.createdAt,
                    updatedAt: siswa.updatedAt
                },
            });
        } catch (error) {
            console.error("Error in get siswa by id:", error);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat mengambil data siswa",
                error: error.message
            });
        }
    })
);

// ✅ Update Siswa
router.put(
    "/:id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            if (!isValidUUID(req.params.id)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Invalid siswa ID format",
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

            const { name, kelas, tahun, semester } = req.body;

            // Cek apakah siswa exists
            const existingSiswa = await Siswa.findByPk(req.params.id);
            if (!existingSiswa) {
                return res.status(404).json({
                    code: 404,
                    status: "error",
                    message: "Siswa not found",
                });
            }

            await Siswa.update({
                name,
                kelas,
                tahun,
                semester
            }, {
                where: { id: req.params.id }
            });

            // Get updated data
            const siswa = await Siswa.findByPk(req.params.id, {
                include: [{
                    model: WaliKelas,
                    as: 'walikelas',
                    include: [{
                        model: User,
                        as: 'user',
                        attributes: ['id', 'name', 'email']
                    }]
                }]
            });

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Siswa updated successfully",
                data: {
                    id: siswa.id,
                    name: siswa.name,
                    kelas: siswa.kelas,
                    tahun: siswa.tahun,
                    semester: siswa.semester,
                    walikelas: siswa.walikelas ? {
                        id: siswa.walikelas.id,
                        user: {
                            id: siswa.walikelas.user.id,
                            name: siswa.walikelas.user.name,
                            email: siswa.walikelas.user.email
                        },
                        sekolah: siswa.walikelas.sekolah,
                        jurusan: siswa.walikelas.jurusan
                    } : null,
                    createdAt: siswa.createdAt,
                    updatedAt: siswa.updatedAt
                },
            });
        } catch (error) {
            console.error("Error in update siswa:", error);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat mengupdate siswa",
                error: error.message
            });
        }
    })
);

// ✅ Delete Siswa
router.delete(
    "/:id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            if (!isValidUUID(req.params.id)) {
                return res.status(400).json({
                    code: 400,
                    status: "error",
                    message: "Invalid siswa ID format",
                });
            }

            const deleted = await Siswa.destroy({
                where: { id: req.params.id }
            });

            if (!deleted) {
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
        } catch (error) {
            console.error("Error in delete siswa:", error);
            res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat menghapus siswa",
                error: error.message
            });
        }
    })
);

module.exports = router;