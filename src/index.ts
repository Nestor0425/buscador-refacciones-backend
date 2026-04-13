import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import { Pool } from "pg";
import multer from "multer";
import XLSX from "xlsx";
import { log } from "./logger";
import { createClient } from "@supabase/supabase-js";
import { Request, Response, NextFunction } from "express";

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const upload = multer({ storage: multer.memoryStorage() });
const app = express();

app.use(cors());
app.use(express.json());

// --- CONEXIÓN BASE DE DATOS ---
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- MIDDLEWARE DE AUTENTICACIÓN (CON MEJORA DE INTERVALO) ---
async function verificarSesion(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token requerido" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as { id: number; rol: string };

    // 🔥 MEJORA SENIOR: Se añade el margen de 1 minuto para evitar desfases entre servidores
    const sesion = await pool.query(
      `SELECT * FROM sesiones_activas 
       WHERE token = $1 
       AND expira_en > (NOW() - INTERVAL '1 minute')`,
      [token]
    );

    if (sesion.rows.length === 0) {
      return res.status(403).json({ error: "Sesión inválida o expirada" });
    }

    await pool.query(
      `UPDATE sesiones_activas
       SET ultima_actividad = NOW()
       WHERE token = $1`,
      [token]
    );

    (req as any).usuario = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Token inválido" });
  }
}

// --- LOGGING HTTP ---
app.use((req: any, res, next) => {
  const inicio = Date.now();
  res.on("finish", () => {
    const duracion = Date.now() - inicio;
    log("INFO", "Petición HTTP", {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      tiempo: `${duracion}ms`,
      ip: req.ip,
      usuario: req.usuario?.id
    }, "/api");
  });
  next();
});

// --- RUTAS DE SISTEMA ---
app.get("/ping", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/logs", (req, res) => res.json(log));
app.get("/test", async (req, res) => {
  const result = await pool.query("SELECT NOW()");
  res.json(result.rows[0]);
});

app.get("/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, message: "Backend y base de datos conectados", time: result.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Error conectando a la base de datos" });
  }
});

// --- RUTAS DE REFACCIONES ---
app.get("/refacciones", async (_, res) => {
  const result = await pool.query("SELECT * FROM refacciones ORDER BY id ASC");
  res.json(result.rows);
});

app.get("/refacciones/con-ubicacion", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM refacciones WHERE ubicacion IS NOT NULL AND TRIM(ubicacion) <> ''");
    return res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error al consultar la base" });
  }
});

app.post("/importar-excel", upload.single("file"), async (req, res) => {
  try {
    const workbook = XLSX.read(req.file!.buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);
    let insertados = 0, actualizados = 0;

    for (const row of rows) {
      if (!row.refInterna) continue;
      const existe = await pool.query("SELECT id FROM refacciones WHERE refinterna = $1", [row.refInterna]);

      if (existe.rows.length > 0) {
        await pool.query("UPDATE refacciones SET cantidad = $1 WHERE refinterna = $2", [Number(row.cantidad) || 0, row.refInterna]);
        actualizados++;
      } else {
        await pool.query(
          `INSERT INTO refacciones (nombreprod, categoriaprin, maquinamod, maquinaesp, tipoprod, modelo, refinterna, palclave, cantidad, unidad, ubicacion, observacion, imagen) 
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [row.nombreProd, row.categoriaPrin, row.maquinaMod, row.maquinaEsp, row.tipoProd, row.modelo, row.refInterna, row.palClave, Number(row.cantidad) || 0, row.unidad, row.ubicacion, row.observacion, row.imagen]
        );
        insertados++;
      }
    }
    res.json({ ok: true, insertados, actualizados });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

app.get("/refacciones/destacadas", async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombreprod, modelo, ubicacion, destacada FROM refacciones WHERE destacada = true');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

app.put("/refacciones/:id", upload.single("imagen"), async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const campos: any = {};

    if (body.eliminarImagen === "true") {
      await pool.query("UPDATE refacciones SET imagen=NULL WHERE id=$1", [id]);
    }

    if (req.file) {
      const ext = req.file.originalname.split(".").pop();
      const fileName = `refaccion_${Date.now()}.${ext}`;
      await supabase.storage.from("refacciones").upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
      const { data } = supabase.storage.from("refacciones").getPublicUrl(fileName);
      campos.imagen = data.publicUrl;
    }

    const keys = Object.keys(campos);
    if (keys.length > 0) {
      const set = keys.map((k, i) => `${k}=$${i + 1}`).join(",");
      await pool.query(`UPDATE refacciones SET ${set} WHERE id=$${keys.length + 1}`, [...Object.values(campos), id]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.delete("/refacciones/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM refacciones WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
});

// --- AUTENTICACIÓN Y LOGIN ---
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE email = $1 AND activo = true", [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Usuario no encontrado" });

    const usuario = result.rows[0];
    const passwordValida = await bcrypt.compare(password, usuario.password);
    if (!passwordValida) return res.status(401).json({ error: "Contraseña incorrecta" });

    const token = jwt.sign({ id: usuario.id, rol: usuario.rol }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES });

    await pool.query(
      `INSERT INTO sesiones_activas (usuario_id, token, ip, user_agent, expira_en) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '8 hours')`,
      [usuario.id, token, req.ip, req.headers["user-agent"]]
    );

    res.json({ token, nombre: usuario.nombre, rol: usuario.rol });
  } catch (err) {
    res.status(500).json({ error: "Error en login" });
  }
});

app.get("/me", verificarSesion, async (req: any, res) => {
  try {
    const result = await pool.query("SELECT id, nombre, rol FROM usuarios WHERE id = $1", [req.usuario?.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener usuario" });
  }
});

app.post("/logout", verificarSesion, async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  await pool.query("DELETE FROM sesiones_activas WHERE token = $1", [token]);
  res.json({ mensaje: "Sesión cerrada correctamente" });
});

// --- LIMPIEZA AUTOMÁTICA ---
setInterval(async () => {
  try {
    await pool.query("DELETE FROM sesiones_activas WHERE expira_en < NOW()");
  } catch (e) {
    console.error("Error limpiando sesiones", e);
  }
}, 1000 * 60 * 10);

app.listen(5000, () => {
  log("INFO", "Backend iniciado", null, { puerto: 5000 }, "/server");
});