import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { usePlayerSong } from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';

const ROTATE_INTERVAL_MS = 20000;

// TheAudioDB's public test key. Fanart fields are wide 1280x720 backdrops.
const AUDIODB_URL = 'https://www.theaudiodb.com/api/v1/json/123/search.php?s=';
const AUDIODB_IMAGE_FIELDS = [
    'strArtistFanart',
    'strArtistFanart2',
    'strArtistFanart3',
    'strArtistFanart4',
    'strArtistWideThumb',
] as const;

const fetchArtistPhotos = async (name: string): Promise<string[]> => {
    const res = await fetch(AUDIODB_URL + encodeURIComponent(name));
    if (!res.ok) return [];

    const artist = (await res.json())?.artists?.[0];
    if (!artist) return [];

    const photos: string[] = AUDIODB_IMAGE_FIELDS.map((field) => artist[field]).filter(Boolean);
    return photos.sort(() => Math.random() - 0.5);
};

// Full screen player background that rotates through photos of the current song's artist.
// Falls back to the artist image from the music server.
export const ArtistBackdrop = ({ className }: { className: string }) => {
    const song = usePlayerSong();
    const artist = song?.albumArtists?.[0] ?? song?.artists?.[0];

    const serverImageUrl = useItemImageUrl({
        id: artist ? artist.imageId || artist.id : undefined,
        imageUrl: artist?.imageUrl,
        itemType: LibraryItem.ARTIST,
        size: 1500,
    });

    const { data: photos } = useQuery({
        enabled: Boolean(artist?.name),
        gcTime: Infinity,
        queryFn: () => fetchArtistPhotos(artist!.name),
        queryKey: ['theaudiodb', 'artist-photos', artist?.name],
        retry: false,
        staleTime: Infinity,
    });

    const images = useMemo(
        () => (photos?.length ? photos : serverImageUrl ? [serverImageUrl] : []),
        [photos, serverImageUrl],
    );

    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (images.length < 2) return undefined;
        const timer = setInterval(() => setTick((value) => value + 1), ROTATE_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [images]);

    const url = images.length ? images[tick % images.length] : undefined;

    return (
        <AnimatePresence initial={false}>
            {url && (
                <motion.div
                    animate={{ opacity: 1 }}
                    className={className}
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key={url}
                    style={{ backgroundImage: `url("${url}")` }}
                    transition={{ duration: 1.5, ease: 'linear' }}
                />
            )}
        </AnimatePresence>
    );
};
