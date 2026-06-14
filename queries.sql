-- =====================================================================
-- queries.sql — 6 äriliselt kasulikku SELECT päringut
-- Andmebaas: epood-tellimuste-andmebaas (epood.db)
-- Tabelid: categories, order_statuses, customers, products, orders, order_items
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Töötlemist vajavad tellimused (staatus 'new')
-- Kes kasutab: e-poe operaator/laotöötaja, igapäevaselt
-- Miks oluline: näitab, millised tellimused on alles sisestatud ja vajavad
-- veel kinnitamist/komplekteerimist — aitab töövoogu juhtida.
-- ---------------------------------------------------------------------
SELECT
    o.id          AS order_id,
    c.name        AS customer_name,
    c.email,
    c.city,
    o.order_date,
    os.name       AS status
FROM orders o
JOIN customers c       ON c.id = o.customer_id
JOIN order_statuses os ON os.id = o.status_id
WHERE os.name = 'new'
ORDER BY o.order_date ASC;


-- ---------------------------------------------------------------------
-- 2. Käive ja müügimaht kategooriate kaupa
-- Kes kasutab: pood juhtkond/sisseostja, kuu/kvartali aruandluseks
-- Miks oluline: näitab, millised tootekategooriad toovad enim käivet ja
-- müügimahtu — aitab otsustada, kuhu suunata sisseostu/turunduse eelarvet.
-- ---------------------------------------------------------------------
SELECT
    cat.name                                  AS category,
    COUNT(DISTINCT oi.order_id)               AS orders_count,
    SUM(oi.quantity)                          AS units_sold,
    ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue
FROM order_items oi
JOIN products p   ON p.id = oi.product_id
JOIN categories cat ON cat.id = p.category_id
GROUP BY cat.id, cat.name
ORDER BY revenue DESC;


-- ---------------------------------------------------------------------
-- 3. Top 10 enimmüüdud toodet
-- Kes kasutab: sisseostja/laojuht
-- Miks oluline: näitab populaarseimaid tooteid müügimahu ja käibe järgi —
-- aitab otsustada, milliseid tooteid laos kindlasti hoida/järjekorda panna.
-- ---------------------------------------------------------------------
SELECT
    p.name                                     AS product_name,
    cat.name                                   AS category,
    SUM(oi.quantity)                           AS units_sold,
    ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue
FROM order_items oi
JOIN products p    ON p.id = oi.product_id
JOIN categories cat ON cat.id = p.category_id
GROUP BY p.id, p.name, cat.name
ORDER BY units_sold DESC
LIMIT 10;


-- ---------------------------------------------------------------------
-- 4. Lojaalsed/suurkliendid (vähemalt 10 mittetühistatud tellimust)
-- Kes kasutab: turundus, lojaalsusprogrammi haldamine
-- Miks oluline: leiab aktiivseimad ja suurima käibega kliendid, kellele
-- saab pakkuda näiteks personaalseid soodustusi või VIP-staatust.
-- ---------------------------------------------------------------------
SELECT
    cu.id                                       AS customer_id,
    cu.name,
    cu.email,
    cu.city,
    COUNT(DISTINCT o.id)                        AS total_orders,
    ROUND(SUM(oi.quantity * oi.unit_price), 2)  AS total_spent
FROM customers cu
JOIN orders o        ON o.customer_id = cu.id
JOIN order_statuses os ON os.id = o.status_id
JOIN order_items oi  ON oi.order_id = o.id
WHERE os.name != 'cancelled'
GROUP BY cu.id, cu.name, cu.email, cu.city
HAVING COUNT(DISTINCT o.id) >= 10
ORDER BY total_spent DESC
LIMIT 20;


-- ---------------------------------------------------------------------
-- 5. Tellimuste tühistamise määr kuude kaupa
-- Kes kasutab: pood juhtkond, kvaliteedi/kliendirahulolu jälgimine
-- Miks oluline: trendi jälgides saab tuvastada perioode, kus tühistamiste
-- osakaal järsult tõuseb (nt tarneprobleem, vale hind) ja sekkuda.
-- ---------------------------------------------------------------------
SELECT
    strftime('%Y-%m', o.order_date)                                     AS month,
    COUNT(*)                                                            AS total_orders,
    COUNT(CASE WHEN os.name = 'cancelled' THEN 1 END)                   AS cancelled_orders,
    ROUND(100.0 * COUNT(CASE WHEN os.name = 'cancelled' THEN 1 END)
          / COUNT(*), 2)                                                AS cancel_rate_pct
FROM orders o
JOIN order_statuses os ON os.id = o.status_id
GROUP BY month
ORDER BY month;


-- ---------------------------------------------------------------------
-- 6. Kliendibaas ja keskmine tellimuse väärtus riikide kaupa
-- Kes kasutab: turundus/logistika, rahvusvahelise strateegia planeerimisel
-- Miks oluline: näitab, kust kliendid pärit on, kui palju tellimusi sealt
-- tuleb ja kui suur on keskmine ostukorvi väärtus — aitab otsustada, kuhu
-- suunata kohaletoimetamise ressursse ja sihitud turundust.
-- ---------------------------------------------------------------------
SELECT
    cu.country,
    COUNT(DISTINCT cu.id)            AS customers_count,
    COUNT(DISTINCT o.id)             AS orders_count,
    ROUND(AVG(ot.order_total), 2)    AS avg_order_value
FROM customers cu
JOIN orders o ON o.customer_id = cu.id
JOIN (
    SELECT order_id, SUM(quantity * unit_price) AS order_total
    FROM order_items
    GROUP BY order_id
) ot ON ot.order_id = o.id
GROUP BY cu.country
ORDER BY orders_count DESC;
