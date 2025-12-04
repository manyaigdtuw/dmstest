const authorizeRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ msg: "User not authenticated or missing role" });
    }

    const userRole = req.user.role.toLowerCase();
    const allowed = allowedRoles.map(r => r.toLowerCase());

    console.log("authorizeRole → userRole:", userRole, "allowedRoles:", allowed);

    if (!allowed.includes(userRole)) {
      return res.status(403).json({ msg: "Access Denied" });
    }

    next();
  };
};

module.exports = authorizeRole;
