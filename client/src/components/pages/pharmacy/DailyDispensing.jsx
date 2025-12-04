import React, { useState, useEffect } from 'react';
import { FaSyringe, FaPills, FaUndo, FaFileImport } from 'react-icons/fa';
import { FiPlus, FiCalendar, FiTrash2, FiDownload } from 'react-icons/fi';
import api from '../../../api/api';

const DailyDispensing = () => {
  const [drugs, setDrugs] = useState([]);
  const [todayRecords, setTodayRecords] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState('OPD');
  const [isLoading, setIsLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  
  const [dispensingForm, setDispensingForm] = useState({
    drug_id: '',
    quantity_dispensed: 1,
    notes: ''
  });

  // Fetch drugs and today's records
  useEffect(() => {
    fetchDrugs();
    fetchTodayDispensing();
  }, [selectedDate, category]);

  const fetchDrugs = async () => {
    try {
      const response = await api.get('/drugs');
      if (response.data.drugs) {
        setDrugs(response.data.drugs);
      }
    } catch (error) {
      console.error('Error fetching drugs:', error);
    }
  };

  const fetchTodayDispensing = async () => {
    try {
      const response = await api.get('/daily-dispensing', {
        params: { date: selectedDate, category }
      });
      if (response.data.records) {
        setTodayRecords(response.data.records);
      }
    } catch (error) {
      console.error('Error fetching dispensing records:', error);
    }
  };

  const handleRecordDispensing = async (e) => {
    e.preventDefault();
    if (!dispensingForm.drug_id) {
      alert('Please select a drug');
      return;
    }

    setIsLoading(true);
    try {
      await api.post('/daily-dispensing', {
        ...dispensingForm,
        category,
        dispensing_date: selectedDate
      });
      
      // Reset form and refresh data
      setDispensingForm({
        drug_id: '',
        quantity_dispensed: 1,
        notes: ''
      });
      fetchTodayDispensing();
      fetchDrugs(); // Refresh to get updated stock
      
      alert('Dispensing recorded successfully!');
    } catch (error) {
      console.error('Error recording dispensing:', error);
      alert(error.response?.data?.message || 'Failed to record dispensing');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteRecord = async (recordId) => {
    if (!confirm('Are you sure you want to delete this dispensing record? Stock will be restored.')) {
      return;
    }

    try {
      await api.delete(`/daily-dispensing/${recordId}`);
      fetchTodayDispensing();
      fetchDrugs(); // Refresh to get updated stock
      alert('Record deleted successfully!');
    } catch (error) {
      console.error('Error deleting record:', error);
      alert('Failed to delete record');
    }
  };

  const handleImportCSV = async (e) => {
    e.preventDefault();
    if (!importFile) {
      alert('Please select a CSV file to import');
      return;
    }

    setImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('dispensing_date', selectedDate);
      formData.append('category', category);

      const response = await api.post('/daily-dispensing/importcsv', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.status) {
        alert(`Successfully imported ${response.data.imported} records! ${response.data.errors.length > 0 ? `${response.data.errors.length} records had errors.` : ''}`);
        if (response.data.errors.length > 0) {
          console.log('Import errors:', response.data.errors);
        }
        setShowImportModal(false);
        setImportFile(null);
        fetchTodayDispensing();
        fetchDrugs(); // Refresh to get updated stock
      } else {
        throw new Error(response.data.message || 'Import failed');
      }
    } catch (error) {
      console.error('Error importing CSV:', error);
      alert(error.response?.data?.message || 'Failed to import CSV file');
    } finally {
      setImportLoading(false);
    }
  };

  const downloadSampleCSV = () => {
    const sampleData = `drug_name,quantity_dispensed,notes
Paracetamol 500mg,10,For OPD patients
Amoxicillin 250mg,5,IPD dispensing
Vitamin B Complex,8,Outreach program`;

    const blob = new Blob([sampleData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dispensing_sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const getDrugStock = (drugId) => {
    const drug = drugs.find(d => d.id === drugId);
    return drug ? drug.stock : 0;
  };

  const totalDispensedToday = todayRecords.reduce((sum, record) => sum + record.quantity_dispensed, 0);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center">
            <FaSyringe className="mr-2 text-green-600" />
            Daily Dispensing Register
          </h2>
          <div className="flex items-center gap-4 mt-2 md:mt-0">
            <div className="flex items-center gap-2">
              <FiCalendar className="text-gray-500" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1"
              />
            </div>
            <button
              onClick={() => setShowImportModal(true)}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"
            >
              <FaFileImport className="h-4 w-4" />
              Import CSV
            </button>
          </div>
        </div>

        {/* Today's Summary */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{todayRecords.length}</div>
              <div className="text-sm text-gray-600">Drugs Dispensed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{totalDispensedToday}</div>
              <div className="text-sm text-gray-600">Total Quantity</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{category}</div>
              <div className="text-sm text-gray-600">Current Category</div>
            </div>
            <div className="text-center">
              <button
                onClick={downloadSampleCSV}
                className="text-blue-600 hover:text-blue-800 flex items-center gap-2 mx-auto"
              >
                <FiDownload className="h-4 w-4" />
                <span className="text-sm">Download Sample CSV</span>
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Record Dispensing Form */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                <FiPlus className="mr-2 text-blue-600" />
                Record Dispensing
              </h3>
              
              <form onSubmit={handleRecordDispensing}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="OPD">OPD</option>
                      <option value="IPD">IPD</option>
                      <option value="OUTREACH">OUTREACH</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Select Drug
                    </label>
                    <select
                      value={dispensingForm.drug_id}
                      onChange={(e) => setDispensingForm(prev => ({
                        ...prev,
                        drug_id: e.target.value
                      }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="">Choose a drug...</option>
                      {drugs.map(drug => (
                        <option key={drug.id} value={drug.id}>
                          {drug.name} (Stock: {drug.stock}, Batch: {drug.batch_no})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Quantity Dispensed
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={dispensingForm.quantity_dispensed}
                      onChange={(e) => setDispensingForm(prev => ({
                        ...prev,
                        quantity_dispensed: parseInt(e.target.value) || 1
                      }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Notes (Optional)
                    </label>
                    <textarea
                      value={dispensingForm.notes}
                      onChange={(e) => setDispensingForm(prev => ({
                        ...prev,
                        notes: e.target.value
                      }))}
                      rows="2"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {dispensingForm.drug_id && (
                    <div className="bg-blue-50 p-3 rounded-md">
                      <div className="text-sm text-blue-700">
                        Current Stock: <strong>{getDrugStock(dispensingForm.drug_id)}</strong><br />
                        After Dispensing: <strong>{getDrugStock(dispensingForm.drug_id) - dispensingForm.quantity_dispensed}</strong>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !dispensingForm.drug_id}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Recording...' : 'Record Dispensing'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Today's Dispensing Records */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                  <FaPills className="mr-2 text-green-600" />
                  Today's Dispensing ({selectedDate}) - {category}
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Drug Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Batch No
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Quantity
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Current Stock
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {todayRecords.map(record => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{record.drug_name}</div>
                          <div className="text-sm text-gray-500">{record.category}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {record.batch_no}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            {record.quantity_dispensed}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {record.current_stock}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleDeleteRecord(record.id)}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Delete record and restore stock"
                          >
                            <FiTrash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {todayRecords.length === 0 && (
                      <tr>
                        <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                          No dispensing records for {selectedDate} in {category} category
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Import CSV Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                <FaFileImport className="mr-2 text-green-600" />
                Import Dispensing Records
              </h3>
            </div>
            
            <form onSubmit={handleImportCSV} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select CSV File
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setImportFile(e.target.files[0])}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  CSV should have columns: drug_name, quantity_dispensed, notes
                </p>
              </div>

              <div className="bg-yellow-50 p-3 rounded-md">
                <h4 className="text-sm font-medium text-yellow-800 mb-1">Important Notes:</h4>
                <ul className="text-xs text-yellow-700 list-disc list-inside space-y-1">
                  <li>Drug names must match exactly with your inventory</li>
                  <li>Quantity must be positive numbers</li>
                  <li>Stock will be automatically deducted</li>
                  <li>Date and category will be set as per current selection</li>
                </ul>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowImportModal(false);
                    setImportFile(null);
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importLoading || !importFile}
                  className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {importLoading ? 'Importing...' : 'Import Records'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyDispensing;