create policy "Admins manage journal media"
on storage.objects for all
to authenticated
using (bucket_id = 'journal-media' and public.has_role(auth.uid(), 'admin'))
with check (bucket_id = 'journal-media' and public.has_role(auth.uid(), 'admin'));