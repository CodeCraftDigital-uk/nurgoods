update public.zendrop_sourcing_rules
set enabled = true,
    continuous_sourcing = true,
    batch_size = 25,
    daily_import_cap = 600,
    updated_at = now()
where id = 'default';