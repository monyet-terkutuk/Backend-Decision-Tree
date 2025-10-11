const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: false,
    },
    role: {
      type: String,
      enum: ['walikelas', 'operator'],
      default: 'walikelas',
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = model('User', userSchema);
