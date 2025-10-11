const express = require("express");
const router = express.Router();
const Siswa = require("../model/Siswa");
const Validator = require("fastest-validator");
const v = new Validator();
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const axios = require("axios");

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
        const response = await axios.post("http://127.0.0.1:5000/predict", {
            nilai_akademik: nilai_akademik,
            total_kehadiran: total_kehadiran
        });

        return response.data.prediksi_prestasi;
    } catch (error) {
        console.error("Error calling prediction API:", error.message);
        return null;
    }
};

// ✅ Create Siswa dengan prediksi otomatis
router.post(
    "",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
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
            // Jika API gagal, berikan nilai default
            if (!prestasi) {
                prestasi = "Cukup"; // Nilai default jika API error
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
router.get(
    "/list",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        const { kelas, tahun, semester, walikelas_id } = req.query;

        let filter = {};
        if (kelas) filter.kelas = kelas;
        if (tahun) filter.tahun = parseInt(tahun);
        if (semester) filter.semester = semester;
        if (walikelas_id) filter.walikelas_id = walikelas_id;

        const siswaList = await Siswa.find(filter)
            .sort({ createdAt: -1 })
            .populate("walikelas_id");

        res.status(200).json({
            code: 200,
            status: "success",
            data: siswaList.map((siswa) => ({
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
            })),
        });
    })
);

// ✅ Get Siswa by ID
router.get(
    "/:id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
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
                prestasi = existingSiswa.prestasi; // Keep existing if API fails
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