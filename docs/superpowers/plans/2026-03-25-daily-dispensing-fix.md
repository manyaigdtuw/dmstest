# Daily Dispensing Module Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the daily dispensing module to properly show pharmacy inventory and allow multiple drug dispensing with correct stock deduction.

**Architecture:** Modify the DailyDispensing component to fetch from pharmacy inventory endpoint, implement multi-drug dispensing form, and ensure proper stock updates.

**Tech Stack:** React, Node.js, PostgreSQL, Express

---

### Task 1: Update Drug Fetching Logic

**Files:**
- Modify: `./client/src/components/pages/pharmacy/DailyDispensing.jsx:26-48`

- [ ] **Step 1: Add pharmacy inventory API function**

```javascript
const fetchPharmacyInventory = async () => {
  try {
    const response = await api.get('/pharmacy/inventory');
    if (response.data.drugs) {
      setDrugs(response.data.drugs);
    }
  } catch (error) {
    console.error('Error fetching pharmacy inventory:', error);
  }
};
```

- [ ] **Step 2: Update useEffect to check user role and fetch appropriate data**

```javascript
// Fetch drugs based on user role
useEffect(() => {
  if (req.user.role === 'pharmacy') {
    fetchPharmacyInventory();
  } else {
    fetchDrugs();
  }
}, []);
```

Note: Need to access user role from auth context or API response

### Task 2: Create Multi-Drug Dispensing State

**Files:**
- Modify: `./client/src/components/pages/pharmacy/DailyDispensing.jsx:17-21`

- [ ] **Step 1: Replace single drug form state with multi-drug array**

```javascript
const [dispensingForms, setDispensingForms] = useState([
  {
    drug_id: '',
    quantity_dispensed: 1,
    notes: '',
    batch_no: ''
  }
]);
```

- [ ] **Step 2: Add functions to manage multiple forms**

```javascript
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
```

### Task 3: Update Dispensing Form UI

**Files:**
- Modify: `./client/src/components/pages/pharmacy/DailyDispensing.jsx:310-399`

- [ ] **Step 1: Replace single form with dynamic multi-drug form**

```javascript
// Replace the entire form section
{dispensingForms.map((form, index) => (
  <div key={index} className="border border-gray-200 rounded-lg p-4 mb-4">
    <div className="flex justify-between items-center mb-3">
      <h4 className="text-sm font-medium text-gray-700">Drug {index + 1}</h4>
      {dispensingForms.length > 1 && (
        <button
          type="button"
          onClick={() => removeDrugForm(index)}
          className="text-red-600 hover:text-red-800"
        >
          <FiTrash2 className="h-4 w-4" />
        </button>
      )}
    </div>

    <div className="space-y-3">
      {/* Drug selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Select Drug
        </label>
        <select
          value={form.drug_id}
          onChange={(e) => updateDrugForm(index, 'drug_id', e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2"
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

      {/* Quantity */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Quantity Dispensed
        </label>
        <input
          type="number"
          min="1"
          max={form.drug_id ? drugs.find(d => d.id === form.drug_id)?.stock : undefined}
          value={form.quantity_dispensed}
          onChange={(e) => updateDrugForm(index, 'quantity_dispensed', parseInt(e.target.value) || 1)}
          className="w-full border border-gray-300 rounded-md px-3 py-2"
          required
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes (Optional)
        </label>
        <textarea
          value={form.notes}
          onChange={(e) => updateDrugForm(index, 'notes', e.target.value)}
          rows="2"
          className="w-full border border-gray-300 rounded-md px-3 py-2"
        />
      </div>

      {/* Stock info */}
      {form.drug_id && (
        <div className="bg-blue-50 p-3 rounded-md">
          <div className="text-sm text-blue-700">
            Available Stock: <strong>{drugs.find(d => d.id === form.drug_id)?.stock || 0}</strong><br />
            After Dispensing: <strong>{(drugs.find(d => d.id === form.drug_id)?.stock || 0) - form.quantity_dispensed}</strong>
          </div>
        </div>
      )}
    </div>
  </div>
))}

{/* Add more drugs button */}
<button
  type="button"
  onClick={addDrugForm}
  className="w-full border-2 border-dashed border-gray-300 rounded-md py-2 text-gray-600 hover:border-gray-400 hover:text-gray-700"
>
  <FiPlus className="inline mr-2" />
  Add Another Drug
</button>
```

### Task 4: Update Form Submission Handler

**Files:**
- Modify: `./client/src/components/pages/pharmacy/DailyDispensing.jsx:78-114`

- [ ] **Step 1: Update handleRecordDispensing to handle multiple drugs**

```javascript
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
    setDispensingForms([{
      drug_id: '',
      quantity_dispensed: 1,
      notes: '',
      batch_no: ''
    }]);

    if (viewMode === 'today') {
      fetchTodayDispensing();
    }

    // Refresh inventory based on role
    if (req.user.role === 'pharmacy') {
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
```

### Task 5: Update Stock Display Logic

**Files:**
- Modify: `./client/src/components/pages/pharmacy/DailyDispensing.jsx:199-202`

- [ ] **Step 1: Update getDrugStock function to handle both user types**

```javascript
const getDrugStock = (drugId) => {
  const drug = drugs.find(d => d.id === drugId);
  return drug ? drug.stock : 0;
};
```

This function already works correctly, just ensure it's using the right drugs array.

### Task 6: Test the Implementation

**Files:**
- Test: Manual testing in browser

- [ ] **Step 1: Test pharmacy user login**
- Login as a pharmacy user
- Navigate to Daily Dispensing module
- Verify drugs from approved indents are displayed

- [ ] **Step 2: Test multi-drug dispensing**
- Add multiple drugs to the form
- Enter quantities
- Submit the form
- Verify stock is deducted correctly

- [ ] **Step 3: Test stock validation**
- Try to dispense more than available stock
- Verify error messages are shown

- [ ] **Step 4: Test with institute user**
- Login as institute user
- Verify the module still works with regular drug inventory

### Task 7: Code Cleanup and Optimization

**Files:**
- Modify: `./client/src/components/pages/pharmacy/DailyDispensing.jsx`

- [ ] **Step 1: Add loading states for inventory fetch**
- [ ] **Step 2: Add error handling display**
- [ ] **Step 3: Optimize re-renders with useCallback/useMemo where needed**
- [ ] **Step 4: Add prop-types or TypeScript types if used in project**

### Task 8: Update Documentation

**Files:**
- Create: `./docs/pharmacy-dispensing-updates.md`

- [ ] **Step 1: Document the changes made**
- [ ] **Step 2: Update API documentation if needed**
- [ ] **Step 3: Add user guide for multi-drug dispensing