const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sesión requerida.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    if (!req.user || !req.user.sub || !req.user.role) throw new Error('Token inválido');
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada o inválida.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tenés permisos para realizar esta operación.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
