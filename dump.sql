-- =====================================================================
-- dump.sql — e-poe andmebaasi skeem (SQLite)
-- =====================================================================
-- Skeemi kaardistus:
--   LOOKUP tabelid    -> categories, order_statuses (väikesed, fikseeritud
--                        viiteandmed, ei kasva tellimuste arvuga)
--   MITTE-LOOKUP      -> customers, products, orders, order_items
--                        (kasvavad äritehingute andmed)
--
-- Indeksite strateegia:
--   Mass-sisestuse ajaks on siin ainult primaarvõtmed (need loovad SQLite-s
--   automaatselt indeksi) ja FK-veerud. Sekundaarsed indeksid (FK-veergudele
--   ja päringutes kasutatavatele väljadele) loob seed.ts pärast andmete
--   laadimist (vt "INDEKSITE TAASTAMINE" osa seedimisskriptis).
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- LOOKUP: tootekategooriad (fikseeritud loend, ~12 rida)
-- ---------------------------------------------------------------------
CREATE TABLE categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------
-- LOOKUP: tellimuse staatused (fikseeritud loend, 5 rida)
-- ---------------------------------------------------------------------
CREATE TABLE order_statuses (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------
-- MITTE-LOOKUP: kliendid
-- ---------------------------------------------------------------------
CREATE TABLE customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    city       TEXT NOT NULL,
    country    TEXT NOT NULL DEFAULT 'Estonia',
    created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- MITTE-LOOKUP: tooted (kataloog)
-- ---------------------------------------------------------------------
CREATE TABLE products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    price       NUMERIC NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- ---------------------------------------------------------------------
-- MITTE-LOOKUP: tellimused
-- Klient kustutamisel kustuvad ka tema tellimused (ON DELETE CASCADE),
-- nagu algses andmebaas-skeemis.
-- ---------------------------------------------------------------------
CREATE TABLE orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    status_id   INTEGER NOT NULL,
    order_date  TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (status_id)   REFERENCES order_statuses(id)
);

-- ---------------------------------------------------------------------
-- MITTE-LOOKUP: tellimuse read (sihttabel >= 2 000 000 rea jaoks)
-- Tellimuse kustutamisel kustuvad ka selle read (ON DELETE CASCADE).
-- unit_price hoiab ostuhetke hinna (price snapshot), nagu päris e-poes.
-- ---------------------------------------------------------------------
CREATE TABLE order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity   INTEGER NOT NULL,
    unit_price NUMERIC NOT NULL,
    FOREIGN KEY (order_id)   REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);
