import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import api from '../../../../api/api';

const LinkDispensary = ({ isOpen, onClose, onSave, institute }) => {
  const [availableDispensaries, setAvailableDispensaries] = useState([]);
  const [selectedDispensary, setSelectedDispensary] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchAvailableDispensaries();
    }
  }, [isOpen]);

  const fetchAvailableDispensaries = async () => {
    try {
      setLoading(true);
      const response = await api.get('/users/admin/unlinkedpharmacies');
      setAvailableDispensaries(response.data.dispensaries || []);
    } catch (error) {
      toast.error('Failed to fetch available dispensaries');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!selectedDispensary) {
      toast.error('Please select a dispensary');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await api.post('/users/link-dispensary', {
        instituteId: institute.id,
        dispensaryId: selectedDispensary
      });

      toast.success('Dispensary linked successfully!');
      onSave(response.data);
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to link dispensary');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h3 className="text-lg font-bold">Link Dispensary to Institute</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            disabled={isSubmitting}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          <div className="mb-4">
            <p className="text-sm text-gray-600">
              Linking dispensary to: <strong>{institute.name}</strong>
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Dispensary
              </label>
              {loading ? (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                </div>
              ) : availableDispensaries.length > 0 ? (
                <select
                  value={selectedDispensary}
                  onChange={(e) => setSelectedDispensary(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="">Choose a dispensary</option>
                  {availableDispensaries.map((dispensary) => (
                    <option key={dispensary.id} value={dispensary.id}>
                      {dispensary.name} - {dispensary.email}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">
                  No unlinked dispensaries available
                </p>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-400"
                disabled={isSubmitting || availableDispensaries.length === 0}
              >
                {isSubmitting ? 'Linking...' : 'Link Dispensary'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LinkDispensary;