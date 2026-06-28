-- Allow all image and video types in journal-photos bucket.
-- Previously only 5 image types were allowed; videos were always rejected,
-- and encrypted uploads (application/octet-stream) were also rejected.
-- We upload encrypted blobs but declare the original file's content-type
-- so the allowed list must cover all types AddEntry accepts (image/* + video/*).

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg', 'video/x-m4v',
  'application/octet-stream'
]
where id = 'journal-photos';
