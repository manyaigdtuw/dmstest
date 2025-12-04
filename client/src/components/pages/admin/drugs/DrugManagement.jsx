import React, { useState, useEffect } from 'react';
import { FiPlus, FiTrash2, FiEdit, FiUpload, FiX } from 'react-icons/fi';
import api from '../../../../api/api';

const DrugManagement = () => {
  const [drugTypes, setDrugTypes] = useState([]);
  const [drugNames, setDrugNames] = useState([]);
  const [selectedType, setSelectedType] = useState(null);
  const [newTypeName, setNewTypeName] = useState('');
  const [newDrugName, setNewDrugName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
    const [showImportModal, setShowImportModal] = useState(false); // Add this state
  const [importFile, setImportFile] = useState(null); // Add this state
  const [importProgress, setImportProgress] = useState(null); // Add this state
  const [importErrors, setImportErrors] = useState([]); // Add this state



  // Fetch all drug types
  useEffect(() => {
    const fetchDrugTypes = async () => {
      try {
        setLoading(true);
        const response = await api.get('/drug-types-names/drug-types');
        if (response.data.status) {
          setDrugTypes(response.data.drugTypes);
        }
      } catch (err) {
        setError('Failed to fetch drug types');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchDrugTypes();
  }, []);

  // Fetch drug names when type is selected
  useEffect(() => {
    if (selectedType) {
      const fetchDrugNames = async () => {
        try {
          setLoading(true);
          const response = await api.get(`/drug-types-names/drug-names/${selectedType}`);
          if (response.data.status) {
            setDrugNames(response.data.drugNames);
          }
        } catch (err) {
          setError('Failed to fetch drug names');
          console.error(err);
        } finally {
          setLoading(false);
        }
      };
      fetchDrugNames();
    }
  }, [selectedType]);

  const handleAddType = async () => {
    if (!newTypeName.trim()) {
      setError('Type name is required');
      return;
    }

    try {
      setLoading(true);
      const response = await api.post('/drug-types-names/drug-types', {
        type_name: newTypeName
      });
      
      if (response.data.status) {
        setDrugTypes([...drugTypes, response.data.drugType]);
        setNewTypeName('');
        setError('');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add drug type');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDrugName = async () => {
    if (!selectedType || !newDrugName.trim()) {
      setError('Please select a type and enter a drug name');
      return;
    }

    try {
      setLoading(true);
      const response = await api.post('/drug-types-names/drug-names', {
        type_id: selectedType,
        name: newDrugName
      });
      
      if (response.data.status) {
        setDrugNames([...drugNames, response.data.drugName]);
        setNewDrugName('');
        setError('');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add drug name');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteType = async (typeId) => {
    if (!window.confirm('Are you sure you want to delete this drug type?')) return;

    try {
      setLoading(true);
      const response = await api.delete(`/drug-types-names/drug-types/${typeId}`);
      
      if (response.data.status) {
        setDrugTypes(drugTypes.filter(type => type.id !== typeId));
        if (selectedType === typeId) {
          setSelectedType(null);
          setDrugNames([]);
        }
        setError('');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete drug type');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDrugName = async (drugId) => {
    if (!window.confirm('Are you sure you want to delete this drug name?')) return;

    try {
      setLoading(true);
      const response = await api.delete(`/drug-types-names/drug-names/${drugId}`);
      
      if (response.data.status) {
        setDrugNames(drugNames.filter(drug => drug.id !== drugId));
        setError('');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete drug name');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  // Add these new functions for import
  const handleImportClick = () => {
    setShowImportModal(true);
    setImportFile(null);
    setImportProgress(null);
    setImportErrors([]);
  };

  const handleFileChange = (e) => {
    setImportFile(e.target.files[0]);
  };

  const handleImportSubmit = async () => {
    if (!importFile) {
      setError('Please select a file to upload');
      return;
    }

    const formData = new FormData();
    formData.append('file', importFile);

    try {
      setImportProgress({ status: 'Uploading...', percent: 0 });
      setError('');

      const response = await api.post('/drug-types-names/import-drug-types', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setImportProgress({
            status: 'Uploading...',
            percent: percentCompleted,
          });
        },
      });

      setImportProgress({
        status: 'Processing...',
        percent: 100,
      });

      if (response.data.errors && response.data.errors.length > 0) {
        setImportErrors(response.data.errors);
        setError(`Import completed with ${response.data.successCount} successes and ${response.data.errors.length} errors`);
      } else {
        setError('');
        alert(`Successfully imported ${response.data.successCount} drug types`);
        fetchDrugTypes(); // Refresh the drug types list
        setShowImportModal(false);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to import drug types');
      console.error(err);
    } finally {
      setImportProgress(null);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl md:text-2xl font-bold">Drug Types & Names Management</h2>
        <button
          onClick={handleImportClick}
          className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
        >
          <FiUpload className="mr-2" />
          Import CSV
        </button>
      </div>
      
      {error && (
        <div className={`p-4 mb-4 rounded-md ${
          error.includes('successfully') 
            ? 'bg-green-100 border-l-4 border-green-500 text-green-700'
            : 'bg-red-100 border-l-4 border-red-500 text-red-700'
        }`}>
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Drug Types Section */}
        <div className="bg-white rounded-lg shadow p-4 md:p-6">
          <h3 className="text-lg md:text-xl font-semibold mb-4">Drug Types</h3>
          
          <div className="flex flex-col sm:flex-row mb-4 gap-2">
            <input
              type="text"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="New drug type name"
              className="flex-1 border rounded px-3 py-2"
            />
            <button
              onClick={handleAddType}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-blue-300"
            >
              <FiPlus className="inline mr-1" /> Add
            </button>
          </div>

          <div className="border rounded">
            {drugTypes.map(type => (
              <div 
                key={type.id} 
                className={`p-3 border-b flex justify-between items-center ${selectedType === type.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              >
                <span 
                  className="cursor-pointer flex-1"
                  onClick={() => setSelectedType(type.id)}
                >
                  {type.type_name}
                </span>
                <button
                  onClick={() => handleDeleteType(type.id)}
                  disabled={loading}
                  className="text-red-600 hover:text-red-800 disabled:text-red-300"
                >
                  <FiTrash2 />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Drug Names Section */}
        <div className="bg-white rounded-lg shadow p-4 md:p-6">
          <h3 className="text-lg md:text-xl font-semibold mb-4">
            {selectedType 
              ? `Drug Names (${drugTypes.find(t => t.id === selectedType)?.type_name || ''})`
              : 'Select a drug type to view names'}
          </h3>
          
          {selectedType && (
            <>
              <div className="flex flex-col sm:flex-row mb-4 gap-2">
                <input
                  type="text"
                  value={newDrugName}
                  onChange={(e) => setNewDrugName(e.target.value)}
                  placeholder="New drug name"
                  className="flex-1 border rounded px-3 py-2"
                />
                <button
                  onClick={handleAddDrugName}
                  disabled={loading}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-blue-300"
                >
                  <FiPlus className="inline mr-1" /> Add
                </button>
              </div>

              <div className="border rounded">
                {drugNames.length > 0 ? (
                  drugNames.map(drug => (
                    <div key={drug.id} className="p-3 border-b flex justify-between items-center hover:bg-gray-50">
                      <span>{drug.name}</span>
                      <button
                        onClick={() => handleDeleteDrugName(drug.id)}
                        disabled={loading}
                        className="text-red-600 hover:text-red-800 disabled:text-red-300"
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-3 text-gray-500">No drug names found for this type</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Import Drug Types from CSV</h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select CSV File
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100"
              />
              <p className="mt-1 text-sm text-gray-500">
                CSV should have one column with header "Drug_types" followed by drug type names
              </p>
            </div>

            {importProgress && (
              <div className="mb-4">
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">
                    {importProgress.status}
                  </span>
                  <span className="text-sm font-medium text-gray-700">
                    {importProgress.percent}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full"
                    style={{ width: `${importProgress.percent}%` }}
                  ></div>
                </div>
              </div>
            )}

            {importErrors.length > 0 && (
              <div className="mb-4 max-h-40 overflow-y-auto">
                <h4 className="text-sm font-medium text-red-700 mb-2">
                  Errors ({importErrors.length})
                </h4>
                <div className="space-y-2">
                  {importErrors.map((error, index) => (
                    <div
                      key={index}
                      className="text-sm text-red-600 p-2 bg-red-50 rounded"
                    >
                      <p>
                        <strong>{error.row}:</strong> {error.error}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={!importFile || importProgress}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DrugManagement;
