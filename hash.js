// // const bcrypt = require("bcrypt");

// // (async () => {
// //   const hash = await bcrypt.hash("refaccionesiemco", 10);
// //   console.log(hash);
// // })();

// // SELECT crypt('Iemcoservicio', gen_salt('bf', 10));

// INSERT INTO usuarios (nombre, email, password, rol, activo)
// VALUES 
// (
//   'Refacciones',
//   'refacciones@iemco.com',
//   crypt('refaccionesiemco', gen_salt('bf', 10)),
// //   'admin',
//   true
// ),
// (
//   'Mantenimiento',
//   'mantenimiento@iemco.com',
//   crypt('mantenimientoiemco', gen_salt('bf', 10)),
//   'mantenimiento',
//   true
// ),
// (
//   'Iemco',
//   'Iemco@servicio.com',
//   crypt('Iemcoservicio', gen_salt('bf', 10)),
//   'personal',
//   true
// );