import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { uploadsDir } from '@/lib/uploads';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/* ─────────────────────────────────────────
   GET /api/uploads/[...path]
   Ported equivalent of server.js's `app.use('/uploads', express.static(...))`.
   Next.js has no direct equivalent for API routes, so this serves files
   manually. NOTE: the frontend originally referenced photo URLs as
   `/uploads/...` directly (not `/api/uploads/...`) — see nav.js/api.js.
   Either rewrite those references to `/api/uploads/...`, or add a
   next.config.js rewrite from `/uploads/:path*` to `/api/uploads/:path*`
   so existing photo_url values in the DB keep working unmodified.
───────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: pathSegments } = await params;

  // Guard against path traversal — reject any segment containing '..'.
  if (pathSegments.some((seg) => seg.includes('..'))) {
    return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  }

  const filePath = path.join(uploadsDir, ...pathSegments);

  // Ensure the resolved path is still inside uploadsDir.
  if (!filePath.startsWith(uploadsDir)) {
    return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  }

  try {
    // Perf: switched from sync fs calls (existsSync/statSync/readFileSync)
    // to the fs/promises equivalents. The sync versions block Node's
    // single event loop thread for the full disk I/O duration on every
    // request — under any real concurrency (e.g. a table full of staff/
    // student thumbnails loading at once) that serializes otherwise
    //-unrelated requests behind each other. Async fs lets the event loop
    // keep serving other requests while each file read is in flight.
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const buffer = await fs.readFile(filePath);

    // Cache bug fix: these filenames are NOT content-hashed — student
    // photos are saved as <roll_no>.ext and staff photos as <cnic>.ext,
    // and saveStaffPhotoFile/savePhotoFile explicitly OVERWRITE the same
    // path on re-upload (see lib/uploads.ts). `immutable, max-age=1y`
    // told every browser to never even revalidate that URL, so a
    // re-uploaded photo kept showing the old image for up to a year.
    // ETag (content hash of the actual bytes) + a short max-age lets
    // browsers cache normally but always revalidate with a cheap 304
    // when the file is unchanged, and pick up new bytes immediately
    // (via a 200) the moment a photo is replaced.
    const etag = `"${createHash('sha1').update(buffer).digest('hex')}"`;
    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300, must-revalidate',
        ETag: etag,
      },
    });
  } catch (err: any) {
    // Covers both "file doesn't exist" (including the race where it's
    // deleted between a hypothetical exists-check and the read) and any
    // other read failure (e.g. permissions) — neither should surface as
    // an unhandled 500 crash.
    if (err?.code === 'ENOENT') {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to read file.' }, { status: 500 });
  }
}
