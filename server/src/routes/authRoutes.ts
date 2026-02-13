import { Router } from 'express';
import { body } from 'express-validator';
import {
  register,
  login,
  refreshToken,
  logout,
  getProfile,
  updateProfile,
  changePassword,
} from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// Register
router.post(
  '/register',
  validate([
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    body('studentId').notEmpty().withMessage('Student ID is required'),
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
    body('phoneNumber').isMobilePhone('any').withMessage('Valid phone number is required'),
  ]),
  register
);

// Login
router.post(
  '/login',
  validate([
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ]),
  login
);

// Refresh token
router.post(
  '/refresh',
  validate([body('refreshToken').notEmpty().withMessage('Refresh token is required')]),
  refreshToken
);

// Logout (protected)
router.post('/logout', authenticate, logout);

// Get profile (protected)
router.get('/profile', authenticate, getProfile);

// Update profile (protected)
router.put('/profile', authenticate, updateProfile);

// Change password (protected)
router.put(
  '/password',
  authenticate,
  validate([
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters'),
  ]),
  changePassword
);

export default router;
