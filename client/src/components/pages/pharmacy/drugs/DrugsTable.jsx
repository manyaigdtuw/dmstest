import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { FiSearch, FiFilter, FiX } from 'react-icons/fi';
import { FaPills, FaExclamationTriangle } from 'react-icons/fa';
import api from '../../../../api/api';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const DrugsTable = () => {
  const [drugs, setDrugs] = useState([]);
  const [filteredDrugs, setFilteredDrugs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    expiringSoon: false,
    lowStock: false,
    priceRange: ['', ''],
    category: '',
    drugType: '',
    expDateRange: [null, null],
  });

  // Pagination state
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });

  // Fetch pharmacy inventory from approved indent items
  const fetchDrugs = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/pharmacy/inventory');

      if (response.data && Array.isArray(response.data.drugs)) {
        setDrugs(response.data.drugs);
      } else {
        console.error('Invalid response format:', response.data);
        toast.error('Received invalid data format from server');
        setDrugs([]);
      }
    } catch (error) {
      console.error('Error fetching pharmacy inventory:', error);
      toast.error(error.response?.data?.message || 'Failed to load inventory');
      setDrugs([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDrugs();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [drugs, searchTerm, filters]);

  const isExpiringSoon = (expDate) => {
    if (!expDate) return false;
    const expirationDate = new Date(expDate);
    const threeMonthsFromNow = new Date();
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
    return expirationDate <= threeMonthsFromNow;
  };

  const applyFilters = () => {
    let result = [...drugs];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (drug) =>
          drug.name?.toLowerCase().includes(term) ||
          drug.batch_no?.toLowerCase().includes(term) ||
          drug.description?.toLowerCase().includes(term) ||
          drug.drug_type?.toLowerCase().includes(term) ||
          drug.category?.toLowerCase().includes(term)
      );
    }

    if (filters.expiringSoon) {
      result = result.filter((drug) => isExpiringSoon(drug.exp_date));
    }

    if (filters.lowStock) {
      result = result.filter((drug) => drug.stock <= 10);
    }

    if (filters.priceRange[0] || filters.priceRange[1]) {
      const minPrice = filters.priceRange[0]
        ? parseFloat(filters.priceRange[0])
        : 0;
      const maxPrice = filters.priceRange[1]
        ? parseFloat(filters.priceRange[1])
        : Infinity;
      result = result.filter(
        (drug) => drug.price >= minPrice && drug.price <= maxPrice
      );
    }

    if (filters.category) {
      result = result.filter((drug) => drug.category === filters.category);
    }

    if (filters.drugType) {
      result = result.filter((drug) => drug.drug_type === filters.drugType);
    }

    if (filters.expDateRange[0] || filters.expDateRange[1]) {
      result = result.filter((drug) => {
        if (!drug.exp_date) return false;
        const expDate = new Date(drug.exp_date);
        const startDate = filters.expDateRange[0]
          ? new Date(filters.expDateRange[0])
          : null;
        const endDate = filters.expDateRange[1]
          ? new Date(filters.expDateRange[1])
          : null;

        if (startDate && expDate < startDate) return false;
        if (endDate && expDate > endDate) return false;
        return true;
      });
    }

    // Sort alphabetically by name
    result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Update pagination
    const total = result.length;
    const totalPages = Math.ceil(total / pagination.limit);
    setPagination((prev) => ({
      ...prev,
      total,
      totalPages,
      page: prev.page > totalPages ? 1 : prev.page,
    }));

    setFilteredDrugs(result);
  };

  // Get paginated drugs
  const getPaginatedDrugs = () => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    const endIndex = startIndex + pagination.limit;
    return filteredDrugs.slice(startIndex, endIndex);
  };

  const handlePageChange = (newPage) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const handleFilterChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFilters((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handlePriceRangeChange = (index, value) => {
    const newRange = [...filters.priceRange];
    newRange[index] = value;
    setFilters((prev) => ({
      ...prev,
      priceRange: newRange,
    }));
  };

  const resetFilters = () => {
    setFilters({
      expiringSoon: false,
      lowStock: false,
      priceRange: ['', ''],
      category: '',
      drugType: '',
      expDateRange: [null, null],
    });
    setSearchTerm('');
  };

  const uniqueCategories = [
    ...new Set(drugs.map((drug) => drug.category).filter(Boolean)),
  ];
  const uniqueDrugTypes = [
    ...new Set(drugs.map((drug) => drug.drug_type).filter(Boolean)),
  ];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mx-auto">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 gap-4">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center">
            <FaPills className="mr-2 text-blue-600" />
            Drugs Inventory
          </h2>
          <p className="text-sm text-gray-500">
            Showing approved indent items
          </p>
        </div>

        {/* Search and Filter Section */}
        <div className="mb-6 bg-white p-4 rounded-lg shadow border border-gray-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="relative flex-grow">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <FiSearch className="text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Search drugs by name, batch, type or description..."
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
              >
                <FiFilter className="mr-2" />
                Filters
              </button>
              {(filters.expiringSoon ||
                filters.lowStock ||
                filters.category ||
                filters.drugType ||
                filters.priceRange[0] ||
                filters.priceRange[1] ||
                filters.expDateRange[0] ||
                filters.expDateRange[1]) && (
                <button
                  onClick={resetFilters}
                  className="flex items-center px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
                >
                  <FiX className="mr-2" />
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="expiringSoon"
                    name="expiringSoon"
                    checked={filters.expiringSoon}
                    onChange={handleFilterChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label
                    htmlFor="expiringSoon"
                    className="ml-2 text-sm text-gray-700"
                  >
                    Expiring Soon (≤ 3 months)
                  </label>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="lowStock"
                    name="lowStock"
                    checked={filters.lowStock}
                    onChange={handleFilterChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label
                    htmlFor="lowStock"
                    className="ml-2 text-sm text-gray-700"
                  >
                    Low Stock (≤ 10)
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Price Range
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={filters.priceRange[0]}
                      onChange={(e) =>
                        handlePriceRangeChange(0, e.target.value)
                      }
                      className="w-20 px-2 py-1 border border-gray-300 rounded-md"
                      placeholder="Min"
                    />
                    <span>to</span>
                    <input
                      type="number"
                      value={filters.priceRange[1]}
                      onChange={(e) =>
                        handlePriceRangeChange(1, e.target.value)
                      }
                      className="w-20 px-2 py-1 border border-gray-300 rounded-md"
                      placeholder="Max"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="category"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="category"
                    name="category"
                    value={filters.category}
                    onChange={handleFilterChange}
                    className="w-full px-2 py-1 border border-gray-300 rounded-md"
                  >
                    <option value="">All Categories</option>
                    {uniqueCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="drugType"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Drug Type
                  </label>
                  <select
                    id="drugType"
                    name="drugType"
                    value={filters.drugType}
                    onChange={handleFilterChange}
                    className="w-full px-2 py-1 border border-gray-300 rounded-md"
                  >
                    <option value="">All Types</option>
                    {uniqueDrugTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Range Picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expiration Date Range
                  </label>
                  <div className="flex flex-col space-y-2">
                    <DatePicker
                      selected={filters.expDateRange[0]}
                      onChange={(date) =>
                        setFilters((prev) => ({
                          ...prev,
                          expDateRange: [date, prev.expDateRange[1]],
                        }))
                      }
                      selectsStart
                      startDate={filters.expDateRange[0]}
                      endDate={filters.expDateRange[1]}
                      placeholderText="Start Date"
                      className="w-full px-2 py-1 border border-gray-300 rounded-md text-sm"
                      isClearable
                    />
                    <DatePicker
                      selected={filters.expDateRange[1]}
                      onChange={(date) =>
                        setFilters((prev) => ({
                          ...prev,
                          expDateRange: [prev.expDateRange[0], date],
                        }))
                      }
                      selectsEnd
                      startDate={filters.expDateRange[0]}
                      endDate={filters.expDateRange[1]}
                      minDate={filters.expDateRange[0]}
                      placeholderText="End Date"
                      className="w-full px-2 py-1 border border-gray-300 rounded-md text-sm"
                      isClearable
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Batch No
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      MFG Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      EXP Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Price
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Stock
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Category
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {getPaginatedDrugs().length > 0 ? (
                    getPaginatedDrugs().map((drug) => {
                      const expiringSoon = isExpiringSoon(drug.exp_date);

                      return (
                        <tr
                          key={drug.drug_id || drug.id}
                          className="hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-500">
                              {drug.drug_type}
                            </span>
                          </td>
                          <td
                            className={`px-6 py-4 whitespace-nowrap ${
                              expiringSoon ? 'text-red-600' : 'text-gray-900'
                            }`}
                          >
                            <div className="flex items-center">
                              {expiringSoon && (
                                <FaExclamationTriangle className="mr-2 text-red-500" />
                              )}
                              <span className="text-sm font-medium">
                                {drug.name}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-500">
                              {drug.batch_no}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm text-gray-500 max-w-xs truncate">
                              {drug.description}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-500">
                              {drug.mfg_date
                                ? new Date(drug.mfg_date).toLocaleDateString()
                                : '-'}
                            </span>
                          </td>
                          <td
                            className={`px-6 py-4 whitespace-nowrap ${
                              expiringSoon
                                ? 'font-semibold text-red-600'
                                : 'text-gray-500'
                            }`}
                          >
                            <span className="text-sm">
                              {drug.exp_date
                                ? new Date(drug.exp_date).toLocaleDateString()
                                : '-'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-500 font-medium">
                              ₹
                              {typeof drug.price === 'number'
                                ? drug.price.toFixed(2)
                                : parseFloat(drug.price).toFixed(2)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${
                                drug.stock > 10
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-yellow-100 text-yellow-800'
                              }`}
                            >
                              {drug.stock} in stock
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${
                                drug.category === 'IPD'
                                  ? 'bg-blue-100 text-blue-800'
                                  : drug.category === 'OPD'
                                  ? 'bg-purple-100 text-purple-800'
                                  : drug.category === 'IEC'
                                  ? 'bg-teal-100 text-teal-800'
                                  : drug.category === 'OUTREACH'
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {drug.category || 'N/A'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan="9"
                        className="px-6 py-4 text-center text-sm text-gray-500"
                      >
                        No approved indent items found. Items will appear here once your institute approves your indents.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div className="flex justify-center items-center py-4">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="px-3 py-1 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="mx-2 text-gray-700">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="px-3 py-1 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DrugsTable;
