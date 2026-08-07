-- 0003: what the menú includes, and when it's served. Both are part of "the desired
-- information" for a menú del día and are frequently stated on the page even when the
-- individual dishes are not.
alter table menu_offers add column if not exists includes_text text;
alter table menu_offers add column if not exists served_text text;
