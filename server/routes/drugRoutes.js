const express = require('express');
const drugCtrl = require('../controllers/drugController');
const verifyToken = require('../middlewares/authMiddleware');
const authorizeRole = require('../middlewares/roleMiddleware');
const importController = require('../controllers/importController');
const upload = require('../middlewares/upload');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// GET CSV template for drug import
router.get('/download-template', verifyToken, authorizeRole('admin', 'institute', 'pharmacy'), (req, res) => {
  try {
    const filePath = path.join(__dirname, '..', 'templates', 'Final_medslist.csv');

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        status: false,
        message: 'Template file not found'
      });
    }

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="Final_medslist.csv"');

    // Send the file
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error('Error serving CSV template:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to download template'
    });
  }
});

router.post('/import', verifyToken, authorizeRole('admin', 'institute', 'pharmacy'), upload.single('file'), importController.importDrugs);

// POST Drug all users can create drugs
router.post('/', verifyToken, authorizeRole('admin', 'institute', 'pharmacy'), drugCtrl.addDrug);

// GET All Drugs
router.get('/', verifyToken, authorizeRole('admin', 'institute', 'pharmacy'), drugCtrl.getDrugs);

// GET Expiring Drugs (with optional query parameters) 
router.get('/expiring', verifyToken, authorizeRole('admin', 'institute', 'pharmacy'), drugCtrl.getExpiringDrugs);

// GET Single Drug
router.get('/:id', verifyToken, authorizeRole('admin', 'institute', 'pharmacy'), drugCtrl.getDrugById);

// UPDATE Drugs
router.put('/:id', verifyToken, authorizeRole('admin', 'institute', 'pharmacy'), drugCtrl.updateDrug);

// DELETE Drug
router.delete('/:id', verifyToken, authorizeRole('admin', 'institute', 'pharmacy'), drugCtrl.deleteDrug);




module.exports = router;
