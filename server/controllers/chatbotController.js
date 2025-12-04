require('dotenv').config();
const { Pool } = require('pg');

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

// Database schema information
const schema = `
Tables and columns:

users(
  id, name, email, password, phone, street, city, state, postal_code, country,
  status, registration_date, license_number, role, created_by, created_at, updated_at
)

drugs(
  id, drug_type, name, batch_no, description, stock, mfg_date, exp_date, price,
  created_by, category, created_at, updated_at
)

orders(
  id, order_no, user_id, recipient_id, transaction_type, notes, total_amount,
  created_at, updated_at
)

order_items(
  id, order_id, drug_id, custom_name, manufacturer_name, quantity, unit_price, total_price,
  source_type, category, batch_no, seller_id, status, created_at, updated_at
)

drug_types(
  id, type_name, created_at, updated_at
)

drug_names(
  id, type_id, name, created_at, updated_at
)

rate_limiter(
  key, points, expire
)

login_logs(
  id, user_id, email, ip_address, user_agent, status, attempt_time, failure_reason
)
`;

// Strict System Prompts
const STRICT_SYSTEM_PROMPTS = {
  admin: `You are a strict data assistant for a Drug Management System. CRITICAL RULES:
  
  **DATA CONSTRAINTS:**
  - ONLY use data provided in the context below
  - NEVER invent, assume, or hallucinate any values
  - If data is missing, say "Data not available" for that field
  - If no records match, say "No matching records found"
  
  **RESPONSE RULES:**
  - Base ALL responses ONLY on the provided database results
  - Use exact values from the data, do not estimate or approximate
  - If context is empty or insufficient, respond: "I don't have enough data to answer that question accurately"
  - For calculations, only use provided numbers
  
  **FORMATTING:**
  - Use clear Markdown tables and sections
  - Highlight critical info (low stock, expiring soon)
  - Be concise and data-focused
  
  Current database schema available: ${schema}`,

  institute: `You are a pharmaceutical institute assistant. STRICT RULES:
  
  - ONLY reference data provided in the context
  - NEVER invent drug names, batch numbers, or quantities
  - If data is incomplete, acknowledge the limitation
  - Use exact values from query results
  
  Respond based SOLELY on the database results provided.`,
  
  pharmacy: `You are a pharmacy data assistant. IMPORTANT:
  
  - All responses must be grounded in the provided data context
  - Do not make up stock levels, orders, or expiration dates
  - If the data doesn't contain the answer, say so clearly
  - Use only the exact values from database results`
};

// Helper function for status icons
function getStatusIcon(status) {
  const icons = {
    'pending': '🟡',
    'approved': '✅',
    'shipped': '🚚',
    'delivered': '📦',
    'rejected': '❌',
    'out_of_stock': '⚠️',
    'Active': '✅',
    'Pending': '🟡'
  };
  return icons[status] || '▪️';
}

// Fetch with timeout utility
const fetchWithTimeout = async (url, options, timeout = 30000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

// Enhanced SQL generator with strict validation
async function generateValidatedSQL(userQuery, userRole) {
  const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE'];
  
  // Provide exact column names to prevent AI from guessing
  const exactSchema = `
EXACT TABLE STRUCTURE:
users(id, name, email, role, status)
drugs(id, name, batch_no, stock, exp_date, price, category, created_by)
orders(id, order_no, user_id, recipient_id, total_amount, created_at)
order_items(id, order_id, drug_id, quantity, unit_price, status)

KEY RELATIONSHIPS:
- drugs.created_by = users.id
- orders.user_id = users.id  
- orders.recipient_id = users.id
- order_items.order_id = orders.id
- order_items.drug_id = drugs.id

NOTE: All primary keys are named 'id', not 'drug_id', 'order_id', etc.
`;

  const prompt = ` IMPORTANT: Do not inline user-provided string values. Either:
1) produce parameterized SQL using $1, $2 placeholders and then return a list of params in a comment, OR
2) if using inline literals, always wrap string literals in single quotes.

Generate a SAFE PostgreSQL SELECT query ONLY using EXACT column names from the schema.
STRICT RULES:
1. ONLY generate SELECT queries
2. Use EXACT column names from the schema below - do not guess or invent column names
3. NEVER include: ${forbiddenKeywords.join(', ')}
4. Return ONLY the SQL, no explanations
5. Always include LIMIT 20 for safety
6. Use correct JOIN conditions based on the exact relationships provided

EXACT SCHEMA: ${exactSchema}

User Role: ${userRole}
Question: ${userQuery}

SQL:`;

  try {
    const response = await fetchWithTimeout(
      `${process.env.OLLAMA_BASE_URL}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL,
          prompt: prompt,
          stream: false,
          options: { temperature: 0, num_predict: 500 }
        })
      }
    );

    if (!response.ok) throw new Error('API error');
    
    let sql = (await response.json()).response.trim();
    sql = sql.replace(/```sql|```/g, '').trim();

    // Enhanced security validation
    if (forbiddenKeywords.some(keyword => sql.toUpperCase().includes(keyword))) {
      throw new Error('Unsafe query detected');
    }
    
    if (!sql.toUpperCase().startsWith('SELECT')) {
      throw new Error('Not a SELECT query');
    }

    // Validate column names against actual schema
    const invalidColumns = validateSQLColumns(sql);
    if (invalidColumns.length > 0) {
      console.log('Invalid columns detected:', invalidColumns);
      throw new Error(`Invalid column names: ${invalidColumns.join(', ')}`);
    }

    return sql;
  } catch (error) {
    console.error('SQL generation failed:', error.message);
    return null;
  }
}


function validateSQLColumns(sql) {
  // canonical list of valid columns (lowercased)
  const validColumns = [
    // users table
    'users.id', 'users.name', 'users.email', 'users.password', 'users.phone', 'users.street',
    'users.city', 'users.state', 'users.postal_code', 'users.country', 'users.status',
    'users.registration_date', 'users.license_number', 'users.role', 'users.created_by',
    'users.created_at', 'users.updated_at',

    // drugs table
    'drugs.id', 'drugs.drug_type', 'drugs.name', 'drugs.batch_no', 'drugs.description',
    'drugs.stock', 'drugs.mfg_date', 'drugs.exp_date', 'drugs.price', 'drugs.created_by',
    'drugs.category', 'drugs.created_at', 'drugs.updated_at',

    // orders table
    'orders.id', 'orders.order_no', 'orders.user_id', 'orders.recipient_id',
    'orders.transaction_type', 'orders.notes', 'orders.total_amount', 'orders.created_at',
    'orders.updated_at',

    // order_items table
    'order_items.id', 'order_items.order_id', 'order_items.drug_id', 'order_items.custom_name',
    'order_items.manufacturer_name', 'order_items.quantity', 'order_items.unit_price',
    'order_items.total_price', 'order_items.source_type', 'order_items.category',
    'order_items.batch_no', 'order_items.seller_id', 'order_items.status',
    'order_items.created_at', 'order_items.updated_at',

    // drug_types table
    'drug_types.id', 'drug_types.type_name', 'drug_types.created_at', 'drug_types.updated_at',

    // drug_names table
    'drug_names.id', 'drug_names.type_id', 'drug_names.name', 'drug_names.created_at',
    'drug_names.updated_at'
  ].map(c => c.toLowerCase());

  // SQL keywords to ignore (lowercase)
  const sqlKeywords = new Set([
    'select','from','where','order','by','limit','join','left','right','inner','outer','on','and','or',
    'group','having','as','count','sum','avg','min','max','distinct','case','when','then','else','end',
    'between','in','is','not','null','like','ilike','exists','now','interval','true','false','offset',
    'union','all','except','intersect','limit','offset'
  ]);

  // 1) remove string literals and dollar-quoted strings to avoid false positives
  const sqlNoStrings = sql
    .replace(/'(?:\\'|[^'])*'/g, ' ')      // single quoted
    .replace(/"(?:\\"|[^"])*"/g, ' ')      // double quoted
    .replace(/\$\$[\s\S]*?\$\$/g, ' ');    // dollar-quoted

  const lowerSql = sqlNoStrings.toLowerCase();

  // 2) find table aliases: supports "FROM table t" and "JOIN table t"
  const aliasMap = {}; // alias -> tableName
  const tableRegex = /\b(?:from|join)\s+([a-z0-9_."]+)(?:\s+(?:as\s+)?([a-z_][\w]*))?/ig;
  let m;
  while ((m = tableRegex.exec(lowerSql)) !== null) {
    let tableToken = m[1].trim();
    let alias = m[2] ? m[2].trim() : null;

    // strip optional quotes around table token
    tableToken = tableToken.replace(/^"+|"+$/g, '');
    // if tableToken includes schema like public.drugs, keep full token
    const tableName = tableToken.split('.').pop(); // use last part (drugs)
    if (alias) aliasMap[alias] = tableName;
    // also map the table name to itself so qualified 'drugs.col' checks work
    aliasMap[tableName] = tableName;
  }

  // 3) validate qualified columns like "d.stock" or "drugs.stock"
  const qualifiedRegex = /\b([a-z_][\w]*)\.([a-z_][\w]*)\b/ig;
  const invalid = new Set();
  while ((m = qualifiedRegex.exec(lowerSql)) !== null) {
    const tbl = m[1];
    const col = m[2];
    // map alias to table if alias exists
    const mappedTable = aliasMap[tbl] || tbl;
    const full = `${mappedTable}.${col}`;
    if (!validColumns.includes(full)) {
      // not found — record original token (case-sensitive substring from original SQL)
      const originalToken = sql.match(new RegExp(`\\b${m[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.${m[2].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`));
      invalid.add(originalToken ? originalToken[0] : `${tbl}.${col}`);
    }
  }

  // 4) validate unqualified tokens (e.g., "stock" when used without table.)
  // extract simple tokens but ignore numbers and SQL keywords
  const tokenRegex = /\b([a-z_][\w]*)\b/ig;
  while ((m = tokenRegex.exec(lowerSql)) !== null) {
    const token = m[1];
    // skip keywords and already-validated qualified tokens and function names
    if (sqlKeywords.has(token)) continue;
    if (/^\d+$/.test(token)) continue;

    // If token appears as part of qualified token (handled above), skip
    const ahead = lowerSql.slice(Math.max(0, m.index - 3), m.index + token.length + 2);
    if (/\.[a-z_]/.test(ahead) || /\b[a-z_][\w]*\.\b/.test(ahead)) continue;

    // check whether any valid column ends with .token
    const found = validColumns.some(c => c.endsWith('.' + token));
    if (!found) {
      // exclude common function names or alias names that were mapped
      if (aliasMap[token]) continue;
      // record original token (case preserved if present)
      const origMatch = sql.match(new RegExp(`\\b${token}\\b`));
      invalid.add(origMatch ? origMatch[0] : token);
    }
  }

  return Array.from(invalid);
}


// Data validation function
function validateResponseAgainstData(response, data, question) {
  const responseLower = response.toLowerCase();
  
  // Check for common hallucination patterns
  const hallucinationIndicators = [
    'i assume', 'probably', 'likely', 'approximately',
    'typically', 'usually', 'based on common practice',
    'generally', 'most likely'
  ];
  
  // If no data but response claims to have data
  if ((!data || (Array.isArray(data) && data.length === 0) || 
       (typeof data === 'object' && Object.keys(data).length === 0)) &&
      !responseLower.includes('no data') &&
      !responseLower.includes('not found') &&
      !responseLower.includes('unavailable')) {
    return "No relevant data found in the system for your query.";
  }
  
  // If response contains hallucination indicators
  if (hallucinationIndicators.some(indicator => responseLower.includes(indicator))) {
    return "I can only provide information based on actual data in the system. Please ask about specific records or check the available data.";
  }
  
  return response;
}

// Enhanced response formatter
function formatResponse(data, userRole, question) {
  // If we have raw query results, format them nicely
  if (Array.isArray(data)) {
    if (data.length === 0) return "No matching records found.";
    
    let response = `## Query Results for: "${question}"\n\n`;
    
    // For drugs
    if (data[0].name && data[0].batch_no) {
      response += "### 🏥 Drug Inventory\n\n";
      response += "| Name | Batch | Stock | Expiry | Price |\n";
      response += "|------|-------|-------|--------|-------|\n";
      
      data.forEach(item => {
        const daysLeft = item.exp_date ? 
          Math.floor((new Date(item.exp_date) - new Date()) / (1000 * 60 * 60 * 24)) : 'N/A';
        
        response += `| ${item.name} | ${item.batch_no || 'N/A'} | ${item.stock || 0} | `;
        response += `${item.exp_date ? new Date(item.exp_date).toISOString().split('T')[0] : 'N/A'} `;
        if (daysLeft < 30 && daysLeft !== 'N/A') response += `⚠️(${daysLeft}d) | `;
        else response += `(${daysLeft}d) | `;
        response += `₹${item.price?.toFixed(2) || 'N/A'} |\n`;
      });
    } 
    // For orders
    else if (data[0].order_no) {
      response += "### 📦 Orders\n\n";
      response += "| Order # | Date | Status | Amount | Items |\n";
      response += "|---------|------|--------|--------|-------|\n";
      
      data.forEach(item => {
        response += `| ${item.order_no} | `;
        response += `${new Date(item.created_at).toISOString().split('T')[0]} | `;
        response += `${getStatusIcon(item.status)} ${item.status} | `;
        response += `₹${item.total_amount?.toFixed(2) || '0.00'} | `;
        response += `${item.item_count || 0} |\n`;
      });
    }
    // For generic results
    else {
      response += "### Results\n\n";
      const columns = Object.keys(data[0]);
      response += `| ${columns.join(' | ')} |\n`;
      response += `| ${columns.map(() => '---').join(' | ')} |\n`;
      
      data.slice(0, 10).forEach(item => {
        response += `| ${columns.map(col => item[col] || 'N/A').join(' | ')} |\n`;
      });
      
      if (data.length > 10) {
        response += `\n*Showing 10 of ${data.length} results*\n`;
      }
    }
    
    return response;
  }
  
  // Original formatted response for predefined queries
  let response = "";

  // DRUG INVENTORY SECTION
  if (data.drugs?.length > 0) {
    response += "## 🏥 Drug Inventory\n\n";
    data.drugs.forEach(drug => {
      response += `### ${drug.name}\n`;
      response += `- **ID**: \`${drug.id}\` | **Batch**: \`${drug.batch_no || 'N/A'}\`\n`;
      response += `- **Stock**: ${drug.stock} units `;
      
      // Stock level indicators
      if (drug.stock < 5) response += "🔴 (Critical Stock)";
      else if (drug.stock < 15) response += "🟠 (Low Stock)";
      else if (drug.stock > 500) response += "🟢 (High Inventory)";
      
      // Expiry information
      const expDate = new Date(drug.exp_date);
      const today = new Date();
      const daysToExpiry = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
      
      response += `\n- **Expiry**: ${expDate.toISOString().split('T')[0]} `;
      if (daysToExpiry < 30) response += `⚠️ (${daysToExpiry} days remaining)`;
      else response += `(${daysToExpiry} days remaining)`;
      
      // Additional drug details
      if (drug.mfg_date) {
        response += `\n- **Manufactured**: ${new Date(drug.mfg_date).toISOString().split('T')[0]}`;
      }
      if (drug.price) {
        response += `\n- **Price**: ₹${drug.price.toFixed(2)}`;
      }
      if (drug.category) {
        response += `\n- **Category**: ${drug.category}`;
      }
      if (drug.description) {
        response += `\n- **Description**: ${drug.description.substring(0, 100)}${drug.description.length > 100 ? '...' : ''}`;
      }
      if (drug.created_by_name) {
        response += `\n- **Added By**: ${drug.created_by_name}`;
      }
      
      response += "\n\n";
    });
  }

  // EXPIRING SOON SECTION
  if (data.expiring_soon?.length > 0) {
    response += "## ⏳ Expiring Soon\n\n";
    response += "| Drug | Batch | Stock | Expiry | Days Left |\n";
    response += "|------|-------|-------|--------|-----------|\n";
    
    data.expiring_soon.forEach(drug => {
      const expDate = new Date(drug.exp_date);
      const today = new Date();
      const daysToExpiry = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
      
      response += `| ${drug.name} | ${drug.batch_no || 'N/A'} | ${drug.stock} | `;
      response += `${expDate.toISOString().split('T')[0]} | ${daysToExpiry} |\n`;
    });
    
    response += "\n";
  }

  // ORDERS SECTION
  if (data.orders?.length > 0) {
    response += `## 📦 ${userRole === 'pharmacy' ? 'Incoming' : 'Outgoing'} Orders\n\n`;
    
    data.orders.forEach(order => {
      response += `### Order #${order.order_no}\n`;
      response += `- **Status**: ${getStatusIcon(order.status)} ${order.status}\n`;
      response += `- **Date**: ${new Date(order.created_at).toLocaleString()}\n`;
      
      if (order.total_amount) {
        response += `- **Amount**: ₹${order.total_amount.toFixed(2)}\n`;
      }
      
      if (order.recipient_name || order.seller_name) {
        response += `- ${userRole === 'pharmacy' ? 'Supplier' : 'Recipient'}: `;
        response += `${order.recipient_name || order.seller_name}\n`;
      }
      
      if (order.item_count) {
        response += `- **Items**: ${order.item_count}\n`;
      }
      
      if (order.notes) {
        response += `- **Notes**: ${order.notes.substring(0, 50)}${order.notes.length > 50 ? '...' : ''}\n`;
      }
      
      response += "\n";
    });
  }

  // ORDER ITEMS SECTION
  if (data.order_items?.length > 0) {
    response += "## 📋 Order Items\n\n";
    response += "| Item | Order # | Qty | Price | Total | Status |\n";
    response += "|------|---------|-----|-------|-------|--------|\n";
    
    data.order_items.forEach(item => {
      response += `| ${item.drug_name || item.custom_name || 'Custom'} `;
      response += `| #${item.order_no} `;
      response += `| ${item.quantity} `;
      response += `| ₹${item.unit_price?.toFixed(2) || 'N/A'} `;
      response += `| ₹${(item.quantity * (item.unit_price || 0)).toFixed(2)} `;
      response += `| ${getStatusIcon(item.status)} ${item.status} |\n`;
    });
    
    response += "\n";
  }

  // Add summary section if there's any data
  if (response) {
    response += "## 📝 Summary\n";
    
    if (data.drugs) {
      const totalStock = data.drugs.reduce((sum, drug) => sum + (drug.stock || 0), 0);
      response += `- **Total Drugs Listed**: ${data.drugs.length} (${totalStock} total units)\n`;
    }
    
    if (data.orders) {
      response += `- **Total Orders**: ${data.orders.length}\n`;
    }
    
    if (data.expiring_soon) {
      response += `- **Drugs Expiring Soon**: ${data.expiring_soon.length}\n`;
    }
    
    if (data.critical_stock) {
      response += `- **Critical Stock Items**: ${data.critical_stock.length}\n`;
    }
    
    if (data.pending_orders) {
      response += `- **Pending Orders**: ${data.pending_orders.length}\n`;
    }
  }

  return response || "No relevant data found for your query.";
}

// Database query function
const getRelevantData = async (db, user, question) => {
  try {
    // Set query timeout
    await db.query('SET statement_timeout TO 15000');

    // Enhanced question analysis
    const questionAnalysis = {
      mentionsDrugs: /drug|medicine|inventory|stock|batch|tablet|syrup|capsule/i.test(question),
      mentionsOrders: /order|purchase|delivery|shipment|transaction/i.test(question),
      mentionsExpiration: /expir|expiry|exp date|mfg|manufactur|shelf life/i.test(question),
      mentionsCategory: /IPD|OPD|OUTREACH|category|type/i.test(question),
      mentionsUsers: /user|admin|institute|pharmacy|created by/i.test(question),
      isCounting: /count|how many|number of/i.test(question),
      isAskingStatus: /status|state|progress/i.test(question),
      isAskingDetails: /detail|info|information|about/i.test(question),
      timePeriod: (() => {
        const monthMatch = question.match(/(\d+)\s*month/i);
        if (monthMatch) return parseInt(monthMatch[1]);
        const dayMatch = question.match(/(\d+)\s*day/i);
        if (dayMatch) return Math.ceil(parseInt(dayMatch[1]) / 30);
        return null;
      })()
    };

    const params = {
      userId: user.id,
      expiryThreshold: questionAnalysis.timePeriod ? 
                      `${questionAnalysis.timePeriod} months` : '3 months',
      lowStockThreshold: 15,
      criticalStockThreshold: 5,
      limit: 25
    };

    // ADMIN QUERIES
    if (user.role === 'admin') {
      const queries = {
        drugs: questionAnalysis.mentionsDrugs && db.query(
          `SELECT d.*, u.name as created_by_name
           FROM drugs d
           LEFT JOIN users u ON d.created_by = u.id
           ${questionAnalysis.mentionsCategory ? "WHERE d.category IS NOT NULL" : ""}
           ORDER BY 
             CASE WHEN d.stock < $1 THEN 0 ELSE 1 END,
             d.exp_date ASC
           LIMIT $2`, 
          [params.lowStockThreshold, params.limit]
        ),
        
        institutes: db.query(
          `SELECT id, name, email, status, license_number, registration_date, 
                  city, state, country
           FROM users 
           WHERE role = 'institute'
           ${questionAnalysis.isAskingStatus ? "ORDER BY status" : "ORDER BY name"}
           LIMIT $1`, 
          [params.limit]
        ),
        
        orders: questionAnalysis.mentionsOrders && db.query(
          `SELECT o.*, 
                  u1.name as buyer_name, 
                  u2.name as recipient_name,
                  COUNT(oi.id) as item_count,
                  SUM(oi.total_price) as calculated_total
           FROM orders o
           JOIN users u1 ON o.user_id = u1.id
           LEFT JOIN users u2 ON o.recipient_id = u2.id
           LEFT JOIN order_items oi ON o.id = oi.order_id
           GROUP BY o.id, u1.name, u2.name
           ORDER BY o.created_at DESC
           LIMIT $1`, 
          [params.limit]
        ),
        
        expiringSoon: questionAnalysis.mentionsExpiration && db.query(
          `SELECT id, name, batch_no, exp_date, stock, category, price
           FROM drugs 
           WHERE exp_date BETWEEN NOW() AND NOW() + INTERVAL '${params.expiryThreshold}'
           ORDER BY exp_date ASC
           LIMIT $1`, 
          [params.limit]
        ),
        
        criticalStock: db.query(
          `SELECT id, name, batch_no, stock, category, price
           FROM drugs 
           WHERE stock < $1
           ORDER BY stock ASC
           LIMIT $2`, 
          [params.criticalStockThreshold, params.limit]
        ),
        
        allUsers: questionAnalysis.mentionsUsers && db.query(
          `SELECT id, name, email, role, status, registration_date
           FROM users
           ORDER BY role, name
           LIMIT $1`,
          [params.limit]
        ),
        
        pendingOrders: questionAnalysis.isAskingStatus && db.query(
          `SELECT o.id, o.order_no, COUNT(oi.id) as pending_items
           FROM orders o
           JOIN order_items oi ON o.id = oi.order_id
           WHERE oi.status = 'pending'
           GROUP BY o.id, o.order_no
           ORDER BY o.created_at ASC
           LIMIT $1`,
          [params.limit]
        )
      };

      // Execute all relevant queries in parallel
      const results = await Promise.all(
        Object.values(queries).filter(q => q).map(q => q.catch(e => {
          console.error('Query error:', e.message);
          return { rows: [] };
        }))
      );

      return {
        drugs: results[0]?.rows,
        institutes: results[1]?.rows,
        orders: results[2]?.rows,
        expiring_soon: results[3]?.rows,
        critical_stock: results[4]?.rows,
        users: results[5]?.rows,
        pending_orders: results[6]?.rows,
        question_analysis: questionAnalysis,
        params: params
      };
    }

    // INSTITUTE QUERIES
    if (user.role === 'institute') {
      const queries = {
        drugs: questionAnalysis.mentionsDrugs && db.query(
          `SELECT d.*
           FROM drugs d
           WHERE d.created_by = $1
           ${questionAnalysis.mentionsCategory ? "AND d.category IS NOT NULL" : ""}
           ORDER BY 
             CASE WHEN d.stock < $2 THEN 0 ELSE 1 END,
             d.exp_date ASC
           LIMIT $3`, 
          [params.userId, params.lowStockThreshold, params.limit]
        ),
        
        orders: questionAnalysis.mentionsOrders && db.query(
          `SELECT o.*, u.name as recipient_name,
                  COUNT(oi.id) as item_count
           FROM orders o
           JOIN users u ON o.recipient_id = u.id
           WHERE o.user_id = $1
           GROUP BY o.id, u.name
           ORDER BY o.created_at DESC
           LIMIT $2`, 
          [params.userId, params.limit]
        ),
        
        orderItems: db.query(
          `SELECT oi.*, d.name as drug_name, o.order_no, d.category,
                  u.name as seller_name
           FROM order_items oi
           LEFT JOIN drugs d ON oi.drug_id = d.id
           JOIN orders o ON oi.order_id = o.id
           LEFT JOIN users u ON oi.seller_id = u.id
           WHERE o.user_id = $1
           ORDER BY oi.created_at DESC
           LIMIT $2`, 
          [params.userId, params.limit]
        ),
        
        expiringSoon: questionAnalysis.mentionsExpiration && db.query(
          `SELECT id, name, batch_no, exp_date, stock, category, price
           FROM drugs 
           WHERE created_by = $1 AND exp_date BETWEEN NOW() AND NOW() + INTERVAL '${params.expiryThreshold}'
           ORDER BY exp_date ASC
           LIMIT $2`, 
          [params.userId, params.limit]
        ),
        
        pendingApprovals: questionAnalysis.isAskingStatus && db.query(
          `SELECT oi.id, oi.drug_id, oi.quantity, oi.status,
                  d.name as drug_name, o.order_no
           FROM order_items oi
           JOIN drugs d ON oi.drug_id = d.id
           JOIN orders o ON oi.order_id = o.id
           WHERE oi.seller_id = $1 AND oi.status = 'pending'
           ORDER BY oi.created_at ASC
           LIMIT $2`,
          [params.userId, params.limit]
        )
      };

      const results = await Promise.all(
        Object.values(queries).filter(q => q).map(q => q.catch(e => {
          console.error('Query error:', e.message);
          return { rows: [] };
        }))
      );

      return {
        drugs: results[0]?.rows,
        orders: results[1]?.rows,
        order_items: results[2]?.rows,
        expiring_soon: results[3]?.rows,
        pending_approvals: results[4]?.rows,
        question_analysis: questionAnalysis,
        params: params
      };
    }

    // PHARMACY QUERIES
    if (user.role === 'pharmacy') {
      const queries = {
        orders: questionAnalysis.mentionsOrders && db.query(
          `SELECT o.*, u.name as seller_name,
                  COUNT(oi.id) as item_count
           FROM orders o
           JOIN users u ON o.user_id = u.id
           WHERE o.recipient_id = $1
           GROUP BY o.id, u.name
           ORDER BY o.created_at DESC
           LIMIT $2`, 
          [params.userId, params.limit]
        ),
        
        orderItems: db.query(
          `SELECT oi.*, d.name as drug_name, d.category, o.order_no, 
                  u.name as seller_name, d.batch_no as drug_batch
           FROM order_items oi
           LEFT JOIN drugs d ON oi.drug_id = d.id
           JOIN orders o ON oi.order_id = o.id
           LEFT JOIN users u ON oi.seller_id = u.id
           WHERE o.recipient_id = $1
           ORDER BY oi.created_at DESC
           LIMIT $2`, 
          [params.userId, params.limit]
        ),
        
        inventory: questionAnalysis.mentionsDrugs && db.query(
          `SELECT id, name, batch_no, stock, category, price, exp_date
           FROM drugs 
           WHERE created_by = $1
           ${questionAnalysis.mentionsCategory ? "AND category IS NOT NULL" : ""}
           ORDER BY 
             CASE WHEN stock < $2 THEN 0 ELSE 1 END,
             exp_date ASC
           LIMIT $3`, 
          [params.userId, params.lowStockThreshold, params.limit]
        ),
        
        pendingOrders: db.query(
          `SELECT o.id, o.order_no, COUNT(oi.id) as pending_items
           FROM orders o
           JOIN order_items oi ON o.id = oi.order_id
           WHERE o.recipient_id = $1 AND oi.status = 'pending'
           GROUP BY o.id
           ORDER BY o.created_at ASC
           LIMIT $2`, 
          [params.userId, params.limit]
        ),
        
        expiringSoon: questionAnalysis.mentionsExpiration && db.query(
          `SELECT id, name, batch_no, exp_date, stock, category, price
           FROM drugs 
           WHERE created_by = $1 AND exp_date BETWEEN NOW() AND NOW() + INTERVAL '${params.expiryThreshold}'
           ORDER BY exp_date ASC
           LIMIT $2`, 
          [params.userId, params.limit]
        )
      };

      const results = await Promise.all(
        Object.values(queries).filter(q => q).map(q => q.catch(e => {
          console.error('Query error:', e.message);
          return { rows: [] };
        }))
      );

      return {
        orders: results[0]?.rows,
        order_items: results[1]?.rows,
        inventory: results[2]?.rows,
        pending_orders: results[3]?.rows,
        expiring_soon: results[4]?.rows,
        question_analysis: questionAnalysis,
        params: params
      };
    }

    return { error: 'Unsupported user role' };
  } catch (error) {
    console.error('Database error:', error.message);
    return { 
      error: 'Database operation failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    };
  } finally {
    await db.query('RESET statement_timeout').catch(() => {});
  }
};

// Main chatbot handler
const handleChatbotQuery = async (req, res) => {
  const { query, conversation_history = [] } = req.body;
  const user = req.user;

  try {
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });
    if (!query?.trim()) return res.status(400).json({ error: 'Query is required' });

    const db = req.app.locals.db;
    let data;

    // First try VALIDATED SQL approach
    try {
      const sqlQuery = await generateValidatedSQL(query, user.role);
      if (sqlQuery) {
        console.log('Generated SQL:', sqlQuery);
        const result = await db.query(sqlQuery);
        data = result.rows;
        
        // If no data from dynamic query, use predefined
        if (!data || data.length === 0) {
          data = await getRelevantData(db, user, query.trim());
        }
      } else {
        data = await getRelevantData(db, user, query.trim());
      }
    } catch (sqlError) {
      console.log('Dynamic SQL failed:', sqlError.message);
      data = await getRelevantData(db, user, query.trim());
    }

    let aiReply;

    // Enhanced AI call with strict instructions
    try {
      const systemPrompt = STRICT_SYSTEM_PROMPTS[user.role] || STRICT_SYSTEM_PROMPTS.institute;
      
      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversation_history,
        { 
          role: 'user', 
          content: `USER QUESTION: "${query}"
          
AVAILABLE DATA CONTEXT:
${JSON.stringify(data, null, 2)}

STRICT INSTRUCTIONS:
- Answer ONLY using the data above
- If data is empty/missing, say "No data available"
- Never invent or assume values
- Be precise and factual` 
        }
      ];

      const response = await fetchWithTimeout(
        `${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || 'gemma2:9b',
            messages: messages,
            stream: false,
            options: { temperature: 0.1, num_predict: 800 } // Lower temperature for less creativity
          })
        }
      );

      if (response.ok) {
        const result = await response.json();
        aiReply = result.message?.content;
        
        // Validate the response against data
        aiReply = validateResponseAgainstData(aiReply, data, query);
        
      } else {
        throw new Error('AI service unavailable');
      }
    } catch (aiError) {
      console.log('AI failed, using formatted response:', aiError.message);
      aiReply = formatResponse(data, user.role, query);
    }

    return res.json({
      reply: aiReply,
      conversation_id: Date.now(),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chatbot error:', error.message);
    
    return res.status(500).json({
      reply: "I'm experiencing technical difficulties. Please try again later or contact support if the issue persists.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  handleChatbotQuery
};