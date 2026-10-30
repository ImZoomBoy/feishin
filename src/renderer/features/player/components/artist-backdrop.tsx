import { useQueries } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { useFullScreenPlayerStore, usePlayerSong } from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';

const ROTATE_INTERVAL_MS = 12000;

// TheAudioDB's public test key. Fanart fields are 1280x720 backdrops.
const AUDIODB_URL = 'https://www.theaudiodb.com/api/v1/json/123/search.php?s=';
const AUDIODB_FANART_FIELDS = [
    'strArtistFanart',
    'strArtistFanart2',
    'strArtistFanart3',
    'strArtistFanart4',
] as const;

// fanart.tv artist backgrounds are 1920x1080 and need a (free) personal API key.
const FANART_TV_URL = 'https://webservice.fanart.tv/v3/music/';

interface ArtistPhotos {
    // Sharp 16:9 photos, best first
    backdrops: string[];
    // Lower resolution photos, only used when there are no backdrops
    fallbacks: string[];
}

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

const fetchJson = async (url: string) => {
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
};

const fetchArtistPhotos = async (name: string, fanartApiKey?: string): Promise<ArtistPhotos> => {
    const artist = (await fetchJson(AUDIODB_URL + encodeURIComponent(name)))?.artists?.[0];
    if (!artist) return { backdrops: [], fallbacks: [] };

    const audioDbFanart: string[] = AUDIODB_FANART_FIELDS.map((field) => artist[field]).filter(
        Boolean,
    );

    let fanartTv: string[] = [];
    if (fanartApiKey && artist.strMusicBrainzID) {
        const data = await fetchJson(
            `${FANART_TV_URL}${artist.strMusicBrainzID}?api_key=${encodeURIComponent(fanartApiKey)}`,
        );
        fanartTv = (data?.artistbackground ?? []).map((image: { url: string }) => image.url);
    }

    const backdrops = [...shuffle(fanartTv), ...shuffle(audioDbFanart)];
    // The wide thumb is also 16:9 but smaller (1000x562), so only add it for variety
    if (backdrops.length < 3 && artist.strArtistWideThumb)
        backdrops.push(artist.strArtistWideThumb);

    return {
        backdrops,
        fallbacks: [artist.strArtistThumb].filter(Boolean),
    };
};

const preload = (url: string) =>
    new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
    });

// Full screen player background that rotates through photos of the current song's artist.
// Falls back to the artist image from the music server.
export const ArtistBackdrop = ({ className }: { className: string }) => {
    const song = usePlayerSong();
    const fanartApiKey = useFullScreenPlayerStore((state) => state.fanartApiKey)?.trim();

    // Song artists first (the performers), then the album artist, e.g. for compilations
    const artists = useMemo(() => {
        const all = [...(song?.artists ?? []), ...(song?.albumArtists ?? [])];
        return all.filter((a, i) => a.name && all.findIndex((b) => b.name === a.name) === i);
    }, [song?.artists, song?.albumArtists]);

    const primary = artists[0];

    const serverImageUrl = useItemImageUrl({
        id: primary ? primary.imageId || primary.id : undefined,
        imageUrl: primary?.imageUrl,
        itemType: LibraryItem.ARTIST,
        size: 1500,
    });

    const results = useQueries({
        queries: artists.slice(0, 3).map((artist) => ({
            gcTime: Infinity,
            queryFn: () => fetchArtistPhotos(artist.name, fanartApiKey),
            queryKey: ['artist-photos', artist.name, Boolean(fanartApiKey)],
            retry: false,
            staleTime: Infinity,
        })),
    });

    const photoKey = results.map((r) => r.dataUpdatedAt).join();

    const images = useMemo(() => {
        const sets = results.map((r) => r.data).filter(Boolean) as ArtistPhotos[];
        // Prefer the main artist, but add other artists' photos for variety
        const backdrops = sets.flatMap((set) => set.backdrops);
        if (backdrops.length) return [...new Set(backdrops)];
        if (serverImageUrl) return [serverImageUrl];
        return [...new Set(sets.flatMap((set) => set.fallbacks))].slice(0, 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [photoKey, serverImageUrl]);

    const [index, setIndex] = useState(0);
    const [url, setUrl] = useState<string>();

    // Start from the first photo whenever the photo list changes (e.g. new artist)
    useEffect(() => setIndex(0), [images]);

    useEffect(() => {
        if (images.length < 2) return undefined;
        const timer = setInterval(() => setIndex((value) => value + 1), ROTATE_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [images]);

    // Only swap once the next photo has loaded, so it never fades into a blank frame
    useEffect(() => {
        const next = images.length ? images[index % images.length] : undefined;
        if (!next) {
            setUrl(undefined);
            return undefined;
        }

        let cancelled = false;
        preload(next).then(() => {
            if (!cancelled) setUrl(next);
        });

        // Warm up the photo after this one
        if (images.length > 1) preload(images[(index + 1) % images.length]);

        return () => {
            cancelled = true;
        };
    }, [images, index]);

    return (
        <AnimatePresence initial={false}>
            {url && (
                <motion.div
                    animate={{ opacity: 1 }}
                    className={className}
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key={url}
                    style={{ backgroundImage: `url("${url}")`, backgroundPosition: 'center 25%' }}
                    transition={{ duration: 1.5, ease: 'linear' }}
                />
            )}
        </AnimatePresence>
    );
};
