# epood-tellimuste-andmebaas

Suuremahuline, reprodutseeritav seemneandmestik e-poe andmebaasile (kliendid,
tooted, tellimused, tellimuse read). Andmed genereeritakse **Bun**-iga,
kasutades sisseehitatud `bun:sqlite` moodulit ja `@faker-js/faker` teeki.
Sihttabel `order_items` saavutab **≥ 2 000 000 rida**.

## Sisukord

- [Eeldused](#eeldused)
- [1. Andmebaasi loomine ja skeemi (dump.sql) laadimine](#1-andmebaasi-loomine-ja-skeemi-dumpsql-laadimine)
- [2. Seemneskripti käivitamine](#2-seemneskripti-käivitamine)
- [Oodatud tulemus](#oodatud-tulemus)
- [Skeemi kaardistus: lookup vs mitte-lookup](#skeemi-kaardistus-lookup-vs-mitte-lookup)
- [Mahtude põhjendus](#mahtude-põhjendus)
- [Andmete ehtsus](#andmete-ehtsus)
- [Terviklus (FK, orvukirjed)](#terviklus-fk-orvukirjed)
- [Mass-sisestus ja indeksite strateegia](#mass-sisestus-ja-indeksite-strateegia)
- [Reprodutseeritavus](#reprodutseeritavus)
- [Andmebaasi kontrollimine pärast seedimist](#andmebaasi-kontrollimine-pärast-seedimist)
- [Failistruktuur](#failistruktuur)

## Eeldused

- **Bun** v1.1 või uuem ([bun.sh](https://bun.sh)) — sisaldab `bun:sqlite`,
  eraldi SQLite teeki paigaldama ei pea.
- **sqlite3 CLI** (valikuline) — vajalik vaid `dump.sql` käsitsi laadimiseks
  kontrollimise eesmärgil (enamikus Linux/macOS süsteemides juba olemas).
- **.env väärtused**: ei ole vajalikud. Andmebaas on failipõhine SQLite
  (`epood.db` projekti juurkaustas). Soovi korral saab faili asukohta muuta
  `seed.ts` failis konstandiga `DB_FILE`.
- Vaba kettaruumi: ~200 MB (lõplik `epood.db` on ligikaudu 165–180 MB).

## 1. Andmebaasi loomine ja skeemi (`dump.sql`) laadimine

Seemneskript (`seed.ts`) loeb ja rakendab `dump.sql` automaatselt enne
andmete sisestamist — **eraldi käsku ei ole kohustuslik käivitada**.

Kui soovid skeemi eraldi luua/kontrollida (nt enne seedimist üle vaadata),
saab seda teha `sqlite3` CLI-ga:

```bash
sqlite3 epood.db < dump.sql
```

Selle käsuga tekib tühi andmebaas, milles on tabelid:
`categories`, `order_statuses`, `customers`, `products`, `orders`,
`order_items` (võõrvõtmetega, kuid veel ilma sekundaarsete indeksiteta —
need lisab seedimisskript pärast täitmist).

> Kui käivitad selle eraldi sammuna, kustuta enne `seed.ts` käivitamist
> tekkinud `epood.db`, sest seedimisskript loob andmebaasi failina uuesti
> (nullist) ja rakendab `dump.sql` ka iseseisvalt.

## 2. Seemneskripti käivitamine

```bash
# Sõltuvuste paigaldamine
bun install

# Andmebaasi loomine + täitmine suuremahuliste andmetega
bun run seed.ts
# või: bun run seed
```

Skript:

1. kustutab olemasoleva `epood.db` (kui on),
2. loob uue andmebaasi ja rakendab `dump.sql` skeemi,
3. täidab tabelid partiipõhiselt (vt [Mass-sisestus](#mass-sisestus-ja-indeksite-strateegia)),
4. loob sekundaarsed indeksid,
5. lülitab sisse FK kontrolli ja kontrollib orvukirjete puudumist
   (`PRAGMA foreign_key_check`),
6. väljastab kokkuvõtte (read tabelite kaupa + kestus).

## Oodatud tulemus

Käivitamise lõpus väljastatakse selline kokkuvõte (täpsed väärtused on
fikseeritud seemne tõttu deterministlikud):

| Tabel            | Tüüp         |          Ridu | Märkus                         |
|------------------|--------------|---------------:|---------------------------------|
| `categories`     | lookup       |             12 | fikseeritud viiteandmed          |
| `order_statuses` | lookup       |              5 | fikseeritud viiteandmed          |
| `customers`      | mitte-lookup |        150 000 |                                  |
| `products`       | mitte-lookup |          8 000 |                                  |
| `orders`         | mitte-lookup |        700 000 |                                  |
| **`order_items`**| mitte-lookup | **≈ 2 099 000**| **≥ 2 000 000 ✅ sihttabel**     |

Kokku ~2,96 miljonit rida.

**Kestus**: andmete genereerimise loogika on testitud samaväärsel skaalal
Node.js + `node:sqlite` peal (samad mahud, partiid ja algoritm, mida
`seed.ts` kasutab bun:sqlite kaudu): andmete laadimine ~10 s, indeksite
loomine ~5 s, kokku **~15–20 sekundit** tavalisel arvutil. Bun-iga
(`bun:sqlite`) on jõudlus üldjuhul samaväärne või kiirem.

## Skeemi kaardistus: lookup vs mitte-lookup

| Tabel            | Tüüp         | Sisestusjärjekord | Põhjus                                                      |
|------------------|--------------|-------------------|--------------------------------------------------------------|
| `categories`     | lookup       | 1                 | fikseeritud 12 kategooriat, ei kasva andmemahuga             |
| `order_statuses` | lookup       | 1                 | fikseeritud 5 staatust, ei kasva andmemahuga                  |
| `customers`      | mitte-lookup | 2                 | viidatav `orders.customer_id` poolt                           |
| `products`       | mitte-lookup | 3                 | viidatav `order_items.product_id` ja `products.category_id` poolt |
| `orders`         | mitte-lookup | 4                 | viidatav `order_items.order_id` poolt, viitab `customers` ja `order_statuses`-le |
| `order_items`    | mitte-lookup | 5 (viimane)       | viitab `orders`-le ja `products`-le — kõik vanemtabelid juba täidetud |

Sisestusjärjekord tagab, et FK viited osutavad alati juba olemasolevatele
vanemkirjetele (vanemad enne lapsi).

## Mahtude põhjendus

- **`order_items` (~2,1M)** — sihttabel ≥ 2M nõude jaoks. Igale tellimusele
  genereeritakse 2–4 rida (keskmiselt ~3), mistõttu see tabel on loomulikult
  suurim — täpselt nagu päris e-poes on "ostukorvi read" suurim fact-tabel.
- **`orders` (700 000)** — põhitehingute tabel. Iga klient teeb keskmiselt
  ~4,7 tellimust 4,5-aastase perioodi (2022–2026) jooksul, mis on realistlik
  e-poe lojaalse kliendibaasi jaoks.
- **`customers` (150 000)** — kliendibaas, mis on proportsioonis
  tellimuste arvuga (1 klient : ~4,7 tellimust).
- **`products` (8 000)**  — keskmise suurusega e-poe kataloog, jaotatud 12
  kategooria vahel (~667 toodet/kategooria). Tooted on suhteliselt
  staatiline andmestik (kataloog ei kasva proportsionaalselt tellimustega),
  mistõttu hoitakse seda tunduvalt väiksemana kui tehingutabeleid.
- **`categories` (12) ja `order_statuses` (5)** — lookup tabelid, sisu on
  käsitsi kureeritud ja fikseeritud.

## Andmete ehtsus

- **Nimed**: `faker.person.firstName/lastName` — realistlikud rahvusvahelised
  ees- ja perekonnanimed.
- **E-posti aadressid**: tuletatud nime + unikaalse ID + domeeni põhjal
  (`eesnimi.perenimi.id@domeen`), garanteerib unikaalsuse 150 000 kliendi
  juures.
- **Linnad/riigid**: ~70% klientidest on Eestist (linnad: Tallinn, Tartu,
  Narva, Pärnu, Viljandi, Rakvere, Maardu, Kuressaare, Sillamäe, Võru, Valga,
  Haapsalu), ~30% rahvusvahelised (Faker `location.city`/`location.country`).
- **Tooted**: `faker.commerce.productName()`, jaotatud 12 realistliku
  kategooria vahel.
- **Hinnad**: paremale kaldu jaotus (`Math.random() * Math.random()`) —
  enamik tooteid odavad (alla ~50 €), väiksem osa kallid (kuni ~2000 €),
  nagu päris e-poe sortimendis.
- **Tellimuse kuupäevad**: ühtlaselt jaotatud 2022-01-01 kuni 2026-06-14
  vahemikus.
- **Tellimuse staatused**: kaalutud jaotus — `delivered` 60%, `paid`/`shipped`
  15% kumb, `new`/`cancelled` 5% kumb — peegeldab tüüpilist e-poe tellimuste
  staatuste jaotust.
- **`order_items.unit_price`**: võetakse toote hetkehinnast ostu "snapshot"-ina
  (nii nagu päris süsteemis säilitatakse ostuhetke hind, mitte hilisem
  muudetud hind).

## Terviklus (FK, orvukirjed)

- Kõik võõrvõtmed on defineeritud `dump.sql`-is (`ON DELETE CASCADE`
  tellimuste ja tellimuse ridade kustutamisel, nagu algses
  `andmebaas/schema.sql` skeemis).
- Andmete genereerimisel viidatakse alati ID-vahemikele, mis on **juba
  sisestatud** (vanemtabelid täidetakse enne lapstabeleid — vt
  [sisestusjärjekord](#skeemi-kaardistus-lookup-vs-mitte-lookup)), seega
  orvukirjeid tekkida ei saa.
- Mass-sisestuse ajaks on `PRAGMA foreign_keys = OFF` (jõudluse huvides —
  SQLite ei kontrolli FK-d rea kaupa). Pärast sisestust lülitatakse
  `PRAGMA foreign_keys = ON` ja käivitatakse `PRAGMA foreign_key_check`,
  mis **peab tagastama tühja tulemuse**. Kui leitakse probleeme, skript
  väljastab vea ja lõpetab käivituse koodiga 1.

## Mass-sisestus ja indeksite strateegia

- **Partiipõhine sisestus**: igale tabelile kasutatakse `db.prepare()`
  ettevalmistatud lauset koos `db.transaction()`-iga, mis pakib iga
  `BATCH_SIZE = 5000` rea partii **ühte transaktsiooni** (BEGIN/COMMIT) —
  mitte rida-realt.
- **Indeksite strateegia**: `dump.sql` sisaldab ainult primaarvõtmeid (mis
  loovad SQLite-s automaatselt indeksi) ja FK-veerge — **ühtegi
  sekundaarset indeksit ei luuda enne andmete laadimist**. Pärast
  mass-sisestust loob `seed.ts` 6 indeksit:
  - `idx_products_category_id`
  - `idx_orders_customer_id`
  - `idx_orders_status_id`
  - `idx_orders_order_date`
  - `idx_order_items_order_id`
  - `idx_order_items_product_id`
- **Sisestusaegsed PRAGMA sätted** (jõudluse jaoks): `journal_mode = MEMORY`,
  `synchronous = OFF`, `foreign_keys = OFF`, `temp_store = MEMORY`,
  suurendatud `cache_size`. Pärast laadimist taastatakse
  `journal_mode = WAL` ja `synchronous = NORMAL` tavakasutuseks ning
  käivitatakse `ANALYZE` planeerija statistika jaoks.

## Reprodutseeritavus

Skripti algusesse on kõvakodeeritud fikseeritud seeme:

```ts
const SEED = 20260614;
faker.seed(SEED);
```

Sama Bun/Faker versiooniga (`@faker-js/faker ^10.4.0`, fikseeritud
`package.json`-is) annab `bun run seed.ts` **iga kord identse
andmestiku** — sama read counts, samad nimed/e-postid/hinnad/kuupäevad.
Kui soovid teist andmestikku, muuda `SEED` konstanti `seed.ts` failis.

## Andmebaasi kontrollimine pärast seedimist

```bash
sqlite3 epood.db

-- Ridade arv tabelite kaupa
SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items;

-- Orvukirjete kontroll (peab tagastama 0 rida)
PRAGMA foreign_key_check;

-- Indeksite nimekiri
SELECT name FROM sqlite_master WHERE type = 'index';

-- Näide: top 5 enim müüdud toodet
SELECT p.name, SUM(oi.quantity) AS total_qty
FROM order_items oi
JOIN products p ON p.id = oi.product_id
GROUP BY p.id
ORDER BY total_qty DESC
LIMIT 5;
```

## Failistruktuur

```
epood-tellimuste-andmebaas/
├── dump.sql        # andmebaasi skeem (tabelid + FK-d, ilma sekundaarsete indeksiteta)
├── seed.ts         # Bun seemneskript: laeb dump.sql, täidab andmed, loob indeksid
├── package.json    # sõltuvused (@faker-js/faker) ja "seed" skript
├── README.md       # see fail
└── .gitignore      # epood.db, node_modules jms väljajätt versioonihaldusest
```
