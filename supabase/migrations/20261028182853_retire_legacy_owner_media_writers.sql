-- LIFE-15 / OPS-5: the removed owner tabs were the only product callers of these writers.
-- CMS publication still owns gallery_images and homepage_logo_path. Keep their read models,
-- barber-photo helpers, the generic Storage queue and every existing cleanup job unchanged.
begin;

drop function public.internal_insert_gallery_image(text, text, text, integer) restrict;
drop function public.internal_delete_gallery_image(uuid, text) restrict;
drop function public.internal_replace_homepage_logo(text, text) restrict;
drop function public.internal_remove_homepage_logo(text) restrict;

commit;
