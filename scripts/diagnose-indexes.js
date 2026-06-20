'use strict';

/**
 * @file HERRAMIENTA DE OPS — Diagnóstico READ-ONLY de índices. No modifica
 * NADA en Atlas: solo lee `getIndexes()` y los validators, e imprime los
 * comandos que tú decides ejecutar.
 *
 * Cuándo correrlo: antes de probar contra Atlas cada vez que agregues una
 * colección nueva o un índice (sobre todo compuestos), para descartar el
 * problema de "parallel arrays" (un índice compuesto sobre 2+ campos array
 * es inválido en MongoDB y bloquea los inserts). Es seguro correrlo siempre.
 *
 * Uso: node scripts/diagnose-indexes.js
 *
 * Qué hace:
 * 1. Lista los índices de `weeklyPlans`.
 * 2. Detecta el índice compuesto targetPosition_1_targetLevel_1_targetGoal_1.
 * 3. Si existe, imprime el comando de borrado + los 3 índices de campo único.
 * 4. Escanea las 12 colecciones: marca cualquier índice COMPUESTO que toque
 *    2+ campos array distintos (problema de "parallel arrays").
 */

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../src/config/database');

const BAD_WEEKLY_INDEX = 'targetPosition_1_targetLevel_1_targetGoal_1';

/**
 * Devuelve el set de campos array (bsonType array) de un $jsonSchema.
 *
 * @param {Object|undefined} jsonSchema - El $jsonSchema del validator.
 * @returns {Set<string>} Nombres de campos array (top-level).
 */
function getArrayFields(jsonSchema) {
  const fields = new Set();
  const props = jsonSchema?.properties || {};
  for (const [key, def] of Object.entries(props)) {
    const t = def.bsonType;
    if (t === 'array' || (Array.isArray(t) && t.includes('array'))) {
      fields.add(key);
    }
  }
  return fields;
}

/**
 * Raíces array distintas que toca un índice (segmento previo al primer punto).
 *
 * @param {Object} indexKey - El objeto `key` del índice.
 * @param {Set<string>} arrayFields - Campos array de la colección.
 * @returns {string[]} Raíces array involucradas.
 */
function arrayRootsOf(indexKey, arrayFields) {
  const roots = new Set();
  for (const field of Object.keys(indexKey)) {
    const root = field.split('.')[0];
    if (arrayFields.has(root)) roots.add(root);
  }
  return [...roots];
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;

  // ── 1 + 2: weeklyPlans en detalle ─────────────────────────────────
  console.log('\n══════════ 1) ÍNDICES ACTUALES DE weeklyPlans ══════════');
  const weeklyIndexes = await db.collection('weeklyPlans').indexes();
  weeklyIndexes.forEach((idx) => {
    console.log(`  • ${idx.name.padEnd(45)} key=${JSON.stringify(idx.key)}`);
  });

  const badWeekly = weeklyIndexes.find((i) => i.name === BAD_WEEKLY_INDEX);
  console.log('\n══════════ 2) ¿EXISTE EL ÍNDICE COMPUESTO PROBLEMÁTICO? ══════════');
  if (badWeekly) {
    console.log(`  ❌ SÍ existe "${BAD_WEEKLY_INDEX}" (arrays paralelos)`);
    console.log('\n  ── 3) COMANDOS PARA CORREGIRLO (córrelos tú en mongosh/Compass) ──');
    console.log(`  db.weeklyPlans.dropIndex("${BAD_WEEKLY_INDEX}")`);
    console.log('  db.weeklyPlans.createIndex({ targetPosition: 1 })');
    console.log('  db.weeklyPlans.createIndex({ targetLevel: 1 })');
    console.log('  db.weeklyPlans.createIndex({ targetGoal: 1 })');
  } else {
    console.log('  ✓ NO existe — Mongoose ya no lo crea (índices de campo único).');
    console.log('    Nada que borrar en weeklyPlans.');
  }

  // ── 4: escaneo global de arrays paralelos ─────────────────────────
  console.log('\n══════════ 4) ESCANEO GLOBAL — índices compuestos sobre arrays ══════════');
  const collections = await db.listCollections().toArray();
  const offenders = [];

  for (const info of collections) {
    const name = info.name;
    const arrayFields = getArrayFields(info.options?.validator?.$jsonSchema);
    let indexes;
    try {
      // eslint-disable-next-line no-await-in-loop
      indexes = await db.collection(name).indexes();
    } catch {
      continue;
    }

    for (const idx of indexes) {
      const keys = Object.keys(idx.key);
      if (keys.length < 2) continue; // single-field nunca es parallel-arrays
      const roots = arrayRootsOf(idx.key, arrayFields);
      if (roots.length >= 2) {
        offenders.push({ collection: name, index: idx.name, key: idx.key, roots });
      }
    }
  }

  if (offenders.length === 0) {
    console.log('  ✓ Ningún índice compuesto toca 2+ campos array. Todo limpio.');
  } else {
    console.log(`  ❌ ${offenders.length} índice(s) con arrays paralelos:\n`);
    for (const o of offenders) {
      console.log(`  · ${o.collection}.${o.index}  (arrays: ${o.roots.join(', ')})`);
      console.log(`      db.${o.collection}.dropIndex("${o.index}")`);
      for (const field of Object.keys(o.key)) {
        console.log(`      db.${o.collection}.createIndex({ ${field}: ${o.key[field]} })`);
      }
    }
  }

  console.log('\n(Diagnóstico read-only: no se modificó nada en Atlas.)\n');
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('✗', err.message);
  try {
    await disconnectDB();
  } catch {
    /* noop */
  }
  process.exit(1);
});
