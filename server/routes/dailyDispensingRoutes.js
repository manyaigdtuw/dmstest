const express = require('express');
const router = express.Router();
const dailyDispensingCtrl = require('../controllers/dailyDispensingController');
const verifyToken = require('../middlewares/authMiddleware');
const authorizeRole = require('../middlewares/roleMiddleware');
const upload = require('../middlewares/upload'); // Make sure you have this upload middleware

// POST - Record/Update daily dispensing for a drug
router.post('/', verifyToken, authorizeRole('pharmacy'), dailyDispensingCtrl.recordDailyDispensing);

// POST - Import dispensing records from CSV
router.post('/importcsv', verifyToken, authorizeRole('pharmacy'), upload.single('file'), dailyDispensingCtrl.importDispensingRecords);

// GET - Get daily dispensing records with filters
router.get('/', verifyToken, authorizeRole('pharmacy'), dailyDispensingCtrl.getDailyDispensing);

// GET - Get today's dispensing records
router.get('/today', verifyToken, authorizeRole('pharmacy'), dailyDispensingCtrl.getTodayDispensing);

// GET - Get dispensing summary for date range
router.get('/summary', verifyToken, authorizeRole('pharmacy'), dailyDispensingCtrl.getDispensingSummary);

// DELETE - Remove dispensing record (with stock adjustment)
router.delete('/:id', verifyToken, authorizeRole('pharmacy'), dailyDispensingCtrl.deleteDispensingRecord);

module.exports = router;