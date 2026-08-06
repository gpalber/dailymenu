-- 0002: menu pages / PDFs found by following links during a crawl are 'crawl'-discovered.
alter table crawl_sources drop constraint if exists crawl_sources_discovered_via_check;
alter table crawl_sources add constraint crawl_sources_discovered_via_check
  check (discovered_via in ('osm','tripadvisor','brave','manual','crawl'));
