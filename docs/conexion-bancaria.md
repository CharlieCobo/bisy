# Conexión bancaria

Bisy puede importar movimientos automáticamente usando **open banking (PSD2)**. Tú autorizas el acceso en la web de tu banco y Bisy recibe un permiso de **solo lectura** para ver saldos y movimientos. Ese permiso dura como máximo 180 días; después hay que renovarlo, porque así lo exige la normativa.

## Opciones evaluadas (noviembre 2026)

| Proveedor | Países | Coste para uso personal | Estado |
|---|---|---|---|
| **Enable Banking** ✅ | España y UE (BBVA, Santander, CaixaBank, ING, Sabadell, Revolut…) | **Gratis** en modo *restricted production*, solo para cuentas que vinculas tú mismo | **Implementado** |
| GoCardless Bank Account Data (antes Nordigen) | UE | Era gratis | **Cerrado a nuevos registros**, no sirve |
| Tink (Visa) | UE | Plan de pago para empresas | Solo para empresas |
| Belvo | Colombia, México, Brasil | Contrato B2B, sin plan para particulares | Encaja en el futuro si abren acceso |
| Prometeo | Colombia y LatAm | Contrato B2B | Ídem |

**Colombia:** el open finance colombiano todavía no ofrece acceso gratuito a particulares. Bancolombia, Davivienda, Nequi y otros permiten descargar el extracto en Excel o CSV: usa **Importar CSV**, que detecta los formatos más habituales y no duplica movimientos aunque importes el mismo archivo dos veces. La interfaz `server/src/bank/provider.ts` está pensada para añadir Belvo o Prometeo más adelante.

## Configurar Enable Banking (España)

1. Crea una cuenta en <https://enablebanking.com> y entra en el *Control Panel → Applications*.
2. Registra una aplicación nueva:
   - Entorno: **Production**. Sin contrato queda en modo *restricted*, que basta para tus propias cuentas.
   - Redirect URL: `http://localhost:5173/bancos/callback`. Si usas `npm start`, pon `http://localhost:4000/bancos/callback` y cámbialo también en `.env`.
   - Al crearla se descarga la **clave privada** (`.pem`). Guárdala en la carpeta del proyecto, por ejemplo como `enablebanking.pem`. Nunca la subas a GitHub; `*.pem` ya está en `.gitignore`.
3. En la aplicación, usa **"Link accounts"** para vincular tus cuentas (requisito del modo restricted).
4. Copia `.env.example` a `.env` y rellena:
   ```
   ENABLE_BANKING_APP_ID=<id de la aplicación>
   ENABLE_BANKING_KEY_PATH=./enablebanking.pem
   ENABLE_BANKING_REDIRECT_URL=http://localhost:5173/bancos/callback
   ```
5. Reinicia Bisy (`npm run dev`), ve a **Bancos**, elige tu banco y autoriza.
6. Al volver, elige para cada cuenta si crear una cuenta nueva en Bisy o vincularla a una existente. Se importan los últimos 90 días y el saldo inicial se ajusta para que coincida con el del banco.
7. Pulsa **Sincronizar ahora** cuando quieras traer movimientos nuevos. Cada sincronización vuelve a pedir los últimos 10 días para recoger los que estaban pendientes, sin duplicar.

## Cómo funciona por dentro

- Autenticación con un JWT RS256 firmado con tu clave (`kid` = id de la aplicación).
- `POST /auth` crea la autorización y redirige al banco. `POST /sessions` canjea el código por una sesión con las cuentas.
- `GET /accounts/{uid}/transactions` se pagina con `continuation_key`. Los movimientos pendientes (`PDNG`) se ignoran hasta que se contabilizan.
- Cada movimiento se guarda con `external_id = bank:<entry_reference>`, con restricción única por cuenta, así que no se duplica.
- Las reglas de categorización (Ajustes) se aplican al importar.
