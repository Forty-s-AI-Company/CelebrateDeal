import Image from "next/image";
import { Film } from "lucide-react";

export function VideoThumbnail({
  title,
  thumbnailUrl,
}: {
  title: string;
  thumbnailUrl?: string | null;
}) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-100" aria-label={`${title}縮圖`}>
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={`${title}縮圖`}
          fill
          unoptimized
          sizes="(max-width: 640px) 100vw, 220px"
          className="object-cover"
        />
      ) : (
        <div className="grid h-full place-items-center gap-1 text-center text-slate-600" role="img" aria-label={`${title}尚無縮圖`}>
          <Film size={28} aria-hidden="true" />
          <span className="text-xs font-medium">尚無縮圖</span>
        </div>
      )}
    </div>
  );
}
