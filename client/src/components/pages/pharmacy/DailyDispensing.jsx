import React, { useState, useEffect, useContext } from 'react';
import { FaSyringe, FaPills, FaUndo, FaFileImport } from 'react-icons/fa';
import { FiPlus, FiCalendar, FiTrash2, FiDownload, FiEye } from 'react-icons/fi';
import api from '../../../api/api';
import UserContext from '../../../context/UserContext';

const DailyDispensing = () => {
  const { user } = useContext(UserContext);
  const [drugs, setDrugs] = useState([]);
  const [todayRecords, setTodayRecords] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState('OPD');
  const [isLoading, setIsLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [viewMode, setViewMode] = useState('today'); // 'today' or 'history'
  
  const [dispensingForms, setDispensingForms] = useState([
    {
      drug_id: '',
      quantity_dispensed: 1,
      notes: '',
      batch_no: ''
    },
    {
      drug_id: '',
      quantity_dispensed: 1,
      notes: '',
      batch_no: ''
    },
    {
      drug_id: '',
      quantity_dispensed: 1,
      notes: '',
      batch_no: ''
    },
    {
      drug_id: '',
      quantity_dispensed: 1,
      notes: '',
      batch_no: ''
    }
  ]);

  const isCurrentDate = selectedDate === new Date().toISOString().split('T')[0];

  const addDrugForm = () => {
    setDispensingForms([...dispensingForms, {
      drug_id: '',
      quantity_dispensed: 1,
      notes: '',
      batch_no: ''
    }]);
  };

  const removeDrugForm = (index) => {
    if (dispensingForms.length > 1) {
      setDispensingForms(dispensingForms.filter((_, i) => i !== index));
    }
  };

  const updateDrugForm = (index, field, value) => {
    const updated = [...dispensingForms];
    updated[index][field] = value;

    // Auto-fill batch_no when drug is selected
    if (field === 'drug_id' && value) {
      const selectedDrug = drugs.find(d => d.id === value);
      if (selectedDrug) {
        updated[index].batch_no = selectedDrug.batch_no;
      }
    }

    setDispensingForms(updated);
  };

  // Fetch drugs based on user role
  useEffect(() => {
    if (user?.role === 'pharmacy') {
      fetchPharmacyInventory();
    } else {
      fetchDrugs();
    }
  }, [user?.role]);

  // Fetch records based on view mode
  useEffect(() => {
    if (viewMode === 'today' && isCurrentDate) {
      fetchTodayDispensing();
    } else {
      fetchHistoryDispensing();
    }
  }, [selectedDate, category, viewMode]);

  const fetchPharmacyInventory = async () => {
    try {
      const response = await api.get('/pharmacy/inventory');
      if (response.data.drugs) {
        // Map drug_id to id for consistency with regular drug endpoint
        const mappedDrugs = response.data.drugs.map(drug => ({
          ...drug,
          id: drug.drug_id
        }));
        setDrugs(mappedDrugs);
      }
    } catch (error) {
      console.error('Error fetching pharmacy inventory:', error);
    }
  };

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
    if (!isCurrentDate) return;
    
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

  const fetchHistoryDispensing = async () => {
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

    // Validate all forms
    const invalidForms = dispensingForms.filter(form => !form.drug_id || form.quantity_dispensed <= 0);
    if (invalidForms.length > 0) {
      alert('Please select a drug and enter valid quantity for all entries');
      return;
    }

    if (!isCurrentDate) {
      alert('Entries can only be made for the current date. Please select today\'s date.');
      return;
    }

    setIsLoading(true);

    try {
      // Process each drug dispensing
      const results = [];
      const errors = [];

      for (const form of dispensingForms) {
        try {
          const response = await api.post('/daily-dispensing', {
            ...form,
            category,
            dispensing_date: selectedDate
          });
          results.push(response.data);
        } catch (error) {
          errors.push({
            drug: drugs.find(d => d.id === form.drug_id)?.name,
            error: error.response?.data?.message || 'Failed to record dispensing'
          });
        }
      }

      // Show results
      if (errors.length > 0) {
        const errorMessage = errors.map(e => `${e.drug}: ${e.error}`).join('\n');
        alert(`Some drugs failed to dispense:\n${errorMessage}`);
      } else {
        alert(`Successfully recorded dispensing for ${results.length} drugs!`);
      }

      // Reset forms and refresh data
      setDispensingForms([
        {
          drug_id: '',
          quantity_dispensed: 1,
          notes: '',
          batch_no: ''
        },
        {
          drug_id: '',
          quantity_dispensed: 1,
          notes: '',
          batch_no: ''
        },
        {
          drug_id: '',
          quantity_dispensed: 1,
          notes: '',
          batch_no: ''
        },
        {
          drug_id: '',
          quantity_dispensed: 1,
          notes: '',
          batch_no: ''
        }
      ]);

      if (viewMode === 'today') {
        fetchTodayDispensing();
      }

      // Refresh inventory based on role
      if (user?.role === 'pharmacy') {
        fetchPharmacyInventory();
      } else {
        fetchDrugs();
      }

    } catch (error) {
      console.error('Error recording dispensing:', error);
      alert('An unexpected error occurred while recording dispensing');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteRecord = async (recordId) => {
    if (!isCurrentDate) {
      alert('Only today\'s records can be deleted.');
      return;
    }

    if (!confirm('Are you sure you want to delete this dispensing record? Stock will be restored.')) {
      return;
    }

    try {
      await api.delete(`/daily-dispensing/${recordId}`);
      fetchTodayDispensing();

      // Refresh inventory based on role
      if (user?.role === 'pharmacy') {
        fetchPharmacyInventory();
      } else {
        fetchDrugs();
      }

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

    if (!isCurrentDate) {
      alert('Entries can only be imported for the current date. Please select today\'s date.');
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

        // Refresh inventory based on role
        if (user?.role === 'pharmacy') {
          fetchPharmacyInventory();
        } else {
          fetchDrugs();
        }
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
                max={new Date().toISOString().split('T')[0]}
              />
            </div>

            {/* Category Selector */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Category:</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="IPD">IPD</option>
                <option value="OPD">OPD</option>
                <option value="IEC">IEC</option>
                <option value="OUTREACH">OUTREACH</option>
              </select>
            </div>

            {/* View Mode Toggle */}
            <div className="flex bg-gray-100 rounded-md p-1">
              <button
                onClick={() => setViewMode('today')}
                className={`px-3 py-1 rounded-md text-sm font-medium ${viewMode === 'today' ? 'bg-white shadow-sm' : 'text-gray-600'}`}
              >
                <FiPlus className="inline mr-1" /> Today's Entry
              </button>
              <button
                onClick={() => setViewMode('history')}
                className={`px-3 py-1 rounded-md text-sm font-medium ${viewMode === 'history' ? 'bg-white shadow-sm' : 'text-gray-600'}`}
              >
                <FiEye className="inline mr-1" /> View History
              </button>
            </div>

            {isCurrentDate && viewMode === 'today' && (
              <button
                onClick={() => setShowImportModal(true)}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"
              >
                <FaFileImport className="h-4 w-4" />
                Import CSV
              </button>
            )}
          </div>
        </div>

        {/* Mode Indicator */}
        {!isCurrentDate && viewMode === 'today' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-6">
            <div className="flex items-center">
              <FaUndo className="text-yellow-600 mr-2" />
              <span className="text-yellow-700">
                <strong>View Mode Only:</strong> You are viewing past records. To make entries, please select today's date ({new Date().toISOString().split('T')[0]}) and switch to "Today's Entry" mode.
              </span>
            </div>
          </div>
        )}

        {/* Today's Summary */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
              <div className={`text-2xl font-bold ${isCurrentDate ? 'text-green-600' : 'text-gray-400'}`}>
                {isCurrentDate ? 'Entry Enabled' : 'View Only'}
              </div>
              <div className="text-sm text-gray-600">Mode</div>
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

        {/* Record Dispensing Form - Only shown for today */}
        {isCurrentDate && viewMode === 'today' && (
          <div className="mb-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                <FiPlus className="mr-2 text-blue-600" />
                Record Dispensing
              </h3>

              <form onSubmit={handleRecordDispensing}>
                {/* Multi-drug dispensing forms - Horizontal Grid Layout */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
                  {dispensingForms.map((form, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="text-sm font-medium text-gray-700">Drug {index + 1}</h4>
                        {dispensingForms.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeDrugForm(index)}
                            className="text-red-600 hover:text-red-800"
                            title="Remove this drug"
                          >
                            <FiTrash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      <div className="space-y-3">
                        {/* Drug selection */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Select Drug
                          </label>
                          <select
                            value={form.drug_id}
                            onChange={(e) => updateDrugForm(index, 'drug_id', Number(e.target.value))}
                            className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-blue-500 focus:border-blue-500"
                            required
                          >
                            <option value="">Choose a drug...</option>
                            {drugs.map(drug => (
                              <option key={drug.id} value={drug.id}>
                                {drug.name} (Stock: {drug.stock})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Quantity */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Quantity
                          </label>
                          <input
                            type="number"
                            min="1"
                            max={form.drug_id ? drugs.find(d => d.id === form.drug_id)?.stock : undefined}
                            value={form.quantity_dispensed}
                            onChange={(e) => updateDrugForm(index, 'quantity_dispensed', parseInt(e.target.value) || 1)}
                            className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-blue-500 focus:border-blue-500"
                            required
                          />
                        </div>

                        {/* Notes */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Notes
                          </label>
                          <textarea
                            value={form.notes}
                            onChange={(e) => updateDrugForm(index, 'notes', e.target.value)}
                            rows="2"
                            className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Optional notes..."
                          />
                        </div>

                        {/* Stock info */}
                        {form.drug_id && (
                          <div className="bg-blue-50 p-2 rounded-md">
                            <div className="text-xs text-blue-700">
                              Stock: <strong>{drugs.find(d => d.id === form.drug_id)?.stock || 0}</strong>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Add more drugs button - Spans full width at the end */}
                  <div className="md:col-span-2 lg:col-span-3 xl:col-span-4">
                    <button
                      type="button"
                      onClick={addDrugForm}
                      className="w-full h-full border-2 border-dashed border-gray-300 rounded-md py-8 text-gray-600 hover:border-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <FiPlus className="inline mr-2 text-xl" />
                      Add Another Drug
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading || dispensingForms.some(form => !form.drug_id)}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Recording...' : 'Record Dispensing'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Dispensing Records Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center">
              <FaPills className="mr-2 text-green-600" />
              {viewMode === 'today' ? `Today's Dispensing` : 'Dispensing Records'} ({selectedDate}) - {category}
              {!isCurrentDate && (
                <span className="ml-2 text-sm font-normal text-gray-500">(View Only)</span>
              )}
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
                    Notes
                  </th>
                  {isCurrentDate && viewMode === 'today' && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  )}
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
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                      {record.notes || '-'}
                    </td>
                    {isCurrentDate && viewMode === 'today' && (
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleDeleteRecord(record.id)}
                          className="text-red-600 hover:text-red-800 p-1"
                          title="Delete record and restore stock"
                        >
                          <FiTrash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {todayRecords.length === 0 && (
                  <tr>
                    <td colSpan={isCurrentDate && viewMode === 'today' ? 6 : 5} className="px-6 py-8 text-center text-gray-500">
                      No dispensing records for {selectedDate} in {category} category
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Import CSV Modal - Only show when it's today and in entry mode */}
      {showImportModal && isCurrentDate && viewMode === 'today' && (
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
                  <li>Importing for date: {selectedDate}</li>
                  <li>Category: {category}</li>
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