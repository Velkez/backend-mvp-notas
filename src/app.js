require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer"); // Importar nodemailer

const app = express();

// Middleware global para CORS simplificado
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  next();
});

// Aumentar el límite de tamaño del payload
app.use(bodyParser.json({ limit: "20mb" })); // Cambia "20mb" según sea necesario
app.use(bodyParser.urlencoded({ limit: "20mb", extended: true }));

// Middleware de autorización
app.use((req, res, next) => {
  const excludedPaths = ["/probar-smtp"]; // Endpoints que no requieren autorización
  if (excludedPaths.includes(req.path)) {
    console.log(`Endpoint excluido de autorización: ${req.path}`);
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.error("Autorización fallida: No se envió el encabezado Authorization");
    return res.status(403).json({ error: "No autorizado: Falta el encabezado Authorization" });
  }

  const token = authHeader.split("Bearer ")[1];
  if (!token) {
    console.error("Autorización fallida: Formato del token incorrecto");
    return res.status(403).json({ error: "No autorizado: Formato del token incorrecto" });
  }

  console.log("Token recibido:", token);
  console.log("Token esperado:", process.env.ADMIN_SECRET_TOKEN);

  if (token !== process.env.ADMIN_SECRET_TOKEN) {
    console.error("Autorización fallida: Token no válido");
    return res.status(403).json({ error: "No autorizado: Token no válido" });
  }

  console.log("Autorización exitosa");
  next();
});

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

app.get("/cursos", async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection("cursos").get();
    const cursos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(cursos);
  } catch (error) {
    return res.status(500).json({ error: error.message });
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

app.post("/enviar-correo", async (req, res) => {
  const { destinatario, asunto, html, pdfBase64, nombreAdjunto, smtpUser, smtpPass } = req.body;

  // Verificar el token secreto
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader.split("Bearer ")[1] !== process.env.ADMIN_SECRET_TOKEN) {
    console.error("Autorización fallida: Token no válido o ausente");
    return res.status(403).json({ error: "No autorizado: Token no válido o ausente" });
  }

  if (!destinatario || !html || !pdfBase64 || !smtpUser || !smtpPass) {
    console.error("Faltan datos obligatorios para enviar el correo.");
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
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
    console.log(`Intentando enviar correo a: ${destinatario}`);
    await transporter.sendMail(mailOptions);
    console.log(`Correo enviado exitosamente a: ${destinatario}`);
    res.status(200).json({ mensaje: "Correo enviado correctamente" });
  } catch (error) {
    console.error("Error enviando correo:", error.message);
    res.status(500).json({ error: "Error enviando correo" });
  }
});

// Endpoint para probar SMTP
app.post("/probar-smtp", async (req, res) => {
  const { smtpUser, smtpPass } = req.body;

  if (!smtpUser || !smtpPass) {
    return res.status(400).json({ error: "Correo y contraseña son obligatorios" });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  try {
    // Intentar verificar la conexión con el servidor SMTP
    await transporter.verify();
    console.log(`Conexión SMTP exitosa para el usuario: ${smtpUser}`);
    res.status(200).json({ mensaje: "Conexión SMTP exitosa" });
  } catch (error) {
    console.error("Error verificando conexión SMTP:", error.message);
    res.status(403).json({ error: "No se pudo autenticar con el servidor SMTP" });
  }
});

module.exports = app;