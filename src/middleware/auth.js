import { auth } from "../firebase.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;        // req.user.uid is now available downstream
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}