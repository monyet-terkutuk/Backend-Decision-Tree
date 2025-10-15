require('dotenv').config();
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("./catchAsyncErrors");
const jwt = require("jsonwebtoken");
const User = require("../model/User");

exports.isAuthenticated = catchAsyncErrors(async (req, res, next) => {
  const token = req.headers.authorization;
  console.log("ini token", token);

  if (!token) {
    return next(new ErrorHandler("Please login to continue", 401));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

    // GANTI: User.findById → User.findByPk
    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ['password'] } // exclude password untuk keamanan
    });

    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    req.user = user; // Store user data in request object
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new ErrorHandler("Invalid token", 401));
    } else if (error.name === 'TokenExpiredError') {
      return next(new ErrorHandler("Token expired", 401));
    } else {
      return next(new ErrorHandler("Authentication failed", 401));
    }
  }
});

exports.isAdmin = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ErrorHandler("Please authenticate first", 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new ErrorHandler(`${req.user.role} can not access this resources!`, 403)
      );
    }
    next();
  };
};

exports.isOfficer = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ErrorHandler("Please authenticate first", 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new ErrorHandler(`${req.user.role} can not access this resources!`, 403)
      );
    }
    next();
  };
};

// Middleware tambahan untuk role-based access yang lebih spesifik
exports.isOperator = (req, res, next) => {
  if (!req.user) {
    return next(new ErrorHandler("Please authenticate first", 401));
  }

  if (req.user.role !== 'operator') {
    return next(
      new ErrorHandler(`${req.user.role} can not access this resources!`, 403)
    );
  }
  next();
};

exports.isWaliKelas = (req, res, next) => {
  if (!req.user) {
    return next(new ErrorHandler("Please authenticate first", 401));
  }

  if (req.user.role !== 'walikelas') {
    return next(
      new ErrorHandler(`${req.user.role} can not access this resources!`, 403)
    );
  }
  next();
};