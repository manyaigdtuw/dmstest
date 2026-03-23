const { v4: uuidv4 } = require('uuid');
let chalk;

// Safe chalk import
try {
  chalk = require('chalk');
} catch (e) {
  chalk = {
    blue: (t) => t,
    green: (t) => t,
    red: (t) => t,
    yellow: (t) => t,
    cyan: { bold: (t) => t },
    gray: (t) => t
  };
}

const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Safe logger (chalk NEVER crashes)
const logger = {
  info: (message, meta = {}) => {
    console.log(chalk.blue(`[INFO] ${message}`), meta);
  },
  success: (message, meta = {}) => {
    console.log(chalk.green(`[SUCCESS] ${message}`), meta);
  },
  error: (message, meta = {}) => {
    // Guard: if chalk.red is undefined, fallback
    const prefix = chalk?.red?.bold
      ? chalk.red.bold(`[ERROR] ${message}`)
      : `[ERROR] ${message}`;

    console.error(prefix, meta);
  },
  request: (req) => {
    console.log(
      chalk.yellow(`[${new Date().toISOString()}]`),
      chalk?.cyan?.bold ? chalk.cyan.bold(req.method) : req.method,
      req.path,
      chalk.gray(`from ${getIp(req)}`)
    );
  },
  response: (req, res, duration) => {
    const statusColor = res.statusCode >= 400 ? chalk.red : chalk.green;
    console.log(
      chalk.yellow(`[${new Date().toISOString()}]`),
      statusColor?.bold
        ? statusColor.bold(`Status: ${res.statusCode}`)
        : `Status: ${res.statusCode}`,
      chalk.gray(`in ${duration}ms`)
    );
  }
};

const getIp = (req) => {
  let ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip && ip.includes('::ffff:')) ip = ip.split(':').pop();
  return ip || 'unknown';
};

const redactSensitiveFields = (obj) => {
  if (!obj) return obj;
  const sensitive = ['password', 'token', 'jwtToken', 'authorization'];

  const clone = JSON.parse(JSON.stringify(obj));
  sensitive.forEach((f) => {
    if (clone[f]) clone[f] = '***REDACTED***';
  });

  return clone;
};

const logRequest = (req, res, next) => {
  const requestId = uuidv4();
  req._requestId = requestId;
  req._startTime = process.hrtime();

  logger.request(req);

  const logEntry = {
    requestId,
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    ip: getIp(req),
    user: req.user?.id || 'anonymous',
    query: req.query,
    params: req.params,
    body: redactSensitiveFields(req.body)
  };

  fs.appendFileSync(
    path.join(logsDir, 'requests.log'),
    JSON.stringify(logEntry) + '\n'
  );

  next();
};

const logResponse = (req, res, next) => {
  const oldWrite = res.write;
  const oldEnd = res.end;
  const chunks = [];

  res.write = function (chunk) {
    chunks.push(chunk);
    return oldWrite.apply(res, arguments);
  };

  res.end = function (chunk) {
    if (chunk) chunks.push(chunk);

    const durationMs = (
      req._startTime
        ? process.hrtime(req._startTime)[0] * 1e3 +
          process.hrtime(req._startTime)[1] / 1e6
        : 0
    ).toFixed(2);

    logger.response(req, res, durationMs);

    const bufferChunks = chunks.map((c) =>
      Buffer.isBuffer(c) ? c : Buffer.from(c)
    );

    const responseLog = {
      requestId: req._requestId,
      timestamp: new Date().toISOString(),
      status: res.statusCode,
      duration: `${durationMs}ms`,
      body: bufferChunks.length
        ? Buffer.concat(bufferChunks).toString('utf8')
        : null
    };

    fs.appendFileSync(
      path.join(logsDir, 'responses.log'),
      JSON.stringify(responseLog) + '\n'
    );

    oldEnd.apply(res, arguments);
  };

  next();
};

const errorLogger = (err, req, res, next) => {
  const requestId = req?._requestId || 'unknown';

  const errorLog = {
    timestamp: new Date().toISOString(),
    requestId,
    path: req?.path || 'unknown',
    method: req?.method || 'unknown',
    user: req?.user?.id || 'anonymous',
    error: {
      message: err?.message || 'Unknown error',
      stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
    }
  };

  logger.error(
    `Error in ${req?.method || 'UNKNOWN'} ${req?.path || 'UNKNOWN'}`,
    { message: err?.message }
  );

  try {
    fs.appendFileSync(
      path.join(logsDir, 'errors.log'),
      JSON.stringify(errorLog) + '\n'
    );
  } catch (fsErr) {
    console.error('Failed to write error log', fsErr);
  }

  next(err);
};

module.exports = { logRequest, logResponse, errorLogger };
