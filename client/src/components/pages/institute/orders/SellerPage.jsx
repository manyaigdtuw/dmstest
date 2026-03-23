import React, { useContext, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import UserContext from "../../../../context/UserContext";
import { toast } from "react-toastify";
import {
  FiPackage,
  FiEdit,
  FiSave,
  FiX,
  FiCheck,
  FiAlertCircle,
} from "react-icons/fi";
import api from "../../../../api/api";

const SellerPage = () => {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("pending");

  const [editingQuantities, setEditingQuantities] = useState({});
  const [tempQuantities, setTempQuantities] = useState({});
  const [bulkApproving, setBulkApproving] = useState({});
  const [stockData, setStockData] = useState({});

  useEffect(() => {
    if (user?.role !== "institute") {
      navigate("/");
      return;
    }
    fetchOrders();
  }, [user, selectedStatus]);

  const fetchOrders = async () => {
    try {
      setLoading(true);

      const response = await api.get("/seller/orders", {
        params: { status: selectedStatus },
      });

      // Debug: Check raw response
      console.log("RAW API RESPONSE:", JSON.stringify(response.data, null, 2));

      if (response.data.status) {
        const formattedOrders =
          response.data.orders
            ?.map((order) => ({
              ...order,
              items: order.items?.filter((item) => item.status === selectedStatus),
            }))
            .filter((o) => o.items.length > 0) || [];

        setOrders(formattedOrders);

        // Build stock data from ALL items (not just filtered ones)
        const stockMap = {};
        response.data.orders.forEach((order) => {
          order.items.forEach((item) => {
            if (item.drug_id && item.available_stock !== undefined) {
              stockMap[item.drug_id] = item.available_stock;
            }
          });
        });
        setStockData(stockMap);

        // Debug log
        console.log("Stock data:", stockMap);
        console.log("Orders:", formattedOrders);
        console.log("First order items:", formattedOrders[0]?.items);
      } else {
        toast.error(response.data.message || "Failed to fetch orders");
      }
    } catch (error) {
      console.error("Fetch orders error:", error);
      toast.error("Failed to fetch orders");
    } finally {
      setLoading(false);
    }
  };

  const toggleEditQuantity = (itemId, quantity) => {
    setEditingQuantities((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
    setTempQuantities((prev) => ({ ...prev, [itemId]: quantity }));
  };

  const saveQuantity = async (itemId, item) => {
    const newQty = tempQuantities[itemId];
    const stock = stockData[item.drug_id] ?? 0;

    if (newQty < 1) return toast.error("Quantity must be at least 1");
    if (newQty > stock)
      return toast.error(`Only ${stock} units available.`);

    try {
      const res = await api.patch(`/seller/order-items/${itemId}/status`, {
        quantity: newQty,
      });

      if (res.data.status) {
        toast.success("Quantity updated");
        toggleEditQuantity(itemId, newQty);
        fetchOrders();
      }
    } catch (error) {
      console.error("Save quantity error:", error);
      toast.error("Error updating quantity");
    }
  };

  const updateItemStatus = async (itemId, newStatus, item) => {
    const stock = stockData[item.drug_id] ?? 0;

    if (newStatus === "approved" && stock < item.quantity) {
      return toast.error(
        `Not enough stock. Need ${item.quantity}, available ${stock}.`
      );
    }

    try {
      const res = await api.patch(`/seller/order-items/${itemId}/status`, {
        status: newStatus,
      });

      if (res.data.status) {
        toast.success("Updated");
        fetchOrders();
      }
    } catch (error) {
      console.error("Update status error:", error);
      toast.error("Update failed");
    }
  };

  const approveAllItems = async (orderId) => {
    try {
      setBulkApproving((p) => ({ ...p, [orderId]: true }));

      // Fixed: Correct variable name and endpoint
      const response = await api.patch(`/seller/orders/${orderId}/approve-all`);

      if (response.data.status) {
        const { approvedCount, insufficientStockItems } = response.data;
        
        if (approvedCount > 0) {
          toast.success(`Approved ${approvedCount} item(s)`);
        }
        
        if (insufficientStockItems && insufficientStockItems.length > 0) {
          toast.warning(
            `${insufficientStockItems.length} item(s) had insufficient stock`,
            { autoClose: 5000 }
          );
        }
        
        fetchOrders();
      } else {
        toast.error(response.data.message || "Bulk approval failed");
      }
    } catch (error) {
      console.error("Approve all error:", error);
      toast.error(error.response?.data?.message || "Error approving items");
    } finally {
      setBulkApproving((p) => ({ ...p, [orderId]: false }));
    }
  };

  const getStatusColor = (status) => {
    return {
      approved: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
      shipped: "bg-blue-100 text-blue-800",
      pending: "bg-yellow-100 text-yellow-800",
    }[status];
  };

  const formatDate = (d) =>
    new Date(d).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold">Manage Orders</h1>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="border rounded-lg p-2"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="shipped">Shipped</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-10">
          <div className="animate-spin h-8 w-8 border-2 border-blue-600 rounded-full mx-auto"></div>
        </div>
      )}

      {/* No Orders */}
      {!loading && orders.length === 0 && (
        <div className="text-center p-8 border rounded-lg bg-white">
          <FiPackage className="mx-auto text-4xl text-gray-400 mb-3" />
          <p>No orders found</p>
        </div>
      )}

      {/* Orders */}
      <div className="space-y-6">
        {orders.map((order) => (
          <div key={order.order_id} className="bg-white border rounded-xl shadow-sm">
            <div className="p-5 border-b">
              <div className="flex justify-between">
                <div>
                  <h3 className="font-semibold text-lg">Order #{order.order_no}</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Placed: {formatDate(order.order_date)}
                  </p>
                </div>

                {selectedStatus === "pending" && order.items.length > 0 && (
                  <button
                    onClick={() => approveAllItems(order.order_id)}
                    disabled={bulkApproving[order.order_id]}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 hover:bg-green-700 transition"
                  >
                    {bulkApproving[order.order_id] ? (
                      <>
                        <div className="animate-spin h-4 w-4 border-2 border-white rounded-full border-t-transparent"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <FiCheck /> Approve All
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="p-5 space-y-4">
              {order.items.map((item) => {
                const stock = stockData[item.drug_id] ?? 0;
                const insufficient = item.status === "pending" && stock < item.quantity;

                return (
                  <div key={item.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-medium">{item.drug_name}</p>
                        <p className="text-sm text-gray-600">Batch: {item.batch_no}</p>
                        <p className="text-sm text-gray-600">Drug ID: {item.drug_id}</p>

                        {item.status === "pending" && (
                          <div className="mt-2 space-y-2">
                            <div
                              className={`px-2 py-1 rounded text-sm flex items-center gap-2 inline-flex ${
                                insufficient
                                  ? "bg-red-100 text-red-700"
                                  : "bg-green-100 text-green-700"
                              }`}
                            >
                              Stock: {stock} / Need: {item.quantity}
                              {insufficient && <FiAlertCircle />}
                            </div>
                            
                            {insufficient && stock > 0 && (
                              <button
                                onClick={() => {
                                  setTempQuantities(prev => ({...prev, [item.id]: stock}));
                                  toggleEditQuantity(item.id, stock);
                                }}
                                className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded hover:bg-yellow-200"
                              >
                                Adjust to available ({stock} units)
                              </button>
                            )}
                            
                            {stock === 0 && (
                              <div className="text-xs text-red-600 font-medium">
                                ⚠️ No stock available - cannot approve
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Quantity Edit */}
                      <div className="ml-4">
                        {editingQuantities[item.id] ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              value={tempQuantities[item.id]}
                              onChange={(e) =>
                                setTempQuantities((prev) => ({
                                  ...prev,
                                  [item.id]: Number(e.target.value),
                                }))
                              }
                              className="w-20 border p-2 rounded"
                            />
                            <button
                              onClick={() => saveQuantity(item.id, item)}
                              className="text-green-700 hover:text-green-900"
                              title="Save"
                            >
                              <FiSave size={20} />
                            </button>
                            <button
                              onClick={() =>
                                toggleEditQuantity(item.id, item.quantity)
                              }
                              className="text-red-600 hover:text-red-800"
                              title="Cancel"
                            >
                              <FiX size={20} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Qty: {item.quantity}</span>
                            <button
                              onClick={() =>
                                toggleEditQuantity(item.id, item.quantity)
                              }
                              className="text-blue-600 hover:text-blue-800"
                              title="Edit quantity"
                            >
                              <FiEdit size={20} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Status Dropdown */}
                    <div className="mt-4 flex items-center justify-between">
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                          item.status
                        )}`}
                      >
                        {item.status}
                      </span>

                      <select
                        disabled={item.status === "rejected"}
                        value={item.status}
                        onChange={(e) =>
                          updateItemStatus(item.id, e.target.value, item)
                        }
                        className="border rounded p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="pending">Pending</option>
                        <option value="approved">Approve</option>
                        <option value="rejected">Reject</option>
                        {item.status === "approved" && (
                          <option value="shipped">Shipped</option>
                        )}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SellerPage;