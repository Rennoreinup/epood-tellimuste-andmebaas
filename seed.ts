// seed.ts — täidab e-poe andmebaasi realistlike andmetega (Bun + bun:sqlite)
//
// Käivitamine: bun run seed.ts
//
// Põhimõtted:
//  - dump.sql skeem laetakse sisse enne andmete sisestust
//  - Mass-sisestus toimub partiidena (BATCH_SIZE), igaüks ühe transaktsioonina
//    (db.transaction), mitte rida-realt
//  - Sekundaarsed indeksid luuakse PÄRAST andmete laadimist
//  - FK kontroll (PRAGMA foreign_key_check) tehakse lõpus, peab olema tühi
//  - faker.seed() tagab reprodutseeritavuse — sama seemne korral sama andmestik

import { Database } from "bun:sqlite";
import { faker } from "@faker-js/faker";
import { existsSync, unlinkSync } from "node:fs";

// ---------------------------------------------------------------------
// KONFIGURATSIOON
// ---------------------------------------------------------------------
const DB_FILE = "./epood.db";
const SCHEMA_FILE = "./dump.sql";
const SEED = 20260614; // fikseeritud seeme -> reprodutseeritav andmestik

const CONFIG = {
  CUSTOMERS: 150_000,
  PRODUCTS: 8_000,
  ORDERS: 700_000,
  ITEMS_PER_ORDER_MIN: 2,
  ITEMS_PER_ORDER_MAX: 4, // keskmiselt 3 rida tellimuse kohta
  BATCH_SIZE: 5_000,
};

const ESTONIAN_CITIES = [
  "Tallinn", "Tartu", "Narva", "Pärnu", "Viljandi", "Rakvere",
  "Maardu", "Kuressaare", "Sillamäe", "Võru", "Valga", "Haapsalu",
];

const CATEGORIES = [
  "Elektroonika", "Kodumasinad", "Mööbel", "Riided", "Jalanõud",
  "Sport ja vaba aeg", "Iluteenused", "Lemmikloomatarbed", "Aed ja terrass",
  "Raamatud", "Mänguasjad", "Toit ja jook",
];

// staatuste järjekord vastab dump.sql sisestusjärjekorrale
const ORDER_STATUSES = ["new", "paid", "shipped", "delivered", "cancelled"];
// realistlik jaotus: enamik tellimusi on kohale toimetatud, vähesed tühistatud
const STATUS_WEIGHTS = [0.05, 0.15, 0.15, 0.6, 0.05];

function weightedStatusId(): number {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < STATUS_WEIGHTS.length; i++) {
    acc += STATUS_WEIGHTS[i];
    if (r <= acc) return i + 1; // staatuse id on 1-indekseeritud
  }
  return STATUS_WEIGHTS.length;
}

// ---------------------------------------------------------------------
// ALGSEADISTUS
// ---------------------------------------------------------------------
faker.seed(SEED);

if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
const walFile = `${DB_FILE}-wal`;
const shmFile = `${DB_FILE}-shm`;
if (existsSync(walFile)) unlinkSync(walFile);
if (existsSync(shmFile)) unlinkSync(shmFile);

const db = new Database(DB_FILE, { create: true });

// Minimaalne kirjutuskaitse mass-sisestuse ajaks (taastatakse lõpus)
db.exec("PRAGMA journal_mode = MEMORY");
db.exec("PRAGMA synchronous = OFF");
db.exec("PRAGMA foreign_keys = OFF"); // taastatakse + kontrollitakse lõpus
db.exec("PRAGMA temp_store = MEMORY");
db.exec("PRAGMA cache_size = -262144"); // ~256MB lehe vahemälu

// Laadi skeem (dump.sql)
const schemaSql = await Bun.file(SCHEMA_FILE).text();
db.exec(schemaSql);

console.log("Skeem laetud, alustan andmete sisestust...\n");

// ---------------------------------------------------------------------
// ABIFUNKTSIOON: partiipõhine mass-sisestus ühe transaktsiooniga partii kaupa
// ---------------------------------------------------------------------
function seedTable<T extends unknown[]>(
  label: string,
  total: number,
  sql: string,
  generator: (rowIndex: number) => T
): void {
  const stmt = db.prepare(sql);
  const insertBatch = db.transaction((rows: T[]) => {
    for (const row of rows) stmt.run(...row);
  });

  const t0 = performance.now();
  let inserted = 0;
  while (inserted < total) {
    const batchSize = Math.min(CONFIG.BATCH_SIZE, total - inserted);
    const batch: T[] = new Array(batchSize);
    for (let i = 0; i < batchSize; i++) {
      batch[i] = generator(inserted + i + 1);
    }
    insertBatch(batch);
    inserted += batchSize;
  }
  const t1 = performance.now();
  console.log(
    `  ${label.padEnd(14)} ${inserted.toLocaleString("et-EE").padStart(10)} rida` +
      `  (${((t1 - t0) / 1000).toFixed(2)}s)`
  );
}

const overallStart = performance.now();

// ---------------------------------------------------------------------
// 1. LOOKUP: kategooriad ja tellimuse staatused (sisestatakse esimesena,
//    kuna products ja orders viitavad nendele)
// ---------------------------------------------------------------------
{
  const insCat = db.prepare(`INSERT INTO categories (name) VALUES (?)`);
  for (const c of CATEGORIES) insCat.run(c);

  const insStatus = db.prepare(`INSERT INTO order_statuses (name) VALUES (?)`);
  for (const s of ORDER_STATUSES) insStatus.run(s);

  console.log(
    `  ${"categories".padEnd(14)} ${CATEGORIES.length.toString().padStart(10)} rida`
  );
  console.log(
    `  ${"order_statuses".padEnd(14)} ${ORDER_STATUSES.length.toString().padStart(10)} rida`
  );
}

// ---------------------------------------------------------------------
// 2. CUSTOMERS (viidatav tabel orders jaoks)
// ---------------------------------------------------------------------
seedTable(
  "customers",
  CONFIG.CUSTOMERS,
  `INSERT INTO customers (name, email, city, country, created_at) VALUES (?, ?, ?, ?, ?)`,
  (id) => {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const name = `${first} ${last}`;
    // id lisatud e-posti aadressile, et tagada unikaalsus 150k kirje juures
    const email = `${first}.${last}.${id}@${faker.internet.domainName()}`.toLowerCase();
    const isEstonian = Math.random() < 0.7; // enamik kliente Eestist
    const city = isEstonian
      ? faker.helpers.arrayElement(ESTONIAN_CITIES)
      : faker.location.city();
    const country = isEstonian ? "Estonia" : faker.location.country();
    const createdAt = faker.date
      .between({ from: "2022-01-01", to: "2026-06-14" })
      .toISOString();
    return [name, email, city, country, createdAt] as const;
  }
);

// ---------------------------------------------------------------------
// 3. PRODUCTS (viidatav tabel order_items jaoks)
// ---------------------------------------------------------------------
seedTable(
  "products",
  CONFIG.PRODUCTS,
  `INSERT INTO products (name, category_id, price) VALUES (?, ?, ?)`,
  () => {
    const name = faker.commerce.productName();
    const categoryId = faker.number.int({ min: 1, max: CATEGORIES.length });
    // Paremale kaldu jaotus: enamik tooteid odavad, mõned kallid
    const price = Number((Math.random() * Math.random() * 1990 + 0.99).toFixed(2));
    return [name, categoryId, price] as const;
  }
);

// ---------------------------------------------------------------------
// 4. ORDERS (viitab customers ja order_statuses)
// ---------------------------------------------------------------------
seedTable(
  "orders",
  CONFIG.ORDERS,
  `INSERT INTO orders (customer_id, status_id, order_date) VALUES (?, ?, ?)`,
  () => {
    const customerId = faker.number.int({ min: 1, max: CONFIG.CUSTOMERS });
    const statusId = weightedStatusId();
    const orderDate = faker.date
      .between({ from: "2022-01-01", to: "2026-06-14" })
      .toISOString()
      .slice(0, 10);
    return [customerId, statusId, orderDate] as const;
  }
);

// ---------------------------------------------------------------------
// 5. ORDER_ITEMS — sihttabel (>= 2 000 000 rida)
//    Iga tellimus saab 2-4 rida (keskm. ~3), seega 700k * ~3 = ~2.1M rida.
//    unit_price võetakse toote praegusest hinnast (ostuhetke "snapshot").
// ---------------------------------------------------------------------
{
  const productPrices = db
    .prepare(`SELECT id, price FROM products`)
    .all() as { id: number; price: number }[];

  const insItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)`
  );
  const insertItemBatch = db.transaction(
    (rows: [number, number, number, number][]) => {
      for (const row of rows) insItem.run(...row);
    }
  );

  const t0 = performance.now();
  let totalItems = 0;
  let batch: [number, number, number, number][] = [];

  for (let orderId = 1; orderId <= CONFIG.ORDERS; orderId++) {
    const itemCount = faker.number.int({
      min: CONFIG.ITEMS_PER_ORDER_MIN,
      max: CONFIG.ITEMS_PER_ORDER_MAX,
    });
    for (let j = 0; j < itemCount; j++) {
      const p = productPrices[faker.number.int({ min: 0, max: productPrices.length - 1 })];
      const quantity = faker.number.int({ min: 1, max: 5 });
      batch.push([orderId, p.id, quantity, p.price]);
      totalItems++;
      if (batch.length >= CONFIG.BATCH_SIZE) {
        insertItemBatch(batch);
        batch = [];
      }
    }
  }
  if (batch.length > 0) insertItemBatch(batch);

  const t1 = performance.now();
  console.log(
    `  ${"order_items".padEnd(14)} ${totalItems.toLocaleString("et-EE").padStart(10)} rida` +
      `  (${((t1 - t0) / 1000).toFixed(2)}s)`
  );
}

const dataLoadEnd = performance.now();

// ---------------------------------------------------------------------
// 6. INDEKSITE TAASTAMINE (pärast mass-sisestust)
// ---------------------------------------------------------------------
console.log("\nLoon indeksid...");
const idxStart = performance.now();
db.exec(`
  CREATE INDEX idx_products_category_id   ON products(category_id);
  CREATE INDEX idx_orders_customer_id      ON orders(customer_id);
  CREATE INDEX idx_orders_status_id        ON orders(status_id);
  CREATE INDEX idx_orders_order_date       ON orders(order_date);
  CREATE INDEX idx_order_items_order_id    ON order_items(order_id);
  CREATE INDEX idx_order_items_product_id  ON order_items(product_id);
`);
const idxEnd = performance.now();
console.log(`  6 indeksit loodud (${((idxEnd - idxStart) / 1000).toFixed(2)}s)`);

// ---------------------------------------------------------------------
// 7. FK TÄHENDUSE TAASTAMINE + INTEGRITEEDI KONTROLL
// ---------------------------------------------------------------------
db.exec("PRAGMA foreign_keys = ON");
const fkIssues = db.prepare("PRAGMA foreign_key_check").all();
if (fkIssues.length > 0) {
  console.error("\n❌ FK INTEGRITEEDI VIGA leitud:", fkIssues);
  process.exit(1);
}
console.log("\n✅ FK integriteedi kontroll: orpaneid kirjeid ei leitud.");

// Taasta normaalsed kettale kirjutamise sätted edasiseks kasutamiseks
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec("ANALYZE");

// ---------------------------------------------------------------------
// 8. KOKKUVÕTE
// ---------------------------------------------------------------------
const tables = [
  "categories",
  "order_statuses",
  "customers",
  "products",
  "orders",
  "order_items",
];
const counts: Record<string, number> = {};
for (const t of tables) {
  counts[t] = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number }).c;
}

const overallEnd = performance.now();

console.log("\n=== KOKKUVÕTE ===");
for (const t of tables) {
  console.log(`  ${t.padEnd(16)} ${counts[t].toLocaleString("et-EE").padStart(10)} rida`);
}
console.log(`\n  Andmete laadimine: ${((dataLoadEnd - overallStart) / 1000).toFixed(2)}s`);
console.log(`  Indeksite loomine: ${((idxEnd - idxStart) / 1000).toFixed(2)}s`);
console.log(`  Kokku:             ${((overallEnd - overallStart) / 1000).toFixed(2)}s`);
console.log(`\n  Andmebaasi fail: ${DB_FILE}`);

db.close();
