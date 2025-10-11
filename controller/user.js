const express = require("express");
const router = express.Router();
const User = require("../model/User");
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");
const Validator = require("fastest-validator");
const v = new Validator();

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
    role: { type: "string", enum: ["walikelas", "operator"], empty: false }
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

  const { name, email, password, phone, role } = req.body;

  // Check if email already exists
  const emailUsed = await User.findOne({ email });
  if (emailUsed) {
    return res.status(400).json({
      code: 400,
      status: "error",
      message: "Email has been used",
    });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    phone: phone || "",
    role
  });

  return res.status(201).json({
    code: 201,
    status: "success",
    message: "User registered successfully",
    data: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt
    },
  });
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

  // Find user by email
  const user = await User.findOne({ email });
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

  // Generate JWT token
  const token = jwt.sign(
    {
      id: user._id,
      role: user.role,
      name: user.name,
      email: user.email
    },
    process.env.JWT_SECRET_KEY,
    { expiresIn: "24h" }
  );

  return res.status(200).json({
    code: 200,
    status: "success",
    message: "Login successful",
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      token,
    },
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
    const user = await User.findById(req.user.id);

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
      message: "Profile retrieved successfully",
      data: {
        id: user._id,
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

    const { name, phone } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      code: 200,
      status: "success",
      message: "Profile updated successfully",
      data: {
        id: user._id,
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

    const user = await User.findById(req.user.id);
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
    user.password = hashedPassword;
    await user.save();

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
    const users = await User.find().select('-password').sort({ createdAt: -1 });

    res.status(200).json({
      code: 200,
      status: "success",
      message: "Users retrieved successfully",
      data: users.map(user => ({
        id: user._id,
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
    const user = await User.findById(req.params.id).select('-password');

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
        id: user._id,
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

    // Check if email already exists (excluding current user)
    if (email) {
      const existingUser = await User.findOne({
        email,
        _id: { $ne: req.params.id }
      });
      if (existingUser) {
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

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

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
      message: "User updated successfully",
      data: {
        id: user._id,
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
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
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