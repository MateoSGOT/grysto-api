'use strict';

/**
 * @file HERRAMIENTA DE OPS — Genera los validadores `$jsonSchema` de Atlas a
 * partir de los schemas de Mongoose. OFFLINE: carga los models SIN conectarse
 * a ninguna base (no requiere .env).
 *
 * Los archivos generados en `db/validators/<coleccion>.json` son la FUENTE DE
 * VERDAD de lo que hay que aplicar a mano en Compass. Tras cambiar un schema:
 * correr este script, revisar el diff en git y aplicar el validador nuevo.
 *
 * Reglas de traducción (estilo del proyecto):
 * - `additionalProperties: false` en todos los objetos (raíz y subdocumentos).
 * - Numéricos → `bsonType: "number"` (acepta int/long/double/decimal).
 * - `required` = paths con `required: true` o con `default` (Mongoose siempre
 *   los escribe; los arrays tienen default `[]` implícito), `_id`, los
 *   timestamps que el schema escribe (`createdAt`/`updatedAt`) y `__v` si hay
 *   versionKey. Esos campos NO aceptan null...
 * - ...salvo `default: null`: el campo siempre existe pero puede valer null →
 *   requerido y nullable `[tipo, "null"]` (y `null` en su enum).
 * - Sin default ni required → opcional y nullable.
 * - min/max → minimum/maximum; minlength/maxlength → minLength/maxLength.
 *   (No se traducen los `match` de regex: JS y PCRE difieren. Para validar un
 *   formato en Atlas, el schema declara aparte `pattern: '<regex PCRE>'`.)
 * - `Mixed` → `{}` (cualquier valor).
 *
 * Uso:
 *   node scripts/generate-validators.js            # escribe db/validators/*.json
 *   node scripts/generate-validators.js --oneline  # además imprime cada uno en 1 línea
 *   node scripts/generate-validators.js --check    # falla si los archivos difieren
 */

const fs = require('fs');
const path = require('path');
const models = require('../src/models');

const OUT_DIR = path.join(__dirname, '..', 'db', 'validators');

/** Primer elemento si Mongoose guarda `[valor, mensaje]`. */
const unwrap = (v) => (Array.isArray(v) ? v[0] : v);

/** bsonType de un SchemaType escalar (null si no tiene restricción de tipo). */
function scalarBsonType(st) {
  switch (st.instance) {
    case 'String':
      return 'string';
    case 'Number':
    case 'Decimal128':
      return 'number';
    case 'Date':
      return 'date';
    case 'Boolean':
      return 'bool';
    case 'ObjectId':
    case 'ObjectID':
      return 'objectId';
    case 'Buffer':
      return 'binData';
    case 'Mixed':
      return null;
    default:
      throw new Error(`Tipo de Mongoose no soportado: ${st.instance} (${st.path})`);
  }
}

/** Restricciones (enum, rangos, largos) de un SchemaType escalar. */
function scalarConstraints(st) {
  const out = {};
  const o = st.options || {};
  const enumValues = st.enumValues && st.enumValues.length ? st.enumValues : null;
  if (enumValues) out.enum = [...enumValues];
  if (o.min !== undefined && st.instance === 'Number') out.minimum = unwrap(o.min);
  if (o.max !== undefined && st.instance === 'Number') out.maximum = unwrap(o.max);
  if (o.minlength !== undefined) out.minLength = unwrap(o.minlength);
  if (o.maxlength !== undefined) out.maxLength = unwrap(o.maxlength);
  if (typeof o.pattern === 'string') out.pattern = o.pattern;
  return out;
}

/** Hace nullable un fragmento de $jsonSchema (tipo + enum). */
function nullable(fragment) {
  if (!fragment.bsonType) return fragment; // Mixed: ya acepta null
  const out = { ...fragment };
  out.bsonType = [fragment.bsonType, 'null'];
  if (out.enum) out.enum = [...out.enum, null];
  return out;
}

/** Fragmento $jsonSchema de un SchemaType (sin decidir nullable). */
function fragmentFor(st) {
  // Subdocumento único.
  if (st.instance === 'Embedded' || st.$isSingleNested) {
    return objectFromSchema(st.schema);
  }
  // Array de subdocumentos o de escalares.
  if (st.instance === 'Array') {
    let items;
    if (st.$isMongooseDocumentArray) {
      items = objectFromSchema(st.schema);
    } else {
      const caster = st.embeddedSchemaType || st.caster;
      const bt = scalarBsonType(caster);
      items = bt ? { bsonType: bt, ...scalarConstraints(caster) } : {};
    }
    return { bsonType: 'array', items };
  }
  const bt = scalarBsonType(st);
  return bt ? { bsonType: bt, ...scalarConstraints(st) } : {};
}

/** Timestamps que el schema escribe automáticamente. */
function timestampFields(schema) {
  const ts = schema.options.timestamps;
  if (!ts) return [];
  if (ts === true) return ['createdAt', 'updatedAt'];
  const fields = [];
  if (ts.createdAt !== false) fields.push(typeof ts.createdAt === 'string' ? ts.createdAt : 'createdAt');
  if (ts.updatedAt !== false) fields.push(typeof ts.updatedAt === 'string' ? ts.updatedAt : 'updatedAt');
  return fields;
}

/**
 * Construye `{ bsonType: 'object', required, properties, additionalProperties }`
 * a partir de un Schema de Mongoose (raíz o subdocumento).
 */
function objectFromSchema(schema, { isRoot = false } = {}) {
  const tsFields = new Set(timestampFields(schema));
  // Mongoose solo escribe la versionKey (__v) en el documento raíz, nunca en
  // subdocumentos (aunque su schema herede la opción por defecto).
  const versionKey = isRoot ? schema.options.versionKey : false;

  // Árbol: los paths anidados (p. ej. 'demoVideo.type') se agrupan en objetos.
  const root = { props: {}, required: new Set(), children: {} };
  const nodeFor = (parts) => {
    let node = root;
    for (const p of parts) {
      if (!node.children[p]) node.children[p] = { props: {}, required: new Set(), children: {} };
      node = node.children[p];
    }
    return node;
  };

  for (const [fullPath, st] of Object.entries(schema.paths)) {
    if (fullPath === schema.options.versionKey) continue; // se agrega aparte (solo raíz)
    const parts = fullPath.split('.');
    const name = parts.pop();
    const node = nodeFor(parts);

    const isTs = parts.length === 0 && tsFields.has(name);
    // Mongoose SIEMPRE escribe los campos con default (los arrays tienen
    // default [] implícito), así que van en `required`. Si el default es null,
    // el campo existe pero puede valer null → requerido y nullable.
    const { defaultValue } = st;
    const hasDefault = defaultValue !== undefined;
    const defaultIsNull = defaultValue === null;
    const isRequired =
      Boolean(st.isRequired) || name === '_id' || isTs || hasDefault;
    const isNullable = defaultIsNull || !isRequired;
    const frag = fragmentFor(st);
    node.props[name] = isNullable ? nullable(frag) : frag;
    if (isRequired) node.required.add(name);
  }

  if (versionKey) {
    root.props[versionKey] = { bsonType: 'number' };
    root.required.add(versionKey);
  }

  const build = (node) => {
    const properties = { ...node.props };
    const required = new Set(node.required);
    for (const [name, child] of Object.entries(node.children)) {
      const obj = build(child);
      properties[name] = obj;
      // Un objeto anidado con algún campo requerido siempre existe.
      if (obj.required && obj.required.length) required.add(name);
    }
    const out = { bsonType: 'object' };
    if (required.size) out.required = [...required];
    out.properties = properties;
    out.additionalProperties = false;
    return out;
  };
  return build(root);
}

/** Índices declarados en el schema (para el inventario). */
function indexesOf(model) {
  return model.schema.indexes().map(([fields, options]) => ({ fields, options }));
}

function main() {
  const args = new Set(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const seen = new Set();
  let drift = false;
  const summary = [];

  for (const model of Object.values(models)) {
    const coll = model.collection.collectionName;
    if (seen.has(coll)) continue;
    seen.add(coll);

    const validator = { $jsonSchema: objectFromSchema(model.schema, { isRoot: true }) };
    const file = path.join(OUT_DIR, `${coll}.json`);
    const pretty = `${JSON.stringify(validator, null, 2)}\n`;

    if (args.has('--check')) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (current.replace(/\r\n/g, '\n') !== pretty) {
        drift = true;
        // eslint-disable-next-line no-console
        console.error(`✗ ${coll}: el archivo no coincide con el schema`);
      }
    } else {
      fs.writeFileSync(file, pretty);
    }

    summary.push({ model: model.modelName, collection: coll, indexes: indexesOf(model) });
    if (args.has('--oneline')) {
      // eslint-disable-next-line no-console
      console.log(`\n# ${coll}\n${JSON.stringify(validator)}`);
    }
  }

  if (args.has('--inventory')) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  }
  if (args.has('--check') && drift) process.exit(1);
  if (!args.has('--check')) {
    // eslint-disable-next-line no-console
    console.log(`✓ ${seen.size} validadores en db/validators/`);
  }
}

main();
