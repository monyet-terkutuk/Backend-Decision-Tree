const express = require("express");
const router = express.Router();
const Siswa = require("../model/Siswa");
const User = require("../model/User");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated } = require("../middleware/auth");
const mongoose = require('mongoose'); // IMPORT MONGOOSE

// ✅ Get Dashboard Statistics
router.get(
    "/statistics",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { tahun, semester } = req.query;

            // Build match stage untuk filter
            let matchStage = {};
            if (tahun) matchStage.tahun = parseInt(tahun);
            if (semester) matchStage.semester = semester;

            // 1. Total Wali Kelas
            const totalWaliKelas = await User.countDocuments({ role: 'walikelas' });

            // 2. Total Siswa
            const totalSiswa = await Siswa.countDocuments(matchStage);

            // 3. Rata-rata Nilai Akademik
            const avgNilaiResult = await Siswa.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: null,
                        avgNilai: { $avg: "$nilai" }
                    }
                }
            ]);
            const avgNilai = avgNilaiResult.length > 0 ? Math.round(avgNilaiResult[0].avgNilai * 100) / 100 : 0;

            // 4. Rata-rata Kehadiran
            const avgKehadiranResult = await Siswa.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: null,
                        avgKehadiran: { $avg: "$kehadiran" }
                    }
                }
            ]);
            const avgKehadiran = avgKehadiranResult.length > 0 ? Math.round(avgKehadiranResult[0].avgKehadiran * 100) / 100 : 0;

            // 5. Jumlah Kelas (unik)
            const kelasResult = await Siswa.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: "$kelas"
                    }
                },
                {
                    $count: "totalKelas"
                }
            ]);
            const totalKelas = kelasResult.length > 0 ? kelasResult[0].totalKelas : 0;

            // 6. Distribusi Prestasi per Semester
            const prestasiDistribution = await Siswa.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: "$prestasi",
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        prestasi: "$_id",
                        count: 1,
                        _id: 0
                    }
                },
                {
                    $sort: { count: -1 }
                }
            ]);

            // Format distribusi prestasi dengan semua kategori
            const allPrestasiCategories = ['Sangat Baik', 'Baik', 'Cukup', 'Kurang', 'Kurang Sekali'];
            const formattedPrestasi = allPrestasiCategories.map(category => {
                const found = prestasiDistribution.find(item => item.prestasi === category);
                return {
                    prestasi: category,
                    count: found ? found.count : 0
                };
            });

            // 7. Data untuk chart - Prestasi per Semester
            const prestasiPerSemester = await Siswa.aggregate([
                {
                    $match: matchStage
                },
                {
                    $group: {
                        _id: {
                            semester: "$semester",
                            prestasi: "$prestasi"
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $group: {
                        _id: "$_id.semester",
                        data: {
                            $push: {
                                prestasi: "$_id.prestasi",
                                count: "$count"
                            }
                        }
                    }
                },
                {
                    $project: {
                        semester: "$_id",
                        data: 1,
                        _id: 0
                    }
                },
                {
                    $sort: { semester: 1 }
                }
            ]);

            // 8. Data untuk chart - Rata-rata per Kelas
            const avgPerKelas = await Siswa.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: "$kelas",
                        avgNilai: { $avg: "$nilai" },
                        avgKehadiran: { $avg: "$kehadiran" },
                        totalSiswa: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        kelas: "$_id",
                        avgNilai: { $round: ["$avgNilai", 2] },
                        avgKehadiran: { $round: ["$avgKehadiran", 2] },
                        totalSiswa: 1,
                        _id: 0
                    }
                },
                {
                    $sort: { kelas: 1 }
                }
            ]);

            // 9. Trend Nilai per Tahun
            const trendPerTahun = await Siswa.aggregate([
                {
                    $group: {
                        _id: "$tahun",
                        avgNilai: { $avg: "$nilai" },
                        avgKehadiran: { $avg: "$kehadiran" },
                        totalSiswa: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        tahun: "$_id",
                        avgNilai: { $round: ["$avgNilai", 2] },
                        avgKehadiran: { $round: ["$avgKehadiran", 2] },
                        totalSiswa: 1,
                        _id: 0
                    }
                },
                {
                    $sort: { tahun: 1 }
                }
            ]);

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Dashboard statistics retrieved successfully",
                data: {
                    summary: {
                        totalWaliKelas,
                        totalSiswa,
                        avgNilai,
                        avgKehadiran,
                        totalKelas
                    },
                    prestasiDistribution: formattedPrestasi,
                    charts: {
                        prestasiPerSemester,
                        avgPerKelas,
                        trendPerTahun
                    }
                }
            });

        } catch (error) {
            return res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat mengambil data statistik",
                error: error.message
            });
        }
    })
);

// ✅ Get Statistics by Wali Kelas (untuk wali kelas tertentu)
router.get(
    "/walikelas/:walikelas_id",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { walikelas_id } = req.params;
            const { tahun, semester } = req.query;

            // Build match stage untuk filter
            let matchStage = { walikelas_id: new mongoose.Types.ObjectId(walikelas_id) };
            if (tahun) matchStage.tahun = parseInt(tahun);
            if (semester) matchStage.semester = semester;

            // Total Siswa untuk wali kelas ini
            const totalSiswa = await Siswa.countDocuments(matchStage);

            // Rata-rata Nilai dan Kehadiran
            const avgStats = await Siswa.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: null,
                        avgNilai: { $avg: "$nilai" },
                        avgKehadiran: { $avg: "$kehadiran" }
                    }
                }
            ]);

            const avgNilai = avgStats.length > 0 ? Math.round(avgStats[0].avgNilai * 100) / 100 : 0;
            const avgKehadiran = avgStats.length > 0 ? Math.round(avgStats[0].avgKehadiran * 100) / 100 : 0;

            // Jumlah Kelas untuk wali kelas ini
            const kelasResult = await Siswa.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: "$kelas"
                    }
                },
                {
                    $count: "totalKelas"
                }
            ]);
            const totalKelas = kelasResult.length > 0 ? kelasResult[0].totalKelas : 0;

            // Distribusi Prestasi
            const prestasiDistribution = await Siswa.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: "$prestasi",
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        prestasi: "$_id",
                        count: 1,
                        _id: 0
                    }
                }
            ]);

            // Format distribusi prestasi dengan semua kategori
            const allPrestasiCategories = ['Sangat Baik', 'Baik', 'Cukup', 'Kurang', 'Kurang Sekali'];
            const formattedPrestasi = allPrestasiCategories.map(category => {
                const found = prestasiDistribution.find(item => item.prestasi === category);
                return {
                    prestasi: category,
                    count: found ? found.count : 0
                };
            });

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Wali kelas statistics retrieved successfully",
                data: {
                    summary: {
                        totalSiswa,
                        avgNilai,
                        avgKehadiran,
                        totalKelas
                    },
                    prestasiDistribution: formattedPrestasi
                }
            });

        } catch (error) {
            return res.status(500).json({
                code: 500,
                status: "error",
                message: "Terjadi kesalahan saat mengambil data statistik wali kelas",
                error: error.message
            });
        }
    })
);

// ✅ Get Available Years and Semesters (untuk filter)
router.get(
    "/filters",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const years = await Siswa.distinct("tahun");
            const semesters = await Siswa.distinct("semester");
            const classes = await Siswa.distinct("kelas");

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Available filters retrieved successfully",
                data: {
                    years: years.sort((a, b) => b - a), // Urutkan tahun descending
                    semesters: semesters.sort(),
                    classes: classes.sort()
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

module.exports = router;