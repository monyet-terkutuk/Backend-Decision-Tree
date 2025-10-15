const express = require("express");
const router = express.Router();
const Siswa = require("../model/Siswa");
const User = require("../model/User");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated } = require("../middleware/auth");
const { Op, Sequelize } = require("sequelize");

// ✅ Get Dashboard Statistics
router.get(
    "/statistics",
    isAuthenticated,
    catchAsyncErrors(async (req, res) => {
        try {
            const { tahun, semester } = req.query;

            // Build where condition untuk filter
            let whereCondition = {};
            if (tahun) whereCondition.tahun = parseInt(tahun);
            if (semester) whereCondition.semester = semester;

            // 1. Total Wali Kelas
            const totalWaliKelas = await User.count({
                where: { role: 'walikelas' }
            });

            // 2. Total Siswa
            const totalSiswa = await Siswa.count({ where: whereCondition });

            // 3. Rata-rata Nilai Akademik
            const avgNilaiResult = await Siswa.findOne({
                where: whereCondition,
                attributes: [
                    [Sequelize.fn('AVG', Sequelize.col('nilai')), 'avgNilai']
                ],
                raw: true
            });
            const avgNilai = avgNilaiResult?.avgNilai ?
                Math.round(parseFloat(avgNilaiResult.avgNilai) * 100) / 100 : 0;

            // 4. Rata-rata Kehadiran
            const avgKehadiranResult = await Siswa.findOne({
                where: whereCondition,
                attributes: [
                    [Sequelize.fn('AVG', Sequelize.col('kehadiran')), 'avgKehadiran']
                ],
                raw: true
            });
            const avgKehadiran = avgKehadiranResult?.avgKehadiran ?
                Math.round(parseFloat(avgKehadiranResult.avgKehadiran) * 100) / 100 : 0;

            // 5. Jumlah Kelas (unik)
            const totalKelas = await Siswa.count({
                where: whereCondition,
                distinct: true,
                col: 'kelas'
            });

            // 6. Distribusi Prestasi
            const prestasiDistribution = await Siswa.findAll({
                where: whereCondition,
                attributes: [
                    'prestasi',
                    [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
                ],
                group: ['prestasi'],
                raw: true
            });

            // Format distribusi prestasi dengan semua kategori
            const allPrestasiCategories = ['Sangat Baik', 'Baik', 'Cukup', 'Kurang', 'Kurang Sekali'];
            const formattedPrestasi = allPrestasiCategories.map(category => {
                const found = prestasiDistribution.find(item => item.prestasi === category);
                return {
                    prestasi: category,
                    count: found ? parseInt(found.count) : 0
                };
            });

            // 7. Data untuk chart - Prestasi per Semester
            const prestasiPerSemester = await Siswa.findAll({
                where: whereCondition,
                attributes: [
                    'semester',
                    'prestasi',
                    [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
                ],
                group: ['semester', 'prestasi'],
                order: [['semester', 'ASC']],
                raw: true
            });

            // Format data prestasi per semester
            const formattedPrestasiPerSemester = prestasiPerSemester.reduce((acc, item) => {
                const existingSemester = acc.find(s => s.semester === item.semester);
                if (existingSemester) {
                    existingSemester.data.push({
                        prestasi: item.prestasi,
                        count: parseInt(item.count)
                    });
                } else {
                    acc.push({
                        semester: item.semester,
                        data: [{
                            prestasi: item.prestasi,
                            count: parseInt(item.count)
                        }]
                    });
                }
                return acc;
            }, []);

            // 8. Data untuk chart - Rata-rata per Kelas
            const avgPerKelas = await Siswa.findAll({
                where: whereCondition,
                attributes: [
                    'kelas',
                    [Sequelize.fn('AVG', Sequelize.col('nilai')), 'avgNilai'],
                    [Sequelize.fn('AVG', Sequelize.col('kehadiran')), 'avgKehadiran'],
                    [Sequelize.fn('COUNT', Sequelize.col('id')), 'totalSiswa']
                ],
                group: ['kelas'],
                order: [['kelas', 'ASC']],
                raw: true
            });

            // Format data avg per kelas
            const formattedAvgPerKelas = avgPerKelas.map(item => ({
                kelas: item.kelas,
                avgNilai: item.avgNilai ? Math.round(parseFloat(item.avgNilai) * 100) / 100 : 0,
                avgKehadiran: item.avgKehadiran ? Math.round(parseFloat(item.avgKehadiran) * 100) / 100 : 0,
                totalSiswa: parseInt(item.totalSiswa)
            }));

            // 9. Trend Nilai per Tahun
            const trendPerTahun = await Siswa.findAll({
                attributes: [
                    'tahun',
                    [Sequelize.fn('AVG', Sequelize.col('nilai')), 'avgNilai'],
                    [Sequelize.fn('AVG', Sequelize.col('kehadiran')), 'avgKehadiran'],
                    [Sequelize.fn('COUNT', Sequelize.col('id')), 'totalSiswa']
                ],
                group: ['tahun'],
                order: [['tahun', 'ASC']],
                raw: true
            });

            // Format data trend per tahun
            const formattedTrendPerTahun = trendPerTahun.map(item => ({
                tahun: item.tahun,
                avgNilai: item.avgNilai ? Math.round(parseFloat(item.avgNilai) * 100) / 100 : 0,
                avgKehadiran: item.avgKehadiran ? Math.round(parseFloat(item.avgKehadiran) * 100) / 100 : 0,
                totalSiswa: parseInt(item.totalSiswa)
            }));

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
                        prestasiPerSemester: formattedPrestasiPerSemester,
                        avgPerKelas: formattedAvgPerKelas,
                        trendPerTahun: formattedTrendPerTahun
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

            // Build where condition untuk filter
            let whereCondition = { walikelas_id };
            if (tahun) whereCondition.tahun = parseInt(tahun);
            if (semester) whereCondition.semester = semester;

            // Total Siswa untuk wali kelas ini
            const totalSiswa = await Siswa.count({ where: whereCondition });

            // Rata-rata Nilai dan Kehadiran
            const avgStats = await Siswa.findOne({
                where: whereCondition,
                attributes: [
                    [Sequelize.fn('AVG', Sequelize.col('nilai')), 'avgNilai'],
                    [Sequelize.fn('AVG', Sequelize.col('kehadiran')), 'avgKehadiran']
                ],
                raw: true
            });

            const avgNilai = avgStats?.avgNilai ?
                Math.round(parseFloat(avgStats.avgNilai) * 100) / 100 : 0;
            const avgKehadiran = avgStats?.avgKehadiran ?
                Math.round(parseFloat(avgStats.avgKehadiran) * 100) / 100 : 0;

            // Jumlah Kelas untuk wali kelas ini
            const totalKelas = await Siswa.count({
                where: whereCondition,
                distinct: true,
                col: 'kelas'
            });

            // Distribusi Prestasi
            const prestasiDistribution = await Siswa.findAll({
                where: whereCondition,
                attributes: [
                    'prestasi',
                    [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
                ],
                group: ['prestasi'],
                raw: true
            });

            // Format distribusi prestasi dengan semua kategori
            const allPrestasiCategories = ['Sangat Baik', 'Baik', 'Cukup', 'Kurang', 'Kurang Sekali'];
            const formattedPrestasi = allPrestasiCategories.map(category => {
                const found = prestasiDistribution.find(item => item.prestasi === category);
                return {
                    prestasi: category,
                    count: found ? parseInt(found.count) : 0
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
            // Get distinct years
            const years = await Siswa.findAll({
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('tahun')), 'tahun']],
                order: [['tahun', 'DESC']],
                raw: true
            });

            // Get distinct semesters
            const semesters = await Siswa.findAll({
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('semester')), 'semester']],
                order: [['semester', 'ASC']],
                raw: true
            });

            // Get distinct classes
            const classes = await Siswa.findAll({
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('kelas')), 'kelas']],
                order: [['kelas', 'ASC']],
                raw: true
            });

            res.status(200).json({
                code: 200,
                status: "success",
                message: "Available filters retrieved successfully",
                data: {
                    years: years.map(item => item.tahun),
                    semesters: semesters.map(item => item.semester),
                    classes: classes.map(item => item.kelas)
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