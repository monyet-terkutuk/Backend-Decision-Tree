const express = require("express");
const router = express.Router();
const User = require("../model/User");
const WaliKelas = require("../model/Walikelas"); // Import model WaliKelas
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");
const Validator = require("fastest-validator");
const v = new Validator();
const { Op } = require("sequelize");

const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isAdmin } = require("../middleware/auth");

/**
 * @route   POST /register
 * @desc    Register new user
 */
router.post("/register", catchAsyncErrors(async (req, res, next) => {
  const schema = {
    name: { type: "string", empty: false, max: 255 },
    email: { type: "email", empty: false },
    password: { type: "string", min: 6, empty: false },
    phone: { type: "string", optional: true, max: 15 },
    role: { type: "string", enum: ["walikelas", "operator"], empty: false },
    // Field tambahan untuk WaliKelas
    sekolah: { type: "string", optional: true, max: 255 },
    jurusan: { type: "string", optional: true, max: 255 }
  };

  const validation = v.validate(req.body, schema);

  if (validation !== true) {
    return res.status(400).json({
      code: 400,
      status: "error",
      message: "Validation failed",
      data: validation,
    });
  }

  const { name, email, password, phone, role, sekolah, jurusan } = req.body;

  // Check if email already exists
  const emailUsed = await User.findOne({ where: { email } });
  if (emailUsed) {
    return res.status(400).json({
      code: 400,
      status: "error",
      message: "Email has been used",
    });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Start transaction untuk memastikan konsistensi data
  const transaction = await User.sequelize.transaction();

  try {
    // Create user
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      phone: phone || "",
      role
    }, { transaction });

    let waliKelasData = null;

    // Jika role adalah walikelas, buat entri di tabel WaliKelas
    if (role === 'walikelas') {
      waliKelasData = await WaliKelas.create({
        user_id: user.id,
        sekolah: sekolah || null,
        jurusan: jurusan || null
      }, { transaction });
    }

    // Commit transaction
    await transaction.commit();

    // Prepare response data
    const responseData = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt
    };

    // Tambahkan data WaliKelas jika ada
    if (waliKelasData) {
      responseData.walikelas = {
        id: waliKelasData.id,
        sekolah: waliKelasData.sekolah,
        jurusan: waliKelasData.jurusan
      };
    }

    return res.status(201).json({
      code: 201,
      status: "success",
      message: "User registered successfully",
      data: responseData,
    });

  } catch (error) {
    // Rollback transaction jika ada error
    await transaction.rollback();

    console.error("Registration error:", error);
    return res.status(500).json({
      code: 500,
      status: "error",
      message: "Terjadi kesalahan saat registrasi user",
      error: error.message,
    });
  }
}));

/**
 * @route   POST /login
 * @desc    Authenticate user and return token
 */
router.post("/login", catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;

  const schema = {
    email: { type: "email", empty: false },
    password: { type: "string", empty: false },
  };

  const validation = v.validate(req.body, schema);
  if (validation !== true) {
    return res.status(400).json({
      code: 400,
      status: "error",
      message: "Validation failed",
      data: validation,
    });
  }

  // Find user by email dengan include WaliKelas
  const user = await User.findOne({
    where: { email },
    include: [{
      model: WaliKelas,
      as: 'walikelas',
      attributes: ['id', 'sekolah', 'jurusan']
    }]
  });

  if (!user) {
    return res.status(401).json({
      code: 401,
      status: "error",
      message: "Invalid email or password",
    });
  }

  // Check password
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({
      code: 401,
      status: "error",
      message: "Invalid email or password",
    });
  }

  // Prepare user data for token
  const userData = {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email
  };

  // Add WaliKelas data if exists
  if (user.walikelas) {
    userData.walikelas_id = user.walikelas.id;
  }

  // Generate JWT token
  const token = jwt.sign(
    userData,
    process.env.JWT_SECRET_KEY,
    { expiresIn: "24h" }
  );

  // Prepare response data
  const responseData = {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    },
    token,
  };

  // Add WaliKelas data to response if exists
  if (user.walikelas) {
    responseData.user.walikelas = {
      id: user.walikelas.id,
      sekolah: user.walikelas.sekolah,
      jurusan: user.walikelas.jurusan
    };
  }

  return res.status(200).json({
    code: 200,
    status: "success",
    message: "Login successful",
    data: responseData,
  });
}));

/**
 * @route   GET /profile
 * @desc    Get current user profile
 */
router.get(
  "/profile",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] },
      include: [{
        model: WaliKelas,
        as: 'walikelas',
        attributes: ['id', 'sekolah', 'jurusan']
      }]
    });

    if (!user) {
      return res.status(404).json({
        code: 404,
        status: "error",
        message: "User not found",
      });
    }

    // Prepare response data
    const responseData = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    // Add WaliKelas data if exists
    if (user.walikelas) {
      responseData.walikelas = {
        id: user.walikelas.id,
        sekolah: user.walikelas.sekolah,
        jurusan: user.walikelas.jurusan
      };
    }

    res.status(200).json({
      code: 200,
      status: "success",
      message: "Profile retrieved successfully",
      data: responseData,
    });
  })
);

/**
 * @route   PUT /profile
 * @desc    Update current user profile
 */
router.put(
  "/profile",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const schema = {
      name: { type: "string", optional: true, max: 255 },
      phone: { type: "string", optional: true, max: 15 },
      // Field untuk WaliKelas
      sekolah: { type: "string", optional: true, max: 255 },
      jurusan: { type: "string", optional: true, max: 255 }
    };

    const validation = v.validate(req.body, schema);
    if (validation !== true) {
      return res.status(400).json({
        code: 400,
        status: "error",
        message: "Validation failed",
        data: validation,
      });
    }

    const { name, phone, sekolah, jurusan } = req.body;
    const transaction = await User.sequelize.transaction();

    try {
      // Update user data
      const updateData = {};
      if (name) updateData.name = name;
      if (phone) updateData.phone = phone;

      if (Object.keys(updateData).length > 0) {
        await User.update(updateData, {
          where: { id: req.user.id },
          transaction
        });
      }

      // Update WaliKelas data jika user adalah walikelas
      if (req.user.role === 'walikelas' && (sekolah !== undefined || jurusan !== undefined)) {
        const waliKelasUpdateData = {};
        if (sekolah !== undefined) waliKelasUpdateData.sekolah = sekolah;
        if (jurusan !== undefined) waliKelasUpdateData.jurusan = jurusan;

        await WaliKelas.update(waliKelasUpdateData, {
          where: { user_id: req.user.id },
          transaction
        });
      }

      await transaction.commit();

      // Get updated user data
      const user = await User.findByPk(req.user.id, {
        attributes: { exclude: ['password'] },
        include: [{
          model: WaliKelas,
          as: 'walikelas',
          attributes: ['id', 'sekolah', 'jurusan']
        }]
      });

      // Prepare response data
      const responseData = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        updatedAt: user.updatedAt
      };

      // Add WaliKelas data if exists
      if (user.walikelas) {
        responseData.walikelas = {
          id: user.walikelas.id,
          sekolah: user.walikelas.sekolah,
          jurusan: user.walikelas.jurusan
        };
      }

      res.status(200).json({
        code: 200,
        status: "success",
        message: "Profile updated successfully",
        data: responseData,
      });

    } catch (error) {
      await transaction.rollback();
      console.error("Profile update error:", error);
      return res.status(500).json({
        code: 500,
        status: "error",
        message: "Terjadi kesalahan saat update profile",
        error: error.message,
      });
    }
  })
);

/**
 * @route   PUT /:id
 * @desc    Update user by ID (Admin only)
 */
router.put(
  "/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    // Check if user is admin/operator
    if (req.user.role !== 'operator') {
      return res.status(403).json({
        code: 403,
        status: "error",
        message: "Access denied. Admin role required.",
      });
    }

    const schema = {
      name: { type: "string", optional: true, max: 255 },
      email: { type: "email", optional: true },
      phone: { type: "string", optional: true, max: 15 },
      role: { type: "string", optional: true, enum: ["walikelas", "operator"] },
      // Field untuk WaliKelas
      sekolah: { type: "string", optional: true, max: 255 },
      jurusan: { type: "string", optional: true, max: 255 }
    };

    const validation = v.validate(req.body, schema);
    if (validation !== true) {
      return res.status(400).json({
        code: 400,
        status: "error",
        message: "Validation failed",
        data: validation,
      });
    }

    const { name, email, phone, role, sekolah, jurusan } = req.body;

    // Check if user exists
    const existingUser = await User.findByPk(req.params.id, {
      include: [{
        model: WaliKelas,
        as: 'walikelas'
      }]
    });

    if (!existingUser) {
      return res.status(404).json({
        code: 404,
        status: "error",
        message: "User not found",
      });
    }

    // Check if email already exists (excluding current user)
    if (email) {
      const userWithEmail = await User.findOne({
        where: {
          email,
          id: { [Op.ne]: req.params.id }
        }
      });
      if (userWithEmail) {
        return res.status(400).json({
          code: 400,
          status: "error",
          message: "Email already exists",
        });
      }
    }

    const transaction = await User.sequelize.transaction();

    try {
      // Update user data
      const updateData = {};
      if (name) updateData.name = name;
      if (email) updateData.email = email;
      if (phone) updateData.phone = phone;
      if (role) updateData.role = role;

      if (Object.keys(updateData).length > 0) {
        await User.update(updateData, {
          where: { id: req.params.id },
          transaction
        });
      }

      // Handle WaliKelas data based on role change
      if (role) {
        if (role === 'walikelas') {
          // Jika role diubah menjadi walikelas, buat atau update WaliKelas
          if (existingUser.walikelas) {
            // Update existing WaliKelas
            const waliKelasUpdateData = {};
            if (sekolah !== undefined) waliKelasUpdateData.sekolah = sekolah;
            if (jurusan !== undefined) waliKelasUpdateData.jurusan = jurusan;

            await WaliKelas.update(waliKelasUpdateData, {
              where: { user_id: req.params.id },
              transaction
            });
          } else {
            // Create new WaliKelas
            await WaliKelas.create({
              user_id: req.params.id,
              sekolah: sekolah || null,
              jurusan: jurusan || null
            }, { transaction });
          }
        } else if (role === 'operator' && existingUser.walikelas) {
          // Jika role diubah menjadi operator, hapus WaliKelas
          await WaliKelas.destroy({
            where: { user_id: req.params.id },
            transaction
          });
        }
      } else if (existingUser.role === 'walikelas' && (sekolah !== undefined || jurusan !== undefined)) {
        // Update WaliKelas data for existing walikelas
        const waliKelasUpdateData = {};
        if (sekolah !== undefined) waliKelasUpdateData.sekolah = sekolah;
        if (jurusan !== undefined) waliKelasUpdateData.jurusan = jurusan;

        await WaliKelas.update(waliKelasUpdateData, {
          where: { user_id: req.params.id },
          transaction
        });
      }

      await transaction.commit();

      // Get updated user data
      const user = await User.findByPk(req.params.id, {
        attributes: { exclude: ['password'] },
        include: [{
          model: WaliKelas,
          as: 'walikelas',
          attributes: ['id', 'sekolah', 'jurusan']
        }]
      });

      // Prepare response data
      const responseData = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        updatedAt: user.updatedAt
      };

      // Add WaliKelas data if exists
      if (user.walikelas) {
        responseData.walikelas = {
          id: user.walikelas.id,
          sekolah: user.walikelas.sekolah,
          jurusan: user.walikelas.jurusan
        };
      }

      res.status(200).json({
        code: 200,
        status: "success",
        message: "User updated successfully",
        data: responseData,
      });

    } catch (error) {
      await transaction.rollback();
      console.error("User update error:", error);
      return res.status(500).json({
        code: 500,
        status: "error",
        message: "Terjadi kesalahan saat update user",
        error: error.message,
      });
    }
  })
);

/**
 * @route   GET /list
 * @desc    Get all users (Admin only)
 */
router.get(
  "/list",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    // Check if user is admin/operator
    if (req.user.role !== 'operator') {
      return res.status(403).json({
        code: 403,
        status: "error",
        message: "Access denied. Admin role required.",
      });
    }

    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      include: [{
        model: WaliKelas,
        as: 'walikelas',
        attributes: ['id', 'sekolah', 'jurusan']
      }],
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
      code: 200,
      status: "success",
      message: "Users retrieved successfully",
      data: users.map(user => {
        const userData = {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        };

        // Add WaliKelas data if exists
        if (user.walikelas) {
          userData.walikelas = {
            id: user.walikelas.id,
            sekolah: user.walikelas.sekolah,
            jurusan: user.walikelas.jurusan
          };
        }

        return userData;
      }),
    });
  })
);

/**
 * @route   GET /:id
 * @desc    Get user by ID (Admin only)
 */
router.get(
  "/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    // Check if user is admin/operator
    if (req.user.role !== 'operator') {
      return res.status(403).json({
        code: 403,
        status: "error",
        message: "Access denied. Admin role required.",
      });
    }

    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] },
      include: [{
        model: WaliKelas,
        as: 'walikelas',
        attributes: ['id', 'sekolah', 'jurusan']
      }]
    });

    if (!user) {
      return res.status(404).json({
        code: 404,
        status: "error",
        message: "User not found",
      });
    }

    // Prepare response data
    const responseData = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    // Add WaliKelas data if exists
    if (user.walikelas) {
      responseData.walikelas = {
        id: user.walikelas.id,
        sekolah: user.walikelas.sekolah,
        jurusan: user.walikelas.jurusan
      };
    }

    res.status(200).json({
      code: 200,
      status: "success",
      message: "User retrieved successfully",
      data: responseData,
    });
  })
);

/**
 * @route   PUT /change-password
 * @desc    Change user password
 */
router.put(
  "/change-password",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const schema = {
      currentPassword: { type: "string", empty: false },
      newPassword: { type: "string", min: 6, empty: false },
    };

    const validation = v.validate(req.body, schema);
    if (validation !== true) {
      return res.status(400).json({
        code: 400,
        status: "error",
        message: "Validation failed",
        data: validation,
      });
    }

    const { currentPassword, newPassword } = req.body;

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({
        code: 404,
        status: "error",
        message: "User not found",
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        code: 400,
        status: "error",
        message: "Current password is incorrect",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await User.update(
      { password: hashedPassword },
      { where: { id: req.user.id } }
    );

    res.status(200).json({
      code: 200,
      status: "success",
      message: "Password changed successfully",
    });
  })
);

/**
 * @route   GET /list
 * @desc    Get all users (Admin only)
 */
router.get(
  "/list",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    // Check if user is admin/operator
    if (req.user.role !== 'operator') {
      return res.status(403).json({
        code: 403,
        status: "error",
        message: "Access denied. Admin role required.",
      });
    }

    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
      code: 200,
      status: "success",
      message: "Users retrieved successfully",
      data: users.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      })),
    });
  })
);

/**
 * @route   GET /:id
 * @desc    Get user by ID (Admin only)
 */
router.get(
  "/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    // Check if user is admin/operator
    if (req.user.role !== 'operator') {
      return res.status(403).json({
        code: 403,
        status: "error",
        message: "Access denied. Admin role required.",
      });
    }

    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] }
    });

    if (!user) {
      return res.status(404).json({
        code: 404,
        status: "error",
        message: "User not found",
      });
    }

    res.status(200).json({
      code: 200,
      status: "success",
      message: "User retrieved successfully",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
    });
  })
);

/**
 * @route   PUT /:id
 * @desc    Update user by ID (Admin only)
 */
router.put(
  "/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    // Check if user is admin/operator
    if (req.user.role !== 'operator') {
      return res.status(403).json({
        code: 403,
        status: "error",
        message: "Access denied. Admin role required.",
      });
    }

    const schema = {
      name: { type: "string", optional: true, max: 255 },
      email: { type: "email", optional: true },
      phone: { type: "string", optional: true, max: 15 },
      role: { type: "string", optional: true, enum: ["walikelas", "operator"] }
    };

    const validation = v.validate(req.body, schema);
    if (validation !== true) {
      return res.status(400).json({
        code: 400,
        status: "error",
        message: "Validation failed",
        data: validation,
      });
    }

    const { name, email, phone, role } = req.body;

    // Check if user exists
    const existingUser = await User.findByPk(req.params.id);
    if (!existingUser) {
      return res.status(404).json({
        code: 404,
        status: "error",
        message: "User not found",
      });
    }

    // Check if email already exists (excluding current user)
    if (email) {
      const userWithEmail = await User.findOne({
        where: {
          email,
          id: { [Op.ne]: req.params.id }
        }
      });
      if (userWithEmail) {
        return res.status(400).json({
          code: 400,
          status: "error",
          message: "Email already exists",
        });
      }
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (phone) updateData.phone = phone;
    if (role) updateData.role = role;

    await User.update(updateData, {
      where: { id: req.params.id }
    });

    // Get updated user data
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] }
    });

    res.status(200).json({
      code: 200,
      status: "success",
      message: "User updated successfully",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        updatedAt: user.updatedAt
      },
    });
  })
);

/**
 * @route   DELETE /:id
 * @desc    Delete user by ID (Admin only)
 */
router.delete(
  "/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    // Check if user is admin/operator
    if (req.user.role !== 'operator') {
      return res.status(403).json({
        code: 403,
        status: "error",
        message: "Access denied. Admin role required.",
      });
    }

    // Prevent user from deleting themselves
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        code: 400,
        status: "error",
        message: "Cannot delete your own account",
      });
    }

    const deleted = await User.destroy({
      where: { id: req.params.id }
    });

    if (!deleted) {
      return res.status(404).json({
        code: 404,
        status: "error",
        message: "User not found",
      });
    }

    return res.status(200).json({
      code: 200,
      status: "success",
      message: "User deleted successfully",
    });
  })
);

module.exports = router;