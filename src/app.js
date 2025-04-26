require("dotenv").config();
import express from "express";
import { json, urlencoded } from "body-parser";
import { createTransport } from "nodemailer";
import admin from "firebase-admin"; // Importar Firebase Admin SDK

// Inicializar Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

// Configuración de la aplicación
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware global para CORS simplificado
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  next();
});

// Middlewares globales
app.use(express.json());
app.use(json({ limit: "20mb" }));
app.use(urlencoded({ limit: "20mb", extended: true }));
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use((req, res, next) => {
  console.log(`Ruta solicitada: ${req.method} ${req.path}`);
  next();
});

// Middleware de autorización
app.use((req, res, next) => {
  const excludedPaths = ["/probar-smtp", "/enviar-correo"];
  if (req.method === 'OPTIONS') return next();
  if (excludedPaths.includes(req.path)) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(403).json({ error: "No autorizado: Falta el encabezado Authorization" });
  }

  const token = authHeader.split("Bearer ")[1];
  if (!token || token !== process.env.ADMIN_SECRET_TOKEN) {
    return res.status(403).json({ error: "No autorizado: Token no válido" });
  }

  next();
});

// Rutas de usuarios
app.post("/crear-usuario", async (req, res) => {
  const { email, password, nombre, profesion } = req.body;
  if (!email || !password || !nombre || !profesion) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }
  try {
    const user = await admin.auth().createUser({ email, password });
    await admin.firestore().collection("usuarios").doc(user.uid).set({
      uid: user.uid,
      email,
      nombre,
      profesion,
      rol: "profesor",
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      ultimaConexion: null,
      cursos: [],
      materias: []
    });
    return res.status(200).json({ uid: user.uid });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/maestros", async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection("usuarios").where("rol", "==", "profesor").get();
    const maestros = snapshot.docs.map(doc => doc.data());
    return res.status(200).json(maestros);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/maestros/:uid", async (req, res) => {
  const { uid } = req.params;
  const { nombre, profesion, cursos, materias } = req.body;

  try {
    const updates = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (profesion !== undefined) updates.profesion = profesion;
    if (Array.isArray(cursos)) updates.cursos = cursos;
    if (Array.isArray(materias)) updates.materias = materias;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Faltan datos para actualizar" });
    }

    await admin.firestore().collection("usuarios").doc(uid).update(updates);
    return res.status(200).json({ message: "Usuario actualizado" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/maestros/:uid", async (req, res) => {
  const { uid } = req.params;
  try {
    await admin.auth().deleteUser(uid);
    await admin.firestore().collection("usuarios").doc(uid).delete();
    return res.status(200).json({ message: "Usuario eliminado" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Rutas de cursos
app.get("/cursos", async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection("cursos").get();
    if (snapshot.empty) {
      return res.status(404).json({ error: "No se encontraron cursos" });
    }
    const cursos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(cursos);
  } catch (error) {
    return res.status(500).json({ error: "Error al obtener cursos" });
  }
});

app.post("/cursos", async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: "Nombre es obligatorio" });
  try {
    const docRef = await admin.firestore().collection("cursos").add({ nombre });
    return res.status(200).json({ id: docRef.id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/cursos/:id", async (req, res) => {
  try {
    await admin.firestore().collection("cursos").doc(req.params.id).delete();
    return res.status(200).json({ message: "Curso eliminado" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Rutas de materias
app.get("/materias", async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection("materias").get();
    const materias = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(materias);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/materias", async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: "Nombre es obligatorio" });
  try {
    const docRef = await admin.firestore().collection("materias").add({ nombre });
    return res.status(200).json({ id: docRef.id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/materias/:id", async (req, res) => {
  try {
    await admin.firestore().collection("materias").doc(req.params.id).delete();
    return res.status(200).json({ message: "Materia eliminada" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Rutas de correo
app.post("/enviar-correo", async (req, res) => {
  const { destinatario, asunto, html, pdfBase64, nombreAdjunto, smtpUser, smtpPass } = req.body;

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader.split("Bearer ")[1] !== process.env.ADMIN_SECRET_TOKEN) {
    return res.status(403).json({ error: "No autorizado: Token no válido o ausente" });
  }

  if (!destinatario || !html || !pdfBase64 || !smtpUser || !smtpPass) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  const transporter = createTransport({
    service: "gmail",
    auth: { user: smtpUser, pass: smtpPass },
  });

  const mailOptions = {
    from: smtpUser,
    to: destinatario,
    subject: asunto || "Boletín académico",
    html,
    attachments: [
      {
        filename: nombreAdjunto || "boletin.pdf",
        content: Buffer.from(pdfBase64, "base64"),
        contentType: "application/pdf",
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    res.header('Access-Control-Expose-Headers', 'X-Custom-Header');
    res.header('X-Custom-Header', 'mail-sent');
    return res.status(200).json({ mensaje: "Correo enviado correctamente" });
  } catch (error) {
    return res.status(500).json({ 
      error: "Error en el servidor",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post("/probar-smtp", async (req, res) => {
  const { smtpUser, smtpPass } = req.body;

  if (!smtpUser || !smtpPass) {
    return res.status(400).json({ error: "Correo y contraseña son obligatorios" });
  }

  const transporter = createTransport({
    service: "gmail",
    auth: { user: smtpUser, pass: smtpPass },
  });

  try {
    await transporter.verify();
    return res.status(200).json({ mensaje: "Conexión SMTP exitosa" });
  } catch (error) {
    return res.status(403).json({ error: "No se pudo autenticar con el servidor SMTP" });
  }
});

// Endpoint raíz
app.get("/", (req, res) => {
  res.status(200).json({ mensaje: "Servidor funcionando correctamente" });
});

// Middleware para manejar errores
app.use((err, req, res, next) => {
  console.error("Error no manejado:", err.message);
  res.status(500).json({ error: "Error interno del servidor" });
});

// Exportación para Vercel
module.exports = app;
