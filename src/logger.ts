import { pool } from "./index";

export const logs: any[] = [];

export async function log(
  level: string,
  message: string,
  req?: any,
  data?: any,
  route?: string
) {

  const usuario_id = req?.usuario?.id || null;
  const rol = req?.usuario?.rol || null;
  const ip = req?.ip || null;

  const entry = {
    level,
    message,
    route,
    usuario_id,
    rol,
    ip,
    data,
    timestamp: new Date()
  };

  // guardar en memoria
  logs.push(entry);

  if (logs.length > 500) {
    logs.shift();
  }

  console.log(
    `[${level}] ${message}`,
    route ? `[${route}]` : "",
    data || ""
  );

  // guardar en PostgreSQL
  try {

    await pool.query(
      `INSERT INTO logs
      (level, message, route, usuario_id, rol, ip, data)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        level,
        message,
        route || null,
        usuario_id,
        rol,
        ip,
        data ? JSON.stringify(data) : null
      ]
    );

  } catch (error) {

    console.error(
      `[LOGGER ERROR] ${message}`,
      error
    );

  }

}